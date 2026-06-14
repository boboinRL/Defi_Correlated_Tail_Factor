import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { promisify } from "node:util";
import { networkInterfaces } from "node:os";
import { simulateJointProbability } from "./lib/tail-model.js";
import { buildDeterministicAuditReport, persistAuditReport } from "./lib/audit-agent.js";

const port = Number(process.env.PORT || 3000);
const root = join(process.cwd(), "public");
const etherscanKey = process.env.ETHERSCAN_API_KEY || "";
const glmApiKey = process.env.GLM_API_KEY || "";
const glmApiMode = (process.env.GLM_API_MODE || "coding").toLowerCase();
const glmBaseUrl = process.env.GLM_BASE_URL || (
  glmApiMode === "standard"
    ? "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    : "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
);
const glmModel = process.env.GLM_MODEL || "glm-5.1";
const glmTimeoutMs = Number(process.env.GLM_TIMEOUT_MS || 60000);
const coingeckoKey = process.env.COINGECKO_API_KEY || "";
const duneKey = process.env.DUNE_API_KEY || "";
const duneQueryId = process.env.DUNE_QUERY_ID || "";
const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com";
const dataRoot = join(process.cwd(), "data");
const auditRoot = join(dataRoot, "generated", "audits");
const execFileAsync = promisify(execFile);
const DUMMY_EVENT_PRIOR_WEIGHT = 0.62;
const MARKET_PRIOR_WEIGHT = 0.18;
const HORIZONS = {
  "1d": 1,
  "7d": 7,
  "30d": 30
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon"
};

const knownContracts = [
  {
    chainId: 1,
    address: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
    name: "Aave V3 Pool",
    protocol: "Aave",
    category: "Lending pool",
    symbol: "A",
    tvl: "$4.8B",
    oracle: "Chainlink",
    coverage: "84%",
    audit: "2026-05-18",
    source: "Curated registry",
    baseResilience: 86,
    liquidityDepth: 0.82,
    keeperQuality: 0.78,
    governanceExposure: 0.22,
    insuranceBuffer: 0.74
  },
  {
    chainId: 1,
    address: "0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b",
    name: "Maker Vat",
    protocol: "MakerDAO",
    category: "CDP accounting core",
    symbol: "M",
    tvl: "$6.2B",
    oracle: "OSM + Median",
    coverage: "91%",
    audit: "2026-04-30",
    source: "Curated registry",
    baseResilience: 89,
    liquidityDepth: 0.88,
    keeperQuality: 0.84,
    governanceExposure: 0.18,
    insuranceBuffer: 0.81
  },
  {
    chainId: 1,
    address: "0x9d0464996170c6b9e75eed71c68b99ddedf279e8",
    name: "Curve crvUSD Controller",
    protocol: "Curve",
    category: "Soft liquidation controller",
    symbol: "C",
    tvl: "$735M",
    oracle: "TriCrypto + EMA",
    coverage: "76%",
    audit: "2026-03-11",
    source: "Curated registry",
    baseResilience: 78,
    liquidityDepth: 0.69,
    keeperQuality: 0.71,
    governanceExposure: 0.31,
    insuranceBuffer: 0.56
  },
  {
    chainId: 1,
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    name: "USDC Token",
    protocol: "Circle",
    category: "Stablecoin token",
    symbol: "U",
    tvl: "$32.0B",
    oracle: "External market feeds",
    coverage: "72%",
    audit: "2026-01-21",
    source: "Curated registry",
    baseResilience: 74,
    liquidityDepth: 0.9,
    keeperQuality: 0.62,
    governanceExposure: 0.42,
    insuranceBuffer: 0.42
  }
];

const riskFactors = [
  { id: "oracle", name: "Oracle Depeg / Lag", baseProb: 0.018, loss: 34, queue: 16, governance: 4 },
  { id: "liquidity", name: "DEX Liquidity Drain", baseProb: 0.026, loss: 42, queue: 12, governance: 3 },
  { id: "volatility", name: "Volatility Jump", baseProb: 0.031, loss: 38, queue: 18, governance: 2 },
  { id: "keeper", name: "Keeper Congestion", baseProb: 0.015, loss: 21, queue: 36, governance: 4 },
  { id: "governance", name: "Governance Upgrade Risk", baseProb: 0.009, loss: 18, queue: 8, governance: 38 },
  { id: "stablecoin", name: "Stablecoin Depeg", baseProb: 0.014, loss: 31, queue: 14, governance: 6 },
  { id: "gas", name: "Gas Spike", baseProb: 0.02, loss: 16, queue: 34, governance: 2 },
  { id: "mev", name: "MEV / OEV Capture", baseProb: 0.013, loss: 19, queue: 22, governance: 3 }
];

const tailEvents = loadJson("tail_events.json", []);
const riskFactorMap = loadJson("risk_factor_map.json", { default: { riskFactorIds: ["liquidity", "volatility"] }, categories: {}, protocolOverrides: {} });
const marketSources = loadJson("market_sources.json", { protocols: {}, defaults: { coingeckoIds: ["ethereum"], days: 30 }, dune: {} });
const eventPriors = buildEventPriors(tailEvents);
const marketCache = new Map();
const glmAuditCache = new Map();
const reconnaissanceCache = new Map();
const fullAuditCache = new Map();

function localIps() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

function loadJson(fileName, fallback) {
  try {
    return JSON.parse(readFileSync(join(dataRoot, fileName), "utf8"));
  } catch {
    return fallback;
  }
}

function buildEventPriors(events) {
  const stats = new Map();
  for (const event of events) {
    for (const factor of event.factors || []) {
      const current = stats.get(factor) || { count: 0, severitySum: 0, liquidityDropSum: 0, drawdownSum: 0 };
      current.count += 1;
      current.severitySum += Number(event.severity || 0.5);
      current.liquidityDropSum += Number(event.liquidity_drop || 0);
      current.drawdownSum += Number(event.price_drawdown || 0);
      stats.set(factor, current);
    }
  }

  const totalEvents = Math.max(events.length, 1);
  const priors = {};
  for (const [factor, stat] of stats.entries()) {
    const frequency = stat.count / totalEvents;
    const severity = stat.severitySum / stat.count;
    const liquidityDrop = stat.liquidityDropSum / stat.count;
    const drawdown = stat.drawdownSum / stat.count;
    priors[factor] = {
      count: stat.count,
      frequency,
      avgSeverity: severity,
      avgLiquidityDrop: liquidityDrop,
      avgDrawdown: drawdown,
      dummyProbability: clamp(0.006 + frequency * 0.032 + severity * 0.018 + liquidityDrop * 0.006 + drawdown * 0.004, 0.004, 0.085)
    };
  }
  return priors;
}

function probabilityForFactor(risk, horizonDays = 7, activeModelParameters = loadJson("model_parameters.json", null)) {
  const horizon = Object.entries(HORIZONS).find(([, days]) => days === horizonDays)?.[0] || "7d";
  const calibrated = activeModelParameters?.probabilityByHorizon?.[horizon]?.[risk.id];
  const prior = eventPriors[risk.id];
  let thirtyDayProbability;
  if (!prior) {
    thirtyDayProbability = risk.baseProb;
  } else {
    thirtyDayProbability = clamp(
      risk.baseProb * (1 - DUMMY_EVENT_PRIOR_WEIGHT) + prior.dummyProbability * DUMMY_EVENT_PRIOR_WEIGHT,
      0.003,
      0.095
    );
  }

  return {
    ...risk,
    thirtyDayProbability,
    marginalProbability: calibrated?.posteriorMean ??
      clamp(1 - Math.pow(1 - thirtyDayProbability, horizonDays / 30), 0, 0.35),
    confidence95: calibrated?.confidence95 || null,
    priorSource: calibrated
      ? `${activeModelParameters.modelVersion} calibrated posterior`
      : prior
        ? "tail_events.json 30d fallback prior"
        : "Static 30d fallback prior",
    eventCount: prior?.count || 0,
    calibrationObservations: calibrated?.observations || 0,
    avgSeverity: prior?.avgSeverity || 0
  };
}

function applyMarketSignalToFactor(risk, marketSignals) {
  if (!marketSignals) return risk;
  const stress = marketSignals.stress || {};
  const multipliers = {
    volatility: 1 + Number(stress.volatility || 0) * MARKET_PRIOR_WEIGHT,
    liquidity: 1 + Number(stress.liquidity || 0) * MARKET_PRIOR_WEIGHT,
    stablecoin: 1 + Number(stress.stablecoin || 0) * MARKET_PRIOR_WEIGHT,
    oracle: 1 + Number(stress.oracle || 0) * MARKET_PRIOR_WEIGHT,
    keeper: 1 + Number(stress.gas || 0) * MARKET_PRIOR_WEIGHT,
    gas: 1 + Number(stress.gas || 0) * MARKET_PRIOR_WEIGHT,
    mev: 1 + Number(stress.liquidity || 0) * MARKET_PRIOR_WEIGHT,
    governance: 1
  };
  const multiplier = multipliers[risk.id] || 1;
  return {
    ...risk,
    marginalProbability: clamp(risk.marginalProbability * multiplier, 0.003, 0.12),
    marketMultiplier: multiplier
  };
}

