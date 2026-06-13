import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDir = join(root, "data", "generated");
const trainingPath = join(generatedDir, "training_dataset.json");
const modelPath = join(root, "data", "model_parameters.json");
const validationPath = join(root, "data", "model_validation.json");
const predictionsPath = join(generatedDir, "backtest_predictions.json");
const predictionsCsvPath = join(generatedDir, "backtest_predictions.csv");
const training = JSON.parse(await readFile(trainingPath, "utf8"));
const model = JSON.parse(await readFile(modelPath, "utf8"));

const factorIds = training.metadata?.factorIds || [];
const horizons = training.metadata?.horizons || { "1d": 1, "7d": 7, "30d": 30 };
const rollingDays = Number(process.env.BACKTEST_WINDOW_DAYS || 730);
const minimumTrainingRows = Number(process.env.BACKTEST_MIN_ROWS || 180);
const bins = Number(process.env.CALIBRATION_BINS || 5);
const alpha = 0.5;
const beta = 0.5;

function utcDay(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

function clamp(value, min = 1e-9, max = 1 - 1e-9) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function targetValue(row, target) {
  return target === "any" ? Number(row.labelAnyTailEvent || 0) : Number(row.labels?.[target] || 0);
}

function metrics(predictions) {
  if (!predictions.length) {
    return { observations: 0, positives: 0, prevalence: null, brierScore: null, logLoss: null };
  }
  let brier = 0;
  let logLoss = 0;
  let positives = 0;
  for (const item of predictions) {
    const probability = clamp(item.probability);
    positives += item.outcome;
    brier += (probability - item.outcome) ** 2;
    logLoss += -(item.outcome * Math.log(probability) + (1 - item.outcome) * Math.log(1 - probability));
  }
  return {
    observations: predictions.length,
    positives,
    prevalence: round(positives / predictions.length),
    brierScore: round(brier / predictions.length),
    logLoss: round(logLoss / predictions.length)
  };
}

function calibrationCurve(predictions, binCount) {
  if (!predictions.length) return [];
  const sorted = [...predictions].sort((a, b) => a.probability - b.probability);
  const effectiveBins = Math.min(binCount, sorted.length);
  const result = [];
  for (let bin = 0; bin < effectiveBins; bin += 1) {
    const start = Math.floor(bin * sorted.length / effectiveBins);
    const end = Math.floor((bin + 1) * sorted.length / effectiveBins);
    const items = sorted.slice(start, end);
    if (!items.length) continue;
    const meanPredicted = items.reduce((sum, item) => sum + item.probability, 0) / items.length;
    const observedRate = items.reduce((sum, item) => sum + item.outcome, 0) / items.length;
    result.push({
      bin: bin + 1,
      observations: items.length,
      meanPredicted: round(meanPredicted),
      observedRate: round(observedRate),
      minPredicted: round(items[0].probability),
      maxPredicted: round(items.at(-1).probability)
    });
  }
  return result;
}

const allPredictions = [];
const report = {};

for (const [horizon, horizonDays] of Object.entries(horizons)) {
  const observedRows = (training.rows || [])
    .filter((row) => row.horizon === horizon && row.labelObserved !== false)
    .sort((a, b) => a.date.localeCompare(b.date));
  const targets = ["any", ...factorIds];
  const targetPredictions = Object.fromEntries(targets.map((target) => [target, []]));

  for (const forecastRow of observedRows) {
    const forecastDay = utcDay(forecastRow.date);
    const knownOutcomeCutoff = forecastDay - Number(horizonDays) * 86_400_000;
    const windowStart = knownOutcomeCutoff - rollingDays * 86_400_000;
    const history = observedRows.filter((row) => {
      const rowDay = utcDay(row.date);
      return rowDay <= knownOutcomeCutoff && rowDay >= windowStart;
    });
    if (history.length < minimumTrainingRows) continue;

    for (const target of targets) {
      const positives = history.reduce((sum, row) => sum + targetValue(row, target), 0);
      const probability = (positives + alpha) / (history.length + alpha + beta);
      const prediction = {
        date: forecastRow.date,
        horizon,
        target,
        probability,
        outcome: targetValue(forecastRow, target),
        trainingRows: history.length,
        trainingStart: history[0].date,
        trainingEnd: history.at(-1).date
      };
      targetPredictions[target].push(prediction);
      allPredictions.push(prediction);
    }
  }

  report[horizon] = Object.fromEntries(
    targets.map((target) => [
      target,
      {
        ...metrics(targetPredictions[target]),
        calibrationCurve: calibrationCurve(targetPredictions[target], bins)
      }
    ])
  );
}

const generatedAt = new Date().toISOString();
const validation = {
  metadata: {
    generatedAt,
    validationVersion: `walk-forward-v0.1.0-${generatedAt.slice(0, 10).replaceAll("-", "")}`,
    modelVersion: model.modelVersion,
    status: "exploratory",
    method: "Walk-forward historical probability backtest",
    rollingWindowDays: rollingDays,
    minimumTrainingRows,
    betaPrior: { alpha, beta },
    labelObservedThrough: training.metadata?.labelObservedThrough || null,
    warnings: [
      "The event catalog contains few independent events, so metrics have high sampling uncertainty.",
      "Overlapping horizon labels are serially dependent; observation counts are not independent incident counts.",
      "This backtest validates rolling marginal probabilities, not the full contract-specific loss model."
    ]
  },
  horizons: report
};

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const headers = [
  "date",
  "horizon",
  "target",
  "probability",
  "outcome",
  "training_rows",
  "training_start",
  "training_end"
];
const csvRows = allPredictions.map((row) => [
  row.date,
  row.horizon,
  row.target,
  row.probability,
  row.outcome,
  row.trainingRows,
  row.trainingStart,
  row.trainingEnd
]);

await mkdir(generatedDir, { recursive: true });
await writeFile(validationPath, JSON.stringify(validation, null, 2));
await writeFile(predictionsPath, JSON.stringify({ metadata: validation.metadata, rows: allPredictions }, null, 2));
await writeFile(
  predictionsCsvPath,
  [headers, ...csvRows].map((row) => row.map(csvEscape).join(",")).join("\n")
);

console.log(`Walk-forward validation for model ${model.modelVersion}:`);
for (const horizon of Object.keys(horizons)) {
  const any = report[horizon].any;
  console.log(
    `  ${horizon}: n=${any.observations}, positives=${any.positives}, Brier=${any.brierScore}, LogLoss=${any.logLoss}`
  );
}
console.log(`Wrote ${validationPath}`);
console.log(`Wrote ${predictionsPath}`);
