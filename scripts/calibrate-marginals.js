import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDir = join(root, "data", "generated");
const trainingPath = join(generatedDir, "training_dataset.json");
const eventsPath = join(root, "data", "tail_events.json");
const outputJsonPath = join(generatedDir, "marginal_calibration.json");
const outputCsvPath = join(generatedDir, "marginal_calibration.csv");
const modelPath = join(root, "data", "model_parameters.json");

const training = JSON.parse(await readFile(trainingPath, "utf8"));
const events = JSON.parse(await readFile(eventsPath, "utf8"));
const rows = training.rows || [];
const factorIds = training.metadata?.factorIds || [
  "oracle",
  "liquidity",
  "volatility",
  "keeper",
  "governance",
  "stablecoin",
  "gas",
  "mev"
];
const horizons = Object.keys(training.metadata?.horizons || { "1d": 1, "7d": 7, "30d": 30 });
const requestedWindows = String(process.env.CALIBRATION_WINDOWS || "365,730,full")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const priorAlpha = Number(process.env.BETA_PRIOR_ALPHA || 0.5);
const priorBeta = Number(process.env.BETA_PRIOR_BETA || 0.5);

if (!rows.length) throw new Error("Training dataset has no rows. Run npm run build:labels first.");

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 8) {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return { low: null, high: null };
  const probability = successes / total;
  const denominator = 1 + z ** 2 / total;
  const center = (probability + z ** 2 / (2 * total)) / denominator;
  const margin = (
    z *
    Math.sqrt((probability * (1 - probability) + z ** 2 / (4 * total)) / total)
  ) / denominator;
  return {
    low: round(clamp(center - margin)),
    high: round(clamp(center + margin))
  };
}

function estimate(successes, total) {
  const empirical = total ? successes / total : null;
  const posteriorMean = (successes + priorAlpha) / (total + priorAlpha + priorBeta);
  const interval = wilsonInterval(successes, total);
  return {
    successes,
    observations: total,
    empiricalProbability: round(empirical),
    posteriorMean: round(posteriorMean),
    confidence95: interval
  };
}

function phiCoefficient(n11, n10, n01, n00) {
  const denominator = Math.sqrt(
    (n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00)
  );
  return denominator ? (n11 * n00 - n10 * n01) / denominator : null;
}

function pairStatistics(records, factorA, factorB) {
  let n11 = 0;
  let n10 = 0;
  let n01 = 0;
  let n00 = 0;
  for (const record of records) {
    const a = record.labels?.[factorA] ? 1 : 0;
    const b = record.labels?.[factorB] ? 1 : 0;
    if (a && b) n11 += 1;
    else if (a) n10 += 1;
    else if (b) n01 += 1;
    else n00 += 1;
  }
  const total = n11 + n10 + n01 + n00;
  const probabilityA = total ? (n11 + n10) / total : 0;
  const probabilityB = total ? (n11 + n01) / total : 0;
  const jointProbability = total ? n11 / total : 0;
  const independentJoint = probabilityA * probabilityB;
  const union = n11 + n10 + n01;
  return {
    factorA,
    factorB,
    counts: { both: n11, onlyA: n10, onlyB: n01, neither: n00 },
    observations: total,
    jointProbability: round(jointProbability),
    independentJointProbability: round(independentJoint),
    lift: independentJoint ? round(jointProbability / independentJoint) : null,
    phiCorrelation: round(phiCoefficient(n11, n10, n01, n00)),
    conditionalBGivenA: n11 + n10 ? round(n11 / (n11 + n10)) : null,
    conditionalAGivenB: n11 + n01 ? round(n11 / (n11 + n01)) : null,
    jaccard: union ? round(n11 / union) : null
  };
}

function allPairs(records) {
  const pairs = [];
  for (let left = 0; left < factorIds.length; left += 1) {
    for (let right = left + 1; right < factorIds.length; right += 1) {
      pairs.push(pairStatistics(records, factorIds[left], factorIds[right]));
    }
  }
  return pairs;
}

function utcDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function filterWindow(horizonRows, windowName) {
  if (windowName === "full") return horizonRows;
  const days = Number(windowName);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid calibration window: ${windowName}`);
  }
  const latest = Math.max(...horizonRows.map((row) => utcDay(row.date)));
  const cutoff = latest - (days - 1) * 86_400_000;
  return horizonRows.filter((row) => utcDay(row.date) >= cutoff);
}

function factorMarginals(records) {
  return Object.fromEntries(
    factorIds.map((factor) => {
      const positives = records.reduce((sum, row) => sum + (row.labels?.[factor] ? 1 : 0), 0);
      return [factor, estimate(positives, records.length)];
    })
  );
}

function anyEventMarginal(records) {
  const positives = records.reduce((sum, row) => sum + (row.labelAnyTailEvent ? 1 : 0), 0);
  return estimate(positives, records.length);
}

const latestDate = rows.map((row) => row.date).sort().at(-1);
const forecastCalibration = {};
const flatRows = [];

for (const horizon of horizons) {
  const horizonRows = rows.filter((row) => row.horizon === horizon);
  forecastCalibration[horizon] = {};
  for (const windowName of requestedWindows) {
    const windowRows = filterWindow(horizonRows, windowName);
    const marginals = factorMarginals(windowRows);
    const pairs = allPairs(windowRows);
    forecastCalibration[horizon][windowName] = {
      dateRange: {
        start: windowRows[0]?.date || null,
        end: windowRows.at(-1)?.date || null
      },
      anyTailEvent: anyEventMarginal(windowRows),
      factors: marginals,
      pairs
    };
    for (const factor of factorIds) {
      flatRows.push({
        horizon,
        window: windowName,
        factor,
        ...marginals[factor]
      });
    }
  }
}

const eventRecords = events.map((event) => ({
  labels: Object.fromEntries(factorIds.map((factor) => [
    factor,
    (event.factors || []).includes(factor) ? 1 : 0
  ]))
}));
const eventCatalogCalibration = {
  eventCount: eventRecords.length,
  factors: factorMarginals(eventRecords),
  pairs: allPairs(eventRecords),
  note: "Event-level statistics count each catalog event once and are not annualized probabilities."
};

const warnings = [];
if (events.length < 50) {
  warnings.push(
    `Only ${events.length} independent catalog events are available; pair estimates are exploratory and confidence intervals are wide.`
  );
}
const sparsePairs = eventCatalogCalibration.pairs.filter((pair) => pair.counts.both < 5).length;
warnings.push(
  `${sparsePairs} of ${eventCatalogCalibration.pairs.length} event-level pairs have fewer than five joint observations.`
);

const generatedAt = new Date().toISOString();
const modelVersion = `empirical-tail-v0.3.0-${generatedAt.slice(0, 10).replaceAll("-", "")}`;
const output = {
  metadata: {
    generatedAt,
    modelVersion,
    status: "early-calibration",
    latestFeatureDate: latestDate,
    factorIds,
    horizons,
    windows: requestedWindows,
    prior: {
      distribution: "Beta",
      alpha: priorAlpha,
      beta: priorBeta,
      purpose: "Jeffreys smoothing prevents exact zero/one estimates in sparse samples."
    },
    probabilityDefinition: "Probability that a labeled factor event starts within the selected horizon.",
    dependenceDefinition: "Empirical binary-label co-occurrence. Phi is association, not a causal or universal correlation coefficient.",
    interpretationLimit: "Rates are calibrated to the current curated event catalog and must not be presented as complete market-wide incident probabilities.",
    warnings
  },
  forecastCalibration,
  eventCatalogCalibration
};

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvHeaders = [
  "horizon",
  "window",
  "factor",
  "successes",
  "observations",
  "empirical_probability",
  "posterior_mean",
  "confidence_95_low",
  "confidence_95_high"
];
const csvRows = flatRows.map((row) => [
  row.horizon,
  row.window,
  row.factor,
  row.successes,
  row.observations,
  row.empiricalProbability,
  row.posteriorMean,
  row.confidence95.low,
  row.confidence95.high
]);

const modelParameters = {
  modelVersion,
  generatedAt,
  status: "early-calibration",
  latestFeatureDate: latestDate,
  defaultWindow: "full",
  probabilityByHorizon: Object.fromEntries(
    horizons.map((horizon) => [
      horizon,
      Object.fromEntries(
        factorIds.map((factor) => [
          factor,
          forecastCalibration[horizon].full.factors[factor]
        ])
      )
    ])
  ),
  dependenceByHorizon: Object.fromEntries(
    horizons.map((horizon) => [
      horizon,
      forecastCalibration[horizon].full.pairs
    ])
  ),
  eventLevelDependence: eventCatalogCalibration,
  warnings
};

await mkdir(generatedDir, { recursive: true });
await writeFile(outputJsonPath, JSON.stringify(output, null, 2));
await writeFile(
  outputCsvPath,
  [csvHeaders, ...csvRows].map((row) => row.map(csvEscape).join(",")).join("\n")
);
await writeFile(modelPath, JSON.stringify(modelParameters, null, 2));

console.log(`Calibrated ${factorIds.length} factors across ${horizons.length} horizons.`);
console.log(`Model version: ${modelVersion}`);
for (const horizon of horizons) {
  const full = forecastCalibration[horizon].full;
  console.log(
    `  ${horizon}: ${full.anyTailEvent.successes}/${full.anyTailEvent.observations} any-event positives, posterior ${(
      full.anyTailEvent.posteriorMean * 100
    ).toFixed(2)}%`
  );
}
console.log(`Event catalog: ${events.length} events; ${sparsePairs} sparse factor pairs.`);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
console.log(`Wrote ${outputJsonPath}`);
console.log(`Wrote ${modelPath}`);
