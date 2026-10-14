// Institutional options pricing and validation utilities.
//
// Design goals:
// - preserve the existing dividend-adjusted Black-Scholes-Merton outputs;
// - provide a genuine early-exercise model for American options;
// - make Greek units explicit and stable across models;
// - support discrete cash-dividend schedules without pretending they are a
//   continuous yield;
// - expose move, curve, audit, and validation helpers so the UI can explain
//   every number instead of showing opaque calculator output.

export type OptionExerciseStyle = "european" | "american";
export type OptionSide = "call" | "put";
export type VolatilitySource = "market_iv" | "realized_proxy" | "surface" | "custom" | "fallback";

export interface OptionGreeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number; // currency units per calendar day
  vega: number; // currency units per +1 volatility point (e.g. 30% -> 31%)
  rho: number; // currency units per +100bp parallel rate move
}

export interface DiscreteDividend {
  /** Cash dividend per share. */
  amount: number;
  /** Time from valuation instant to ex-dividend date, in years. */
  timeYears: number;
  /** Optional source/reference surfaced in audit UI. */
  source?: string;
}

export interface YieldCurveLikePoint {
  label: string;
  yield: number | null;
  asOf?: string | null;
  seriesId?: string;
}

export interface InterpolatedRate {
  ratePercent: number | null;
  lowerLabel: string | null;
  upperLabel: string | null;
  method: "exact" | "linear" | "nearest" | "unavailable";
  asOf: string | null;
}

export interface OptionMoveMetrics {
  straddleMove: number;
  straddleMovePct: number;
  oneSigmaMove: number;
  oneSigmaMovePct: number;
}

export interface OptionAuditInput {
  spot: number;
  strike: number;
  timeYears: number;
  rate: number;
  dividendYield: number;
  volatility: number;
  isCall: boolean;
  exerciseStyle: OptionExerciseStyle;
  discreteDividends?: DiscreteDividend[];
  treeSteps?: number;
  volatilitySource?: VolatilitySource;
  rateSource?: string;
  rateAsOf?: string | null;
}

export interface OptionCalculationAudit {
  model: string;
  exerciseStyle: OptionExerciseStyle;
  optionSide: OptionSide;
  inputs: {
    spot: number;
    strike: number;
    timeYears: number;
    calendarDays: number;
    rate: number;
    dividendYield: number;
    volatility: number;
    volatilitySource: VolatilitySource;
    rateSource: string;
    rateAsOf: string | null;
    discreteDividends: DiscreteDividend[];
  };
  adjustments: {
    discreteDividendPv: number;
    adjustedSpot: number;
    dividendMethod: "continuous_yield" | "escrowed_cash_dividends" | "continuous_plus_escrowed";
  };
  intermediates: {
    d1: number | null;
    d2: number | null;
    nd1: number | null;
    nd2: number | null;
    treeSteps: number | null;
  };
  output: OptionGreeks;
  conventions: {
    dayCount: "ACT/365";
    compounding: "continuous";
    thetaUnit: "per calendar day";
    vegaUnit: "per +1 volatility point";
    rhoUnit: "per +100bp";
  };
  checks: {
    lowerBound: number;
    upperBound: number;
    withinNoArbitrageBounds: boolean;
    putCallParityResidual: number | null;
  };
}

export interface OptionGridValidationRow {
  strike: number;
  call: OptionGreeks;
  put: OptionGreeks;
}

export interface OptionGridValidation {
  passed: boolean;
  maxPutCallParityResidual: number;
  boundsPassed: boolean;
  monotonicityPassed: boolean;
  convexityPassed: boolean;
  issues: string[];
}

const EPS = 1e-12;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function assertCoreInputs(S: number, K: number): void {
  if (!(S > 0) || !(K > 0)) {
    throw new Error("Option pricing requires positive spot and strike values.");
  }
}

export function stdNormCDF(x: number): number {
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;

  if (x >= 0.0) {
    const t = 1.0 / (1.0 + p * x);
    return 1.0 - c * Math.exp((-x * x) / 2.0) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
  }
  const t = 1.0 / (1.0 - p * x);
  return c * Math.exp((-x * x) / 2.0) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
}

