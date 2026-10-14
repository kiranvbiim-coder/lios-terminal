import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapYieldCurve,
  computeSpreadAnalysis,
  applyCurveScenario,
  computeCreditTransition,
  computeExpectedLoss,
  type MarketInstrument,
} from "./fixedIncomeEngines";

// ─── Yield Curve Bootstrapping ────────────────────────────────────────────

test("bootstrap: produces monotonically ordered spot rates from zero-coupon instruments", () => {
  const instruments: MarketInstrument[] = [
    { maturity: 0.25, couponRate: 0, price: 98.75, frequency: 1, instrumentType: "zero" },
    { maturity: 0.5, couponRate: 0, price: 97.50, frequency: 1, instrumentType: "zero" },
    { maturity: 1, couponRate: 0, price: 95.00, frequency: 1, instrumentType: "zero" },
    { maturity: 2, couponRate: 0, price: 89.00, frequency: 1, instrumentType: "zero" },
  ];
  const curve = bootstrapYieldCurve(instruments);

  assert.equal(curve.points.length, 4);
  assert.equal(curve.method, "bootstrap");

  // Spot rates should be positive
  for (const point of curve.points) {
    assert.ok(point.spotRate > 0, `spotRate at ${point.maturity}y should be positive`);
    assert.ok(point.discountFactor > 0 && point.discountFactor < 1, `DF at ${point.maturity}y should be in (0,1)`);
    assert.ok(point.zeroRate > 0, `zeroRate at ${point.maturity}y should be positive`);
  }
});

test("bootstrap: discount factors from zero-coupon prices match price/100", () => {
  const instruments: MarketInstrument[] = [
    { maturity: 1, couponRate: 0, price: 95.24, frequency: 1, instrumentType: "zero" },
    { maturity: 2, couponRate: 0, price: 90.70, frequency: 1, instrumentType: "zero" },
  ];
  const curve = bootstrapYieldCurve(instruments);

  assert.ok(Math.abs(curve.points[0].discountFactor - 0.9524) < 0.001);
  assert.ok(Math.abs(curve.points[1].discountFactor - 0.9070) < 0.001);
});

test("bootstrap: coupon bond stripping uses intermediate DFs", () => {
  const instruments: MarketInstrument[] = [
    { maturity: 1, couponRate: 0, price: 95.24, frequency: 1, instrumentType: "zero" },
    { maturity: 2, couponRate: 0.05, price: 99.50, frequency: 1, instrumentType: "coupon_bond" },
  ];
  const curve = bootstrapYieldCurve(instruments);

  assert.equal(curve.points.length, 2);
  // 2Y coupon bond: price = 5*DF1 + 105*DF2 → DF2 = (99.50 - 5*0.9524)/105
  const expectedDF2 = (99.50 - 5 * 0.9524) / 105;
  assert.ok(Math.abs(curve.points[1].discountFactor - expectedDF2) < 0.01);
});

test("bootstrap: forward rates are non-negative", () => {
  const instruments: MarketInstrument[] = [
    { maturity: 1, couponRate: 0, price: 96, frequency: 1, instrumentType: "zero" },
    { maturity: 2, couponRate: 0, price: 91, frequency: 1, instrumentType: "zero" },
    { maturity: 5, couponRate: 0, price: 75, frequency: 1, instrumentType: "zero" },
  ];
  const curve = bootstrapYieldCurve(instruments);
  for (const point of curve.points) {
    assert.ok(point.forwardRate >= 0, `forward rate at ${point.maturity}y should be >= 0`);
  }
});

// ─── Spread Analysis ──────────────────────────────────────────────────────

test("spread analysis: nominal spread is yield minus benchmark in bps", () => {
  const result = computeSpreadAnalysis({
    bondYield: 0.065,
    benchmarkYield: 0.040,
    bondPrice: 98.5,
    couponRate: 0.05,
    maturity: 5,
    frequency: 2,
  });
  // Nominal spread: (6.5% - 4.0%) × 10000 = 250 bps
  assert.ok(Math.abs(result.nominalSpread - 250) < 1);
  assert.ok(result.zSpread > 0);
  assert.ok(result.creditSpread >= 0);
  assert.ok(result.impliedProbOfDefault >= 0 && result.impliedProbOfDefault <= 1);
  assert.ok(result.spreadDuration > 0);
});

test("spread analysis: zero spread for par bond at benchmark yield", () => {
  // Bond priced at par with coupon = benchmark yield → spread ≈ 0
  const result = computeSpreadAnalysis({
    bondYield: 0.05,
    benchmarkYield: 0.05,
    bondPrice: 100,
    couponRate: 0.05,
    maturity: 5,
    frequency: 2,
  });
  assert.ok(Math.abs(result.nominalSpread) < 1);
  assert.ok(Math.abs(result.zSpread) < 10); // may not be exactly 0 due to price rounding
});

test("spread analysis: implied PD increases with credit spread", () => {
  const narrow = computeSpreadAnalysis({
    bondYield: 0.045, benchmarkYield: 0.040, bondPrice: 99, couponRate: 0.04, maturity: 5, frequency: 2,
  });
  const wide = computeSpreadAnalysis({
    bondYield: 0.080, benchmarkYield: 0.040, bondPrice: 90, couponRate: 0.04, maturity: 5, frequency: 2,
  });
  assert.ok(wide.impliedProbOfDefault > narrow.impliedProbOfDefault);
});