function categoryDefaults(category) {
  return riskFactorMap.categories?.[category] || riskFactorMap.default || {};
}

function sourceConfigForProfile(profile) {
  return marketSources.protocols?.[profile.protocol] || marketSources.protocols?.["Unknown protocol"] || marketSources.defaults || {};
}

function pctChange(latest, previous) {
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) return 0;
  return (latest - previous) / previous;
}

function maxDrawdown(values) {
  let peak = values[0] || 0;
  let worst = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.min(worst, (value - peak) / peak);
  }
  return Math.abs(worst);
}

function volumeSpike(volumes) {
  if (volumes.length < 3) return 0;
  const latest = volumes.at(-1) || 0;
  const average = volumes.slice(0, -1).reduce((sum, value) => sum + value, 0) / Math.max(volumes.length - 1, 1);
  return average > 0 ? latest / average : 0;
}

async function fetchDefiLlamaProtocol(slug) {
  if (!slug) return null;
  const data = await fetchJson(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
  const tvl = Array.isArray(data?.tvl) ? data.tvl : [];
  const latest = Number(tvl.at(-1)?.totalLiquidityUSD || data?.tvl || 0);
  const weekAgo = Number(tvl.at(-8)?.totalLiquidityUSD || tvl.at(0)?.totalLiquidityUSD || latest);
  return {
    source: "DefiLlama",
    slug,
    latestTvlUsd: latest,
    tvl7dChange: pctChange(latest, weekAgo)
  };
}

async function fetchCoinGeckoCoin(id, days = 30) {
  const baseUrl = coingeckoKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
  const headers = coingeckoKey ? { "x-cg-pro-api-key": coingeckoKey } : {};
  const data = await fetchJson(`${baseUrl}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`, { headers });
  const prices = (data.prices || []).map((row) => Number(row[1])).filter(Number.isFinite);
  const volumes = (data.total_volumes || []).map((row) => Number(row[1])).filter(Number.isFinite);
  const latest = prices.at(-1) || 0;
  const previous = prices.at(-2) || prices[0] || latest;
  return {
    source: "CoinGecko",
    id,
    latestPriceUsd: latest,
    dailyChange: pctChange(latest, previous),
    maxDrawdown30d: maxDrawdown(prices),
    volumeSpike: volumeSpike(volumes)
  };
}

async function executeDuneQuery(profile) {
  const queryId = duneQueryId || marketSources.dune?.queryId;
  if (!duneKey || !queryId) return null;
  const data = await fetchJson(`https://api.dune.com/api/v1/query/${queryId}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dune-API-Key": duneKey
    },
    body: JSON.stringify({
      query_parameters: {
        chain_id: profile.chainId,
        contract_address: profile.address
      },
      performance: "medium"
    })
  });
  return {
    source: "Dune",
    queryId,
    executionId: data.execution_id,
    state: data.state
  };
}

function aggregateMarketSignals(protocol, coins, dune) {
  const maxCoinDrawdown = Math.max(0, ...coins.map((coin) => coin.maxDrawdown30d || 0));
  const maxVolumeSpike = Math.max(0, ...coins.map((coin) => coin.volumeSpike || 0));
  const stablecoinStress = Math.max(
    0,
    ...coins
      .filter((coin) => /usd|dai|frax|lusd|crvusd/i.test(coin.id))
      .map((coin) => Math.abs((coin.latestPriceUsd || 1) - 1))
  );
  const tvlDrop = protocol?.tvl7dChange < 0 ? Math.abs(protocol.tvl7dChange) : 0;
  return {
    stress: {
      volatility: clamp(maxCoinDrawdown * 2.8, 0, 1),
      liquidity: clamp(tvlDrop * 2 + Math.max(0, maxVolumeSpike - 1) * 0.16, 0, 1),
      stablecoin: clamp(stablecoinStress * 8, 0, 1),
      oracle: clamp(maxCoinDrawdown * 1.1 + stablecoinStress * 4, 0, 1),
      gas: 0
    },
    protocol,
    coins,
    dune,
    updatedAt: new Date().toISOString(),
    warnings: []
  };
}

async function collectMarketSignals(profile, force = false) {
  const cacheKey = `${profile.chainId}:${profile.address.toLowerCase()}`;
  const cached = marketCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.timestamp < 10 * 60 * 1000) return cached.value;

  const config = sourceConfigForProfile(profile);
  const coinIds = config.coingeckoIds?.length ? config.coingeckoIds : marketSources.defaults?.coingeckoIds || ["ethereum"];
  const days = Number(marketSources.defaults?.days || 30);
  const warnings = [];

  const [protocolResult, duneResult, ...coinResults] = await Promise.allSettled([
    fetchDefiLlamaProtocol(config.defillamaSlug),
    executeDuneQuery(profile),
    ...coinIds.map((id) => fetchCoinGeckoCoin(id, days))
  ]);

  const protocol = protocolResult.status === "fulfilled" ? protocolResult.value : null;
  const dune = duneResult.status === "fulfilled" ? duneResult.value : null;
  const coins = coinResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  for (const result of [protocolResult, duneResult, ...coinResults]) {
    if (result.status === "rejected") warnings.push(result.reason?.message || "Market collector failed");
  }

  const signals = aggregateMarketSignals(protocol, coins, dune);
  signals.warnings = warnings;
  marketCache.set(cacheKey, { timestamp: Date.now(), value: signals });
  return signals;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value || "");
}

function knownByAddress(address) {
  return knownContracts.find((item) => item.address.toLowerCase() === address.toLowerCase());
}

function inferRiskFactorIds(profile) {
  const text = `${profile.name} ${profile.protocol} ${profile.category} ${profile.sourceName || ""}`.toLowerCase();
  const defaults = categoryDefaults(profile.category);
  const override = riskFactorMap.protocolOverrides?.[profile.protocol];
  const factors = new Set(override || defaults.riskFactorIds || riskFactorMap.default?.riskFactorIds || ["liquidity", "volatility"]);

  if (/pool|lending|vault|controller|liquidation|cdp|llamma/.test(text)) {
    factors.add("oracle");
    factors.add("keeper");
  }
  if (/stable|usdc|usdt|dai|frax|lusd/.test(text)) {
    factors.add("stablecoin");
    factors.add("liquidity");
  }
  if (/proxy|governance|admin|upgrade|timelock|controller/.test(text)) {
    factors.add("governance");
  }
  if (/exchange|amm|pool|curve|uniswap/.test(text)) {
    factors.add("mev");
  }

  return [...factors];
}

function applyRiskMap(profile) {
  const defaults = categoryDefaults(profile.category);
  return {
    ...defaults,
    ...profile,
    riskFactorIds: inferRiskFactorIds({ ...defaults, ...profile })
  };
}

function profileFromKnown(contract) {
  return applyRiskMap({
    ...contract,
    verified: true,
    sourceName: contract.name,
    implementation: "",
    compilerVersion: "",
    abiAvailable: true,
    sourceCodeAvailable: true
  });
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function describeGlmError(error) {
  const message = String(error?.message || error || "");
  if (/HTTP 429/.test(message) && /1113|余额不足|资源包/.test(message)) {
    if (glmApiMode === "standard") {
      return {
        code: "GLM_ENDPOINT_OR_BALANCE",
        message: "GLM returned code 1113 on the standard API endpoint. If this is a Coding Plan key, set GLM_API_MODE=coding; otherwise check the standard API balance."
      };
    }
    return {
      code: "GLM_CODING_QUOTA",
      message: "The Coding Plan endpoint has no currently available quota. Check the 5-hour or weekly Coding Plan quota and the API key account."
    };
  }
  if (/HTTP 429/.test(message)) {
    return {
      code: "GLM_RATE_LIMIT",
      message: "GLM API rate limit reached. Wait briefly and try again."
    };
  }
  if (/HTTP 401|HTTP 403/.test(message)) {
    return {
      code: "GLM_AUTH_FAILED",
      message: "GLM API authentication failed. Check that GLM_API_KEY contains the complete API Key ID and secret."
    };
  }
  if (/aborted|timeout/i.test(message)) {
    return {
      code: "GLM_TIMEOUT",
      message: "GLM API timed out. Local rules were used instead."
    };
  }
  return { code: "GLM_UNAVAILABLE", message: message.slice(0, 240) };
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function utcFileStamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z");
}

function abiType(input) {
  if (!input) return "";
  if (!String(input.type || "").startsWith("tuple")) return input.type || "";
  const suffix = String(input.type).slice("tuple".length);
  return `(${(input.components || []).map(abiType).join(",")})${suffix}`;
}

function functionSignature(item) {
  return `${item.name}(${(item.inputs || []).map(abiType).join(",")})`;
}

function parseAbi(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string" || value.startsWith("Contract source code not verified")) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseEtherscanSources(sourceCode, contractName) {
  if (!sourceCode) return {};
  const trimmed = sourceCode.trim();
  const candidates = [trimmed];
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) candidates.unshift(trimmed.slice(1, -1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.sources && typeof parsed.sources === "object") {
        return Object.fromEntries(
          Object.entries(parsed.sources).map(([path, source]) => [path, source?.content || ""])
        );
      }
    } catch {
      // Single-file source falls through below.
    }
  }
  return { [`${contractName || "Contract"}.sol`]: sourceCode };
}

function extractSourcifySources(data) {
  const sources = data?.sources || data?.compilation?.sources || {};
  return Object.fromEntries(
    Object.entries(sources)
      .map(([path, source]) => [path, typeof source === "string" ? source : source?.content || ""])
      .filter(([, content]) => content)
  );
}

function sourcePatternEvidence(sources) {
  const patterns = [
    ["delegatecall", /\bdelegatecall\b/i, "Delegatecall can transfer execution into another implementation."],
    ["selfdestruct", /\bselfdestruct\b/i, "Selfdestruct semantics or legacy assumptions require review."],
    ["tx-origin", /\btx\.origin\b/i, "tx.origin authorization can be phished through an intermediate contract."],
    ["assembly", /\bassembly\s*\{/i, "Inline assembly bypasses several Solidity safety checks."],
    ["unchecked", /\bunchecked\s*\{/i, "Unchecked arithmetic requires explicit invariant review."],
    ["oracle-read", /\b(latestRoundData|getRoundData|consult|observe|getPrice|price0CumulativeLast)\b/i, "Price or oracle reads affect economic safety."],
    ["external-call", /\.(call|staticcall|delegatecall)\s*(\{|\()/i, "Low-level external calls require return-value and reentrancy review."],
    ["upgrade", /\b(upgradeTo|upgradeToAndCall|_authorizeUpgrade|implementation)\b/i, "Upgrade controls and implementation authorization require review."],
    ["access-control", /\b(onlyOwner|onlyRole|AccessControl|Ownable|DEFAULT_ADMIN_ROLE)\b/i, "Privileged roles are present in the source."],
    ["liquidation", /\b(liquidat|healthFactor|collateral|borrow|repay)\w*\b/i, "Liquidation or collateral accounting paths are present."]
  ];
  const findings = [];
  for (const [path, content] of Object.entries(sources)) {
    const lines = String(content).split(/\r?\n/);
    for (const [id, regex, description] of patterns) {
      const lineIndex = lines.findIndex((line) => regex.test(line));
      if (lineIndex >= 0) {
        findings.push({
          id,
          file: path,
          line: lineIndex + 1,
          excerpt: lines[lineIndex].trim().slice(0, 180),
          description
        });
      }
    }
  }
  return findings.slice(0, 40);
}

function analyzeAbi(abi) {
  const functionItems = abi.filter((item) => item?.type === "function" && item.name);
  const eventItems = abi.filter((item) => item?.type === "event" && item.name);
  const errorItems = abi.filter((item) => item?.type === "error" && item.name);
  const privilegedPattern = /owner|admin|role|govern|upgrade|pause|guardian|operator|manager|config|parameter|set[A-Z]|grant|revoke/i;
  const economicPattern = /deposit|withdraw|borrow|repay|liquidat|swap|mint|burn|redeem|claim|flash|oracle|price|collateral/i;
  const functions = functionItems.map((item) => ({
    name: item.name,
    signature: functionSignature(item),
    stateMutability: item.stateMutability || "",
    payable: item.stateMutability === "payable",
    stateChanging: !["view", "pure"].includes(item.stateMutability),
    privilegedCandidate: privilegedPattern.test(item.name),
    economicCandidate: economicPattern.test(item.name)
  }));
  return {
    functionCount: functions.length,
    eventCount: eventItems.length,
    customErrorCount: errorItems.length,
    stateChangingCount: functions.filter((item) => item.stateChanging).length,
    payableCount: functions.filter((item) => item.payable).length,
    privilegedFunctions: functions.filter((item) => item.privilegedCandidate).slice(0, 30),
    economicFunctions: functions.filter((item) => item.economicCandidate).slice(0, 40),
    functions: functions.slice(0, 250),
    events: eventItems.map((item) => item.name).slice(0, 100)
  };
}

async function rpcCall(method, params) {
  return fetchJson(ethereumRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }, 15000);
}

function storageAddress(value) {
  const hex = String(value || "").replace(/^0x/, "").padStart(64, "0");
  const address = `0x${hex.slice(-40)}`;
  return /^0x0{40}$/.test(address) ? "" : address;
}

async function fetchProxyEvidence(address) {
  const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const adminSlot = "0xb53127684a568b3173ae13b9f8a6016e0195e8e9e3f13c52a7a8ee7aef0f8f";
  const beaconSlot = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
  const [implementation, admin, beacon, code] = await Promise.all([
    rpcCall("eth_getStorageAt", [address, implementationSlot, "latest"]),
    rpcCall("eth_getStorageAt", [address, adminSlot, "latest"]),
    rpcCall("eth_getStorageAt", [address, beaconSlot, "latest"]),
    rpcCall("eth_getCode", [address, "latest"])
  ]);
  return {
    implementation: storageAddress(implementation?.result),
    admin: storageAddress(admin?.result),
    beacon: storageAddress(beacon?.result),
    bytecodeHash: code?.result ? sha256(code.result) : "",
    bytecodeBytes: code?.result ? Math.max(0, (code.result.length - 2) / 2) : 0,
    rpcUrl: new URL(ethereumRpcUrl).origin
  };
}

async function fetchSourcifyEvidence(chainId, address) {
  const url = `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=all`;
  const data = await fetchJson(url, {}, 20000);
  const sources = extractSourcifySources(data);
  const abi = parseAbi(data?.abi || data?.compilation?.abi);
  return {
    provider: "Sourcify",
    url,
    verified: Boolean(data?.match || data?.compilation),
    match: data?.match || "",
    contractName: data?.compilation?.name || data?.name || "",
    compilerVersion: data?.compilation?.compilerVersion || "",
    abi,
    sources
  };
}

async function fetchEtherscanEvidence(chainId, address) {
  if (!etherscanKey || chainId !== 1) return null;
  const params = new URLSearchParams({
    module: "contract",
    action: "getsourcecode",
    address,
    apikey: etherscanKey
  });
  const url = `https://api.etherscan.io/api?${params.toString()}`;
  const data = await fetchJson(url, {}, 20000);
  const result = Array.isArray(data?.result) ? data.result[0] : null;
  if (!result || data.status === "0") return null;
  return {
    provider: "Etherscan",
    url: url.replace(etherscanKey, "[redacted]"),
    verified: Boolean(result.SourceCode),
    contractName: result.ContractName || "",
    compilerVersion: result.CompilerVersion || "",
    proxy: result.Proxy === "1",
    implementation: result.Implementation || "",
    abi: parseAbi(result.ABI),
    sources: parseEtherscanSources(result.SourceCode, result.ContractName)
  };
}

function summarizeEvidenceSource(source) {
  return {
    provider: source.provider,
    role: source.role || "contract",
    targetAddress: source.targetAddress || "",
    url: source.url,
    verified: source.verified,
    match: source.match || "",
    contractName: source.contractName || "",
    compilerVersion: source.compilerVersion || "",
    proxy: source.proxy || false,
    implementation: source.implementation || "",
    abiEntries: source.abi.length,
    sourceFiles: Object.keys(source.sources).length
  };
}

async function buildEvidenceBundle(chainId, address, force = false) {
  const normalizedAddress = address.toLowerCase();
  const cacheKey = `${chainId}:${normalizedAddress}`;
  const cached = reconnaissanceCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
    return { ...cached.bundle, cached: true };
  }

  const generatedAt = new Date();
  const warnings = [];
  const sourceResults = await Promise.allSettled([
    fetchSourcifyEvidence(chainId, normalizedAddress),
    fetchEtherscanEvidence(chainId, normalizedAddress),
    fetchProxyEvidence(normalizedAddress)
  ]);
  const sourceEvidence = sourceResults
    .slice(0, 2)
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => ({
      ...result.value,
      role: "proxy-or-contract",
      targetAddress: normalizedAddress
    }));
  for (const [index, result] of sourceResults.entries()) {
    if (result.status === "rejected") {
      warnings.push(`${["Sourcify", "Etherscan", "Ethereum RPC"][index]}: ${result.reason?.message || "unavailable"}`);
    }
  }
  if (!etherscanKey) warnings.push("Etherscan API key is not configured; Etherscan evidence was skipped.");

  const proxy = sourceResults[2].status === "fulfilled"
    ? sourceResults[2].value
    : { implementation: "", admin: "", beacon: "", bytecodeHash: "", bytecodeBytes: 0 };
  if (!proxy.implementation) {
    proxy.implementation = sourceEvidence.find((item) => item.implementation)?.implementation || "";
  }
  if (proxy.implementation && proxy.implementation.toLowerCase() !== normalizedAddress) {
    const implementationAddress = proxy.implementation.toLowerCase();
    const implementationResults = await Promise.allSettled([
      fetchSourcifyEvidence(chainId, implementationAddress),
      fetchEtherscanEvidence(chainId, implementationAddress)
    ]);
    for (const [index, result] of implementationResults.entries()) {
      if (result.status === "fulfilled" && result.value) {
        sourceEvidence.push({
          ...result.value,
          role: "implementation",
          targetAddress: implementationAddress
        });
      } else if (result.status === "rejected") {
        warnings.push(
          `Implementation ${["Sourcify", "Etherscan"][index]}: ${result.reason?.message || "unavailable"}`
        );
      }
    }
  }

  const primary = sourceEvidence
    .sort((left, right) =>
      (Object.keys(right.sources).length + right.abi.length) -
      (Object.keys(left.sources).length + left.abi.length)
    )[0] || { abi: [], sources: {}, provider: "none" };
  const sourceFiles = Object.entries(primary.sources).map(([path, content]) => ({
    path,
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content)
  }));
  const abiAnalysis = analyzeAbi(primary.abi);
  const patternEvidence = sourcePatternEvidence(primary.sources);
  const bundleId = `recon-${chainId}-${normalizedAddress.slice(2, 10)}-${utcFileStamp(generatedAt)}`;
  const evidenceHash = sha256(JSON.stringify({
    chainId,
    address: normalizedAddress,
    sourceFiles,
    abi: primary.abi,
    proxy
  }));
  const bundle = {
    schemaVersion: "contract-evidence-v0.1.0",
    bundleId,
    generatedAt: generatedAt.toISOString(),
    cached: false,
    chainId,
    address: normalizedAddress,
    evidenceHash,
    status: sourceFiles.length || primary.abi.length ? "evidence-collected" : "limited-evidence",
    sources: sourceEvidence.map(summarizeEvidenceSource),
    primarySource: primary.provider,
    primarySourceRole: primary.role || "contract",
    primarySourceAddress: primary.targetAddress || normalizedAddress,
    sourceFiles,
    abiHash: primary.abi.length ? sha256(JSON.stringify(primary.abi)) : "",
    proxy,
    attackSurface: abiAnalysis,
    sourceSignals: patternEvidence,
    warnings,
    limitations: [
      "Reconnaissance identifies attack-surface evidence; it does not confirm a vulnerability.",
      "Privileged function detection is name-based until Slither and source-level data flow analysis are connected.",
      "Proxy slots may not cover custom proxy implementations or diamond storage."
    ]
  };

  mkdirSync(auditRoot, { recursive: true });
  const fullBundle = {
    ...bundle,
    rawEvidence: {
      abi: primary.abi,
      sources: primary.sources
    }
  };
  writeFileSync(join(auditRoot, `${bundleId}.json`), JSON.stringify(fullBundle, null, 2));
  writeFileSync(
    join(auditRoot, `${chainId}-${normalizedAddress}-latest.json`),
    JSON.stringify(fullBundle, null, 2)
  );
  reconnaissanceCache.set(cacheKey, { timestamp: Date.now(), bundle });
  return bundle;
}

