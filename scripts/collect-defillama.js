import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "data", "training_config.json");
const sourcesPath = join(root, "data", "market_sources.json");
const outputDir = join(root, "data", "generated");
const config = JSON.parse(await readFile(configPath, "utf8"));
const sources = JSON.parse(await readFile(sourcesPath, "utf8"));

const requestedDays = Number(process.env.HISTORY_DAYS || 0);
const historyDays = requestedDays > 0 ? requestedDays : Number(config.historyDays || 365);
const requestedStart = process.env.HISTORY_START || "";
const chain = process.env.DEFILLAMA_CHAIN || "Ethereum";
const today = new Date();
const defaultStart = new Date(Date.UTC(
  today.getUTCFullYear(),
  today.getUTCMonth(),
  today.getUTCDate() - historyDays + 1
));
const startDate = requestedStart ? new Date(`${requestedStart}T00:00:00Z`) : defaultStart;
const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

if (Number.isNaN(startDate.valueOf())) {
  throw new Error("HISTORY_START must use YYYY-MM-DD format.");
}

const API_BASE = "https://api.llama.fi";
const STABLECOIN_BASE = "https://stablecoins.llama.fi";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function dateKey(value) {
  const timestamp = Number(value);
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function dateRange(start, end) {
  const dates = [];
  for (let cursor = start.valueOf(); cursor <= end.valueOf(); cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentChange(current, previous) {
  if (current === null || previous === null || !previous) return null;
  return current / previous - 1;
}

function rollingDrawdown(values, index, size = 30) {
  const window = values
    .slice(Math.max(0, index - size + 1), index + 1)
    .filter((value) => value !== null);
  const current = values[index];
  if (current === null || !window.length) return null;
  const peak = Math.max(...window);
  return peak ? current / peak - 1 : null;
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "defi-correlated-tail-factor/1.0"
    }
  });
  if (response.ok) return response.json();

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await sleep(Math.max(retryAfter * 1000, attempt * 2000));
    return fetchJson(url, attempt + 1);
  }

  const body = await response.text();
  throw new Error(`DefiLlama ${response.status}: ${body.slice(0, 220)}`);
}

function mapChainTvl(payload) {
  return new Map(
    (Array.isArray(payload) ? payload : [])
      .map((row) => [dateKey(row.date), finiteNumber(row.tvl)])
      .filter(([, value]) => value !== null)
  );
}

function mapStablecoinSupply(payload) {
  return new Map(
    (Array.isArray(payload) ? payload : [])
      .map((row) => [
        dateKey(row.date),
        finiteNumber(row.totalCirculatingUSD?.peggedUSD ?? row.totalCirculating?.peggedUSD)
      ])
      .filter(([, value]) => value !== null)
  );
}

function mapDexVolume(payload) {
  return new Map(
    (payload?.totalDataChart || [])
      .map(([timestamp, value]) => [dateKey(timestamp), finiteNumber(value)])
      .filter(([, value]) => value !== null)
  );
}

function mapProtocolTvl(payload) {
  return new Map(
    (payload?.tvl || [])
      .map((row) => [dateKey(row.date), finiteNumber(row.totalLiquidityUSD)])
      .filter(([, value]) => value !== null)
  );
}

function protocolSources() {
  const seen = new Set();
  return Object.entries(sources.protocols || {})
    .map(([protocol, source]) => ({ protocol, slug: source.defillamaSlug }))
    .filter(({ slug }) => slug && !seen.has(slug) && seen.add(slug));
}

async function collectSource(name, url, mapper) {
  try {
    const payload = await fetchJson(url);
    const data = mapper(payload);
    console.log(`  OK ${name}: ${data.size} daily observations`);
    return { name, url, status: "ok", observations: data.size, data };
  } catch (error) {
    console.warn(`  FAIL ${name}: ${error.message}`);
    return { name, url, status: "failed", observations: 0, error: error.message, data: new Map() };
  }
}

console.log(`Collecting DefiLlama data for ${chain} from ${startDate.toISOString().slice(0, 10)}...`);

const coreSources = await Promise.all([
  collectSource(
    `${chain} chain TVL`,
    `${API_BASE}/v2/historicalChainTvl/${encodeURIComponent(chain)}`,
    mapChainTvl
  ),
  collectSource(
    "global stablecoin supply",
    `${STABLECOIN_BASE}/stablecoincharts/all`,
    mapStablecoinSupply
  ),
  collectSource(
    `${chain} DEX volume`,
    `${API_BASE}/overview/dexs/${encodeURIComponent(chain)}?excludeTotalDataChartBreakdown=true&excludeTotalDataChart=false`,
    mapDexVolume
  )
]);

const protocolResults = [];
for (const { protocol, slug } of protocolSources()) {
  const result = await collectSource(
    `${protocol} TVL`,
    `${API_BASE}/protocol/${encodeURIComponent(slug)}`,
    mapProtocolTvl
  );
  protocolResults.push({ ...result, protocol, slug });
  await sleep(250);
}

const [chainTvlSource, stablecoinSource, dexSource] = coreSources;
const dates = dateRange(startDate, endDate);
const chainTvls = dates.map((date) => chainTvlSource.data.get(date) ?? null);
const stablecoinSupplies = dates.map((date) => stablecoinSource.data.get(date) ?? null);
const dexVolumes = dates.map((date) => dexSource.data.get(date) ?? null);

