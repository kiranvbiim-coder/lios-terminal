import test from "node:test";
import assert from "node:assert/strict";
import { blackScholesMerton } from "./optionsModels";
import {
  analyzeBoxSpread,
  analyzePutCallParity,
  applyUnderlyingDeltaHedge,
  approximateGreekScenarioPnl,
  scaleOptionGreeks,
  solveDeltaGammaVegaHedge,
  solveSingleOptionHedge,
} from "./optionsHedging";

const S = 316.22;
const T = 30 / 365;
const R = 0.05;
const Q = 0.0034;
const VOL = 0.30;
const MULTIPLIER = 100;

function approx(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

test("delta hedge converts option delta into the exact opposite stock share position", () => {
  const call = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const risk = scaleOptionGreeks(call, 10, MULTIPLIER, S);
  const hedge = applyUnderlyingDeltaHedge(risk, S);

  approx(hedge.underlyingShares, -call.delta * 10 * MULTIPLIER, 1e-10, "underlying hedge shares");
  approx(hedge.residualRisk.deltaShares, 0, 1e-12, "residual delta shares");
  approx(hedge.residualRisk.gamma, risk.gamma, 1e-12, "stock hedge leaves gamma unchanged");
});

test("delta-gamma hedge neutralizes gamma with a second option and delta with stock", () => {
  const primary = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const hedgeOption = blackScholesMerton(S, 330, T, R, Q, VOL, true);
  const primaryRisk = scaleOptionGreeks(primary, 5, MULTIPLIER, S);
  const hedge = solveSingleOptionHedge(primaryRisk, hedgeOption, "gamma", S, MULTIPLIER);

  assert.equal(hedge.warning, undefined);
  assert.ok(Number.isFinite(hedge.hedgeContractsA));
  approx(hedge.residualRisk.gamma, 0, 1e-9, "residual gamma");
  approx(hedge.residualRisk.deltaShares, 0, 1e-12, "residual delta");
});

test("delta-vega hedge neutralizes vega with a second option and delta with stock", () => {
  const primary = blackScholesMerton(S, 320, T, R, Q, VOL, false);
  const hedgeOption = blackScholesMerton(S, 300, T, R, Q, VOL, true);
  const primaryRisk = scaleOptionGreeks(primary, -7, MULTIPLIER, S);
  const hedge = solveSingleOptionHedge(primaryRisk, hedgeOption, "vega", S, MULTIPLIER);

  assert.equal(hedge.warning, undefined);
  approx(hedge.residualRisk.vegaPerVolPoint, 0, 1e-9, "residual vega");
  approx(hedge.residualRisk.deltaShares, 0, 1e-12, "residual delta");
});

test("cross-maturity three-instrument hedge neutralizes delta, gamma and vega simultaneously", () => {
  const primary = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const hedgeA = blackScholesMerton(S, 290, 45 / 365, R, Q, VOL, true);
  const hedgeB = blackScholesMerton(S, 350, 90 / 365, R, Q, VOL, false);
  const primaryRisk = scaleOptionGreeks(primary, 12, MULTIPLIER, S);
  const hedge = solveDeltaGammaVegaHedge(primaryRisk, hedgeA, hedgeB, S, MULTIPLIER, MULTIPLIER);

  assert.equal(hedge.warning, undefined);
  assert.ok(Math.abs(hedge.determinant ?? 0) > 1e-10);
  approx(hedge.residualRisk.deltaShares, 0, 1e-12, "residual delta");
  approx(hedge.residualRisk.gamma, 0, 1e-8, "residual gamma");
  approx(hedge.residualRisk.vegaPerVolPoint, 0, 1e-8, "residual vega");
});

test("same-expiry BSM hedge options are rejected as gamma-vega collinear", () => {
  const primary = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const hedgeA = blackScholesMerton(S, 290, T, R, Q, VOL, true);
  const hedgeB = blackScholesMerton(S, 350, T, R, Q, VOL, false);
  const primaryRisk = scaleOptionGreeks(primary, 12, MULTIPLIER, S);
  const hedge = solveDeltaGammaVegaHedge(primaryRisk, hedgeA, hedgeB, S, MULTIPLIER, MULTIPLIER);

  assert.match(hedge.warning ?? "", /collinear/i);
  approx(hedge.residualRisk.deltaShares, 0, 1e-12, "fallback residual delta");
});

test("scenario P&L decomposition uses stated Greek units", () => {
  const call = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const risk = scaleOptionGreeks(call, 1, MULTIPLIER, S);
  const pnl = approximateGreekScenarioPnl(risk, S, 1, 2, 1, 50);
  const dS = S * 0.01;

  approx(pnl.delta, risk.deltaShares * dS, 1e-10, "delta term");
  approx(pnl.gamma, 0.5 * risk.gamma * dS * dS, 1e-10, "gamma term");
  approx(pnl.theta, risk.thetaPerDay, 1e-10, "theta term");
  approx(pnl.vega, risk.vegaPerVolPoint * 2, 1e-10, "vega term");
  approx(pnl.rho, risk.rhoPer100bp * 0.5, 1e-10, "rho term");
});

test("European put-call parity recovers the funding rate and synthetic forward", () => {
  const call = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const put = blackScholesMerton(S, 320, T, R, Q, VOL, false);
  const parity = analyzePutCallParity({
    spot: S,
    strike: 320,
    timeYears: T,
    rate: R,
    dividendYield: Q,
    callPrice: call.price,
    putPrice: put.price,
  });

  approx(parity.residual, 0, 1e-6, "parity residual");
  approx(parity.impliedRatePct ?? 0, R * 100, 1e-4, "implied financing rate");
  approx(parity.syntheticImpliedForward, parity.fairForward, 1e-5, "synthetic forward");
  assert.equal(parity.status, "aligned");
});

test("parity flags a deliberately rich synthetic long forward", () => {
  const call = blackScholesMerton(S, 320, T, R, Q, VOL, true);
  const put = blackScholesMerton(S, 320, T, R, Q, VOL, false);
  const parity = analyzePutCallParity({
    spot: S,
    strike: 320,
    timeYears: T,
    rate: R,
    dividendYield: Q,
    callPrice: call.price + 1,
    putPrice: put.price,
  });

  assert.equal(parity.status, "synthetic_long_rich");
  assert.ok(parity.residual > 0.99);
  assert.ok(parity.forwardBasis > 0);
});

test("European box spread equals discounted strike width and recovers rate", () => {
  const k1 = 300;
  const k2 = 340;
  const c1 = blackScholesMerton(S, k1, T, R, Q, VOL, true).price;
  const p1 = blackScholesMerton(S, k1, T, R, Q, VOL, false).price;
  const c2 = blackScholesMerton(S, k2, T, R, Q, VOL, true).price;
  const p2 = blackScholesMerton(S, k2, T, R, Q, VOL, false).price;
  const box = analyzeBoxSpread({ lowStrike: k1, highStrike: k2, callLow: c1, putLow: p1, callHigh: c2, putHigh: p2, timeYears: T, rate: R });

  approx(box.residual, 0, 1e-6, "box residual");
  approx(box.impliedRatePct ?? 0, R * 100, 1e-4, "box implied rate");
  assert.equal(box.status, "aligned");
});