async function fetchSourcifyProfile(chainId, address) {
  const url = `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=all`;
  const data = await fetchJson(url);
  const name =
    data?.compilation?.name ||
    data?.name ||
    data?.metadata?.settings?.compilationTarget && Object.values(data.metadata.settings.compilationTarget)[0] ||
    `Contract ${address.slice(0, 6)}...${address.slice(-4)}`;

  const profile = applyRiskMap({
    chainId,
    address,
    name,
    protocol: "Unknown protocol",
    category: inferCategory(name, data),
    symbol: name.slice(0, 1).toUpperCase(),
    tvl: "Unknown",
    oracle: inferOracle(name, data),
    coverage: data?.match === "exact_match" ? "78%" : "64%",
    audit: "Not indexed",
    source: "Sourcify",
    verified: Boolean(data?.match || data?.compilation),
    sourceName: name,
    implementation: "",
    compilerVersion: data?.compilation?.compilerVersion || "",
    abiAvailable: Boolean(data?.abi),
    sourceCodeAvailable: Boolean(data?.sources || data?.compilation),
    baseResilience: data?.match === "exact_match" ? 76 : 66,
    liquidityDepth: 0.62,
    keeperQuality: 0.58,
    governanceExposure: 0.34,
    insuranceBuffer: 0.38
  });
  return profile;
}

