import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNormalizedComparisonSeries,
  calculateAnnualizedVolatilityPct,
  calculateBeta,
  calculateMaxDrawdownPct,
  calculatePortfolioAnalytics,
} from "./portfolioAnalytics";

test("calculateMaxDrawdownPct measures peak-to-trough decline", () => {
  assert.equal(calculateMaxDrawdownPct([100, 120, 90, 95]), -25);
});

test("calculateBeta compares portfolio returns to benchmark returns", () => {
  const beta = calculateBeta([0.01, 0.02, -0.01], [0.02, 0.04, -0.02]);
  assert.equal(beta, 0.5);
});

test("calculateAnnualizedVolatilityPct annualizes daily return volatility", () => {
  const vol = calculateAnnualizedVolatilityPct([0.01, -0.01, 0.015, -0.005]);
  assert.equal(vol, 16.36);
});

test("buildNormalizedComparisonSeries rebases portfolio and benchmark to 100", () => {
  const result = buildNormalizedComparisonSeries(
    [
      { date: "2026-03-15", value: 100 },
      { date: "2026-03-16", value: 110 },
    ],
    [
      { date: "2026-03-15", close: 200 },
      { date: "2026-03-16", close: 210 },
    ],
  );

  assert.deepEqual(result, [
    { date: "2026-03-15", portfolio: 100, benchmark: 100 },
    { date: "2026-03-16", portfolio: 110, benchmark: 105 },
  ]);
});

test("calculatePortfolioAnalytics derives benchmark and risk context from aligned histories", () => {
  const analytics = calculatePortfolioAnalytics({
    positions: [
      { symbol: "AAPL", shares: 1, avgCost: 100 },
      { symbol: "MSFT", shares: 1, avgCost: 100 },
    ],
    histories: {
      AAPL: [
        { date: "2026-03-15", close: 100 },
        { date: "2026-03-16", close: 105 },
        { date: "2026-03-17", close: 110 },
      ],
      MSFT: [
        { date: "2026-03-15", close: 100 },
        { date: "2026-03-16", close: 95 },
        { date: "2026-03-17", close: 100 },
      ],
    },
    benchmark: [
      { date: "2026-03-15", close: 100 },
      { date: "2026-03-16", close: 102 },
      { date: "2026-03-17", close: 104 },
    ],
  });

  assert.equal(analytics.portfolioReturnPct, 5);
  assert.equal(analytics.benchmarkReturnPct, 4);
  assert.equal(analytics.activeReturnPct, 1);
  assert.equal(analytics.maxDrawdownPct, 0);
  assert.equal(analytics.effectiveNumberOfAssets, 2);
  assert.equal(analytics.diversificationAsOf, "2026-03-17");
  assert.equal(analytics.chart.length, 3);
});

test("skfolio effective asset score refuses to carry a stale last-known position forward", () => {
  const analytics = calculatePortfolioAnalytics({
    positions: [{symbol:"AAA",shares:1,avgCost:10},{symbol:"BBB",shares:1,avgCost:20}],
    histories: {
      AAA: [{date:"2026-03-10",close:10},{date:"2026-03-11",close:12}],
      BBB: [{date:"2026-03-10",close:20}],
    },
    benchmark: [{date:"2026-03-10",close:100},{date:"2026-03-11",close:101}],
  });
  assert.equal(analytics.portfolioReturnPct, 6.67);
  assert.equal(analytics.effectiveNumberOfAssets, null);
  assert.equal(analytics.diversificationAsOf, null);
});
