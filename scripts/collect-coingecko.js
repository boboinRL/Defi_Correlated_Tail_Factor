import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "data", "training_config.json");
const outputDir = join(root, "data", "generated");
const apiKey = process.env.COINGECKO_API_KEY || "";
const apiPlan = (process.env.COINGECKO_API_PLAN || "demo").toLowerCase();
const requestedDays = Number(process.env.HISTORY_DAYS || 0);

const config = JSON.parse(await readFile(configPath, "utf8"));
const historyDays = requestedDays > 0 ? requestedDays : Number(config.historyDays || 365);
const assets = config.assets || [];
const thresholds = config.thresholds || {};

if (!assets.length) throw new Error("No assets configured in data/training_config.json");

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function rolling(values, endIndex, size) {
  return values.slice(Math.max(0, endIndex - size + 1), endIndex + 1);
}

function apiSettings() {
  if (!apiKey) {
    return {
      baseUrl: "https://api.coingecko.com/api/v3",
      headers: {},
      authMode: "public"
    };
  }
  if (apiPlan === "pro") {
    return {
      baseUrl: "https://pro-api.coingecko.com/api/v3",
      headers: { "x-cg-pro-api-key": apiKey },
      authMode: "pro"
    };
  }
  return {
    baseUrl: "https://api.coingecko.com/api/v3",
    headers: { "x-cg-demo-api-key": apiKey },
    authMode: "demo"
  };
}

async function fetchJson(url, headers, attempt = 1) {
  const response = await fetch(url, { headers });
  if (response.ok) return response.json();

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await sleep(Math.max(retryAfter * 1000, attempt * 2500));
    return fetchJson(url, headers, attempt + 1);
  }

  const text = await response.text();
  throw new Error(`CoinGecko ${response.status}: ${text.slice(0, 220)}`);
}

async function fetchAsset(asset, settings) {
  const params = new URLSearchParams({
    vs_currency: "usd",
    days: String(historyDays),
    interval: "daily"
  });
  const url = `${settings.baseUrl}/coins/${encodeURIComponent(asset.id)}/market_chart?${params}`;
  const payload = await fetchJson(url, settings.headers);
  const prices = new Map((payload.prices || []).map(([timestamp, value]) => [dateKey(timestamp), Number(value)]));
  const volumes = new Map((payload.total_volumes || []).map(([timestamp, value]) => [dateKey(timestamp), Number(value)]));
  const marketCaps = new Map((payload.market_caps || []).map(([timestamp, value]) => [dateKey(timestamp), Number(value)]));
  return { ...asset, prices, volumes, marketCaps };
}

function buildAssetRows(asset) {
  const dates = [...asset.prices.keys()].sort();
  const prices = dates.map((date) => asset.prices.get(date));
  const volumes = dates.map((date) => asset.volumes.get(date) || 0);
  return dates.map((date, index) => {
    const price = prices[index];
    const previousPrice = prices[index - 1] || price;
    const previousVolume = volumes[index - 1] || volumes[index] || 0;
    const dailyReturn = previousPrice ? price / previousPrice - 1 : 0;
    const volumeChange = previousVolume ? volumes[index] / previousVolume - 1 : 0;
    const returnWindow = rolling(
      prices.map((current, position) => {
        const previous = prices[position - 1] || current;
        return previous ? current / previous - 1 : 0;
      }),
      index,
      7
    );
    const volumeWindow = rolling(volumes, index, 30);
    const volumeMean = mean(volumeWindow);
    const volumeStd = standardDeviation(volumeWindow);
    const volumeZScore = volumeStd ? (volumes[index] - volumeMean) / volumeStd : 0;
    const priceWindow = rolling(prices, index, 30);
    const peak30d = Math.max(...priceWindow);
    const drawdown30d = peak30d ? price / peak30d - 1 : 0;
    return {
      date,
      price,
      volume: volumes[index],
      marketCap: asset.marketCaps.get(date) || 0,
      dailyReturn,
      absoluteReturn: Math.abs(dailyReturn),
      rollingVolatility7d: standardDeviation(returnWindow),
      volumeChange,
      volumeZScore,
      drawdown30d,
      pegDeviation: asset.role === "stablecoin" ? Math.abs(price - 1) : 0
    };
  });
}