async function fetchEtherscanProfile(chainId, address) {
  if (!etherscanKey || chainId !== 1) return null;
  const params = new URLSearchParams({
    module: "contract",
    action: "getsourcecode",
    address,
    apikey: etherscanKey
  });
  const data = await fetchJson(`https://api.etherscan.io/api?${params.toString()}`);
  const result = Array.isArray(data?.result) ? data.result[0] : null;
  if (!result || data.status === "0") return null;

  const name = result.ContractName || `Contract ${address.slice(0, 6)}...${address.slice(-4)}`;
  const profile = applyRiskMap({
    chainId,
    address,
    name,
    protocol: "Unknown protocol",
    category: inferCategory(name, result),
    symbol: name.slice(0, 1).toUpperCase(),
    tvl: "Unknown",
    oracle: inferOracle(name, result),
    coverage: result.Proxy === "1" ? "70%" : "76%",
    audit: "Not indexed",
    source: "Etherscan",
    verified: Boolean(result.SourceCode),
    sourceName: name,
    implementation: result.Implementation || "",
    compilerVersion: result.CompilerVersion || "",
    abiAvailable: Boolean(result.ABI && result.ABI !== "Contract source code not verified"),
    sourceCodeAvailable: Boolean(result.SourceCode),
    baseResilience: result.SourceCode ? 74 : 58,
    liquidityDepth: 0.6,
    keeperQuality: 0.58,
    governanceExposure: result.Proxy === "1" ? 0.42 : 0.28,
    insuranceBuffer: 0.36
  });
  return profile;
}

function inferCategory(name, raw) {
  const text = `${name} ${JSON.stringify(raw || {}).slice(0, 2000)}`.toLowerCase();
  if (/lending|pool|borrow|reserve/.test(text)) return "Lending or liquidity pool";
  if (/vault|vat|cdp|collateral/.test(text)) return "Vault or CDP system";
  if (/oracle|price|feed|aggregator/.test(text)) return "Oracle adapter";
  if (/token|erc20|stable|usdc|usdt|dai/.test(text)) return "Token contract";
  if (/governance|timelock|proxy|admin/.test(text)) return "Governance or proxy control";
  return "General smart contract";
}

function inferOracle(name, raw) {
  const text = `${name} ${JSON.stringify(raw || {}).slice(0, 2000)}`.toLowerCase();
  if (/chainlink|aggregatorv3/.test(text)) return "Chainlink-linked";
  if (/pyth/.test(text)) return "Pyth-linked";
  if (/twap|uniswap/.test(text)) return "TWAP-linked";
  if (/oracle|price/.test(text)) return "On-chain oracle";
  return "Not detected";
}

