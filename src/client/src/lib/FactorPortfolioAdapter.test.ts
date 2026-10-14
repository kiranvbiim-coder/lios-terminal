import test from "node:test";
import assert from "node:assert/strict";
import { adaptFactorPortfolioJson, runFactorPortfolioJson } from "./FactorPortfolioAdapter";

const validDocument = {
  sourceClassification: "MANUAL",
  factors: [{ id: "market", label: "Market", source: "Analyst workbook", asOf: "2026-08-30", units: "decimal return", period: "annual" }],
  factorReturns: { market: 0.1 },
  factorReturnProvenance: { market: { source: "Analyst workbook", asOf: "2026-08-30", units: "decimal return", period: "annual" } },
  factorCovariance: [[4]],
  factorCovarianceProvenance: { source: "Risk model export", asOf: "2026-08-30", units: "squared decimal return", period: "annual" },
  securities: [
    { securityId: "A", exposures: { market: 1 }, specificReturn: 0.02, source: "Analyst workbook", asOf: "2026-08-30", units: "decimal return", period: "annual" },
    { securityId: "B", exposures: { market: 3 }, specificReturn: 0.01, source: "Analyst workbook", asOf: "2026-08-30", units: "decimal return", period: "annual" },
  ],
  specificVariances: { A: 0.04, B: 0.09 },
  specificVarianceProvenance: { source: "Risk model export", asOf: "2026-08-30", units: "squared decimal return", period: "annual" },
  portfolioWeights: { A: 0.5, B: 0.5 },
  portfolioWeightsProvenance: { source: "Custodian holdings", asOf: "2026-08-30", units: "weight" },
  benchmarkWeights: { A: 0.25, B: 0.75 },
  benchmarkWeightsProvenance: { source: "Benchmark holdings", asOf: "2026-08-30", units: "weight" },
  scenario: { id: "market-up", label: "Market +20%", factorShocks: { market: 0.2 }, provenance: { source: "Analyst scenario", asOf: "2026-08-30", units: "decimal return" } },
};

test("FactorPortfolio adapter runs known-answer attribution and scenario", () => {
  const result = runFactorPortfolioJson(JSON.stringify(validDocument));
  assert.ok("attribution" in result);
  assert.equal(result.receipt.status, "READY");
  assert.equal(result.receipt.sourceClassification, "MANUAL");
  assert.equal(result.attribution.portfolioExposure.market, 2);
  assert.equal(result.attribution.factorContributions[0].expectedContribution, 0.2);
  assert.equal(result.attribution.specificContribution, 0.015);
  assert.ok(Math.abs(result.attribution.totalExpectedReturn - 0.215) < 1e-12);
  assert.equal(result.attribution.risk.factorVariance, 16);
  assert.equal(result.attribution.risk.specificVariance, 0.0325);
  assert.equal(result.attribution.benchmark?.exposure.market, 2.5);
  assert.equal(result.attribution.active?.activeExposure.market, -0.5);
  assert.equal(result.attribution.scenario?.portfolioPnl, 0.4);
});

test("FactorPortfolio adapter reuses real basket weights only when security order matches", () => {
  const { portfolioWeights: _, portfolioWeightsProvenance: __, ...withoutWeights } = validDocument;
  const result = adaptFactorPortfolioJson(JSON.stringify(withoutWeights), { assets: ["A", "B"], weights: [0.6, 0.4], asOf: "2026-08-29" });
  assert.equal(result.receipt.status, "READY");
  assert.deepEqual(result.input?.portfolioWeights, { A: 0.6, B: 0.4 });
  assert.equal(result.input?.portfolioWeightsProvenance?.source, "live-portfolio-optimizer-basket");
});

test("FactorPortfolio adapter blocks missing provenance and specific variances", () => {
  const incomplete = { ...validDocument, specificVariances: undefined, factorCovarianceProvenance: undefined, sourceClassification: "PRIVATE" };
  const result = adaptFactorPortfolioJson(JSON.stringify(incomplete));
  assert.equal(result.input, null);
  assert.equal(result.receipt.status, "BLOCKED");
  assert.ok(result.receipt.errors.some((error) => error.includes("specificVariances is required")));
  assert.ok(result.receipt.errors.some((error) => error.includes("factorCovarianceProvenance")));
});

test("FactorPortfolio adapter blocks invalid dimensions, weights and non-PSD covariance", () => {
  const dimensionAndWeightFailure = {
    ...validDocument,
    factorCovariance: [[1, 2], [2, 1]],
    portfolioWeights: { A: 0.8, B: 0.8 },
  };
  const dimensionResult = adaptFactorPortfolioJson(JSON.stringify(dimensionAndWeightFailure));
  assert.equal(dimensionResult.input, null);
  assert.ok(dimensionResult.receipt.errors.some((error) => error.includes("dimension")));
  assert.ok(dimensionResult.receipt.errors.some((error) => error.includes("must sum to one")));

  const nonPsdResult = adaptFactorPortfolioJson(JSON.stringify({ ...validDocument, factorCovariance: [[-1]] }));
  assert.equal(nonPsdResult.input, null);
  assert.ok(nonPsdResult.receipt.errors.some((error) => error.includes("positive semidefinite")));
});

test("FactorPortfolio adapter rejects invalid JSON and never infers factor model inputs", () => {
  const result = adaptFactorPortfolioJson("[]");
  assert.equal(result.input, null);
  assert.equal(result.receipt.status, "BLOCKED");
  assert.ok(result.receipt.errors.some((error) => error.includes("JSON object")));
  const missingModel = adaptFactorPortfolioJson(JSON.stringify({ sourceClassification: "MANUAL", securities: [{ securityId: "A" }] }));
  assert.ok(missingModel.receipt.errors.some((error) => error.includes("factorReturns")));
  assert.ok(missingModel.receipt.errors.some((error) => error.includes("factorCovariance")));
});