function aggregateDailyFactors(assetSeries) {
  const dateMap = new Map();
  for (const asset of assetSeries) {
    for (const row of asset.rows) {
      if (!dateMap.has(row.date)) dateMap.set(row.date, []);
      dateMap.get(row.date).push({ assetId: asset.id, role: asset.role, ...row });
    }
  }

  return [...dateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const marketRows = rows.filter((row) => row.role !== "stablecoin");
      const stableRows = rows.filter((row) => row.role === "stablecoin");
      const maxReturn = Math.max(0, ...marketRows.map((row) => row.absoluteReturn));
      const maxRollingVol = Math.max(0, ...marketRows.map((row) => row.rollingVolatility7d));
      const worstVolumeChange = Math.min(0, ...marketRows.map((row) => row.volumeChange));
      const worstVolumeZ = Math.min(0, ...marketRows.map((row) => row.volumeZScore));
      const maxDepeg = Math.max(0, ...stableRows.map((row) => row.pegDeviation));
      const worstDrawdown = Math.abs(Math.min(0, ...marketRows.map((row) => row.drawdown30d)));

      const volatilityScore = clamp(
        (maxReturn / Number(thresholds.volatilityReturn || 0.08)) * 0.6 +
        (maxRollingVol / Number(thresholds.volatilityRolling7d || 0.06)) * 0.4
      );
      const liquidityScore = clamp(
        (Math.abs(worstVolumeChange) / Number(thresholds.liquidityDailyVolumeDrop || 0.35)) * 0.65 +
        (Math.abs(Math.min(0, worstVolumeZ)) / Math.abs(Number(thresholds.liquidityVolumeZScore || -1.5))) * 0.35
      );
      const stablecoinScore = clamp(maxDepeg / Number(thresholds.stablecoinDepeg || 0.01));
      const oracleProxyScore = clamp(volatilityScore * 0.55 + stablecoinScore * 0.45);

      return {
        date,
        observations: rows.length,
        raw: {
          maxAbsoluteReturn: maxReturn,
          maxRollingVolatility7d: maxRollingVol,
          worstVolumeChange,
          worstVolumeZScore: worstVolumeZ,
          maxStablecoinPegDeviation: maxDepeg,
          worstDrawdown30d: worstDrawdown
        },
        factors: {
          volatility: {
            score: volatilityScore,
            active: maxReturn >= Number(thresholds.volatilityReturn || 0.08) ||
              maxRollingVol >= Number(thresholds.volatilityRolling7d || 0.06)
          },
          liquidity: {
            score: liquidityScore,
            active: worstVolumeChange <= -Number(thresholds.liquidityDailyVolumeDrop || 0.35) ||
              worstVolumeZ <= Number(thresholds.liquidityVolumeZScore || -1.5)
          },
          stablecoin: {
            score: stablecoinScore,
            active: maxDepeg >= Number(thresholds.stablecoinDepeg || 0.01)
          },
          oracle: {
            score: oracleProxyScore,
            active: oracleProxyScore >= 0.7,
            proxy: true
          }
        }
      };
    });
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const headers = [
    "date",
    "observations",
    "volatility_score",
    "volatility_active",
    "liquidity_score",
    "liquidity_active",
    "stablecoin_score",
    "stablecoin_active",
    "oracle_proxy_score",
    "oracle_proxy_active",
    "max_absolute_return",
    "max_rolling_volatility_7d",
    "worst_volume_change",
    "worst_volume_zscore",
    "max_stablecoin_peg_deviation",
    "worst_drawdown_30d"
  ];
  const dataRows = rows.map((row) => [
    row.date,
    row.observations,
    row.factors.volatility.score,
    row.factors.volatility.active,
    row.factors.liquidity.score,
    row.factors.liquidity.active,
    row.factors.stablecoin.score,
    row.factors.stablecoin.active,
    row.factors.oracle.score,
    row.factors.oracle.active,
    row.raw.maxAbsoluteReturn,
    row.raw.maxRollingVolatility7d,
    row.raw.worstVolumeChange,
    row.raw.worstVolumeZScore,
    row.raw.maxStablecoinPegDeviation,
    row.raw.worstDrawdown30d
  ]);
  return [headers, ...dataRows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

const settings = apiSettings();
console.log(`Collecting ${historyDays} days from CoinGecko (${settings.authMode}) for ${assets.length} assets...`);

const collected = [];
const failures = [];
for (const asset of assets) {
  try {
    const result = await fetchAsset(asset, settings);
    collected.push({ id: asset.id, role: asset.role, rows: buildAssetRows(result) });
    console.log(`  OK ${asset.id}: ${result.prices.size} daily prices`);
  } catch (error) {
    failures.push({ id: asset.id, error: error.message });
    console.warn(`  FAIL ${asset.id}: ${error.message}`);
  }
  await sleep(apiKey ? 700 : 1800);
}

if (!collected.length) throw new Error("No CoinGecko assets were collected.");

const dailyFactors = aggregateDailyFactors(collected);
const output = {
  metadata: {
    generatedAt: new Date().toISOString(),
    source: "CoinGecko market_chart",
    authMode: settings.authMode,
    historyDays,
    configuredAssets: assets.length,
    collectedAssets: collected.map(({ id, role }) => ({ id, role })),
    failures,
    thresholds,
    factorNotes: {
      volatility: "Observed from daily returns and rolling 7d realized volatility.",
      liquidity: "Market proxy based on volume contraction and rolling volume z-score.",
      stablecoin: "Observed from absolute USD peg deviation.",
      oracle: "Proxy only; combines market volatility and stablecoin depeg until on-chain oracle updates are collected."
    }
  },
  dailyFactors
};

await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "coingecko_daily_features.json"), JSON.stringify(output, null, 2));
await writeFile(join(outputDir, "coingecko_daily_features.csv"), toCsv(dailyFactors));

console.log(`Wrote ${dailyFactors.length} daily rows:`);
console.log(`  ${join(outputDir, "coingecko_daily_features.json")}`);
console.log(`  ${join(outputDir, "coingecko_daily_features.csv")}`);
