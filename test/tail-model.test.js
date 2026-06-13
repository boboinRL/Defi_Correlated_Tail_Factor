import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { simulateJointProbability } from "../lib/tail-model.js";

const model = JSON.parse(
  await readFile(new URL("../data/model_parameters.json", import.meta.url), "utf8")
);
const factors = [
  { id: "liquidity", baseProb: 0.02 },
  { id: "volatility", baseProb: 0.02 }
];

test("empty selection returns exact zero probabilities", () => {
  const result = simulateJointProbability({
    factors: [],
    horizon: "7d",
    modelParameters: model
  });
  assert.equal(result.allSelectedProbability, 0);
  assert.equal(result.anySelectedProbability, 0);
  assert.equal(result.atLeastTwoProbability, 0);
});

test("Monte Carlo results are deterministic for a fixed seed", () => {
  const options = {
    factors,
    horizon: "7d",
    modelParameters: model,
    samples: 30000,
    seed: "fixed-test-seed"
  };
  assert.deepEqual(simulateJointProbability(options), simulateJointProbability(options));
});

test("probability containment holds for multiple factors", () => {
  const result = simulateJointProbability({
    factors,
    horizon: "7d",
    modelParameters: model,
    samples: 50000,
    seed: "containment"
  });
  assert.ok(result.allSelectedProbability <= result.atLeastTwoProbability);
  assert.ok(result.atLeastTwoProbability <= result.anySelectedProbability);
  assert.ok(result.confidence95.low <= result.confidence95.high);
});

test("correlation can be disabled to recover the independent joint estimate", () => {
  const result = simulateJointProbability({
    factors,
    horizon: "7d",
    modelParameters: model,
    useCorrelation: false,
    samples: 150000,
    seed: "independent"
  });
  const error = Math.abs(result.rawAllSelectedProbability - result.independentAllProbability);
  assert.ok(error < 0.0015, `independent Monte Carlo error was ${error}`);
  assert.equal(result.correlation.psdShrinkage, 1);
});

test("stabilized correlation matrix remains simulatable", () => {
  const manyFactors = [
    "oracle",
    "liquidity",
    "volatility",
    "keeper",
    "governance",
    "stablecoin",
    "gas",
    "mev"
  ].map((id) => ({ id, baseProb: 0.01 }));
  const result = simulateJointProbability({
    factors: manyFactors,
    horizon: "30d",
    modelParameters: model,
    samples: 20000,
    seed: "full-matrix"
  });
  assert.ok(Number.isFinite(result.anySelectedProbability));
  assert.ok(result.correlation.psdShrinkage >= 0);
  assert.ok(result.correlation.psdShrinkage <= 1);
});
