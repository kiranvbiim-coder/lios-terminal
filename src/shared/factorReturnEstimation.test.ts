import test from "node:test";
import assert from "node:assert/strict";
import { ordinaryLeastSquares, estimateFactorReturns, type PeriodReturns } from "./factorReturnEstimation";
import type { FactorDefinition, SecurityFactorExposure } from "./factorAttribution";

const factors: FactorDefinition[] = [
  { id: "factor_a", label: "Factor A", source: "known test fixture", asOf: "2026-08-31", status: "derived", units: "decimal return" },
  { id: "factor_b", label: "Factor B", source: "known test fixture", asOf: "2026-08-31", status: "derived", units: "decimal return" },
];

const exposures: SecurityFactorExposure[] = Array.from({ length: 7 }, (_, index) => ({
  securityId: `SEC${index + 1}`,
  exposures: { factor_a: index + 1, factor_b: (index % 3) - 1 },
  source: "known test fixture",
  asOf: "2026-08-31",
  status: "derived",
  units: "decimal exposure",
}));

function generatedPeriods(count: number): PeriodReturns[] {
  return Array.from({ length: count }, (_, periodIndex) => {
    const trueReturns = { factor_a: 0.01 * (periodIndex + 1), factor_b: -0.005 * (periodIndex + 2) };
    return {
      periodEnd: `2026-${String(periodIndex + 1).padStart(2, "0")}-28`,
      securityReturns: Object.fromEntries(exposures.map((security) => [
        security.securityId,
        security.exposures.factor_a * trueReturns.factor_a + security.exposures.factor_b * trueReturns.factor_b,
      ])),
    };
  });
}

test("ordinaryLeastSquares recovers a hand-solvable exact coefficient vector", () => {
  const result = ordinaryLeastSquares([[1, 0], [0, 1], [1, 1]], [2, 3, 5]);
  assert.ok(Math.abs(result.coefficients[0] - 2) < 1e-12);
  assert.ok(Math.abs(result.coefficients[1] - 3) < 1e-12);
  assert.ok(result.residuals.every((value) => Math.abs(value) < 1e-12));
  assert.equal(result.rSquared, 1);
});

test("estimateFactorReturns recovers synthetic factor returns exactly and annualizes covariance", () => {
  const periods = generatedPeriods(8);
  const result = estimateFactorReturns(factors, exposures, periods, 12);
  assert.equal(result.periodsUsed, 8);
  assert.deepEqual(result.excludedPeriods, []);
  for (let periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
    const expectedA = 0.01 * (periodIndex + 1);
    const expectedB = -0.005 * (periodIndex + 2);
    const actual = result.factorReturnSeries[periodIndex].returns;
    assert.ok(Math.abs(actual.factor_a - expectedA) < 1e-12);
    assert.ok(Math.abs(actual.factor_b - expectedB) < 1e-12);
    assert.equal(result.regressionRSquaredByPeriod[periods[periodIndex].periodEnd], 1);
  }
  assert.equal(result.factorCovariance.length, 2);
  assert.equal(result.factorCovariance[0].length, 2);
  assert.deepEqual(result.factorCovariance[0][1], result.factorCovariance[1][0]);
  assert.ok(result.factorCovariance[0][0] > 0);
  assert.ok(result.factorCovariance[1][1] > 0);
  // Exact residuals are zero, so the specific variance is known exactly as zero.
  // Exact residuals are zero up to floating-point elimination error.
  assert.ok(Object.values(result.specificVariances).every((value) => value < 1e-20));
  assert.deepEqual(result.excludedFromSpecificVariance, []);
});

test("estimateFactorReturns excludes periods with too few cross-sectional securities", () => {
  const sparsePeriod = generatedPeriods(1)[0];
  const sparseReturns = Object.fromEntries(Object.entries(sparsePeriod.securityReturns).slice(0, 6));
  const sparseResult = estimateFactorReturns(factors, exposures, [{ ...sparsePeriod, securityReturns: sparseReturns }], 12);
  assert.equal(sparseResult.periodsUsed, 0);
  assert.equal(sparseResult.excludedPeriods.length, 1);
  assert.match(sparseResult.excludedPeriods[0].reason, /at least 7 securities/);
});

test("estimateFactorReturns reports specific-variance exclusion when residual history is short", () => {
  const result = estimateFactorReturns(factors, exposures, generatedPeriods(5), 12);
  assert.equal(result.periodsUsed, 5);
  assert.deepEqual(result.specificVariances, {});
  assert.equal(result.excludedFromSpecificVariance.length, exposures.length);
  assert.ok(result.excludedFromSpecificVariance.every((item) => /requires >=6/.test(item.reason)));
});

test("ordinaryLeastSquares rejects singular designs instead of fabricating coefficients", () => {
  assert.throws(
    () => ordinaryLeastSquares([[1, 1], [2, 2], [3, 3]], [1, 2, 3]),
    /singular|insufficiently identified/i,
  );
});