async function resolveProfile(chainId, address) {
  const known = knownByAddress(address);
  if (known) return profileFromKnown(known);

  const sources = [];
  try {
    const sourcify = await fetchSourcifyProfile(chainId, address);
    if (sourcify) return sourcify;
  } catch (error) {
    sources.push(`Sourcify unavailable: ${error.message}`);
  }

  try {
    const etherscan = await fetchEtherscanProfile(chainId, address);
    if (etherscan) return etherscan;
  } catch (error) {
    sources.push(`Etherscan unavailable: ${error.message}`);
  }

  return applyRiskMap({
    chainId,
    address,
    name: `Contract ${address.slice(0, 6)}...${address.slice(-4)}`,
    protocol: "Unknown protocol",
    category: "Unverified smart contract",
    symbol: "?",
    tvl: "Unknown",
    oracle: "Not detected",
    coverage: "42%",
    audit: "Not indexed",
    source: sources.join(" | ") || "Address lookup",
    verified: false,
    sourceName: "",
    implementation: "",
    compilerVersion: "",
    abiAvailable: false,
    sourceCodeAvailable: false,
    baseResilience: 52,
    liquidityDepth: 0.45,
    keeperQuality: 0.48,
    governanceExposure: 0.48,
    insuranceBuffer: 0.25
  });
}

function runStress({ profile, factorIds, horizon = "7d", severity = 0.65, useCorrelation = true, simulateKeeper = true, marketSignals = null }) {
  const activeModelParameters = loadJson("model_parameters.json", null);
  const activeModelValidation = loadJson("model_validation.json", null);
  const predictionHorizon = HORIZONS[horizon] ? horizon : "7d";
  const horizonDays = HORIZONS[predictionHorizon];
  const probabilityFactors = riskFactors
    .map((risk) => probabilityForFactor(risk, horizonDays, activeModelParameters))
    .map((risk) => applyMarketSignalToFactor(risk, marketSignals));
  const selected = probabilityFactors.filter((risk) => factorIds.includes(risk.id));
  const risks = selected;
  const marketMultipliers = Object.fromEntries(
    risks.map((risk) => {
      const executionMultiplier = simulateKeeper && ["keeper", "gas"].includes(risk.id)
        ? 1 + (1 - profile.keeperQuality) * 0.46
        : 1;
      return [risk.id, (risk.marketMultiplier || 1) * executionMultiplier];
    })
  );
  const simulation = simulateJointProbability({
    factors: risks,
    horizon: predictionHorizon,
    modelParameters: activeModelParameters,
    useCorrelation,
    severity,
    marketMultipliers,
    samples: Number(process.env.MONTE_CARLO_SAMPLES || 100000),
    seed: `${profile.address}:${predictionHorizon}:${risks.map((risk) => risk.id).join(",")}:${severity}:${useCorrelation}`
  });
  const horizonSurface = Object.fromEntries(
    Object.keys(HORIZONS).map((surfaceHorizon) => {
      const surfaceSimulation = surfaceHorizon === predictionHorizon
        ? simulation
        : simulateJointProbability({
            factors: risks,
            horizon: surfaceHorizon,
            modelParameters: activeModelParameters,
            useCorrelation,
            severity,
            marketMultipliers,
            samples: Number(process.env.MONTE_CARLO_SURFACE_SAMPLES || 50000),
            seed: `${profile.address}:${surfaceHorizon}:${risks.map((risk) => risk.id).join(",")}:${severity}:${useCorrelation}`
          });
      return [surfaceHorizon, {
        jointProbability: risks.length ? surfaceSimulation.allSelectedProbability : 0,
        anySelectedProbability: risks.length ? surfaceSimulation.anySelectedProbability : 0,
        atLeastTwoProbability: risks.length ? surfaceSimulation.atLeastTwoProbability : 0,
        confidence95: risks.length ? surfaceSimulation.confidence95 : { low: 0, high: 0 }
      }];
    })
  );
  const pairs = simulation.correlation.diagnostics.map((dependency) => {
    const left = risks.find((risk) => risk.id === dependency.factorIds[0]);
    const right = risks.find((risk) => risk.id === dependency.factorIds[1]);
    const strength = Math.abs(dependency.correlation);
    return {
      factors: [left?.name || dependency.factorIds[0], right?.name || dependency.factorIds[1]],
      factorIds: dependency.factorIds,
      tailDependence: dependency.correlation,
      observedPhi: dependency.observedPhi,
      jointEventCount: dependency.jointEventCount,
      reliability: dependency.reliability,
      source: dependency.source,
      label: strength >= 0.5 ? "Strong" : strength >= 0.25 ? "Moderate" : "Weak"
    };
  });
  const jointProbability = risks.length
    ? clamp(simulation.allSelectedProbability, 0, 0.75)
    : 0;
  const lossLoad = risks.reduce((sum, risk) => sum + risk.loss, 0);
  const queueLoad = risks.reduce((sum, risk) => sum + risk.queue, 0);
  const governanceLoad = risks.reduce((sum, risk) => sum + risk.governance, 0);
  const liquidityStress = (1 - profile.liquidityDepth) * 42;
  const insuranceRelief = profile.insuranceBuffer * 24;
  const keeperStress = simulateKeeper ? (1 - profile.keeperQuality) * 32 : 0;
  const gap = risks.length ? clamp((lossLoad * severity + liquidityStress - insuranceRelief) * (1 + jointProbability), 2.4, 220) : 0;
  const queue = risks.length ? clamp(queueLoad * severity + keeperStress + jointProbability * 120, 4, 98) : 0;
  const governance = risks.length ? clamp(governanceLoad * severity + profile.governanceExposure * 100, 3, 98) : 0;
  const coverage = risks.length ? clamp(100 - gap * 0.28 - queue * 0.13 + profile.insuranceBuffer * 16, 18, 98) : 100;
  const score = risks.length ? Math.round(clamp(profile.baseResilience - jointProbability * 140 - gap * 0.08 - queue * 0.06, 24, 96)) : 100;
  const recovery = risks.length ? Math.round(clamp(8 + queue * 0.21 + gap * 0.1, 8, 90)) : 0;
  const confidence = clamp((profile.verified ? 0.62 : 0.38) + pairs.length * 0.03 + (profile.source === "Curated registry" ? 0.18 : 0), 0.32, 0.91);

  return {
    profile,
    risks,
    factorProbabilities: risks.map((risk) => ({
      id: risk.id,
      name: risk.name,
      baseProbability: risk.baseProb,
      thirtyDayProbability: risk.thirtyDayProbability,
      marginalProbability: simulation.marginals[risk.id] ?? risk.marginalProbability,
      calibratedProbability: risk.marginalProbability,
      confidence95: risk.confidence95,
      priorSource: risk.priorSource,
      eventCount: risk.eventCount,
      calibrationObservations: risk.calibrationObservations,
      avgSeverity: risk.avgSeverity
    })),
    severity,
    predictionHorizon,
    horizonDays,
    useCorrelation,
    simulateKeeper,
    jointProbability,
    anySelectedProbability: risks.length ? simulation.anySelectedProbability : 0,
    atLeastTwoProbability: risks.length ? simulation.atLeastTwoProbability : 0,
    independentJointProbability: risks.length ? simulation.independentAllProbability : 0,
    dependenceLift: risks.length ? simulation.dependenceLift : null,
    jointConfidence95: risks.length ? simulation.confidence95 : { low: 0, high: 0 },
    horizonSurface,
    expectedBadDebtUsdM: gap,
    queueCongestion: queue,
    governanceExposure: governance,
    liquidationCoverage: coverage,
    resilienceScore: score,
    recoveryWindowMinutes: recovery,
    dependencies: pairs.sort((a, b) => b.tailDependence - a.tailDependence),
    simulation: {
      method: "Gaussian copula Monte Carlo",
      samples: simulation.samples,
      seed: simulation.seed,
      psdShrinkage: simulation.correlation.psdShrinkage
    },
    marketSignals,
    model: {
      name: "Calibrated empirical marginals + Gaussian copula",
      version: activeModelParameters?.modelVersion || "fallback-prior-v0",
      calibrationStatus: activeModelParameters?.status || "fallback",
      source: "CoinGecko + DefiLlama features, curated event labels, sparse-sample-shrunk event phi matrix",
      jointDefinition: "All selected factor labels occur within the forecast horizon; they are not guaranteed to belong to one incident.",
      dependenceLimit: "Binary event-level Phi is used as a shrunk Gaussian-copula correlation proxy; it is not a fitted tetrachoric correlation.",
      tailEventCount: tailEvents.length,
      latestFeatureDate: activeModelParameters?.latestFeatureDate || null,
      labelObservedThrough: activeModelParameters?.labelObservedThrough || null,
      warnings: activeModelParameters?.warnings || ["Versioned model parameters were not found; fallback priors are active."],
      validation: activeModelValidation ? {
        ...activeModelValidation.horizons?.[predictionHorizon]?.any,
        metadata: activeModelValidation.metadata
      } : null,
      confidenceType: "contract metadata and evidence coverage",
      confidence
    }
  };
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleSearch(url, res) {
  const query = (url.searchParams.get("q") || "").trim();
  const chainId = Number(url.searchParams.get("chainId") || 1);
  if (!query) return sendJson(res, 200, { results: knownContracts.map(profileFromKnown) });

  if (isAddress(query)) {
    const profile = await resolveProfile(chainId, query);
    return sendJson(res, 200, { results: [profile] });
  }

  const lower = query.toLowerCase();
  const results = knownContracts
    .filter((item) => `${item.name} ${item.protocol} ${item.category}`.toLowerCase().includes(lower))
    .map(profileFromKnown);

  return sendJson(res, 200, { results, message: results.length ? "" : "No local match. Paste a contract address for live lookup." });
}

async function handleProfile(url, res) {
  const parts = url.pathname.split("/").filter(Boolean);
  const chainId = Number(parts[2]);
  const address = parts[3];
  if (!chainId || !isAddress(address)) return sendJson(res, 400, { error: "Expected /api/contracts/:chainId/:address/profile" });
  const profile = await resolveProfile(chainId, address);
  const activeModelParameters = loadJson("model_parameters.json", null);
  return sendJson(res, 200, {
    profile,
    factors: riskFactors
      .map((risk) => probabilityForFactor(risk, 7, activeModelParameters))
      .filter((risk) => profile.riskFactorIds.includes(risk.id))
  });
}

async function handleStress(req, res) {
  const body = await parseBody(req);
  const chainId = Number(body.chainId || 1);
  let profile = body.profile;
  if (!profile && isAddress(body.address)) profile = await resolveProfile(chainId, body.address);
  if (!profile) profile = profileFromKnown(knownContracts[0]);
  const marketSignals = body.useMarketData === false ? null : await collectMarketSignals(profile, Boolean(body.forceMarketRefresh));

  const result = runStress({
    profile,
    factorIds: Array.isArray(body.factors) ? body.factors : profile.riskFactorIds,
    horizon: body.horizon,
    severity: Number(body.severity || 0.65),
    useCorrelation: body.useCorrelation !== false,
    simulateKeeper: body.simulateKeeper !== false,
    marketSignals
  });

  return sendJson(res, 200, result);
}

async function handleMarketSnapshot(url, res) {
  const chainId = Number(url.searchParams.get("chainId") || 1);
  const address = url.searchParams.get("address");
  const force = url.searchParams.get("force") === "1";
  if (!isAddress(address)) return sendJson(res, 400, { error: "Expected address query parameter" });
  const profile = await resolveProfile(chainId, address);
  const marketSignals = await collectMarketSignals(profile, force);
  return sendJson(res, 200, { profile, marketSignals });
}

async function handleReconnaissance(req, res) {
  const body = await parseBody(req);
  const chainId = Number(body.chainId || 1);
  const address = body.address || body.profile?.address;
  if (!chainId || !isAddress(address)) {
    return sendJson(res, 400, { error: "Expected a valid chainId and contract address." });
  }
  const bundle = await buildEvidenceBundle(chainId, address, Boolean(body.force));
  return sendJson(res, 200, { bundle });
}

async function handleSlitherAudit(req, res) {
  const body = await parseBody(req);
  const chainId = Number(body.chainId || 1);
  const address = String(body.address || "").toLowerCase();
  if (!isAddress(address)) return sendJson(res, 400, { error: "A valid contract address is required." });

  const script = join(process.cwd(), "scripts", "run-slither-audit.js");
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [script, String(chainId), address], {
      cwd: process.cwd(),
      timeout: Number(process.env.SLITHER_TIMEOUT_MS || 180000),
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true
    }));
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error);
    const friendly = /EPERM|permission denied/i.test(detail)
      ? "The Slither temporary workspace is still locked by Windows. The scanner now uses an isolated workspace; retry the scan after restarting the server."
      : `Slither could not complete: ${detail.slice(0, 320)}`;
    return sendJson(res, 500, { error: friendly });
  }
  const report = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  return sendJson(res, 200, { report });
}