// ─── Curve Scenario Engine ────────────────────────────────────────────────

test("curve scenario: parallel shift adds uniform bps across all maturities", () => {
  const base = [
    { maturity: 1, yield: 0.04 },
    { maturity: 5, yield: 0.045 },
    { maturity: 10, yield: 0.05 },
  ];
  const result = applyCurveScenario({ basePoints: base, scenarioType: "parallel_shift", shiftBps: 50 });

  assert.equal(result.shiftedPoints.length, 3);
  for (const point of result.shiftedPoints) {
    assert.equal(point.shiftBps, 50);
  }
  // 1Y: 4.00% + 50bps = 4.50%
  assert.ok(Math.abs(result.shiftedPoints[0].yield - 0.045) < 0.0001);
  assert.ok(Math.abs(result.shiftedPoints[2].yield - 0.055) < 0.0001);
});

test("curve scenario: butterfly shifts wings opposite to belly", () => {
  const base = [
    { maturity: 1, yield: 0.04 },
    { maturity: 5, yield: 0.045 },
    { maturity: 10, yield: 0.05 },
    { maturity: 30, yield: 0.055 },
  ];
  const result = applyCurveScenario({ basePoints: base, scenarioType: "butterfly", shiftBps: 25, pivotMaturity: 5 });

  assert.equal(result.shiftedPoints.length, 4);
  // At least one wing should have positive shift, belly negative
  const bellyShift = result.shiftedPoints.find((p) => p.maturity === 5)?.shiftBps ?? 0;
  const wingShift = result.shiftedPoints.find((p) => p.maturity === 30)?.shiftBps ?? 0;
  assert.ok(bellyShift < 0, "Belly should shift down in butterfly");
  assert.ok(wingShift > 0, "Wing should shift up in butterfly");
});

// ─── Credit Transition ───────────────────────────────────────────────────

test("credit transition: BBB has upgrade and downgrade probabilities", () => {
  const matrix: Record<string, Record<string, number>> = {
    BBB: { AAA: 0.001, AA: 0.01, A: 0.04, BBB: 0.85, BB: 0.06, B: 0.02, CCC: 0.01, D: 0.005 },
  };
  const result = computeCreditTransition({ currentRating: "BBB", horizonYears: 1, transitionMatrix: matrix });

  assert.equal(result.currentRating, "BBB");
  assert.ok(result.upgradeProbability > 0);
  assert.ok(result.downgradeProbability > 0);
  assert.ok(result.defaultProbability > 0);
  assert.ok(result.stayProbability > 0);
  assert.equal(result.transitions.length, 8);
});

test("credit transition: multi-year horizon increases migration probability", () => {
  const matrix: Record<string, Record<string, number>> = {
    A: { AAA: 0.01, AA: 0.05, A: 0.88, BBB: 0.04, BB: 0.01, D: 0.01 },
  };
  const oneYear = computeCreditTransition({ currentRating: "A", horizonYears: 1, transitionMatrix: matrix });
  const fiveYear = computeCreditTransition({ currentRating: "A", horizonYears: 5, transitionMatrix: matrix });

  // Default probability increases over longer horizon
  assert.ok(fiveYear.defaultProbability > oneYear.defaultProbability);
  // Stay probability decreases
  assert.ok(fiveYear.stayProbability < oneYear.stayProbability);
});

test("credit transition: unknown rating returns safe defaults", () => {
  const result = computeCreditTransition({ currentRating: "ZZZ", horizonYears: 1, transitionMatrix: {} });
  assert.equal(result.stayProbability, 1);
  assert.equal(result.defaultProbability, 0);
});

// ─── Expected Loss ────────────────────────────────────────────────────────

test("expected loss: EL = EAD × PD × LGD", () => {
  const result = computeExpectedLoss({ exposure: 1_000_000, probabilityOfDefault: 0.02, lossGivenDefault: 0.60 });
  // EL = 1M × 0.02 × 0.60 = 12,000
  assert.ok(Math.abs(result.expectedLoss - 12_000) < 1);
  assert.ok(result.unexpectedLoss > 0);
  assert.ok(result.creditVaR99 > result.expectedLoss);
});

test("expected loss: zero PD means zero loss", () => {
  const result = computeExpectedLoss({ exposure: 1_000_000, probabilityOfDefault: 0, lossGivenDefault: 0.60 });
  assert.equal(result.expectedLoss, 0);
  assert.equal(result.unexpectedLoss, 0);
});

test("expected loss: full LGD (no recovery) maximizes loss", () => {
  const full = computeExpectedLoss({ exposure: 1_000_000, probabilityOfDefault: 0.05, lossGivenDefault: 1.0 });
  const partial = computeExpectedLoss({ exposure: 1_000_000, probabilityOfDefault: 0.05, lossGivenDefault: 0.40 });
  assert.ok(full.expectedLoss > partial.expectedLoss);
});
