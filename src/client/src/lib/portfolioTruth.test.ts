import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePortfolioValuationCoverage, resolveHoldingCurrency } from "./portfolioTruth";

test("portfolio truth guard allows complete single-currency valuation", () => {
  const result = evaluatePortfolioValuationCoverage([
    { symbol: "AAPL", quoteCurrency: "USD", hasLivePrice: true },
    { symbol: "MSFT", quoteCurrency: "USD", hasLivePrice: true },
  ]);
  assert.equal(result.reason, "ready");
  assert.equal(result.canAggregateWeights, true);
  assert.deepEqual(result.currencyCodes, ["USD"]);
});

test("portfolio truth guard blocks mixed-currency weighting without FX normalization", () => {
  const result = evaluatePortfolioValuationCoverage([
    { symbol: "AAPL", quoteCurrency: "USD", hasLivePrice: true },
    { symbol: "RELIANCE.NS", quoteCurrency: "INR", hasLivePrice: true },
  ]);
  assert.equal(result.reason, "mixed_currency");
  assert.equal(result.canAggregateWeights, false);
});

test("portfolio truth guard blocks aggregate valuation when a live price is missing", () => {
  const result = evaluatePortfolioValuationCoverage([
    { symbol: "AAPL", quoteCurrency: "USD", hasLivePrice: true },
    { symbol: "MSFT", quoteCurrency: "USD", hasLivePrice: false },
  ]);
  assert.equal(result.reason, "missing_quotes");
  assert.equal(result.pricedCount, 1);
  assert.equal(result.canAggregateWeights, false);
});

test("authoritative quote currency overrides symbol inference", () => {
  assert.equal(resolveHoldingCurrency("AAPL", "CAD"), "CAD");
  assert.equal(resolveHoldingCurrency("RELIANCE.NS", null), "INR");
});