function normalizeAgentReview(value, fallback = {}) {
  const allowed = new Set(["credible-candidate", "likely-benign-pattern", "needs-manual-review"]);
  const findings = Array.isArray(value?.findings) ? value.findings.slice(0, 24).map((item) => ({
    clusterId: compactText(item?.clusterId, "", 240),
    verdict: allowed.has(item?.verdict) ? item.verdict : "needs-manual-review",
    confidence: clamp(Number(item?.confidence ?? 0.5), 0, 1),
    rationale: compactText(item?.rationale, "Manual validation is required.", 420),
    exploitPreconditions: compactList(item?.exploitPreconditions, [], 5, 180),
    recommendedTest: compactText(item?.recommendedTest, "Add a focused regression test for the reported path.", 300)
  })).filter((item) => item.clusterId) : (fallback.findings || []);
  return {
    executiveSummary: compactText(value?.executiveSummary, fallback.executiveSummary || "AI review was not available.", 720),
    findings,
    crossFactorChains: compactList(value?.crossFactorChains, fallback.crossFactorChains || [], 6, 320),
    immediateActions: compactList(value?.immediateActions, fallback.immediateActions || [], 8, 260)
  };
}

function fallbackAgentReview(report, reason = "") {
  return {
    source: "deterministic fallback",
    model: "local audit rules",
    reason,
    executiveSummary: `The deterministic review produced ${report.summary.reviewQueue} prioritized clusters. Static findings remain unconfirmed until their preconditions are tested against protocol invariants.`,
    findings: report.reviewQueue.slice(0, 12).map((item) => ({
      clusterId: item.clusterId,
      verdict: item.deterministicVerdict,
      confidence: item.deterministicVerdict === "likely-benign-pattern" ? 0.72 : 0.52,
      rationale: item.deterministicVerdict === "likely-benign-pattern"
        ? "The detector matches a common framework or explicit-user asset-flow pattern; retain it for manual confirmation."
        : "The reported source path is economically or operationally sensitive and needs a targeted test.",
      exploitPreconditions: [
        "The reported entry point must be externally reachable in the deployed configuration.",
        "Protocol authorization and state invariants must permit the detector-reported sink."
      ],
      recommendedTest: item.remediation
    })),
    crossFactorChains: report.attackPaths.slice(0, 5).map((path) =>
      `${path.entryPoint} -> ${path.sink} -> ${path.riskFactors.join(" + ") || "contract-state"}`
    ),
    immediateActions: [
      "Reproduce credible high-impact candidates on a mainnet fork.",
      "Validate proxy initialization and upgrade authorization against the deployed implementation.",
      "Convert confirmed issues into regression tests before proposing code changes."
    ]
  };
}

async function runGlmAuditRounds(report, locale) {
  const fallback = fallbackAgentReview(report);
  if (!glmApiKey) return fallbackAgentReview(report, "GLM_API_KEY is not configured.");
  const evidence = {
    contract: report.contract,
    executiveRisk: report.executiveRisk,
    evidence: report.evidence,
    reviewQueue: report.reviewQueue.slice(0, 16).map((item) => ({
      clusterId: item.clusterId,
      detector: item.detector,
      impact: item.maxImpact,
      confidence: item.confidence,
      priorityScore: item.priorityScore,
      deterministicVerdict: item.deterministicVerdict,
      location: item.location,
      description: item.description,
      evidenceExcerpt: item.evidenceExcerpt,
      riskFactors: item.riskFactors
    }))
  };
  const language = locale === "zh-CN" ? "Simplified Chinese" : "English";
  try {
    const analystResponse = await fetchJson(glmBaseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${glmApiKey}` },
      body: JSON.stringify({
        model: glmModel,
        messages: [
          {
            role: "system",
            content: [
              "You are the primary smart-contract audit analyst.",
              "Use only the supplied source excerpts and static-analysis evidence.",
              "Do not invent call paths, deployed state, exploit success, or financial loss.",
              "Return strict JSON: executiveSummary, findings, crossFactorChains, immediateActions.",
              "Each finding needs clusterId, verdict, confidence, rationale, exploitPreconditions, recommendedTest.",
              "Allowed verdicts: credible-candidate, likely-benign-pattern, needs-manual-review.",
              `Write in ${language}.`
            ].join(" ")
          },
          { role: "user", content: JSON.stringify(evidence) }
        ],
        response_format: { type: "json_object" }
      })
    }, glmTimeoutMs);
    const analyst = normalizeAgentReview(
      JSON.parse(analystResponse?.choices?.[0]?.message?.content || "{}"),
      fallback
    );

    const criticResponse = await fetchJson(glmBaseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${glmApiKey}` },
      body: JSON.stringify({
        model: glmModel,
        messages: [
          {
            role: "system",
            content: [
              "You are the adversarial audit reviewer.",
              "Challenge overclaims, identify likely false positives, and demand explicit exploit preconditions.",
              "You may downgrade a verdict but cannot change source evidence, detector output, or locations.",
              "Return the same strict JSON schema as the analyst.",
              `Write in ${language}.`
            ].join(" ")
          },
          { role: "user", content: JSON.stringify({ evidence, analystReview: analyst }) }
        ],
        response_format: { type: "json_object" }
      })
    }, glmTimeoutMs);
    const critic = normalizeAgentReview(
      JSON.parse(criticResponse?.choices?.[0]?.message?.content || "{}"),
      analyst
    );
    return {
      source: "GLM multi-round review",
      model: glmModel,
      analyst,
      critic,
      executiveSummary: critic.executiveSummary,
      findings: critic.findings,
      crossFactorChains: critic.crossFactorChains,
      immediateActions: critic.immediateActions
    };
  } catch (error) {
    return fallbackAgentReview(report, error.message);
  }
}

