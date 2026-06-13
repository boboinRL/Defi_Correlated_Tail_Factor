function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function normalPair(random) {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  const radius = Math.sqrt(-2 * Math.log(u1));
  const angle = 2 * Math.PI * u2;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

// Acklam's rational approximation for the inverse standard normal CDF.
export function inverseNormal(probability) {
  const p = clamp(probability, 1e-12, 1 - 1e-12);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;

  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= high) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function cholesky(matrix) {
  const size = matrix.length;
  const lower = Array.from({ length: size }, () => Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = matrix[row][column];
      for (let index = 0; index < column; index += 1) {
        sum -= lower[row][index] * lower[column][index];
      }
      if (row === column) {
        if (sum <= 1e-10) return null;
        lower[row][column] = Math.sqrt(sum);
      } else {
        lower[row][column] = sum / lower[column][column];
      }
    }
  }
  return lower;
}

function stabilizedCholesky(matrix) {
  let shrinkage = 1;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = matrix.map((row, rowIndex) =>
      row.map((value, columnIndex) => rowIndex === columnIndex ? 1 : value * shrinkage)
    );
    const lower = cholesky(candidate);
    if (lower) return { matrix: candidate, lower, psdShrinkage: shrinkage };
    shrinkage *= 0.9;
  }
  const identity = matrix.map((row, rowIndex) =>
    row.map((_, columnIndex) => rowIndex === columnIndex ? 1 : 0)
  );
  return { matrix: identity, lower: cholesky(identity), psdShrinkage: 0 };
}

function pairKey(left, right) {
  return [left, right].sort().join(":");
}

function pairMap(modelParameters) {
  const map = new Map();
  for (const pair of modelParameters?.eventLevelDependence?.pairs || []) {
    map.set(pairKey(pair.factorA, pair.factorB), pair);
  }
  return map;
}

export function buildCorrelationModel(factorIds, modelParameters, useCorrelation = true) {
  const pairs = pairMap(modelParameters);
  const diagnostics = [];
  const raw = factorIds.map((factorA, row) =>
    factorIds.map((factorB, column) => {
      if (row === column) return 1;
      if (!useCorrelation) return 0;
      const pair = pairs.get(pairKey(factorA, factorB));
      const observed = Number(pair?.phiCorrelation);
      const both = Number(pair?.counts?.both || 0);
      const reliability = both / (both + 5);
      const shrunk = Number.isFinite(observed)
        ? clamp(observed * reliability, -0.75, 0.75)
        : 0;
      if (row < column) {
        diagnostics.push({
          factorIds: [factorA, factorB],
          observedPhi: Number.isFinite(observed) ? observed : null,
          jointEventCount: both,
          reliability,
          correlation: shrunk,
          source: pair ? "Event catalog phi, sparse-sample shrinkage" : "No observed pair; zero prior"
        });
      }
      return shrunk;
    })
  );
  const stabilized = stabilizedCholesky(raw);
  for (const diagnostic of diagnostics) {
    const left = factorIds.indexOf(diagnostic.factorIds[0]);
    const right = factorIds.indexOf(diagnostic.factorIds[1]);
    diagnostic.correlation = stabilized.matrix[left][right];
  }
  return { ...stabilized, diagnostics };
}

function confidenceInterval(successes, samples, z = 1.96) {
  if (!samples) return { low: 0, high: 0 };
  const probability = successes / samples;
  const error = z * Math.sqrt(Math.max(probability * (1 - probability), 0.25 / samples) / samples);
  return {
    low: clamp(probability - error),
    high: clamp(probability + error)
  };
}

export function simulateJointProbability({
  factors,
  horizon,
  modelParameters,
  useCorrelation = true,
  severity = 0.65,
  marketMultipliers = {},
  samples = 100000,
  seed = ""
}) {
  if (!factors.length) {
    return {
      allSelectedProbability: 0,
      anySelectedProbability: 0,
      atLeastTwoProbability: 0,
      confidence95: { low: 0, high: 0 },
      samples: 0,
      seed: 0,
      correlation: { diagnostics: [], psdShrinkage: 1 }
    };
  }

  const calibrated = modelParameters?.probabilityByHorizon?.[horizon] || {};
  const severityMultiplier = 0.65 + clamp(severity, 0, 1) * 0.7;
  const marginals = factors.map((factor) => {
    const base = Number(calibrated[factor.id]?.posteriorMean ?? factor.marginalProbability ?? factor.baseProb);
    const marketMultiplier = Number(marketMultipliers[factor.id] || factor.marketMultiplier || 1);
    return clamp(base * severityMultiplier * marketMultiplier, 1e-7, 0.75);
  });
  const factorIds = factors.map((factor) => factor.id);
  const thresholds = marginals.map(inverseNormal);
  const correlation = buildCorrelationModel(factorIds, modelParameters, useCorrelation);
  const numericSeed = hashSeed(
    seed || `${modelParameters?.modelVersion || "model"}:${horizon}:${factorIds.join(",")}:${severity}:${useCorrelation}`
  );
  const random = mulberry32(numericSeed);
  const totalSamples = Math.max(10000, Math.round(samples));
  let allCount = 0;
  let anyCount = 0;
  let atLeastTwoCount = 0;
  const independentAll = marginals.reduce((product, value) => product * value, 1);
  const independentAny = 1 - marginals.reduce((product, value) => product * (1 - value), 1);

  for (let sample = 0; sample < totalSamples; sample += 1) {
    const independentNormals = [];
    while (independentNormals.length < factorIds.length) {
      independentNormals.push(...normalPair(random));
    }
    let eventCount = 0;
    for (let row = 0; row < factorIds.length; row += 1) {
      let latent = 0;
      for (let column = 0; column <= row; column += 1) {
        latent += correlation.lower[row][column] * independentNormals[column];
      }
      if (latent <= thresholds[row]) eventCount += 1;
    }
    if (eventCount === factorIds.length) allCount += 1;
    if (eventCount > 0) anyCount += 1;
    if (eventCount >= 2) atLeastTwoCount += 1;
  }

  const simulatedAll = allCount / totalSamples;
  // Rare-event smoothing prevents an exact zero while keeping the estimate below one simulated hit.
  const allSelectedProbability = (allCount + 0.5) / (totalSamples + 1);
  const anySelectedProbability = (anyCount + 0.5) / (totalSamples + 1);
  const atLeastTwoProbability = factorIds.length >= 2
    ? (atLeastTwoCount + 0.5) / (totalSamples + 1)
    : 0;
  return {
    allSelectedProbability,
    rawAllSelectedProbability: simulatedAll,
    anySelectedProbability,
    atLeastTwoProbability,
    independentAllProbability: independentAll,
    independentAnyProbability: independentAny,
    dependenceLift: independentAll ? allSelectedProbability / independentAll : null,
    confidence95: confidenceInterval(allCount, totalSamples),
    marginals: Object.fromEntries(factorIds.map((id, index) => [id, marginals[index]])),
    samples: totalSamples,
    seed: numericSeed,
    correlation: {
      diagnostics: correlation.diagnostics,
      psdShrinkage: correlation.psdShrinkage
    }
  };
}