export function stdNormPDF(x: number): number {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

export function normalizeDiscreteDividends(dividends: DiscreteDividend[] = [], expiryYears = Infinity): DiscreteDividend[] {
  return dividends
    .filter((d) => Number.isFinite(d.amount) && d.amount > 0 && Number.isFinite(d.timeYears) && d.timeYears > 0 && d.timeYears <= expiryYears + EPS)
    .map((d) => ({ ...d }))
    .sort((a, b) => a.timeYears - b.timeYears);
}

export function presentValueDiscreteDividends(dividends: DiscreteDividend[] = [], r = 0, expiryYears = Infinity): number {
  return normalizeDiscreteDividends(dividends, expiryYears).reduce(
    (sum, dividend) => sum + dividend.amount * Math.exp(-r * dividend.timeYears),
    0
  );
}

function remainingDividendPvAtTime(dividends: DiscreteDividend[], r: number, time: number, expiryYears: number): number {
  return normalizeDiscreteDividends(dividends, expiryYears).reduce((sum, dividend) => {
    if (dividend.timeYears <= time + EPS) return sum;
    return sum + dividend.amount * Math.exp(-r * (dividend.timeYears - time));
  }, 0);
}

function rollDividends(dividends: DiscreteDividend[], elapsedYears: number, newExpiryYears: number): DiscreteDividend[] {
  return dividends
    .map((d) => ({ ...d, timeYears: d.timeYears - elapsedYears }))
    .filter((d) => d.timeYears > EPS && d.timeYears <= newExpiryYears + EPS);
}

function adjustedSpotForCashDividends(S: number, T: number, r: number, dividends: DiscreteDividend[]): { adjustedSpot: number; pv: number } {
  const pv = presentValueDiscreteDividends(dividends, r, T);
  return { adjustedSpot: Math.max(EPS, S - pv), pv };
}

interface BsmCoreResult {
  price: number;
  delta: number;
  gamma: number;
  thetaAnnual: number;
  vegaPerVolPoint: number;
  rhoPerRatePoint: number;
  d1: number;
  d2: number;
  nd1: number;
  nd2: number;
}

function deterministicEuropeanPrice(S: number, K: number, T: number, r: number, q: number, isCall: boolean): number {
  const forwardPv = S * Math.exp(-q * T) - K * Math.exp(-r * T);
  return isCall ? Math.max(0, forwardPv) : Math.max(0, -forwardPv);
}

function bsmCore(S: number, K: number, T: number, r: number, q: number, v: number, isCall: boolean): BsmCoreResult {
  assertCoreInputs(S, K);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (v * v) / 2) * T) / (v * sqrtT);
  const d2 = d1 - v * sqrtT;
  const nd1 = stdNormCDF(d1);
  const nd2 = stdNormCDF(d2);
  const nnd1 = stdNormCDF(-d1);
  const nnd2 = stdNormCDF(-d2);
  const pdfd1 = stdNormPDF(d1);
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);

  let price: number;
  let delta: number;
  let thetaAnnual: number;
  let rhoPerRatePoint: number;

  if (isCall) {
    price = S * eqT * nd1 - K * erT * nd2;
    delta = eqT * nd1;
    thetaAnnual = (-S * eqT * pdfd1 * v) / (2 * sqrtT) - r * K * erT * nd2 + q * S * eqT * nd1;
    rhoPerRatePoint = K * T * erT * nd2;
  } else {
    price = K * erT * nnd2 - S * eqT * nnd1;
    delta = -eqT * nnd1;
    thetaAnnual = (-S * eqT * pdfd1 * v) / (2 * sqrtT) + r * K * erT * nnd2 - q * S * eqT * nnd1;
    rhoPerRatePoint = -K * T * erT * nnd2;
  }

  const gamma = (eqT * pdfd1) / (S * v * sqrtT);
  const vegaPerVolPoint = S * eqT * sqrtT * pdfd1;

  return { price: Math.max(0, price), delta, gamma, thetaAnnual, vegaPerVolPoint, rhoPerRatePoint, d1, d2, nd1, nd2 };
}

function europeanPriceOnly(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  v: number,
  isCall: boolean,
  discreteDividends: DiscreteDividend[] = []
): number {
  assertCoreInputs(S, K);
  if (T <= 0) return intrinsicValue(S, K, isCall);
  const { adjustedSpot } = adjustedSpotForCashDividends(S, T, r, discreteDividends);
  if (v <= EPS) return deterministicEuropeanPrice(adjustedSpot, K, T, r, q, isCall);
  return bsmCore(adjustedSpot, K, T, r, q, v, isCall).price;
}