async function handleFullAudit(req, res) {
  const body = await parseBody(req);
  const chainId = Number(body.chainId || 1);
  const address = String(body.address || "").toLowerCase();
  if (!isAddress(address)) return sendJson(res, 400, { error: "A valid contract address is required." });
  const cacheKey = `${chainId}:${address}:${body.locale || "en"}`;
  const cached = fullAuditCache.get(cacheKey);
  if (!body.force && cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
    return sendJson(res, 200, { report: { ...cached.report, cached: true } });
  }

  const profile = body.profile || await resolveProfile(chainId, address);
  const evidencePath = join(auditRoot, `${chainId}-${address}-latest.json`);
  if (body.force || !existsSync(evidencePath)) {
    await buildEvidenceBundle(chainId, address, Boolean(body.force));
  }
  const script = join(process.cwd(), "scripts", "run-slither-audit.js");
  await execFileAsync(process.execPath, [script, String(chainId), address], {
    cwd: process.cwd(),
    timeout: Number(process.env.SLITHER_TIMEOUT_MS || 180000),
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true
  });
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const slither = JSON.parse(readFileSync(
    join(dataRoot, "generated", "slither-results", `${chainId}-${address}-latest.json`),
    "utf8"
  ));
  const report = buildDeterministicAuditReport({ evidence, slither, profile });
  report.aiReview = await runGlmAuditRounds(report, body.locale || "en");
  report.status = report.aiReview.source === "GLM multi-round review"
    ? "multi-round-review-completed"
    : "deterministic-review-completed";
  report.cached = false;
  report.finalReportHash = sha256(JSON.stringify(report));
  persistAuditReport(process.cwd(), report);
  fullAuditCache.set(cacheKey, { timestamp: Date.now(), report });
  return sendJson(res, 200, { report });
}

function handleLatestAuditReport(url, res) {
  const match = url.pathname.match(/^\/api\/audit\/report\/(\d+)\/(0x[a-fA-F0-9]{40})$/);
  if (!match) return sendJson(res, 400, { error: "Expected /api/audit/report/:chainId/:address" });
  const [, chainId, rawAddress] = match;
  const address = rawAddress.toLowerCase();
  const path = join(dataRoot, "generated", "agent-reports", `${chainId}-${address}-latest.json`);
  if (!existsSync(path)) return sendJson(res, 404, { error: "No completed audit report is available." });
  const report = readFileSync(path, "utf8");
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="audit-${chainId}-${address.slice(2, 10)}.json"`,
    "Cache-Control": "no-store"
  });
  res.end(report);
}

function deterministicClassification(profile) {
  const factorIds = inferRiskFactorIds(profile);
  return {
    category: profile.category || inferCategory(profile.name, profile),
    riskFactorIds: factorIds,
    confidence: profile.verified ? 0.68 : 0.42,
    rationale: "Deterministic fallback based on protocol name, contract category, verified metadata, and risk_factor_map.json.",
    source: "deterministic fallback",
    model: "local rules"
  };
}

function normalizeClassification(classification, fallback) {
  const allowed = new Set(riskFactors.map((risk) => risk.id));
  const ids = Array.isArray(classification?.riskFactorIds)
    ? classification.riskFactorIds.filter((id) => allowed.has(id))
    : fallback.riskFactorIds;
  return {
    ...fallback,
    ...classification,
    riskFactorIds: ids,
    confidence: clamp(Number(classification?.confidence ?? fallback.confidence), 0, 1)
  };
}

function compactText(value, fallback = "", maxLength = 320) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
}

function compactList(value, fallback = [], maxItems = 5, maxLength = 180) {
  const items = Array.isArray(value) ? value : fallback;
  return items
    .map((item) => compactText(item, "", maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function deterministicAuditMemo(body, reason = "") {
  const result = body.result || {};
  const profile = result.profile || body.profile || {};
  const risks = Array.isArray(result.risks) ? result.risks : [];
  const names = risks.map((risk) => risk.name || risk.id).filter(Boolean);
  const dependencies = Array.isArray(result.dependencies) ? result.dependencies : [];
  const strongestPair = dependencies[0];
  const horizon = result.predictionHorizon || body.horizon || "7d";
  const joint = Number(result.jointProbability || 0);
  const any = Number(result.anySelectedProbability || 0);
  const queue = Number(result.queueCongestion || 0);
  const coverage = Number(result.liquidationCoverage || 100);
  const mitigations = [];
  if (risks.some((risk) => risk.id === "oracle")) {
    mitigations.push("Define stale-price circuit breakers and a tested fallback-oracle path.");
  }
  if (risks.some((risk) => risk.id === "liquidity")) {
    mitigations.push("Predefine slippage, auction-size, and liquidity-depth escalation thresholds.");
  }
  if (risks.some((risk) => ["keeper", "gas"].includes(risk.id))) {
    mitigations.push("Maintain redundant keepers with adaptive gas bidding and private transaction routing.");
  }
  if (risks.some((risk) => risk.id === "governance")) {
    mitigations.push("Require timelocks, parameter-change bounds, and emergency rollback procedures.");
  }
  if (!mitigations.length) mitigations.push("Keep factor thresholds and incident response ownership under review.");

  return {
    source: "local fallback",
    model: "local audit rules",
    cached: false,
    executiveSummary: `${profile.name || "The selected contract"} has a ${horizon} all-selected joint probability of ${(joint * 100).toFixed(3)}% and an any-factor probability of ${(any * 100).toFixed(2)}%. The result is driven by ${names.join(", ") || "the selected scenario factors"}.`,
    mechanismChain: [
      `${names.join(" + ") || "Selected factors"} create the modeled stress path.`,
      strongestPair
        ? `${strongestPair.factors?.join(" and ") || "The strongest pair"} has the highest displayed dependence in this scenario.`
        : "No pair dependence is available because fewer than two factors are selected.",
      `Modeled queue congestion is ${queue.toFixed(0)}% and liquidation coverage is ${coverage.toFixed(0)}%.`
    ],
    mitigations,
    monitoringSignals: [
      "Oracle freshness and cross-source price divergence",
      "DEX depth, slippage, and protocol TVL change",
      "Keeper inclusion latency and failed transaction rate",
      "Liquidation queue depth and insurance-buffer utilization"
    ],
    limitations: [
      "GLM explains and classifies the supplied evidence; it does not calculate the probability.",
      "The current calibration uses a small curated event catalog and remains exploratory.",
      "All-selected factors occurring in one horizon are not guaranteed to belong to one incident."
    ],
    fallbackReason: reason || "GLM_API_KEY is not configured."
  };
}

function normalizeAuditMemo(value, fallback, source, model) {
  return {
    source,
    model,
    cached: false,
    executiveSummary: compactText(value?.executiveSummary, fallback.executiveSummary, 520),
    mechanismChain: compactList(value?.mechanismChain, fallback.mechanismChain, 5, 240),
    mitigations: compactList(value?.mitigations, fallback.mitigations, 5, 240),
    monitoringSignals: compactList(value?.monitoringSignals, fallback.monitoringSignals, 5, 200),
    limitations: compactList(value?.limitations, fallback.limitations, 4, 240)
  };
}

function auditCacheKey(body) {
  const result = body.result || {};
  return JSON.stringify({
    address: result.profile?.address || body.profile?.address || "",
    modelVersion: result.model?.version || "",
    horizon: result.predictionHorizon || body.horizon || "",
    factors: (result.risks || []).map((risk) => risk.id).sort(),
    severity: Number(result.severity || body.severity || 0).toFixed(2),
    correlation: result.useCorrelation !== false,
    keeper: result.simulateKeeper !== false,
    locale: body.locale || "en"
  });
}

async function handleClassify(req, res) {
  const body = await parseBody(req);
  const profile = body.profile || (isAddress(body.address) ? await resolveProfile(Number(body.chainId || 1), body.address) : null);
  if (!profile) return sendJson(res, 400, { error: "Expected profile or contract address" });

  if (!glmApiKey) return sendJson(res, 200, { profile, classification: deterministicClassification(profile) });

  const fallback = deterministicClassification(profile);
  let response;
  try {
    response = await fetchJson(glmBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${glmApiKey}`
      },
      body: JSON.stringify({
        model: glmModel,
        messages: [
          {
            role: "system",
            content: [
              "Classify a DeFi smart contract for risk-factor mapping.",
              "Return strict JSON with category, riskFactorIds, confidence, and rationale.",
              "Allowed riskFactorIds: oracle, liquidity, volatility, keeper, governance, stablecoin, gas, mev.",
              "Do not estimate probabilities or invent numeric risk scores."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify({
              name: profile.name,
              protocol: profile.protocol,
              category: profile.category,
              verified: profile.verified,
              sourceName: profile.sourceName,
              compilerVersion: profile.compilerVersion,
              abiAvailable: profile.abiAvailable,
              sourceCodeAvailable: profile.sourceCodeAvailable
            })
          }
        ],
        response_format: { type: "json_object" }
      })
    }, glmTimeoutMs);
  } catch (error) {
    const glmError = describeGlmError(error);
    return sendJson(res, 200, {
      profile,
      classification: {
        ...fallback,
        source: "local fallback",
        rationale: `GLM was unavailable, so local contract rules were used. ${glmError.message}`
      },
      fallbackReason: glmError.message,
      fallbackCode: glmError.code
    });
  }

  const content = response?.choices?.[0]?.message?.content || "{}";
  let classification;
  try {
    classification = JSON.parse(content);
  } catch {
    classification = fallback;
    classification.rationale = `GLM returned non-JSON output; fallback used. Raw: ${content.slice(0, 160)}`;
  }

  return sendJson(res, 200, {
    profile,
    classification: normalizeClassification({ ...classification, source: "GLM", model: glmModel }, fallback)
  });
}

