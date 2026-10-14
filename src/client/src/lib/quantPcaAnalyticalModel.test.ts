import test from "node:test";
import assert from "node:assert/strict";
import { AnalyticalModelRegistry } from "./analyticalRegistry";
import {
  QUANT_PCA_ANALYTICAL_MODEL,
  QUANT_PCA_MODEL_ID,
  runQuantPca,
} from "./quantPcaAnalyticalModel";

function almostEqual(left: number, right: number, tolerance = 1e-9): boolean {
  return Math.abs(left - right) <= tolerance;
}

test("PCA concentrates perfectly collinear variables into the first component", () => {
  const result = runQuantPca({
    observations: [
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
      [5, 10],
    ],
    labels: ["A", "B"],
    mode: "covariance",
    components: 2,
  });

  assert.notEqual(result.status, "blocked");
  assert.equal(result.components.length, 2);
  assert.ok(result.components[0].explainedVarianceRatio > 0.999999999);
  assert.ok(result.components[1].explainedVarianceRatio < 1e-9);
  assert.equal(result.effectiveRank, 1);
  const dominant = result.components[0].vector.reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
  assert.ok(dominant >= 0);
});

test("PCA component vectors are orthonormal and deterministically oriented", () => {
  const input = {
    observations: [
      [2, 0, 1],
      [3, 1, 0],
      [4, 1, 2],
      [5, 2, 1],
      [6, 3, 4],
      [7, 5, 3],
    ],
    labels: ["Value", "Quality", "Momentum"],
    mode: "correlation" as const,
    components: 3,
  };
  const first = runQuantPca(input);
  const second = runQuantPca(input);

  assert.deepEqual(first.components, second.components);
  for (const component of first.components) {
    const norm = Math.sqrt(component.vector.reduce((sum, value) => sum + value * value, 0));
    assert.ok(almostEqual(norm, 1, 1e-8));
    const anchor = component.vector.reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
    assert.ok(anchor >= 0);
  }
  for (let left = 0; left < first.components.length; left += 1) {
    for (let right = left + 1; right < first.components.length; right += 1) {
      const dot = first.components[left].vector.reduce((sum, value, index) => sum + value * first.components[right].vector[index], 0);
      assert.ok(Math.abs(dot) < 1e-8);
    }
  }
});

test("correlation PCA handles a constant variable explicitly instead of producing NaN", () => {
  const result = runQuantPca({
    observations: [
      [1, 5, 2],
      [2, 5, 3],
      [3, 5, 4],
      [4, 5, 5],
    ],
    labels: ["A", "Constant", "B"],
    mode: "correlation",
    components: 2,
  });

  assert.equal(result.status, "partial");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.id === "zero-variance-1"));
  assert.ok(result.components.every((component) => component.vector.every(Number.isFinite)));
  assert.ok(result.scores.flat().every(Number.isFinite));
});

test("PCA registry runs are reproducible and fingerprint the actual observation matrix", () => {
  const registry = new AnalyticalModelRegistry().register(QUANT_PCA_ANALYTICAL_MODEL);
  const input = {
    observations: [[1, 2], [2, 1], [3, 4], [4, 3]],
    labels: ["A", "B"],
    mode: "covariance" as const,
    components: 2,
    source: "governed-returns",
    sourceAsOf: "2026-09-10T00:00:00.000Z",
  };
  const first = registry.run(QUANT_PCA_MODEL_ID, input, { objectId: "portfolio:test", runAt: "2026-09-10T10:00:00.000Z" }).run;
  const repeated = registry.run(QUANT_PCA_MODEL_ID, input, { objectId: "portfolio:test", runAt: "2026-09-10T10:05:00.000Z" }).run;
  const changed = registry.run(QUANT_PCA_MODEL_ID, {
    ...input,
    observations: [[1, 2], [2, 1], [3, 4], [4, 30]],
  }, { objectId: "portfolio:test", runAt: "2026-09-10T10:10:00.000Z" }).run;

  assert.equal(first.status, "success");
  assert.equal(first.reproducibilityHash, repeated.reproducibilityHash);
  assert.equal(first.inputFingerprint, repeated.inputFingerprint);
  assert.notEqual(first.reproducibilityHash, changed.reproducibilityHash);
  assert.notEqual(first.inputFingerprint, changed.inputFingerprint);
  assert.ok(first.outputs.some((output) => output.id === "pc1ExplainedVariancePct" && typeof output.value === "number"));
  assert.equal(first.evidence[0]?.source, input.source);
});

test("PCA blocks malformed and variance-free matrices with useful diagnostics", () => {
  const ragged = runQuantPca({ observations: [[1, 2], [3]] });
  assert.equal(ragged.status, "blocked");
  assert.ok(ragged.diagnostics.some((diagnostic) => diagnostic.id === "ragged-matrix" && diagnostic.blocking));

  const constant = runQuantPca({ observations: [[1, 1], [1, 1], [1, 1]] });
  assert.equal(constant.status, "blocked");
  assert.ok(constant.diagnostics.some((diagnostic) => diagnostic.id === "no-variance" && diagnostic.blocking));
});
