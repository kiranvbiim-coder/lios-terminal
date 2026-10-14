import test from "node:test";
import assert from "node:assert/strict";
import {
  americanBinomialPrice,
  americanGreeks,
  blackScholesMerton,
  buildOptionCalculationAudit,
  interpolateYieldCurveRate,
  optionMoveMetrics,
  presentValueDiscreteDividends,
  validateEuropeanOptionGrid,
  type OptionGridValidationRow,
} from "./optionsModels";

const S = 316.22;
const T = 30 / 365;
const R = 0.05;
const Q = 0.0034;
const VOL = 0.30;

function approx(actual: number, expected: number, tolerance: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}, tolerance ${tolerance}`
  );
}

test("BSM: reproduces the reviewed AAPL K=320 terminal values", () => {
  const call = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const put = blackScholesMerton(S, 320, T, R, Q, VOL, false);

  approx(call.price, 9.6572543878, 2e-4, "call price");
  approx(put.price, 12.2132403749, 2e-4, "put price");
  approx(call.delta, 0.4796784111, 2e-4, "call delta");
  approx(put.delta, -0.5200421758, 2e-4, "put delta");
  approx(call.gamma, 0.0146456081, 2e-5, "call gamma");
  approx(put.gamma, 0.0146456081, 2e-5, "put gamma");
  approx(call.theta, -0.1985961833, 2e-4, "call theta/day");
  approx(put.theta, -0.1578851315, 2e-4, "put theta/day");
  approx(call.vega, 0.3611068469, 2e-4, "call vega/1 vol point");
  approx(put.vega, 0.3611068469, 2e-4, "put vega/1 vol point");
  approx(call.rho, 0.1167342352, 2e-4, "call rho/100bp");
  approx(put.rho, -0.1452008032, 2e-4, "put rho/100bp");
});

test("move metrics: separates ATM straddle proxy from one-sigma volatility move", () => {
  const call = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const put = blackScholesMerton(S, 320, T, R, Q, VOL, false);
  const move = optionMoveMetrics(S, VOL, T, call.price, put.price);

  approx(move.straddleMove, 21.8704947627, 2e-4, "straddle move");
  approx(move.straddleMovePct, 0.0691622755, 2e-6, "straddle move pct");
  approx(move.oneSigmaMove, 27.1972369003, 2e-4, "one sigma move");
  approx(move.oneSigmaMovePct, 0.0860073269, 2e-6, "one sigma move pct");
});

test("European grid: put-call parity, bounds, monotonicity and convexity all pass", () => {
  const strikes = [270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370];
  const rows: OptionGridValidationRow[] = strikes.map((strike) => ({
    strike,
    call: blackScholesMerton(S, strike, T, R, Q, VOL, true),
    put: blackScholesMerton(S, strike, T, R, Q, VOL, false),
  }));

  const validation = validateEuropeanOptionGrid(rows, S, T, R, Q);
  assert.equal(validation.passed, true, validation.issues.join(" "));
  assert.equal(validation.boundsPassed, true);
  assert.equal(validation.monotonicityPassed, true);
  assert.equal(validation.convexityPassed, true);
  assert.ok(validation.maxPutCallParityResidual < 1e-6);
});

test("BSM Greeks: analytical delta/gamma agree with finite differences", () => {
  const strike = 320;
  const base = blackScholesMerton(S, strike, T, R, Q, VOL, true);
  const h = S * 0.001;
  const up = blackScholesMerton(S + h, strike, T, R, Q, VOL, true).price;
  const down = blackScholesMerton(S - h, strike, T, R, Q, VOL, true).price;
  const fdDelta = (up - down) / (2 * h);
  const fdGamma = (up - 2 * base.price + down) / (h * h);

  approx(base.delta, fdDelta, 3e-5, "finite-difference delta");
  approx(base.gamma, fdGamma, 3e-5, "finite-difference gamma");
});

test("American CRR: non-dividend call converges to European and put is never cheaper", () => {
  const strike = 320;
  const euroCall = blackScholesMerton(S, strike, T, R, 0, VOL, true).price;
  const euroPut = blackScholesMerton(S, strike, T, R, 0, VOL, false).price;
  const americanCall = americanBinomialPrice(S, strike, T, R, 0, VOL, true, 800);
  const americanPut = americanBinomialPrice(S, strike, T, R, 0, VOL, false, 800);

  approx(americanCall, euroCall, 0.03, "American non-dividend call vs European");
  assert.ok(americanPut + 1e-8 >= euroPut, `American put ${americanPut} must be >= European put ${euroPut}`);
});

test("American Greeks: finite-difference engine returns finite institutional units", () => {
  const greeks = americanGreeks(S, 320, T, R, Q, VOL, false, 300);
  for (const [name, value] of Object.entries(greeks)) {
    assert.ok(Number.isFinite(value), `${name} must be finite`);
  }
  assert.ok(greeks.price > 0);
  assert.ok(greeks.delta < 0);
  assert.ok(greeks.gamma >= -1e-8);
});

test("discrete dividends: PV adjustment lowers calls, raises puts and is auditable", () => {
  const dividends = [{ amount: 0.25, timeYears: 15 / 365, source: "test dividend" }];
  const pv = presentValueDiscreteDividends(dividends, R, T);
  assert.ok(pv > 0.24 && pv < 0.25);

  const callNoDividend = blackScholesMerton(S, 320, T, R, 0, VOL, true).price;
  const putNoDividend = blackScholesMerton(S, 320, T, R, 0, VOL, false).price;
  const callWithDividend = blackScholesMerton(S, 320, T, R, 0, VOL, true, dividends).price;
  const putWithDividend = blackScholesMerton(S, 320, T, R, 0, VOL, false, dividends).price;

  assert.ok(callWithDividend < callNoDividend);
  assert.ok(putWithDividend > putNoDividend);

  const audit = buildOptionCalculationAudit({
    spot: S,
    strike: 320,
    timeYears: T,
    rate: R,
    dividendYield: 0,
    volatility: VOL,
    isCall: true,
    exerciseStyle: "european",
    discreteDividends: dividends,
    volatilitySource: "realized_proxy",
    rateSource: "USD Treasury curve",
    rateAsOf: "2026-09-09",
  });

  assert.equal(audit.adjustments.dividendMethod, "escrowed_cash_dividends");
  approx(audit.adjustments.discreteDividendPv, pv, 1e-10, "audit dividend PV");
  assert.equal(audit.conventions.thetaUnit, "per calendar day");
  assert.equal(audit.conventions.vegaUnit, "per +1 volatility point");
  assert.equal(audit.conventions.rhoUnit, "per +100bp");
  assert.equal(audit.checks.withinNoArbitrageBounds, true);
  assert.ok(Math.abs(audit.checks.putCallParityResidual ?? 1) < 1e-6);
});

test("American discrete-dividend tree can capture early exercise premium", () => {
  const dividends = [{ amount: 4, timeYears: 20 / 365 }];
  const deepCallStrike = 250;
  const european = blackScholesMerton(S, deepCallStrike, T, R, 0, 0.20, true, dividends).price;
  const american = americanBinomialPrice(S, deepCallStrike, T, R, 0, 0.20, true, 600, dividends);
  assert.ok(american + 1e-8 >= european, `American call ${american} must not be cheaper than European ${european}`);
});

test("yield curve: exact, interpolated and edge-tenor rates are resolved", () => {
  const curve = [
    { label: "1M", yield: 4.80, asOf: "2026-09-08" },
    { label: "3M", yield: 4.60, asOf: "2026-09-08" },
    { label: "6M", yield: 4.40, asOf: "2026-09-08" },
    { label: "1Y", yield: 4.10, asOf: "2026-09-08" },
  ];

  const oneMonth = interpolateYieldCurveRate(curve, 365 / 12);
  assert.equal(oneMonth.method, "exact");
  approx(oneMonth.ratePercent ?? 0, 4.80, 1e-12, "1M exact rate");

  const twoMonth = interpolateYieldCurveRate(curve, (365 / 12) * 2);
  assert.equal(twoMonth.method, "linear");
  approx(twoMonth.ratePercent ?? 0, 4.70, 1e-8, "2M interpolated rate");

  const long = interpolateYieldCurveRate(curve, 730);
  assert.equal(long.method, "nearest");
  approx(long.ratePercent ?? 0, 4.10, 1e-12, "long-end nearest rate");
});

test("calculation audit exposes BSM intermediates and reviewed conventions", () => {
  const audit = buildOptionCalculationAudit({
    spot: S,
    strike: 320,
    timeYears: T,
    rate: R,
    dividendYield: Q,
    volatility: VOL,
    isCall: true,
    exerciseStyle: "european",
    volatilitySource: "realized_proxy",
    rateSource: "USD Treasury interpolated",
  });

  assert.equal(audit.model, "Black-Scholes-Merton");
  approx(audit.intermediates.d1 ?? 0, -0.0506242311, 2e-4, "d1");
  approx(audit.intermediates.d2 ?? 0, -0.1366315579, 2e-4, "d2");
  approx(audit.output.price, 9.6572543878, 2e-4, "audit price");
  assert.equal(audit.checks.withinNoArbitrageBounds, true);
  assert.ok(Math.abs(audit.checks.putCallParityResidual ?? 1) < 1e-6);
});
