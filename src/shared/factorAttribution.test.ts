import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFactorAttribution,
  calculateScenarioPnl,
  FactorAttributionValidationError,
  type FactorAttributionInput,
} from "./factorAttribution";
const closeTo = (actual: number, expected: number, tolerance = 1e-12): void => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

const provenance = { source: "synthetic test fixture", asOf: "2025-01-01", units: "decimal return", status: "manual" as const };
const baseInput: FactorAttributionInput = {
  factors: [
    { id: "market", label: "Market", ...provenance },
    { id: "value", label: "Value", ...provenance },
  ],
  factorReturns: { market: 0.1, value: 0.2 },
  factorCovariance: [[0.04, 0.01], [0.01, 0.09]],
  securities: [
    { securityId: "A", exposures: { market: 1, value: 0.5 }, specificReturn: 0.01, specificVariance: 0.01, sector: "growth", ...provenance },
    { securityId: "B", exposures: { market: 0.2, value: 1 }, specificReturn: -0.02, specificVariance: 0.04, sector: "value", ...provenance },
  ],
  portfolioWeights: { A: 0.6, B: 0.4 },
  benchmarkWeights: { A: 0.5, B: 0.5 },
  scenario: { id: "shock-1", factorShocks: { market: 0.03, value: -0.02 }, provenance: { ...provenance, units: "decimal return shock" } },
};

test("two-factor/two-security exposure, return and variance decomposition", () => {
  const result = calculateFactorAttribution(baseInput);
  closeTo(result.portfolioExposure.market, 0.68);
  closeTo(result.factorContributions[0].expectedContribution, 0.068);
  closeTo(result.factorContributions[1].expectedContribution, 0.14);
  closeTo(result.specificContribution, -0.002);
  closeTo(result.totalExpectedReturn, 0.206);
  closeTo(result.risk.factorVariance, 0.072116);
  closeTo(result.risk.specificVariance, 0.01);
  closeTo(result.risk.totalVariance, 0.082116);
  assert.ok(Math.abs(result.risk.volatility - Math.sqrt(0.082116)) < 1e-12);
  assert.ok(Math.abs(Object.values(result.risk.factorVarianceContributions).reduce((a, b) => a + b, 0) - result.risk.factorVariance) < 1e-12);
  assert.ok(Math.abs(Object.values(result.risk.securitySpecificVarianceContributions).reduce((a, b) => a + b, 0) - result.risk.specificVariance) < 1e-12);
});

test("benchmark active exposure/risk and deterministic factor shock P&L", () => {
  const result = calculateFactorAttribution(baseInput);
  assert.deepEqual(result.benchmark?.exposure, { market: 0.6, value: 0.75 });
  closeTo(result.active?.activeExposure.market ?? Number.NaN, 0.08);
  closeTo(result.active?.activeExpectedReturn ?? Number.NaN, 0.001);
  closeTo(result.active?.totalVariance ?? Number.NaN, 0.000901);
  closeTo(result.scenario?.portfolioPnl ?? Number.NaN, 0.0064);
  closeTo(result.scenario?.benchmarkPnl ?? Number.NaN, 0.003);
  closeTo(result.scenario?.activePnl ?? Number.NaN, 0.0034);
});

test("Brinson attribution is withheld until realized sector inputs are supplied", () => {
  const without = calculateFactorAttribution(baseInput);
  assert.equal(without.brinsonAttribution, undefined);
  const withBrinson = calculateFactorAttribution({
    ...baseInput,
    brinson: {
      securityReturns: { A: 0.12, B: 0.04 },
      benchmarkSecurityReturns: { A: 0.1, B: 0.05 },
      sectorBySecurity: { A: "growth", B: "value" },
    },
  });
  assert.ok(withBrinson.brinsonAttribution);
  const attribution = withBrinson.brinsonAttribution!;
  assert.ok(Math.abs(attribution.total.total - ((0.6 * 0.12 + 0.4 * 0.04) - (0.5 * 0.1 + 0.5 * 0.05))) < 1e-12);
});

test("zero loadings are a negative control", () => {
  const result = calculateFactorAttribution({
    ...baseInput,
    securities: baseInput.securities.map(security => ({ ...security, exposures: { market: 0, value: 0 }, specificReturn: 0 })),
  });
  assert.deepEqual(result.portfolioExposure, { market: 0, value: 0 });
  assert.equal(result.expectedReturn, 0);
  assert.equal(result.specificContribution, 0);
  assert.equal(result.risk.factorVariance, 0);
});

test("dimension, PSD, finite-value and weight constraints fail loudly", () => {
  assert.throws(() => calculateFactorAttribution({ ...baseInput, factorCovariance: [[0.04]] }), (error: unknown) => error instanceof FactorAttributionValidationError && error.issues.some(issue => issue.includes("dimension")));
  assert.throws(() => calculateFactorAttribution({ ...baseInput, factorCovariance: [[1, 2], [2, 1]] }), (error: unknown) => error instanceof FactorAttributionValidationError && error.issues.some(issue => issue.includes("positive semidefinite")));
  assert.throws(() => calculateFactorAttribution({ ...baseInput, portfolioWeights: { A: 1.2, B: -0.2 } }), (error: unknown) => error instanceof FactorAttributionValidationError && error.issues.some(issue => issue.includes("negative weight")));
  assert.throws(() => calculateFactorAttribution({ ...baseInput, factorReturns: { market: Number.NaN, value: 0.2 } }), (error: unknown) => error instanceof FactorAttributionValidationError && error.issues.some(issue => issue.includes("finite")));
});

test("standalone scenario calculation preserves explicit provenance", () => {
  const scenario = calculateScenarioPnl(baseInput, { factorShocks: [0.03, -0.02], provenance: { ...provenance, units: "decimal return shock" } });
  closeTo(scenario.securities[0].totalPnl, 0.02);
  closeTo(scenario.securities[1].totalPnl, -0.014);
  assert.equal(scenario.provenance.source, "synthetic test fixture");
});
