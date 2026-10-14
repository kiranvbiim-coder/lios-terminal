import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBrinsonAttribution,
  computeBenchmarkRelativeMetrics,
  computeConcentrationMetrics,
  computeRebalancingProposal,
  type BrinsonHolding,
} from "./portfolioEngines";

// ─── Brinson-Fachler Attribution ──────────────────────────────────────────

test("brinson attribution: decomposes active return into allocation, selection, interaction", () => {
  const holdings: BrinsonHolding[] = [
    { symbol: "AAPL", sector: "Tech", portfolioWeight: 0.40, benchmarkWeight: 0.30, portfolioReturn: 0.15, benchmarkReturn: 0.10 },
    { symbol: "JPM", sector: "Finance", portfolioWeight: 0.30, benchmarkWeight: 0.40, portfolioReturn: 0.08, benchmarkReturn: 0.05 },
    { symbol: "JNJ", sector: "Health", portfolioWeight: 0.30, benchmarkWeight: 0.30, portfolioReturn: 0.12, benchmarkReturn: 0.07 },
  ];
  const result = computeBrinsonAttribution(holdings);

  // Total returns
  assert.ok(Math.abs(result.totalPortfolioReturn - (0.40 * 0.15 + 0.30 * 0.08 + 0.30 * 0.12)) < 0.001);
  assert.ok(Math.abs(result.totalBenchmarkReturn - (0.30 * 0.10 + 0.40 * 0.05 + 0.30 * 0.07)) < 0.001);
  assert.ok(result.totalActiveReturn > 0);

  // All three effects should sum to active return
  const totalFromEffects = result.totalAllocationEffect + result.totalSelectionEffect + result.totalInteractionEffect;
  assert.ok(Math.abs(totalFromEffects - result.totalActiveReturn) < 0.001, "Effects should sum to active return");

  assert.equal(result.sectors.length, 3);
});

test("brinson attribution: zero active return when portfolio equals benchmark", () => {
  const holdings: BrinsonHolding[] = [
    { symbol: "A", sector: "S1", portfolioWeight: 0.50, benchmarkWeight: 0.50, portfolioReturn: 0.10, benchmarkReturn: 0.10 },
    { symbol: "B", sector: "S2", portfolioWeight: 0.50, benchmarkWeight: 0.50, portfolioReturn: 0.05, benchmarkReturn: 0.05 },
  ];
  const result = computeBrinsonAttribution(holdings);
  assert.ok(Math.abs(result.totalActiveReturn) < 0.001);
  assert.ok(Math.abs(result.totalAllocationEffect) < 0.001);
  assert.ok(Math.abs(result.totalSelectionEffect) < 0.001);
});

// ─── Benchmark-Relative Metrics ───────────────────────────────────────────

test("benchmark metrics: computes sharpe, sortino, treynor, information ratio, tracking error", () => {
  // Simulate 20 periods of daily returns
  const pReturns = Array.from({ length: 20 }, (_, i) => 0.001 + Math.sin(i) * 0.005);
  const bReturns = Array.from({ length: 20 }, (_, i) => 0.0005 + Math.cos(i) * 0.004);

  const result = computeBenchmarkRelativeMetrics(pReturns, bReturns, 0.04, 252);
  assert.ok(result.sharpeRatio != null);
  assert.ok(result.sortinoRatio != null);
  assert.ok(result.trackingError != null && result.trackingError > 0);
  assert.ok(result.informationRatio != null);
  assert.ok(result.jensensAlpha != null);
});

test("benchmark metrics: returns null for insufficient data", () => {
  const result = computeBenchmarkRelativeMetrics([0.01], [0.005], 0.04);
  assert.equal(result.sharpeRatio, null);
  assert.equal(result.trackingError, null);
});

test("benchmark metrics: up/down capture ratios", () => {
  const pReturns = [0.02, -0.01, 0.03, -0.02, 0.01];
  const bReturns = [0.01, -0.02, 0.02, -0.01, 0.015];
  const result = computeBenchmarkRelativeMetrics(pReturns, bReturns, 0.04, 252);
  assert.ok(result.upCaptureRatio != null);
  assert.ok(result.downCaptureRatio != null);
});

// ─── Concentration Risk ───────────────────────────────────────────────────

test("concentration: HHI for equally-weighted portfolio", () => {
  const holdings = [
    { symbol: "A", weight: 0.25, sector: "Tech" },
    { symbol: "B", weight: 0.25, sector: "Tech" },
    { symbol: "C", weight: 0.25, sector: "Finance" },
    { symbol: "D", weight: 0.25, sector: "Health" },
  ];
  const result = computeConcentrationMetrics(holdings);
  // HHI = 4 × 0.25² = 0.25, effective positions = 4
  assert.ok(Math.abs(result.herfindahlIndex - 0.25) < 0.001);
  assert.ok(Math.abs(result.effectivePositions - 4) < 0.1);
  assert.equal(result.topNSymbols.length, 4); // only 4 holdings, topN=5
});