/**
 * Merton dividend-adjusted Black-Scholes with optional discrete cash-dividend
 * escrow adjustment. With no discrete dividends this intentionally preserves
 * the original analytical implementation and Greek values.
 */
export function blackScholesMerton(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  v: number,
  isCall: boolean,
  discreteDividends: DiscreteDividend[] = []
): OptionGreeks {
  assertCoreInputs(S, K);

  if (T <= 0) {
    const intrinsic = intrinsicValue(S, K, isCall);
    return { price: intrinsic, delta: isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0 };
  }

  const normalizedDividends = normalizeDiscreteDividends(discreteDividends, T);
  const { adjustedSpot } = adjustedSpotForCashDividends(S, T, r, normalizedDividends);

  if (v <= EPS) {
    const price = deterministicEuropeanPrice(adjustedSpot, K, T, r, q, isCall);
    return { price, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }

  // Continuous-yield-only case uses exact analytical Greeks.
  if (normalizedDividends.length === 0) {
    const core = bsmCore(S, K, T, r, q, v, isCall);
    return {
      price: core.price,
      delta: core.delta,
      gamma: core.gamma,
      theta: core.thetaAnnual / 365,
      vega: core.vegaPerVolPoint / 100,
      rho: core.rhoPerRatePoint / 100,
    };
  }

  // Cash dividends make spot adjustment time-dependent, so finite differences
  // are more honest for Greeks than reusing the continuous-yield formulas.
  const price = europeanPriceOnly(S, K, T, r, q, v, isCall, normalizedDividends);
  const hS = Math.max(S * 0.001, 0.01);
  const pUp = europeanPriceOnly(S + hS, K, T, r, q, v, isCall, normalizedDividends);
  const pDown = europeanPriceOnly(Math.max(EPS, S - hS), K, T, r, q, v, isCall, normalizedDividends);
  const delta = (pUp - pDown) / (2 * hS);
  const gamma = (pUp - 2 * price + pDown) / (hS * hS);

  const dayYears = Math.min(1 / 365, T * 0.5);
  const rolledT = Math.max(EPS, T - dayYears);
  const rolledDividends = rollDividends(normalizedDividends, dayYears, rolledT);
  const rolledPrice = europeanPriceOnly(S, K, rolledT, r, q, v, isCall, rolledDividends);
  const theta = (rolledPrice - price) / (dayYears * 365);

  const hV = Math.max(0.0005, v * 0.0025);
  const pVUp = europeanPriceOnly(S, K, T, r, q, v + hV, isCall, normalizedDividends);
  const pVDown = europeanPriceOnly(S, K, T, r, q, Math.max(EPS, v - hV), isCall, normalizedDividends);
  const vega = ((pVUp - pVDown) / (2 * hV)) * 0.01;

  const hR = 0.0001;
  const pRUp = europeanPriceOnly(S, K, T, r + hR, q, v, isCall, normalizedDividends);
  const pRDown = europeanPriceOnly(S, K, T, r - hR, q, v, isCall, normalizedDividends);
  const rho = ((pRUp - pRDown) / (2 * hR)) * 0.01;

  return { price, delta, gamma, theta, vega, rho };
}

function resolveCrrLattice(T: number, r: number, q: number, v: number, requestedSteps: number): { steps: number; dt: number; u: number; d: number; p: number; disc: number } {
  let steps = Math.max(25, Math.min(4096, Math.round(requestedSteps)));
  for (;;) {
    const dt = T / steps;
    const u = Math.exp(v * Math.sqrt(dt));
    const d = 1 / u;
    const p = (Math.exp((r - q) * dt) - d) / (u - d);
    if ((p >= 0 && p <= 1) || steps >= 4096) {
      return { steps, dt, u, d, p: Math.max(0, Math.min(1, p)), disc: Math.exp(-r * dt) };
    }
    steps = Math.min(4096, steps * 2);
  }
}

/**
 * Cox-Ross-Rubinstein American pricing with early exercise at every node.
 * Discrete cash dividends use an escrowed-dividend/prepaid-forward tree:
 * the ex-dividend component recombines while the PV of remaining cash
 * dividends is added back to the node stock for exercise decisions.
 */
export function americanBinomialPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  v: number,
  isCall: boolean,
  steps = 250,
  discreteDividends: DiscreteDividend[] = []
): number {
  assertCoreInputs(S, K);
  if (T <= 0) return intrinsicValue(S, K, isCall);
  if (v <= EPS) {
    return Math.max(intrinsicValue(S, K, isCall), europeanPriceOnly(S, K, T, r, q, v, isCall, discreteDividends));
  }

  const dividends = normalizeDiscreteDividends(discreteDividends, T);
  const initialDividendPv = presentValueDiscreteDividends(dividends, r, T);
  const prepaidSpot = Math.max(EPS, S - initialDividendPv);
  const lattice = resolveCrrLattice(T, r, q, v, steps);
  const { dt, u, d, p, disc } = lattice;
  const values = new Array<number>(lattice.steps + 1);

  const nodeSpot = (step: number, downMoves: number): number => {
    const t = step * dt;
    const exDividendComponent = prepaidSpot * Math.pow(u, step - downMoves) * Math.pow(d, downMoves);
    return exDividendComponent + remainingDividendPvAtTime(dividends, r, t, T);
  };

  for (let i = 0; i <= lattice.steps; i++) {
    const ST = nodeSpot(lattice.steps, i);
    values[i] = intrinsicValue(ST, K, isCall);
  }

  for (let step = lattice.steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      const continuation = disc * (p * values[i] + (1 - p) * values[i + 1]);
      const exercise = intrinsicValue(nodeSpot(step, i), K, isCall);
      values[i] = Math.max(continuation, exercise);
    }
  }

  return finite(values[0], intrinsicValue(S, K, isCall));
}