const dailyFeatures = dates.map((date, index) => {
  const chainTvlUsd = chainTvls[index];
  const stablecoinSupplyUsd = stablecoinSupplies[index];
  const dexVolumeUsd = dexVolumes[index];
  const chainTvlChange1d = percentChange(chainTvlUsd, chainTvls[index - 1] ?? null);
  const stablecoinSupplyChange1d = percentChange(
    stablecoinSupplyUsd,
    stablecoinSupplies[index - 1] ?? null
  );
  const dexVolumeChange1d = percentChange(dexVolumeUsd, dexVolumes[index - 1] ?? null);
  const chainTvlDrawdown30d = rollingDrawdown(chainTvls, index);
  const dexVolumeDrawdown30d = rollingDrawdown(dexVolumes, index);

  const protocolTvlUsd = Object.fromEntries(
    protocolResults.map(({ protocol, data }) => [protocol, data.get(date) ?? null])
  );
  const protocolValues = Object.values(protocolTvlUsd).filter((value) => value !== null);
  const trackedProtocolTvlUsd = protocolValues.length
    ? protocolValues.reduce((sum, value) => sum + value, 0)
    : null;

  const tvlShock = chainTvlChange1d === null ? 0 : Math.abs(Math.min(0, chainTvlChange1d));
  const dexShock = dexVolumeChange1d === null ? 0 : Math.abs(Math.min(0, dexVolumeChange1d));
  const liquidityScore = clamp((tvlShock / 0.08) * 0.6 + (dexShock / 0.5) * 0.4);

  return {
    date,
    raw: {
      chainTvlUsd,
      chainTvlChange1d,
      chainTvlDrawdown30d,
      dexVolumeUsd,
      dexVolumeChange1d,
      dexVolumeDrawdown30d,
      stablecoinSupplyUsd,
      stablecoinSupplyChange1d,
      trackedProtocolTvlUsd,
      protocolTvlUsd
    },
    factors: {
      liquidity: {
        score: liquidityScore,
        active: tvlShock >= 0.08 || dexShock >= 0.5,
        observedFrom: ["chain_tvl", "dex_volume"]
      }
    }
  };
});

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const protocolNames = protocolResults.map(({ protocol }) => protocol);
  const headers = [
    "date",
    "chain_tvl_usd",
    "chain_tvl_change_1d",
    "chain_tvl_drawdown_30d",
    "dex_volume_usd",
    "dex_volume_change_1d",
    "dex_volume_drawdown_30d",
    "stablecoin_supply_usd",
    "stablecoin_supply_change_1d",
    "tracked_protocol_tvl_usd",
    "liquidity_score",
    "liquidity_active",
    ...protocolNames.map((name) => `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_")}_tvl_usd`)
  ];
  const data = rows.map((row) => [
    row.date,
    row.raw.chainTvlUsd,
    row.raw.chainTvlChange1d,
    row.raw.chainTvlDrawdown30d,
    row.raw.dexVolumeUsd,
    row.raw.dexVolumeChange1d,
    row.raw.dexVolumeDrawdown30d,
    row.raw.stablecoinSupplyUsd,
    row.raw.stablecoinSupplyChange1d,
    row.raw.trackedProtocolTvlUsd,
    row.factors.liquidity.score,
    row.factors.liquidity.active,
    ...protocolNames.map((name) => row.raw.protocolTvlUsd[name])
  ]);
  return [headers, ...data].map((row) => row.map(csvEscape).join(",")).join("\n");
}

const sourceStatus = [...coreSources, ...protocolResults].map((source) => ({
  name: source.name,
  url: source.url,
  status: source.status,
  observations: source.observations,
  ...(source.error ? { error: source.error } : {})
}));
const warnings = sourceStatus
  .filter(({ status }) => status !== "ok")
  .map(({ name, error }) => `${name} was unavailable: ${error}`);

const output = {
  metadata: {
    generatedAt: new Date().toISOString(),
    provider: "DefiLlama",
    authentication: "none",
    chain,
    requestedRange: {
      start: startDate.toISOString().slice(0, 10),
      end: endDate.toISOString().slice(0, 10)
    },
    sourceStatus,
    warnings,
    factorNotes: {
      liquidity: "Observed from Ethereum TVL contraction and DEX volume contraction.",
      stablecoinSupply: "System-wide circulating USD supply is retained as a feature; it is not treated as a depeg label.",
      missingValues: "Unavailable source observations remain null and are never converted to zero."
    }
  },
  dailyFeatures
};

await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "defillama_daily_features.json"), JSON.stringify(output, null, 2));
await writeFile(join(outputDir, "defillama_daily_features.csv"), toCsv(dailyFeatures));

console.log(`Wrote ${dailyFeatures.length} normalized daily rows:`);
console.log(`  ${join(outputDir, "defillama_daily_features.json")}`);
console.log(`  ${join(outputDir, "defillama_daily_features.csv")}`);
if (warnings.length) {
  console.warn(`Completed with ${warnings.length} source warning(s). See metadata.sourceStatus.`);
}