async function handleAuditMemo(req, res) {
  const body = await parseBody(req);
  const result = body.result;
  if (!result?.profile || !Array.isArray(result.risks)) {
    return sendJson(res, 400, { error: "Expected the latest stress-test result." });
  }

  const key = auditCacheKey(body);
  const cached = glmAuditCache.get(key);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
    return sendJson(res, 200, { memo: { ...cached.memo, cached: true } });
  }

  const fallback = deterministicAuditMemo(body);
  if (!glmApiKey) return sendJson(res, 200, { memo: fallback });

  const compactResult = {
    contract: {
      name: result.profile.name,
      protocol: result.profile.protocol,
      category: result.profile.category,
      verified: result.profile.verified,
      oracle: result.profile.oracle
    },
    scenario: {
      horizon: result.predictionHorizon,
      severity: result.severity,
      factors: result.risks.map((risk) => ({ id: risk.id, name: risk.name })),
      allSelectedJointProbability: result.jointProbability,
      anySelectedProbability: result.anySelectedProbability,
      atLeastTwoProbability: result.atLeastTwoProbability,
      jointConfidence95: result.jointConfidence95,
      liquidationCoverage: result.liquidationCoverage,
      expectedBadDebtUsdM: result.expectedBadDebtUsdM,
      queueCongestion: result.queueCongestion,
      governanceExposure: result.governanceExposure,
      recoveryWindowMinutes: result.recoveryWindowMinutes
    },
    dependence: (result.dependencies || []).slice(0, 5).map((item) => ({
      factors: item.factorIds,
      correlation: item.tailDependence,
      observedPhi: item.observedPhi,
      jointEventCount: item.jointEventCount
    })),
    model: {
      version: result.model?.version,
      calibrationStatus: result.model?.calibrationStatus,
      tailEventCount: result.model?.tailEventCount,
      labelObservedThrough: result.model?.labelObservedThrough,
      validation: result.model?.validation && {
        observations: result.model.validation.observations,
        positives: result.model.validation.positives,
        brierScore: result.model.validation.brierScore,
        logLoss: result.model.validation.logLoss
      },
      warnings: result.model?.warnings
    }
  };

  let response;
  try {
    response = await fetchJson(glmBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${glmApiKey}`
      },
      body: JSON.stringify({
        model: glmModel,
        messages: [
          {
            role: "system",
            content: [
              "You are a DeFi liquidation-resilience audit analyst.",
              "Use only the supplied contract, scenario, probability, dependence, and validation evidence.",
              "Do not recalculate, alter, or invent probabilities.",
              "Return strict JSON with executiveSummary, mechanismChain, mitigations, monitoringSignals, limitations.",
              "Each list must contain short actionable strings. State uncertainty and data limitations.",
              `Write in ${body.locale === "zh-CN" ? "Simplified Chinese" : "English"}.`
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify(compactResult)
          }
        ],
        response_format: { type: "json_object" }
      })
    }, glmTimeoutMs);
  } catch (error) {
    return sendJson(res, 200, { memo: deterministicAuditMemo(body, error.message) });
  }

  const content = response?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return sendJson(res, 200, {
      memo: deterministicAuditMemo(body, "GLM returned a non-JSON audit response.")
    });
  }

  const memo = normalizeAuditMemo(parsed, fallback, "GLM", glmModel);
  glmAuditCache.set(key, { timestamp: Date.now(), memo });
  return sendJson(res, 200, { memo });
}

async function handleExplain(req, res) {
  const body = await parseBody(req);
  if (!glmApiKey) {
    return sendJson(res, 200, {
      explanation: [
        "GLM_API_KEY is not configured, so this is a deterministic fallback explanation.",
        `The scenario is driven by ${body?.risks?.map((risk) => risk.name).join(", ") || "the selected risk factors"}.`,
        "The backend risk engine uses marginal probabilities plus a tail-dependence matrix, then adjusts liquidation coverage, queue congestion, and expected bad debt."
      ].join(" ")
    });
  }

  const response = await fetchJson(glmBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${glmApiKey}`
    },
    body: JSON.stringify({
      model: glmModel,
      messages: [
        {
          role: "system",
          content: "You explain DeFi smart-contract stress-test results. Be concise, factual, and do not invent data sources."
        },
        {
          role: "user",
          content: JSON.stringify(body)
        }
      ]
    })
  });

  return sendJson(res, 200, {
    explanation: response?.choices?.[0]?.message?.content || "GLM returned no explanation."
  });
}

function serveStatic(url, res) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/contracts/search") return await handleSearch(url, res);
    if (req.method === "GET" && /^\/api\/contracts\/\d+\/0x[a-fA-F0-9]{40}\/profile$/.test(url.pathname)) {
      return await handleProfile(url, res);
    }
    if (req.method === "GET" && url.pathname === "/api/market/snapshot") return await handleMarketSnapshot(url, res);
    if (req.method === "GET" && url.pathname === "/api/model/validation") {
      return sendJson(
        res,
        200,
        loadJson("model_validation.json", null) || { error: "Model validation has not been generated." }
      );
    }
    if (req.method === "GET" && /^\/api\/audit\/report\/\d+\/0x[a-fA-F0-9]{40}$/.test(url.pathname)) {
      return handleLatestAuditReport(url, res);
    }
    if (req.method === "POST" && url.pathname === "/api/stress/run") return await handleStress(req, res);
    if (req.method === "POST" && url.pathname === "/api/audit/recon") return await handleReconnaissance(req, res);
    if (req.method === "POST" && url.pathname === "/api/audit/slither") return await handleSlitherAudit(req, res);
    if (req.method === "POST" && url.pathname === "/api/audit/full") return await handleFullAudit(req, res);
    if (req.method === "POST" && url.pathname === "/api/agent/classify") return await handleClassify(req, res);
    if (req.method === "POST" && url.pathname === "/api/agent/audit") return await handleAuditMemo(req, res);
    if (req.method === "POST" && url.pathname === "/api/agent/explain") return await handleExplain(req, res);
    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "API route not found" });
    return serveStatic(url, res);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Unexpected server error" });
  }
}).listen(port, "0.0.0.0", () => {
  console.log("DeFi tail-risk dashboard is running:");
  console.log(`  Local:   http://localhost:${port}`);
  for (const ip of localIps()) console.log(`  Phone:   http://${ip}:${port}`);
  console.log(`  GLM:     ${glmApiMode} mode (${glmBaseUrl})`);
  console.log("Optional env: ETHERSCAN_API_KEY, GLM_API_KEY, GLM_API_MODE, GLM_MODEL, GLM_BASE_URL, COINGECKO_API_KEY, DUNE_API_KEY, DUNE_QUERY_ID");
});