/** American Greeks by central finite differences on the same CRR engine. */
export function americanGreeks(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  v: number,
  isCall: boolean,
  steps = 250,
  discreteDividends: DiscreteDividend[] = []
): OptionGreeks {
  const dividends = normalizeDiscreteDividends(discreteDividends, T);
  const price = americanBinomialPrice(S, K, T, r, q, v, isCall, steps, dividends);
  if (T <= 0 || v <= EPS) return { price, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };

  const hS = Math.max(S * 0.001, 0.01);
  const pUp = americanBinomialPrice(S + hS, K, T, r, q, v, isCall, steps, dividends);
  const pDown = americanBinomialPrice(Math.max(EPS, S - hS), K, T, r, q, v, isCall, steps, dividends);
  const delta = (pUp - pDown) / (2 * hS);
  const gamma = (pUp - 2 * price + pDown) / (hS * hS);

  const dayYears = Math.min(1 / 365, T * 0.5);
  const rolledT = Math.max(EPS, T - dayYears);
  const rolledDividends = rollDividends(dividends, dayYears, rolledT);
  const pTheta = americanBinomialPrice(S, K, rolledT, r, q, v, isCall, steps, rolledDividends);
  const theta = (pTheta - price) / (dayYears * 365);

  const hV = Math.max(0.0005, v * 0.0025);
  const pVUp = americanBinomialPrice(S, K, T, r, q, v + hV, isCall, steps, dividends);
  const pVDown = americanBinomialPrice(S, K, T, r, q, Math.max(EPS, v - hV), isCall, steps, dividends);
  const vega = ((pVUp - pVDown) / (2 * hV)) * 0.01;

  const hR = 0.0001;
  const pRUp = americanBinomialPrice(S, K, T, r + hR, q, v, isCall, steps, dividends);
  const pRDown = americanBinomialPrice(S, K, T, r - hR, q, v, isCall, steps, dividends);
  const rho = ((pRUp - pRDown) / (2 * hR)) * 0.01;

  return { price, delta, gamma, theta, vega, rho };
}

