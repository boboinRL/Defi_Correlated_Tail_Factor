import { createServer } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { networkInterfaces } from "node:os";

const port = Number(process.env.PORT || 3000);
const root = join(process.cwd(), "public");
const etherscanKey = process.env.ETHERSCAN_API_KEY || "";
const glmApiKey = process.env.GLM_API_KEY || "";
const glmBaseUrl = process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const glmModel = process.env.GLM_MODEL || "glm-5.1";
const coingeckoKey = process.env.COINGECKO_API_KEY || "";
const duneKey = process.env.DUNE_API_KEY || "";
const duneQueryId = process.env.DUNE_QUERY_ID || "";
const dataRoot = join(process.cwd(), "data");
const DUMMY_EVENT_PRIOR_WEIGHT = 0.62;
const MARKET_PRIOR_WEIGHT = 0.18;
const MODEL_VERSION = "horizon-prior-v0.2.0";
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

const tailDependence = {
  "oracle:liquidity": { value: 0.58, source: "Historical prior", label: "Strong" },
  "oracle:volatility": { value: 0.52, source: "Historical prior", label: "Strong" },
  "liquidity:volatility": { value: 0.67, source: "Historical prior", label: "Very strong" },
  "keeper:gas": { value: 0.74, source: "Mechanism prior", label: "Very strong" },
  "keeper:liquidity": { value: 0.39, source: "Expert calibration", label: "Moderate" },
  "governance:oracle": { value: 0.28, source: "Expert calibration", label: "Moderate" },
  "stablecoin:liquidity": { value: 0.63, source: "Historical prior", label: "Very strong" },
  "stablecoin:volatility": { value: 0.44, source: "Historical prior", label: "Strong" },
  "mev:liquidity": { value: 0.35, source: "Mechanism prior", label: "Moderate" },
  "mev:keeper": { value: 0.41, source: "Mechanism prior", label: "Strong" },
  "gas:liquidity": { value: 0.33, source: "Expert calibration", label: "Moderate" }
};

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

function probabilityForFactor(risk, horizonDays = 7) {
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
    marginalProbability: clamp(1 - Math.pow(1 - thirtyDayProbability, horizonDays / 30), 0, 0.35),
    priorSource: prior ? "tail_events.json 30d dummy prior" : "Static 30d model prior",
    eventCount: prior?.count || 0,
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

function canonicalPair(a, b) {
  return [a, b].sort().join(":");
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

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
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
  const predictionHorizon = HORIZONS[horizon] ? horizon : "7d";
  const horizonDays = HORIZONS[predictionHorizon];
  const probabilityFactors = riskFactors
    .map((risk) => probabilityForFactor(risk, horizonDays))
    .map((risk) => applyMarketSignalToFactor(risk, marketSignals));
  const selected = probabilityFactors.filter((risk) => factorIds.includes(risk.id));
  const risks = selected;
  const pairs = [];
  let dependencySum = 0;

  for (let i = 0; i < risks.length; i += 1) {
    for (let j = i + 1; j < risks.length; j += 1) {
      const pair = canonicalPair(risks[i].id, risks[j].id);
      const dependency = tailDependence[pair] || { value: 0.18, source: "Sparse-data prior", label: "Weak" };
      dependencySum += dependency.value;
      pairs.push({
        factors: [risks[i].name, risks[j].name],
        factorIds: [risks[i].id, risks[j].id],
        tailDependence: dependency.value,
        source: dependency.source,
        label: dependency.label
      });
    }
  }

  const avgDependency = pairs.length ? dependencySum / pairs.length : 0;
  const dependenceBoost = useCorrelation ? 1 + avgDependency * Math.log2(risks.length + 1) : 1;
  const keeperPenalty = simulateKeeper ? 1 + (1 - profile.keeperQuality) * 0.46 : 1;
  const baseNoEvent = risks.reduce((acc, risk) => acc * (1 - risk.marginalProbability * (0.72 + severity)), 1);
  const jointProbability = risks.length ? clamp((1 - baseNoEvent) * dependenceBoost * keeperPenalty, 0.001, 0.48) : 0;
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
      marginalProbability: risk.marginalProbability,
      priorSource: risk.priorSource,
      eventCount: risk.eventCount,
      avgSeverity: risk.avgSeverity
    })),
    severity,
    predictionHorizon,
    horizonDays,
    useCorrelation,
    simulateKeeper,
    jointProbability,
    expectedBadDebtUsdM: gap,
    queueCongestion: queue,
    governanceExposure: governance,
    liquidationCoverage: coverage,
    resilienceScore: score,
    recoveryWindowMinutes: recovery,
    dependencies: pairs.sort((a, b) => b.tailDependence - a.tailDependence),
    marketSignals,
    model: {
      name: "Horizon-aware tail dependence prior",
      version: MODEL_VERSION,
      calibrationStatus: "uncalibrated",
      source: "tail_events.json dummy prior + risk_factor_map.json + market collectors + tail-dependence matrix",
      tailEventCount: tailEvents.length,
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
  return sendJson(res, 200, { profile, factors: riskFactors.map(probabilityForFactor).filter((risk) => profile.riskFactorIds.includes(risk.id)) });
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

async function handleClassify(req, res) {
  const body = await parseBody(req);
  const profile = body.profile || (isAddress(body.address) ? await resolveProfile(Number(body.chainId || 1), body.address) : null);
  if (!profile) return sendJson(res, 400, { error: "Expected profile or contract address" });

  if (!glmApiKey) return sendJson(res, 200, { profile, classification: deterministicClassification(profile) });

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
  });

  const content = response?.choices?.[0]?.message?.content || "{}";
  let classification;
  const fallback = deterministicClassification(profile);
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
    if (req.method === "POST" && url.pathname === "/api/stress/run") return await handleStress(req, res);
    if (req.method === "POST" && url.pathname === "/api/agent/classify") return await handleClassify(req, res);
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
  console.log("Optional env: ETHERSCAN_API_KEY, GLM_API_KEY, GLM_MODEL, GLM_BASE_URL, COINGECKO_API_KEY, DUNE_API_KEY, DUNE_QUERY_ID");
});
