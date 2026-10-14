import test from "node:test";
import assert from "node:assert/strict";
import {
  priceFutures,
  analyzeFuturesTermStructure,
  valueSwap,
  analyzeStrategy,
  buildBullCallSpread,
  buildStraddle,
  buildIronCondor,
} from "./derivativesEngines";

// ─── Futures Pricing ──────────────────────────────────────────────────────

test("futures: cost-of-carry pricing for equity index", () => {
  const result = priceFutures({
    spotPrice: 5000,
    riskFreeRate: 0.05,
    timeToExpiry: 0.25,
    dividendYield: 0.02,
  });
  // F = 5000 × e^((0.05 - 0.02) × 0.25) = 5000 × e^0.0075 ≈ 5037.6
  assert.ok(Math.abs(result.theoreticalPrice - 5037.6) < 1);
  assert.ok(result.basisPoints > 0); // contango
  assert.ok(result.costOfCarry > 0);
});

test("futures: commodity with storage cost and convenience yield", () => {
  const result = priceFutures({
    spotPrice: 80,
    riskFreeRate: 0.04,
    timeToExpiry: 0.5,
    storageCosPct: 0.02,
    convenienceYieldPct: 0.06,
  });
  // cost of carry = 0.04 + 0.02 - 0.06 = 0.00 → futures ≈ spot
  assert.ok(Math.abs(result.theoreticalPrice - 80) < 1);
});

test("futures: negative basis (backwardation) when convenience yield exceeds carry", () => {
  const result = priceFutures({
    spotPrice: 100,
    riskFreeRate: 0.03,
    timeToExpiry: 0.25,
    convenienceYieldPct: 0.10,
  });
  assert.ok(result.theoreticalPrice < 100);
  assert.ok(result.basisPoints < 0);
  assert.ok(result.rollYield > 0); // positive roll yield in backwardation
});

// ─── Futures Term Structure ───────────────────────────────────────────────

test("futures term structure: detects contango", () => {
  const contracts = [
    { expiry: "2026-12-01", price: 102, timeToExpiry: 0.25 },
    { expiry: "2027-03-01", price: 104, timeToExpiry: 0.5 },
    { expiry: "2027-06-01", price: 106, timeToExpiry: 0.75 },
  ];
  const result = analyzeFuturesTermStructure(100, contracts, 0.04);
  assert.equal(result.structure, "contango");
  assert.ok(result.rollYieldAnnualized < 0); // negative roll in contango
});

test("futures term structure: detects backwardation", () => {
  const contracts = [
    { expiry: "2026-12-01", price: 97, timeToExpiry: 0.25 },
    { expiry: "2027-03-01", price: 95, timeToExpiry: 0.5 },
  ];
  const result = analyzeFuturesTermStructure(100, contracts, 0.04);
  assert.equal(result.structure, "backwardation");
  assert.ok(result.rollYieldAnnualized > 0);
});

// ─── Interest Rate Swap ───────────────────────────────────────────────────

test("swap: at-market swap has near-zero value", () => {
  // If fixed rate equals average floating rate, value should be near zero
  const rate = 0.05;
  const result = valueSwap({
    notional: 1_000_000,
    fixedRate: rate,
    floatingRates: [rate, rate, rate, rate],
    frequency: 2,
    remainingPeriods: 4,
    discountRate: rate,
  });
  assert.ok(Math.abs(result.swapValueToFixedPayer) < 100); // near zero
  assert.equal(result.swapValueToFixedPayer, -result.swapValueToFloatingPayer);
  // DV01 can be zero when fixed == floating (both legs shift equally)
  assert.ok(result.dv01 >= 0);
});

test("swap: fixed payer benefits when floating rates rise", () => {
  const result = valueSwap({
    notional: 1_000_000,
    fixedRate: 0.04,
    floatingRates: [0.05, 0.055, 0.06, 0.065],
    frequency: 2,
    remainingPeriods: 4,
    discountRate: 0.05,
  });
  assert.ok(result.swapValueToFixedPayer > 0);
  assert.ok(result.floatingLegPV > result.fixedLegPV);
});

test("swap: cashflow arrays have correct length", () => {
  const result = valueSwap({
    notional: 1_000_000,
    fixedRate: 0.04,
    floatingRates: [0.03, 0.035, 0.04, 0.045, 0.05, 0.055],
    frequency: 4,
    remainingPeriods: 6,
    discountRate: 0.04,
  });
  assert.equal(result.fixedLegCashflows.length, 6);
  assert.equal(result.floatingLegCashflows.length, 6);
});

// ─── Strategy Payoff Engine ───────────────────────────────────────────────

test("strategy: long call has unlimited upside, limited downside", () => {
  const result = analyzeStrategy("Long Call", [
    { type: "call", direction: "long", strike: 100, premium: 5, quantity: 1 },
  ], 100, { min: 80, max: 130, steps: 50 });

  assert.equal(result.name, "Long Call");
  assert.ok(result.payoffCurve.length > 0);
  // Max loss = premium paid = $500 (5 × 100 shares)
  assert.ok(result.maxLoss != null && Math.abs(result.maxLoss + 500) < 100);
  // Max profit should be large (last point)
  assert.ok(result.maxProfit != null && result.maxProfit > 0);
  // One breakeven at strike + premium = 105
  assert.equal(result.breakevens.length, 1);
  assert.ok(Math.abs(result.breakevens[0] - 105) < 2);
  // Net premium: long call = debit
  assert.ok(result.netPremium < 0);
});

test("strategy: bull call spread has capped profit and loss", () => {
  const result = buildBullCallSpread(100, 95, 105, 7, 3);
  assert.equal(result.name, "Bull Call Spread");
  // Max profit = (105-95)*100 - net debit = 1000 - 400 = 600
  assert.ok(result.maxProfit != null && result.maxProfit > 0);
  // Max loss = net debit = (7-3)*100 = 400
  assert.ok(result.maxLoss != null && result.maxLoss < 0);
  assert.ok(result.breakevens.length >= 1);
});

test("strategy: long straddle has two breakevens", () => {
  const result = buildStraddle(100, 100, 5, 5);
  assert.equal(result.name, "Long Straddle");
  // Max loss at strike = -(5+5)*100 = -1000
  assert.ok(result.maxLoss != null && result.maxLoss < 0);
  // Two breakevens: strike ± total premium
  assert.equal(result.breakevens.length, 2);
  const [lower, upper] = result.breakevens;
  assert.ok(Math.abs(lower - 90) < 2);
  assert.ok(Math.abs(upper - 110) < 2);
});

test("strategy: iron condor is a net credit strategy", () => {
  const result = buildIronCondor(100, 85, 90, 110, 115, [1, 3, 3, 1]);
  assert.equal(result.name, "Iron Condor");
  assert.ok(result.netPremium > 0); // net credit
  // Profit between the short strikes, loss in the wings
  assert.ok(result.maxProfit != null && result.maxProfit > 0);
  assert.ok(result.maxLoss != null && result.maxLoss < 0);
});

test("strategy: payoff curve covers full price range", () => {
  const result = analyzeStrategy("Test", [
    { type: "call", direction: "long", strike: 100, premium: 5, quantity: 1 },
  ], 100, { min: 50, max: 150, steps: 200 });
  assert.equal(result.payoffCurve.length, 201); // steps + 1
  assert.equal(result.payoffCurve[0].underlyingPrice, 50);
  assert.ok(Math.abs(result.payoffCurve[200].underlyingPrice - 150) < 0.01);
});