/** Risk-neutral terminal ITM probability under the BSM diffusion. */
export function probabilityITM(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  v: number,
  isCall: boolean,
  discreteDividends: DiscreteDividend[] = []
): number {
  if (T <= 0 || v <= 0) return isCall ? (S > K ? 1 : 0) : (S < K ? 1 : 0);
  const adjustedSpot = adjustedSpotForCashDividends(S, T, r, discreteDividends).adjustedSpot;
  const sqrtT = Math.sqrt(T);
  const d2 = (Math.log(adjustedSpot / K) + (r - q - (v * v) / 2) * T) / (v * sqrtT);
  return isCall ? stdNormCDF(d2) : stdNormCDF(-d2);
}

/**
 * Risk-neutral continuous-monitoring touch probability under GBM. Cash
 * dividends are represented by the same PV spot adjustment as terminal BSM;
 * this is an approximation and should be labelled as such when cash-dividend
 * schedules are active.
 */
export function probabilityOfTouch(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  v: number,
  discreteDividends: DiscreteDividend[] = []
): number {
  if (T <= 0 || v <= 0) return S === K ? 1 : 0;
  const adjustedSpot = adjustedSpotForCashDividends(S, T, r, discreteDividends).adjustedSpot;
  if (K === adjustedSpot) return 1;
  const mu = r - q - (v * v) / 2;
  const sqrtT = Math.sqrt(T);

  if (K > adjustedSpot) {
    const x = Math.log(K / adjustedSpot);
    const a = (x - mu * T) / (v * sqrtT);
    const b = (x + mu * T) / (v * sqrtT);
    const ratio = Math.pow(K / adjustedSpot, (2 * mu) / (v * v));
    return Math.min(1, Math.max(0, stdNormCDF(-a) + ratio * stdNormCDF(-b)));
  }

  const x = Math.log(adjustedSpot / K);
  const a = (x + mu * T) / (v * sqrtT);
  const b = (x - mu * T) / (v * sqrtT);
  const ratio = Math.pow(adjustedSpot / K, (-2 * mu) / (v * v));
  return Math.min(1, Math.max(0, stdNormCDF(-a) + ratio * stdNormCDF(-b)));
}

export function intrinsicValue(S: number, K: number, isCall: boolean): number {
  return isCall ? Math.max(0, S - K) : Math.max(0, K - S);
}

export function moneyness(S: number, K: number, isCall: boolean, atmBandPct = 0.5): "ITM" | "ATM" | "OTM" {
  const bandWidth = S * (atmBandPct / 100);
  if (Math.abs(S - K) <= bandWidth) return "ATM";
  return (isCall ? S > K : S < K) ? "ITM" : "OTM";
}

export function breakeven(K: number, premium: number, isCall: boolean): number {
  return isCall ? K + premium : K - premium;
}

export function optionMoveMetrics(spot: number, volatility: number, timeYears: number, atmCallPrice: number, atmPutPrice: number): OptionMoveMetrics {
  const straddleMove = Math.max(0, atmCallPrice) + Math.max(0, atmPutPrice);
  const oneSigmaMove = Math.max(0, spot) * Math.max(0, volatility) * Math.sqrt(Math.max(0, timeYears));
  return {
    straddleMove,
    straddleMovePct: spot > 0 ? straddleMove / spot : 0,
    oneSigmaMove,
    oneSigmaMovePct: spot > 0 ? oneSigmaMove / spot : 0,
  };
}

/** Annualized close-to-close realized volatility. */
export function realizedVolatilityPct(closes: number[], periodsPerYear = 252): number | null {
  if (closes.length < 10) return null;
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) logReturns.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (logReturns.length < 5) return null;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
}

export function tenorLabelToDays(label: string): number | null {
  const normalized = label.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)(D|W|M|Y|YR|YRS|YEAR|YEARS)$/);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(n)) return null;
  if (unit === "D") return n;
  if (unit === "W") return n * 7;
  if (unit === "M") return n * (365 / 12);
  return n * 365;
}