test("concentration: concentrated portfolio has high HHI", () => {
  const holdings = [
    { symbol: "A", weight: 0.80, sector: "Tech" },
    { symbol: "B", weight: 0.10, sector: "Finance" },
    { symbol: "C", weight: 0.10, sector: "Health" },
  ];
  const result = computeConcentrationMetrics(holdings, 3);
  // HHI = 0.64 + 0.01 + 0.01 = 0.66
  assert.ok(result.herfindahlIndex > 0.60);
  assert.ok(result.effectivePositions < 2);
  assert.equal(result.topNSymbols[0], "A");
  assert.ok(result.topNWeight > 0.99);
});

test("concentration: sector aggregation works", () => {
  const holdings = [
    { symbol: "A", weight: 0.30, sector: "Tech" },
    { symbol: "B", weight: 0.20, sector: "Tech" },
    { symbol: "C", weight: 0.50, sector: "Finance" },
  ];
  const result = computeConcentrationMetrics(holdings);
  assert.equal(result.sectorConcentration.length, 2);
  // Both sectors total: Tech=0.50, Finance=0.50. Either could be first in a tie.
  const techSector = result.sectorConcentration.find((s) => s.sector === "Tech");
  const financeSector = result.sectorConcentration.find((s) => s.sector === "Finance");
  assert.ok(techSector);
  assert.ok(financeSector);
  assert.ok(Math.abs(techSector.weight - 0.50) < 0.001);
  assert.ok(Math.abs(financeSector.weight - 0.50) < 0.001);
});

test("concentration: empty portfolio", () => {
  const result = computeConcentrationMetrics([]);
  assert.equal(result.herfindahlIndex, 0);
  assert.equal(result.effectivePositions, 0);
});

// ─── Rebalancing Engine ──────────────────────────────────────────────────

test("rebalancing: proposes buys and sells to reach target weights", () => {
  const targets = [
    { symbol: "AAPL", targetWeight: 0.40, currentWeight: 0.30, currentShares: 30, currentPrice: 200 },
    { symbol: "MSFT", targetWeight: 0.30, currentWeight: 0.40, currentShares: 40, currentPrice: 400 },
    { symbol: "GOOG", targetWeight: 0.30, currentWeight: 0.30, currentShares: 20, currentPrice: 150 },
  ];
  const result = computeRebalancingProposal(targets, 100_000, 0.01);

  assert.ok(result.rebalanceNeeded);
  assert.ok(result.maxDrift >= 0.10);
  assert.ok(result.totalBuyNotional > 0);
  assert.ok(result.totalSellNotional > 0);

  const aaplTrade = result.trades.find((t) => t.symbol === "AAPL");
  assert.equal(aaplTrade?.action, "buy");
  const msftTrade = result.trades.find((t) => t.symbol === "MSFT");
  assert.equal(msftTrade?.action, "sell");
  const googTrade = result.trades.find((t) => t.symbol === "GOOG");
  assert.equal(googTrade?.action, "hold");
});

test("rebalancing: no trades needed when within threshold", () => {
  const targets = [
    { symbol: "AAPL", targetWeight: 0.50, currentWeight: 0.505, currentShares: 50, currentPrice: 200 },
    { symbol: "MSFT", targetWeight: 0.50, currentWeight: 0.495, currentShares: 25, currentPrice: 400 },
  ];
  const result = computeRebalancingProposal(targets, 100_000, 0.01);
  assert.equal(result.rebalanceNeeded, false);
  assert.ok(result.trades.every((t) => t.action === "hold"));
});

test("rebalancing: trades sorted by absolute drift descending", () => {
  const targets = [
    { symbol: "A", targetWeight: 0.20, currentWeight: 0.10, currentShares: 10, currentPrice: 100 },
    { symbol: "B", targetWeight: 0.30, currentWeight: 0.50, currentShares: 50, currentPrice: 100 },
    { symbol: "C", targetWeight: 0.50, currentWeight: 0.40, currentShares: 40, currentPrice: 100 },
  ];
  const result = computeRebalancingProposal(targets, 100_000, 0.01);
  assert.equal(result.trades[0].symbol, "B"); // largest drift: -0.20
  assert.equal(result.trades[1].symbol, "A"); // drift: +0.10
  assert.equal(result.trades[2].symbol, "C"); // drift: +0.10
});
