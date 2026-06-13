import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDir = join(root, "data", "generated");
const coingeckoPath = join(generatedDir, "coingecko_daily_features.json");
const defillamaPath = join(generatedDir, "defillama_daily_features.json");
const eventsPath = join(root, "data", "tail_events.json");
const horizons = { "1d": 1, "7d": 7, "30d": 30 };
const factorIds = ["oracle", "liquidity", "volatility", "keeper", "governance", "stablecoin", "gas", "mev"];

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const coingeckoFeatures = await readOptionalJson(coingeckoPath);
const defillamaFeatures = await readOptionalJson(defillamaPath);
const rawEvents = JSON.parse(await readFile(eventsPath, "utf8"));

if (!coingeckoFeatures && !defillamaFeatures) {
  throw new Error("No generated features found. Run a CoinGecko or DefiLlama collector first.");
}

function utcDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dateString(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function addDays(timestamp, days) {
  return timestamp + days * 86_400_000;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const events = rawEvents
  .map((event) => ({
    ...event,
    startDay: utcDay(event.start_time),
    endDay: utcDay(event.end_time || event.start_time)
  }))
  .sort((a, b) => a.startDay - b.startDay);
const labelObservedThrough = events.length
  ? Math.max(...events.map((event) => event.endDay))
  : null;

function labelsForDate(date, horizonDays) {
  const day = utcDay(date);
  const horizonEnd = addDays(day, horizonDays);
  const futureEvents = events.filter((event) => event.startDay > day && event.startDay <= horizonEnd);
  const activeEvents = events.filter((event) => event.startDay <= day && event.endDay >= day);
  const labels = Object.fromEntries(factorIds.map((factor) => [
    factor,
    futureEvents.some((event) => (event.factors || []).includes(factor)) ? 1 : 0
  ]));
  const severity = futureEvents.length ? Math.max(...futureEvents.map((event) => Number(event.severity || 0))) : 0;

  return {
    horizonDays,
    observed: labelObservedThrough !== null && horizonEnd <= labelObservedThrough,
    anyTailEvent: futureEvents.length ? 1 : 0,
    factors: labels,
    severity,
    eventIds: futureEvents.map((event) => event.event_id),
    activeEventIds: activeEvents.map((event) => event.event_id)
  };
}

const featureDates = [...new Set([
  ...(coingeckoFeatures?.dailyFactors || []).map((row) => row.date),
  ...(defillamaFeatures?.dailyFeatures || []).map((row) => row.date)
])].sort();

const rows = featureDates.map((date) => ({
  date,
  featureDateKnownAt: `${date}T23:59:59Z`,
  labels: Object.fromEntries(
    Object.entries(horizons).map(([name, days]) => [name, labelsForDate(date, days)])
  )
}));

const positiveCounts = Object.fromEntries(
  Object.keys(horizons).map((horizon) => [
    horizon,
    {
      anyTailEvent: rows.reduce((sum, row) => sum + row.labels[horizon].anyTailEvent, 0),
      factors: Object.fromEntries(
        factorIds.map((factor) => [
          factor,
          rows.reduce((sum, row) => sum + row.labels[horizon].factors[factor], 0)
        ])
      )
    }
  ])
);

const featureStart = rows[0]?.date || null;
const featureEnd = rows.at(-1)?.date || null;
const overlappingEvents = events.filter((event) => {
  if (!featureStart || !featureEnd) return false;
  return event.startDay <= addDays(utcDay(featureEnd), 30) && event.endDay >= utcDay(featureStart);
});
const totalPositives = Object.values(positiveCounts).reduce((sum, item) => sum + item.anyTailEvent, 0);
const warnings = [];
if (!overlappingEvents.length) {
  warnings.push("No labeled tail event overlaps the feature range or its 30-day forecast window.");
}
if (!totalPositives) {
  warnings.push("All forecast labels are zero. Extend CoinGecko history to cover the labeled events before model training.");
}

const labelOutput = {
  metadata: {
    generatedAt: new Date().toISOString(),
    definition: "At date t, label 1 when an event starts in the open-closed interval (t, t+horizon].",
    leakagePolicy: "Features from date t never include information from events starting after date t.",
    featureRange: { start: featureStart, end: featureEnd },
    eventRange: {
      start: events.length ? dateString(events[0].startDay) : null,
      end: labelObservedThrough === null ? null : dateString(labelObservedThrough)
    },
    labelObservedThrough: labelObservedThrough === null ? null : dateString(labelObservedThrough),
    censoringPolicy: "Rows whose complete forecast horizon extends beyond labelObservedThrough are retained but excluded from calibration and backtesting.",
    eventCount: events.length,
    overlappingEventCount: overlappingEvents.length,
    overlappingEventIds: overlappingEvents.map((event) => event.event_id),
    factorIds,
    horizons,
    positiveCounts,
    warnings
  },
  rows
};

function nullable(value) {
  return value === undefined || value === null ? null : value;
}

function flattenCoinGeckoRow(row) {
  if (!row) {
    return {
      hasCoinGecko: 0,
      observations: null,
      volatilityScore: null,
      volatilityActive: null,
      liquidityScore: null,
      liquidityActive: null,
      stablecoinScore: null,
      stablecoinActive: null,
      oracleScore: null,
      oracleActive: null,
      maxAbsoluteReturn: null,
      maxRollingVolatility7d: null,
      worstVolumeChange: null,
      worstVolumeZScore: null,
      maxStablecoinPegDeviation: null,
      worstDrawdown30d: null
    };
  }
  return {
    hasCoinGecko: 1,
    date: row.date,
    observations: nullable(row.observations),
    volatilityScore: nullable(row.factors?.volatility?.score),
    volatilityActive: row.factors?.volatility?.active ? 1 : 0,
    liquidityScore: nullable(row.factors?.liquidity?.score),
    liquidityActive: row.factors?.liquidity?.active ? 1 : 0,
    stablecoinScore: nullable(row.factors?.stablecoin?.score),
    stablecoinActive: row.factors?.stablecoin?.active ? 1 : 0,
    oracleScore: nullable(row.factors?.oracle?.score),
    oracleActive: row.factors?.oracle?.active ? 1 : 0,
    maxAbsoluteReturn: nullable(row.raw?.maxAbsoluteReturn),
    maxRollingVolatility7d: nullable(row.raw?.maxRollingVolatility7d),
    worstVolumeChange: nullable(row.raw?.worstVolumeChange),
    worstVolumeZScore: nullable(row.raw?.worstVolumeZScore),
    maxStablecoinPegDeviation: nullable(row.raw?.maxStablecoinPegDeviation),
    worstDrawdown30d: nullable(row.raw?.worstDrawdown30d)
  };
}

function flattenDefiLlamaRow(row) {
  if (!row) {
    return {
      hasDefiLlama: 0,
      defiLlamaLiquidityScore: null,
      defiLlamaLiquidityActive: null,
      chainTvlUsd: null,
      chainTvlChange1d: null,
      chainTvlDrawdown30d: null,
      dexVolumeUsd: null,
      dexVolumeChange1d: null,
      dexVolumeDrawdown30d: null,
      stablecoinSupplyUsd: null,
      stablecoinSupplyChange1d: null,
      trackedProtocolTvlUsd: null
    };
  }
  return {
    hasDefiLlama: 1,
    defiLlamaLiquidityScore: nullable(row.factors?.liquidity?.score),
    defiLlamaLiquidityActive: row.factors?.liquidity?.active ? 1 : 0,
    chainTvlUsd: nullable(row.raw?.chainTvlUsd),
    chainTvlChange1d: nullable(row.raw?.chainTvlChange1d),
    chainTvlDrawdown30d: nullable(row.raw?.chainTvlDrawdown30d),
    dexVolumeUsd: nullable(row.raw?.dexVolumeUsd),
    dexVolumeChange1d: nullable(row.raw?.dexVolumeChange1d),
    dexVolumeDrawdown30d: nullable(row.raw?.dexVolumeDrawdown30d),
    stablecoinSupplyUsd: nullable(row.raw?.stablecoinSupplyUsd),
    stablecoinSupplyChange1d: nullable(row.raw?.stablecoinSupplyChange1d),
    trackedProtocolTvlUsd: nullable(row.raw?.trackedProtocolTvlUsd)
  };
}

const coingeckoByDate = new Map(
  (coingeckoFeatures?.dailyFactors || []).map((row) => [row.date, row])
);
const defillamaByDate = new Map(
  (defillamaFeatures?.dailyFeatures || []).map((row) => [row.date, row])
);
const featureByDate = new Map(featureDates.map((date) => [
  date,
  {
    date,
    ...flattenCoinGeckoRow(coingeckoByDate.get(date)),
    ...flattenDefiLlamaRow(defillamaByDate.get(date))
  }
]));
const trainingRows = [];
for (const row of rows) {
  const feature = featureByDate.get(row.date);
  for (const horizon of Object.keys(horizons)) {
    trainingRows.push({
      ...feature,
      horizon,
      horizonDays: horizons[horizon],
      labelAnyTailEvent: row.labels[horizon].anyTailEvent,
      labelObserved: row.labels[horizon].observed,
      labelSeverity: row.labels[horizon].severity,
      labels: row.labels[horizon].factors,
      eventIds: row.labels[horizon].eventIds
    });
  }
}

const trainingOutput = {
  metadata: {
    ...labelOutput.metadata,
    featureSources: {
      coingecko: coingeckoFeatures?.metadata || null,
      defillama: defillamaFeatures?.metadata || null
    },
    sourceCoverage: {
      coingeckoDates: coingeckoByDate.size,
      defillamaDates: defillamaByDate.size,
      mergedDates: featureDates.length
    },
    rowCount: trainingRows.length
  },
  rows: trainingRows
};

function labelsCsv(labelRows) {
  const headers = [
    "date",
    "horizon",
    "horizon_days",
    "label_any_tail_event",
    "label_observed",
    ...factorIds.map((factor) => `label_${factor}`),
    "label_severity",
    "event_ids",
    "active_event_ids"
  ];
  const data = [];
  for (const row of labelRows) {
    for (const [horizon, label] of Object.entries(row.labels)) {
      data.push([
        row.date,
        horizon,
        label.horizonDays,
        label.anyTailEvent,
        label.observed,
        ...factorIds.map((factor) => label.factors[factor]),
        label.severity,
        label.eventIds.join("|"),
        label.activeEventIds.join("|")
      ]);
    }
  }
  return [headers, ...data].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function trainingCsv(training) {
  const headers = [
    "date",
    "horizon",
    "horizon_days",
    "has_coingecko",
    "has_defillama",
    "observations",
    "volatility_score",
    "volatility_active",
    "liquidity_score",
    "liquidity_active",
    "stablecoin_score",
    "stablecoin_active",
    "oracle_score",
    "oracle_active",
    "max_absolute_return",
    "max_rolling_volatility_7d",
    "worst_volume_change",
    "worst_volume_zscore",
    "max_stablecoin_peg_deviation",
    "worst_drawdown_30d",
    "defillama_liquidity_score",
    "defillama_liquidity_active",
    "chain_tvl_usd",
    "chain_tvl_change_1d",
    "chain_tvl_drawdown_30d",
    "dex_volume_usd",
    "dex_volume_change_1d",
    "dex_volume_drawdown_30d",
    "stablecoin_supply_usd",
    "stablecoin_supply_change_1d",
    "tracked_protocol_tvl_usd",
    "label_any_tail_event",
    "label_observed",
    ...factorIds.map((factor) => `label_${factor}`),
    "label_severity",
    "event_ids"
  ];
  const data = training.map((row) => [
    row.date,
    row.horizon,
    row.horizonDays,
    row.hasCoinGecko,
    row.hasDefiLlama,
    row.observations,
    row.volatilityScore,
    row.volatilityActive,
    row.liquidityScore,
    row.liquidityActive,
    row.stablecoinScore,
    row.stablecoinActive,
    row.oracleScore,
    row.oracleActive,
    row.maxAbsoluteReturn,
    row.maxRollingVolatility7d,
    row.worstVolumeChange,
    row.worstVolumeZScore,
    row.maxStablecoinPegDeviation,
    row.worstDrawdown30d,
    row.defiLlamaLiquidityScore,
    row.defiLlamaLiquidityActive,
    row.chainTvlUsd,
    row.chainTvlChange1d,
    row.chainTvlDrawdown30d,
    row.dexVolumeUsd,
    row.dexVolumeChange1d,
    row.dexVolumeDrawdown30d,
    row.stablecoinSupplyUsd,
    row.stablecoinSupplyChange1d,
    row.trackedProtocolTvlUsd,
    row.labelAnyTailEvent,
    row.labelObserved,
    ...factorIds.map((factor) => row.labels[factor]),
    row.labelSeverity,
    row.eventIds.join("|")
  ]);
  return [headers, ...data].map((row) => row.map(csvEscape).join(",")).join("\n");
}

await mkdir(generatedDir, { recursive: true });
await writeFile(join(generatedDir, "tail_event_labels.json"), JSON.stringify(labelOutput, null, 2));
await writeFile(join(generatedDir, "tail_event_labels.csv"), labelsCsv(rows));
await writeFile(join(generatedDir, "training_dataset.json"), JSON.stringify(trainingOutput, null, 2));
await writeFile(join(generatedDir, "training_dataset.csv"), trainingCsv(trainingRows));

console.log(`Built labels for ${rows.length} feature dates and ${trainingRows.length} horizon rows.`);
console.log(`Feature range: ${featureStart} to ${featureEnd}`);
console.log(`Overlapping labeled events: ${overlappingEvents.length}`);
for (const [horizon, counts] of Object.entries(positiveCounts)) {
  console.log(`  ${horizon}: ${counts.anyTailEvent} positive any-event labels`);
}
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
console.log(`Outputs written to ${generatedDir}`);