/** Linear interpolation across live Treasury/FRED curve tenors. */
export function interpolateYieldCurveRate(curve: YieldCurveLikePoint[], expiryDays: number): InterpolatedRate {
  const points = curve
    .map((point) => ({ ...point, days: tenorLabelToDays(point.label) }))
    .filter((point): point is YieldCurveLikePoint & { days: number; yield: number } => point.days !== null && point.yield !== null && Number.isFinite(point.yield))
    .sort((a, b) => a.days - b.days);

  if (points.length === 0 || !(expiryDays > 0)) {
    return { ratePercent: null, lowerLabel: null, upperLabel: null, method: "unavailable", asOf: null };
  }

  const exact = points.find((point) => Math.abs(point.days - expiryDays) < 1e-9);
  if (exact) {
    return { ratePercent: exact.yield, lowerLabel: exact.label, upperLabel: exact.label, method: "exact", asOf: exact.asOf ?? null };
  }

  const lower = [...points].reverse().find((point) => point.days < expiryDays);
  const upper = points.find((point) => point.days > expiryDays);
  if (lower && upper) {
    const w = (expiryDays - lower.days) / (upper.days - lower.days);
    const ratePercent = lower.yield + w * (upper.yield - lower.yield);
    return {
      ratePercent,
      lowerLabel: lower.label,
      upperLabel: upper.label,
      method: "linear",
      asOf: lower.asOf === upper.asOf ? (lower.asOf ?? null) : (upper.asOf ?? lower.asOf ?? null),
    };
  }

  const nearest = lower ?? upper ?? points[0];
  return { ratePercent: nearest.yield, lowerLabel: nearest.label, upperLabel: nearest.label, method: "nearest", asOf: nearest.asOf ?? null };
}

function europeanBounds(S: number, K: number, T: number, r: number, q: number, isCall: boolean, discreteDividends: DiscreteDividend[]): { lower: number; upper: number } {
  const adjustedSpot = adjustedSpotForCashDividends(S, T, r, discreteDividends).adjustedSpot;
  const spotPv = adjustedSpot * Math.exp(-q * T);
  const strikePv = K * Math.exp(-r * T);
  return isCall
    ? { lower: Math.max(0, spotPv - strikePv), upper: spotPv }
    : { lower: Math.max(0, strikePv - spotPv), upper: strikePv };
}

export function buildOptionCalculationAudit(input: OptionAuditInput): OptionCalculationAudit {
  const dividends = normalizeDiscreteDividends(input.discreteDividends ?? [], input.timeYears);
  const adjustment = adjustedSpotForCashDividends(input.spot, input.timeYears, input.rate, dividends);
  const output = input.exerciseStyle === "american"
    ? americanGreeks(input.spot, input.strike, input.timeYears, input.rate, input.dividendYield, input.volatility, input.isCall, input.treeSteps ?? 250, dividends)
    : blackScholesMerton(input.spot, input.strike, input.timeYears, input.rate, input.dividendYield, input.volatility, input.isCall, dividends);

  let d1: number | null = null;
  let d2: number | null = null;
  let nd1: number | null = null;
  let nd2: number | null = null;
  if (input.timeYears > 0 && input.volatility > EPS) {
    const core = bsmCore(adjustment.adjustedSpot, input.strike, input.timeYears, input.rate, input.dividendYield, input.volatility, input.isCall);
    d1 = core.d1;
    d2 = core.d2;
    nd1 = core.nd1;
    nd2 = core.nd2;
  }

  const bounds = europeanBounds(input.spot, input.strike, input.timeYears, input.rate, input.dividendYield, input.isCall, dividends);
  const call = blackScholesMerton(input.spot, input.strike, input.timeYears, input.rate, input.dividendYield, input.volatility, true, dividends).price;
  const put = blackScholesMerton(input.spot, input.strike, input.timeYears, input.rate, input.dividendYield, input.volatility, false, dividends).price;
  const parityTarget = adjustment.adjustedSpot * Math.exp(-input.dividendYield * input.timeYears) - input.strike * Math.exp(-input.rate * input.timeYears);
  const parityResidual = call - put - parityTarget;
  const lowerBound = input.exerciseStyle === "american" ? intrinsicValue(input.spot, input.strike, input.isCall) : bounds.lower;
  const upperBound = input.isCall ? input.spot : input.strike;

  return {
    model: input.exerciseStyle === "american" ? "Cox-Ross-Rubinstein binomial" : "Black-Scholes-Merton",
    exerciseStyle: input.exerciseStyle,
    optionSide: input.isCall ? "call" : "put",
    inputs: {
      spot: input.spot,
      strike: input.strike,
      timeYears: input.timeYears,
      calendarDays: input.timeYears * 365,
      rate: input.rate,
      dividendYield: input.dividendYield,
      volatility: input.volatility,
      volatilitySource: input.volatilitySource ?? "custom",
      rateSource: input.rateSource ?? "manual",
      rateAsOf: input.rateAsOf ?? null,
      discreteDividends: dividends,
    },
    adjustments: {
      discreteDividendPv: adjustment.pv,
      adjustedSpot: adjustment.adjustedSpot,
      dividendMethod: dividends.length > 0
        ? (Math.abs(input.dividendYield) > EPS ? "continuous_plus_escrowed" : "escrowed_cash_dividends")
        : "continuous_yield",
    },
    intermediates: {
      d1,
      d2,
      nd1,
      nd2,
      treeSteps: input.exerciseStyle === "american" ? (input.treeSteps ?? 250) : null,
    },
    output,
    conventions: {
      dayCount: "ACT/365",
      compounding: "continuous",
      thetaUnit: "per calendar day",
      vegaUnit: "per +1 volatility point",
      rhoUnit: "per +100bp",
    },
    checks: {
      lowerBound,
      upperBound,
      withinNoArbitrageBounds: output.price >= lowerBound - 1e-8 && output.price <= upperBound + 1e-8,
      putCallParityResidual: input.exerciseStyle === "european" ? parityResidual : null,
    },
  };
}

export function validateEuropeanOptionGrid(
  rows: OptionGridValidationRow[],
  S: number,
  T: number,
  r: number,
  q: number,
  discreteDividends: DiscreteDividend[] = [],
  tolerance = 1e-5
): OptionGridValidation {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  const issues: string[] = [];
  let maxPutCallParityResidual = 0;
  let boundsPassed = true;
  let monotonicityPassed = true;
  let convexityPassed = true;
  const adjustedSpot = adjustedSpotForCashDividends(S, T, r, discreteDividends).adjustedSpot;

  for (const row of sorted) {
    const callBounds = europeanBounds(S, row.strike, T, r, q, true, discreteDividends);
    const putBounds = europeanBounds(S, row.strike, T, r, q, false, discreteDividends);
    if (row.call.price < callBounds.lower - tolerance || row.call.price > callBounds.upper + tolerance || row.put.price < putBounds.lower - tolerance || row.put.price > putBounds.upper + tolerance) {
      boundsPassed = false;
      issues.push(`No-arbitrage bound failed at K=${row.strike}.`);
    }
    const parityTarget = adjustedSpot * Math.exp(-q * T) - row.strike * Math.exp(-r * T);
    const residual = Math.abs(row.call.price - row.put.price - parityTarget);
    maxPutCallParityResidual = Math.max(maxPutCallParityResidual, residual);
  }

  if (maxPutCallParityResidual > tolerance) issues.push(`Put-call parity residual ${maxPutCallParityResidual.toExponential(3)} exceeds tolerance.`);

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].call.price > sorted[i - 1].call.price + tolerance || sorted[i].put.price < sorted[i - 1].put.price - tolerance) {
      monotonicityPassed = false;
      issues.push(`Strike monotonicity failed around K=${sorted[i].strike}.`);
      break;
    }
  }

  for (let i = 1; i < sorted.length - 1; i++) {
    const leftWidth = sorted[i].strike - sorted[i - 1].strike;
    const rightWidth = sorted[i + 1].strike - sorted[i].strike;
    if (leftWidth <= 0 || rightWidth <= 0) continue;
    const callSlopeLeft = (sorted[i].call.price - sorted[i - 1].call.price) / leftWidth;
    const callSlopeRight = (sorted[i + 1].call.price - sorted[i].call.price) / rightWidth;
    const putSlopeLeft = (sorted[i].put.price - sorted[i - 1].put.price) / leftWidth;
    const putSlopeRight = (sorted[i + 1].put.price - sorted[i].put.price) / rightWidth;
    if (callSlopeRight + tolerance < callSlopeLeft || putSlopeRight + tolerance < putSlopeLeft) {
      convexityPassed = false;
      issues.push(`Strike convexity failed around K=${sorted[i].strike}.`);
      break;
    }
  }

  return {
    passed: boundsPassed && monotonicityPassed && convexityPassed && maxPutCallParityResidual <= tolerance,
    maxPutCallParityResidual,
    boundsPassed,
    monotonicityPassed,
    convexityPassed,
    issues,
  };
}
