// Shared quantitative-finance formula library -- pure functions, no I/O.
// Standard textbook definitions throughout; each function names its formula
// in a comment so it can be checked against a reference rather than trusted
// blindly. Companion to statistics.ts (descriptive stats / histograms).

import { stdNormCDF } from "./optionsModels";
import { computeDescriptiveStats, resamplingRandom } from "./statistics";

// ── Matrix helpers (small N -- OLS regression, PCA covariance) ─────────────

export type Matrix = number[][];

function transpose(m: Matrix): Matrix {
  return m[0].map((_, j) => m.map((row) => row[j]));
}

function matMul(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = Array.from({ length: a.length }, () => Array(b[0].length).fill(0));
  for (let i = 0; i < a.length; i++)
    for (let k = 0; k < b.length; k++)
      for (let j = 0; j < b[0].length; j++)
        out[i][j] += a[i][k] * b[k][j];
  return out;
}

// Gauss-Jordan inversion -- fine for the small (<= 6x6) design matrices
// these regressions use (a handful of factors, never large N).
function invert(m: Matrix): Matrix {
  const n = m.length;
  const aug: Matrix = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const pv = aug[col][col] || 1e-12;
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  return aug.map((row) => row.slice(n));
}

// ── OLS multi-factor regression: y = a + b1*x1 + b2*x2 + ... + e ───────────
// Used for CAPM (1 factor), Fama-French 3/5-factor, Carhart 4-factor.

export interface RegressionResult {
  alpha: number;           // intercept, annualized if inputs are periodic
  betas: number[];         // one per factor, same order as input columns
  rSquared: number;
  residualStdDev: number;
}

export function olsRegression(y: number[], factorColumns: number[][]): RegressionResult {
  const n = y.length;
  const k = factorColumns.length;
  const X: Matrix = Array.from({ length: n }, (_, i) => [1, ...factorColumns.map((col) => col[i])]);
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXinv = invert(XtX);
  const Xty: Matrix = matMul(Xt, y.map((v) => [v]));
  const coeffs = matMul(XtXinv, Xty).map((r) => r[0]);

  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0, ssTot = 0;
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    const pred = coeffs[0] + factorColumns.reduce((s, col, j) => s + coeffs[j + 1] * col[i], 0);
    const resid = y[i] - pred;
    residuals.push(resid);
    ssRes += resid * resid;
    ssTot += (y[i] - yMean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const residualStdDev = n > k + 1 ? Math.sqrt(ssRes / (n - k - 1)) : 0;

  return { alpha: coeffs[0], betas: coeffs.slice(1), rSquared, residualStdDev };
}

// ── CAPM and derived risk-adjusted ratios ───────────────────────────────────

// Expected return under CAPM: Rf + beta*(Rm - Rf). All inputs same period.
export function capmExpectedReturn(riskFreeRate: number, beta: number, marketReturn: number): number {
  return riskFreeRate + beta * (marketReturn - riskFreeRate);
}

// Jensen's Alpha: actual return minus the CAPM-expected return -- positive
// means the asset beat what its systematic risk alone would predict.
export function jensensAlpha(actualReturn: number, riskFreeRate: number, beta: number, marketReturn: number): number {
  return actualReturn - capmExpectedReturn(riskFreeRate, beta, marketReturn);
}

// Treynor Ratio: reward per unit of systematic (beta) risk, vs. Sharpe's
// reward per unit of total risk.
export function treynorRatio(portfolioReturn: number, riskFreeRate: number, beta: number): number | null {
  if (beta === 0) return null;
  return (portfolioReturn - riskFreeRate) / beta;
}

// Sortino Ratio: like Sharpe, but the denominator only penalizes downside
// deviation (returns below the target/MAR), not upside volatility.
export function sortinoRatio(returns: number[], targetReturn: number, periodsPerYear: number): number | null {
  const n = returns.length;
  if (!n) return null;
  const mean = returns.reduce((s, v) => s + v, 0) / n;
  const downsideSq = returns.reduce((s, v) => s + Math.min(0, v - targetReturn) ** 2, 0) / n;
  const downsideDev = Math.sqrt(downsideSq);
  if (downsideDev === 0) return null;
  return ((mean - targetReturn) * periodsPerYear) / (downsideDev * Math.sqrt(periodsPerYear));
}

// Information Ratio: active return over a benchmark, scaled by tracking
// error (std dev of the excess-return series).
export function informationRatio(portfolioReturns: number[], benchmarkReturns: number[], periodsPerYear: number): number | null {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (!n) return null;
  const excess = Array.from({ length: n }, (_, i) => portfolioReturns[i] - benchmarkReturns[i]);
  const meanExcess = excess.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? excess.reduce((s, v) => s + (v - meanExcess) ** 2, 0) / (n - 1) : 0;
  const trackingError = Math.sqrt(variance);
  if (trackingError === 0) return null;
  return (meanExcess * periodsPerYear) / (trackingError * Math.sqrt(periodsPerYear));
}

// Calmar Ratio: CAGR divided by the magnitude of max drawdown.
export function calmarRatio(cagr: number, maxDrawdownPct: number): number | null {
  if (maxDrawdownPct === 0) return null;
  return cagr / Math.abs(maxDrawdownPct);
}

// ── Value at Risk / Expected Shortfall ──────────────────────────────────────

const Z_SCORES: Record<number, number> = { 90: 1.2816, 95: 1.6449, 97.5: 1.9600, 99: 2.3263 };

// Parametric (variance-covariance) VaR, assuming normally distributed returns.
export function parametricVaR(positionValue: number, dailyVolPct: number, confidence: number, horizonDays = 1): number {
  const z = Z_SCORES[confidence] ?? 1.6449;
  return positionValue * (dailyVolPct / 100) * z * Math.sqrt(horizonDays);
}

// Historical VaR: empirical percentile of actual observed returns -- makes
// no distributional assumption, captures real fat tails/skew.
export function historicalVaR(positionValue: number, returnsPct: number[], confidence: number): number {
  if (!returnsPct.length) return 0;
  const sorted = [...returnsPct].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor(((100 - confidence) / 100) * sorted.length));
  const worstReturn = sorted[idx];
  return positionValue * Math.max(0, -worstReturn / 100);
}

// Expected Shortfall (CVaR): average loss beyond the VaR cutoff -- answers
// "given we're in the tail, how bad is it on average", unlike VaR's single
// cutoff point.
export function expectedShortfall(positionValue: number, returnsPct: number[], confidence: number): number {
  if (!returnsPct.length) return 0;
  const sorted = [...returnsPct].sort((a, b) => a - b);
  const cutoffIdx = Math.max(1, Math.floor(((100 - confidence) / 100) * sorted.length));
  const tail = sorted.slice(0, cutoffIdx);
  const meanTailReturn = tail.reduce((s, v) => s + v, 0) / tail.length;
  return positionValue * Math.max(0, -meanTailReturn / 100);
}

// Cornish-Fisher VaR: parametric VaR corrected for the sample's own skew and
// excess kurtosis (Cornish & Fisher 1938 expansion of the normal quantile),
// so a fat-tailed/skewed return series gets a worse (or better) z than the
// plain normal assumption instead of always using the same z as
// parametricVaR. Ported from LIMURIA_ENGINES' engines/05_risk_engine.py
// (var_cornish_fisher) -- a genuine gap in the existing VaR family here,
// which had historical/parametric/Monte Carlo/EVT but not this one.
export function cornishFisherVaR(positionValue: number, returnsPct: number[], confidence: number): number {
  if (returnsPct.length < 4) return 0; // kurtosis needs n>3 (computeDescriptiveStats)
  const stats = computeDescriptiveStats(returnsPct);
  const { mean, stdDev, skewness, kurtosis } = stats;
  if (skewness === null || kurtosis === null || stdDev === 0) return 0;
  const z = -(Z_SCORES[confidence] ?? 1.6449); // left-tail quantile, same sign convention as var_parametric
  const zCF = z
    + (z ** 2 - 1) * skewness / 6
    + (z ** 3 - 3 * z) * kurtosis / 24
    - (2 * z ** 3 - 5 * z) * (skewness ** 2) / 36;
  const varPct = mean + zCF * stdDev;
  return positionValue * Math.max(0, -varPct / 100);
}

// Monte Carlo VaR: simulate terminal P&L via GBM (Box-Muller normal draws)
// and take the empirical percentile -- cross-check against parametric VaR,
// which assumes normality outright.
export function monteCarloVaR(positionValue: number, dailyVolPct: number, dailyDriftPct: number, confidence: number, horizonDays: number, paths = 5000, seed = 42): number {
  const random = resamplingRandom(seed);
  const results: number[] = [];
  const vol = dailyVolPct / 100;
  const drift = dailyDriftPct / 100;
  for (let p = 0; p < paths; p++) {
    let value = positionValue;
    for (let d = 0; d < horizonDays; d++) {
      const u1 = random() || 1e-9;
      const u2 = random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      value *= Math.exp((drift - 0.5 * vol * vol) + vol * z);
    }
    results.push(positionValue - value);
  }
  results.sort((a, b) => b - a);
  const idx = Math.max(0, Math.floor(((100 - confidence) / 100) * results.length));
  return Math.max(0, results[idx]);
}

// ── Counterparty CVA / risk decomposition / liquidity cost ─────────────────
// Closed-form, no randomness -- stay native TS rather than a sidecar hop
// (Monte Carlo credit VaR and operational risk LDA, which genuinely need
// correlated/compound random sampling, live in the Python sidecar instead;
// see python-service/credit_operational_risk.py). All three ported from
// LIMURIA_ENGINES' engines/05_risk_engine.py, verified real there.

export interface CVAResult {
  cva: number; // expected credit-loss-adjusted valuation reduction
}

// Credit Valuation Adjustment: LGD x sum(expected exposure_t x default
// probability_t x discount factor_t) -- the standard expected-exposure CVA
// approximation (not a full wrong-way-risk model, which would need a joint
// exposure/default simulation -- this is the textbook simplified formula
// the source itself implements).
export function counterpartyCVA(exposureProfile: number[], pdCurvePct: number[], lgdPct: number, discountFactors: number[]): CVAResult {
  const n = Math.min(exposureProfile.length, pdCurvePct.length, discountFactors.length);
  let cva = 0;
  for (let t = 0; t < n; t++) {
    cva += exposureProfile[t] * (pdCurvePct[t] / 100) * discountFactors[t];
  }
  return { cva: cva * (lgdPct / 100) };
}

export interface RiskDecompositionRow {
  asset: string;
  weight: number;
  marginalVaR: number; // change in portfolio vol per unit change in this asset's weight
  componentVaR: number; // this asset's share of total portfolio vol -- sums to portfolio vol across all assets
  componentPct: number; // componentVaR as % of total portfolio vol
}

// Marginal/component risk contribution: for portfolio variance w^T*Cov*w,
// the marginal contribution of asset i is (Cov*w)_i / portfolioVol, and its
// component contribution is w_i * marginal_i -- by construction the
// component contributions sum exactly to portfolio vol, which is what makes
// this "decomposition" rather than just per-asset vol.
export function riskDecomposition(assets: string[], weights: number[], covMatrix: Matrix): RiskDecompositionRow[] {
  const n = weights.length;
  const portVar = weights.reduce((sum, wi, i) => sum + wi * weights.reduce((s, wj, j) => s + covMatrix[i][j] * wj, 0), 0);
  const portVol = Math.sqrt(Math.max(0, portVar));
  if (portVol === 0) return assets.map((asset, i) => ({ asset, weight: weights[i], marginalVaR: 0, componentVaR: 0, componentPct: 0 }));
  return assets.map((asset, i) => {
    const covRowDotWeights = covMatrix[i].reduce((s, cij, j) => s + cij * weights[j], 0);
    const marginal = covRowDotWeights / portVol;
    const component = weights[i] * marginal;
    return { asset, weight: weights[i], marginalVaR: marginal, componentVaR: component, componentPct: (component / portVol) * 100 };
  });
}

// Liquidity cost estimate: half the bid-ask spread applied to each position
// size, summed -- an honest label for what this actually is (the source's
// own function is this simple, not a full liquidity-adjusted VaR, which
// would also need to widen the VaR horizon by time-to-liquidate).
export function liquidityCostEstimate(bidAskSpreadPct: number[], positionSizes: number[]): number {
  const n = Math.min(bidAskSpreadPct.length, positionSizes.length);
  let cost = 0;
  for (let i = 0; i < n; i++) cost += 0.5 * (bidAskSpreadPct[i] / 100) * positionSizes[i];
  return cost;
}

// ── EWMA volatility (RiskMetrics convention, lambda = 0.94 for daily) ──────

export function ewmaVolatility(returnsPct: number[], lambda = 0.94): number[] {
  if (!returnsPct.length) return [];
  const variances: number[] = [];
  let variance = returnsPct[0] ** 2;
  for (const r of returnsPct) {
    variance = lambda * variance + (1 - lambda) * r * r;
    variances.push(Math.sqrt(variance));
  }
  return variances;
}

// ── PCA via Jacobi eigenvalue algorithm (symmetric covariance matrix) ──────

export interface PcaResult {
  eigenvalues: number[];       // descending
  eigenvectors: Matrix;        // eigenvectors[i] is the i-th component, same order as eigenvalues
  varianceExplainedPct: number[];
}

// Classic cyclic Jacobi rotation method -- simple, numerically stable for
// the small (<= ~20x20) symmetric matrices a multi-asset covariance matrix
// produces here, no external linear-algebra dependency needed.
function jacobiEigen(input: Matrix, iterations = 100): { values: number[]; vectors: Matrix } {
  const n = input.length;
  const a = input.map((row) => [...row]);
  let v: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < iterations; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-12) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const app = a[p][p], aqq = a[q][q], apq = a[p][q];
        a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p][q] = 0; a[q][p] = 0;
        for (let i = 0; i < n; i++) {
          if (i !== p && i !== q) {
            const aip = a[i][p], aiq = a[i][q];
            a[i][p] = c * aip - s * aiq; a[p][i] = a[i][p];
            a[i][q] = s * aip + c * aiq; a[q][i] = a[i][q];
          }
        }
        for (let i = 0; i < n; i++) {
          const vip = v[i][p], viq = v[i][q];
          v[i][p] = c * vip - s * viq;
          v[i][q] = s * vip + c * viq;
        }
      }
    }
  }

  const values = Array.from({ length: n }, (_, i) => a[i][i]);
  const order = values.map((_, i) => i).sort((i, j) => values[j] - values[i]);
  return {
    values: order.map((i) => values[i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

export function computeCovarianceMatrix(returnSeries: number[][]): Matrix {
  const k = returnSeries.length;
  const n = returnSeries[0]?.length ?? 0;
  const means = returnSeries.map((s) => s.reduce((a, b) => a + b, 0) / n);
  const cov: Matrix = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let t = 0; t < n; t++) s += (returnSeries[i][t] - means[i]) * (returnSeries[j][t] - means[j]);
      cov[i][j] = n > 1 ? s / (n - 1) : 0;
    }
  }
  return cov;
}

export function pca(returnSeries: number[][]): PcaResult {
  const cov = computeCovarianceMatrix(returnSeries);
  const { values, vectors } = jacobiEigen(cov);
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  return {
    eigenvalues: values,
    eigenvectors: vectors,
    varianceExplainedPct: values.map((v) => (Math.max(0, v) / total) * 100),
  };
}

// ── Engle-Granger cointegration test (2-step) ───────────────────────────────
// Step 1: OLS regress y on x, get the spread (residuals).
// Step 2: ADF test on the spread -- is it stationary (mean-reverting)?
// Critical values below are the standard MacKinnon (1994) approximations
// for the no-constant-in-spread case at n>=50; flagged as approximate since
// exact response-surface critical values need the full MacKinnon tables.

export interface CointegrationResult {
  hedgeRatio: number;      // beta from regressing y on x
  spread: number[];        // y - hedgeRatio*x, the tradeable series
  adfStatistic: number;
  isLikelyCointegrated: boolean;   // adfStatistic below ~ -3.0 (5% approx. critical value)
  currentZScore: number;   // how many std devs the latest spread is from its mean
}

export function engleGrangerTest(y: number[], x: number[]): CointegrationResult {
  const n = Math.min(y.length, x.length);
  const reg = olsRegression(y.slice(0, n), [x.slice(0, n)]);
  const hedgeRatio = reg.betas[0];
  const spread = Array.from({ length: n }, (_, i) => y[i] - hedgeRatio * x[i]);

  // ADF regression: d(spread_t) = rho*spread_{t-1} + e_t (no drift/trend --
  // spread is assumed already demeaned via the OLS intercept above).
  const dSpread: number[] = [];
  const laggedSpread: number[] = [];
  for (let i = 1; i < spread.length; i++) {
    dSpread.push(spread[i] - spread[i - 1]);
    laggedSpread.push(spread[i - 1]);
  }
  const adfReg = olsRegression(dSpread, [laggedSpread]);
  const rho = adfReg.betas[0];
  const seRho = adfReg.residualStdDev / (Math.sqrt(laggedSpread.reduce((s, v) => s + v * v, 0)) || 1);
  const adfStatistic = seRho > 0 ? rho / seRho : 0;

  const spreadMean = spread.reduce((s, v) => s + v, 0) / spread.length;
  const spreadStd = Math.sqrt(spread.reduce((s, v) => s + (v - spreadMean) ** 2, 0) / spread.length) || 1;
  const currentZScore = (spread[spread.length - 1] - spreadMean) / spreadStd;

  return { hedgeRatio, spread, adfStatistic, isLikelyCointegrated: adfStatistic < -3.0, currentZScore };
}

// ── Kalman filter: dynamic (time-varying) beta / hedge ratio ───────────────
// State-space: beta_t = beta_{t-1} + w_t (random walk), y_t = beta_t*x_t + v_t.
// Standard scalar Kalman recursion -- adapts faster than a rolling-window
// regression to a genuinely time-varying relationship.

export interface KalmanBetaResult { betas: number[]; }

export function kalmanDynamicBeta(y: number[], x: number[], processVar = 0.0001, obsVar = 0.01): KalmanBetaResult {
  const n = Math.min(y.length, x.length);
  let beta = n > 0 ? y[0] / (x[0] || 1) : 1;
  let P = 1; // state covariance
  const betas: number[] = [];
  for (let t = 0; t < n; t++) {
    // Predict
    P += processVar;
    // Update
    const xt = x[t] || 1e-9;
    const kalmanGain = (P * xt) / (xt * xt * P + obsVar);
    const prediction = beta * xt;
    beta = beta + kalmanGain * (y[t] - prediction);
    P = (1 - kalmanGain * xt) * P;
    betas.push(beta);
  }
  return { betas };
}

// ── Rolling statistics ──────────────────────────────────────────────────────

export function rollingVolatility(returnsPct: number[], window: number, periodsPerYear = 252): (number | null)[] {
  return returnsPct.map((_, i) => {
    if (i < window - 1) return null;
    const slice = returnsPct.slice(i - window + 1, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / window;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (window - 1);
    return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
  });
}

export function rollingBeta(assetReturns: number[], marketReturns: number[], window: number): (number | null)[] {
  const n = Math.min(assetReturns.length, marketReturns.length);
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (i < window - 1) { out.push(null); continue; }
    const a = assetReturns.slice(i - window + 1, i + 1);
    const m = marketReturns.slice(i - window + 1, i + 1);
    const meanA = a.reduce((s, v) => s + v, 0) / window;
    const meanM = m.reduce((s, v) => s + v, 0) / window;
    let cov = 0, varM = 0;
    for (let j = 0; j < window; j++) { cov += (a[j] - meanA) * (m[j] - meanM); varM += (m[j] - meanM) ** 2; }
    out.push(varM > 0 ? cov / varM : null);
  }
  return out;
}

export function rollingCorrelation(seriesA: number[], seriesB: number[], window: number): (number | null)[] {
  const n = Math.min(seriesA.length, seriesB.length);
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (i < window - 1) { out.push(null); continue; }
    const a = seriesA.slice(i - window + 1, i + 1);
    const b = seriesB.slice(i - window + 1, i + 1);
    const meanA = a.reduce((s, v) => s + v, 0) / window;
    const meanB = b.reduce((s, v) => s + v, 0) / window;
    let cov = 0, varA = 0, varB = 0;
    for (let j = 0; j < window; j++) { cov += (a[j] - meanA) * (b[j] - meanB); varA += (a[j] - meanA) ** 2; varB += (b[j] - meanB) ** 2; }
    const denom = Math.sqrt(varA * varB);
    out.push(denom > 0 ? cov / denom : null);
  }
  return out;
}

// ── Brinson attribution (single-period, sector/asset-level) ────────────────
// Allocation effect: (wp - wb) * rb  -- did you overweight sectors that did well?
// Selection effect:   wb * (rp - rb) -- did you pick better securities within a sector?
// Interaction effect: (wp - wb) * (rp - rb) -- combined timing+selection effect.

export interface BrinsonRow {
  segment: string;
  portfolioWeight: number; benchmarkWeight: number;
  portfolioReturn: number; benchmarkReturn: number;
  allocationEffect: number; selectionEffect: number; interactionEffect: number; totalEffect: number;
}

export function brinsonAttribution(rows: { segment: string; wp: number; wb: number; rp: number; rb: number }[]): BrinsonRow[] {
  return rows.map((r) => {
    const allocationEffect = (r.wp - r.wb) * r.rb;
    const selectionEffect = r.wb * (r.rp - r.rb);
    const interactionEffect = (r.wp - r.wb) * (r.rp - r.rb);
    return {
      segment: r.segment,
      portfolioWeight: r.wp, benchmarkWeight: r.wb,
      portfolioReturn: r.rp, benchmarkReturn: r.rb,
      allocationEffect, selectionEffect, interactionEffect,
      totalEffect: allocationEffect + selectionEffect + interactionEffect,
    };
  });
}

// CAGR from a starting/ending value over a number of years.
export function cagr(startValue: number, endValue: number, years: number): number {
  if (startValue <= 0 || years <= 0) return 0;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

// Max drawdown (%) from an equity curve.
export function maxDrawdownPct(equityCurve: number[]): number {
  let peak = -Infinity, maxDD = 0;
  for (const v of equityCurve) {
    peak = Math.max(peak, v);
    if (peak > 0) maxDD = Math.min(maxDD, (v - peak) / peak);
  }
  return maxDD * 100;
}

// ── Black-Litterman ─────────────────────────────────────────────────────────
// Real prior/posterior blend (He & Litterman 1999 formulation), not a manual
// return offset. Absolute views only (each view pins one asset's expected
// return; P is a selection matrix), with the standard default view-
// uncertainty Omega = diag(tau * P*Sigma*P').
//
//   pi (equilibrium) = riskAversion * Sigma * w_prior
//   E[R] = [(tau*Sigma)^-1 + P'*Omega^-1*P]^-1 * [(tau*Sigma)^-1*pi + P'*Omega^-1*Q]

export interface BlackLittermanView { assetIndex: number; viewReturn: number; confidence?: number } // confidence 0-1, default 0.5

export interface BlackLittermanResult {
  equilibriumReturns: number[];
  posteriorReturns: number[];
}

export function blackLitterman(
  covMatrix: Matrix,
  priorWeights: number[],
  riskAversion: number,
  tau: number,
  views: BlackLittermanView[],
): BlackLittermanResult {
  const n = covMatrix.length;
  const sigma = covMatrix;

  // pi = delta * Sigma * w
  const equilibriumReturns = sigma.map((row) => riskAversion * row.reduce((s, v, j) => s + v * priorWeights[j], 0));

  if (!views.length) return { equilibriumReturns, posteriorReturns: equilibriumReturns };

  const k = views.length;
  const P: Matrix = Array.from({ length: k }, (_, i) => Array.from({ length: n }, (_, j) => (j === views[i].assetIndex ? 1 : 0)));
  const Q: Matrix = views.map((v) => [v.viewReturn]);

  const tauSigma: Matrix = sigma.map((row) => row.map((v) => v * tau));
  const tauSigmaInv = invert(tauSigma);

  // Omega: diagonal, scaled inversely by confidence (low confidence -> high uncertainty)
  const PtauSigmaPt = matMul(matMul(P, tauSigma), transpose(P));
  const omega: Matrix = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => {
    if (i !== j) return 0;
    const confidence = Math.min(0.99, Math.max(0.01, views[i].confidence ?? 0.5));
    return PtauSigmaPt[i][i] * (1 / confidence - 1 + 0.01);
  }));
  const omegaInv = invert(omega);

  const Pt = transpose(P);
  const term1 = sigma.map((row, i) => row.map((_, j) => tauSigmaInv[i][j])); // (tau*Sigma)^-1
  const PtOmegaInvP = matMul(matMul(Pt, omegaInv), P);
  const combinedPrecision = term1.map((row, i) => row.map((v, j) => v + PtOmegaInvP[i][j]));
  const combinedPrecisionInv = invert(combinedPrecision);

  const piCol: Matrix = equilibriumReturns.map((v) => [v]);
  const term1Pi = matMul(term1, piCol);
  const PtOmegaInvQ = matMul(matMul(Pt, omegaInv), Q);
  const rhs = term1Pi.map((row, i) => [row[0] + PtOmegaInvQ[i][0]]);

  const posterior = matMul(combinedPrecisionInv, rhs).map((r) => r[0]);
  return { equilibriumReturns, posteriorReturns: posterior };
}

// ── Altman Z-Score (1968, original public-company model) ───────────────────
// Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5, all from real filed
// balance-sheet/income-statement figures -- not estimated ratios.

export interface AltmanZInputs {
  totalCurrentAssets: number; totalCurrentLiabilities: number; totalAssets: number;
  retainedEarnings: number; ebit: number; marketCapitalization: number;
  totalLiabilities: number; revenue: number;
}

export interface AltmanZResult { x1: number; x2: number; x3: number; x4: number; x5: number; zScore: number; zone: "safe" | "grey" | "distress" }

export function altmanZScore(inputs: AltmanZInputs): AltmanZResult {
  const ta = inputs.totalAssets || 1;
  const x1 = (inputs.totalCurrentAssets - inputs.totalCurrentLiabilities) / ta;
  const x2 = inputs.retainedEarnings / ta;
  const x3 = inputs.ebit / ta;
  const x4 = inputs.totalLiabilities > 0 ? inputs.marketCapitalization / inputs.totalLiabilities : 0;
  const x5 = inputs.revenue / ta;
  const zScore = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
  const zone = zScore > 2.99 ? "safe" : zScore > 1.81 ? "grey" : "distress";
  return { x1, x2, x3, x4, x5, zScore, zone };
}

// ── Piotroski F-Score (2000, 9-point fundamental strength checklist) ───────
// Each criterion is a real year-over-year comparison of filed figures, not
// a static/hardcoded proxy. Returns 0-9; higher is stronger.

export interface PiotroskiYearInputs {
  netIncome: number; totalAssets: number; operatingCashFlow: number;
  longTermDebt: number; totalCurrentAssets: number; totalCurrentLiabilities: number;
  grossProfitMargin: number; assetTurnover: number; netCommonStockIssuance: number;
}

export interface PiotroskiResult {
  score: number;
  criteria: { label: string; passed: boolean }[];
}

export function piotroskiFScore(current: PiotroskiYearInputs, prior: PiotroskiYearInputs): PiotroskiResult {
  const roaCurrent = current.netIncome / (current.totalAssets || 1);
  const roaPrior = prior.netIncome / (prior.totalAssets || 1);
  const leverageCurrent = current.longTermDebt / (current.totalAssets || 1);
  const leveragePrior = prior.longTermDebt / (prior.totalAssets || 1);
  const currentRatioNow = current.totalCurrentAssets / (current.totalCurrentLiabilities || 1);
  const currentRatioPrior = prior.totalCurrentAssets / (prior.totalCurrentLiabilities || 1);

  const criteria = [
    { label: "Positive ROA", passed: roaCurrent > 0 },
    { label: "Positive Operating Cash Flow", passed: current.operatingCashFlow > 0 },
    { label: "ROA improved YoY", passed: roaCurrent > roaPrior },
    { label: "Operating Cash Flow > Net Income (quality of earnings)", passed: current.operatingCashFlow > current.netIncome },
    { label: "Long-term debt ratio decreased YoY", passed: leverageCurrent < leveragePrior },
    { label: "Current ratio improved YoY", passed: currentRatioNow > currentRatioPrior },
    { label: "No net new share issuance (no dilution)", passed: current.netCommonStockIssuance <= 0 },
    { label: "Gross margin improved YoY", passed: current.grossProfitMargin > prior.grossProfitMargin },
    { label: "Asset turnover improved YoY", passed: current.assetTurnover > prior.assetTurnover },
  ];

  return { score: criteria.filter((c) => c.passed).length, criteria };
}

// ── Beneish M-Score (1999, 8-variable earnings-manipulation detector) ──────
// M = -4.84 + 0.92*DSRI + 0.528*GMI + 0.404*AQI + 0.892*SGI + 0.115*DEPI
//     - 0.172*SGAI + 4.679*TATA - 0.327*LVGI
// M > -1.78 flags likely manipulation (Beneish's published threshold).

export interface BeneishYearInputs {
  receivables: number; revenue: number; grossProfit: number;
  currentAssets: number; ppe: number; totalAssets: number;
  depreciation: number; sga: number;
  currentLiabilities: number; longTermDebt: number;
  netIncome: number; operatingCashFlow: number;
}

export interface BeneishResult {
  dsri: number; gmi: number; aqi: number; sgi: number; depi: number;
  sgai: number; tata: number; lvgi: number; mScore: number; flagged: boolean;
}

export function beneishMScore(current: BeneishYearInputs, prior: BeneishYearInputs): BeneishResult {
  const ta = current.totalAssets || 1;
  const taPrior = prior.totalAssets || 1;

  const dsri = (current.receivables / (current.revenue || 1)) / ((prior.receivables / (prior.revenue || 1)) || 1e-9);
  const gmCurrent = current.grossProfit / (current.revenue || 1);
  const gmPrior = prior.grossProfit / (prior.revenue || 1);
  const gmi = gmPrior / (gmCurrent || 1e-9);
  const aqiCurrent = 1 - (current.currentAssets + current.ppe) / ta;
  const aqiPrior = 1 - (prior.currentAssets + prior.ppe) / taPrior;
  const aqi = aqiCurrent / (aqiPrior || 1e-9);
  const sgi = current.revenue / (prior.revenue || 1);
  const depiCurrent = current.depreciation / ((current.depreciation + current.ppe) || 1);
  const depiPrior = prior.depreciation / ((prior.depreciation + prior.ppe) || 1);
  const depi = depiPrior / (depiCurrent || 1e-9);
  const sgaiCurrent = current.sga / (current.revenue || 1);
  const sgaiPrior = prior.sga / (prior.revenue || 1);
  const sgai = sgaiCurrent / (sgaiPrior || 1e-9);
  const tata = (current.netIncome - current.operatingCashFlow) / ta;
  const lvgiCurrent = (current.currentLiabilities + current.longTermDebt) / ta;
  const lvgiPrior = (prior.currentLiabilities + prior.longTermDebt) / taPrior;
  const lvgi = lvgiCurrent / (lvgiPrior || 1e-9);

  const mScore = -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi
    + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi;

  return { dsri, gmi, aqi, sgi, depi, sgai, tata, lvgi, mScore, flagged: mScore > -1.78 };
}

// ── Ohlson O-Score (1980, 9-variable bankruptcy-probability model) ─────────
// Uses log(Total Assets) in place of the original GNP price-level deflator
// (unavailable / not meaningfully comparable across countries in a global
// multi-exchange terminal) -- a standard simplification when that index
// isn't accessible.

export interface OhlsonYearInputs {
  totalAssets: number; totalLiabilities: number;
  currentAssets: number; currentLiabilities: number;
  netIncome: number; fundsFromOperations: number;
}

export interface OhlsonResult {
  oScore: number; probability: number; risk: "low" | "moderate" | "high";
}

export function ohlsonOScore(current: OhlsonYearInputs, prior: OhlsonYearInputs): OhlsonResult {
  const ta = current.totalAssets || 1;
  const workingCapital = current.currentAssets - current.currentLiabilities;
  const x = current.totalLiabilities > current.totalAssets ? 1 : 0;
  const y = current.netIncome < 0 && prior.netIncome < 0 ? 1 : 0;
  const niChange = (current.netIncome - prior.netIncome) / ((Math.abs(current.netIncome) + Math.abs(prior.netIncome)) || 1);

  const oScore = -1.32
    - 0.407 * Math.log(Math.max(ta, 1))
    + 6.03 * (current.totalLiabilities / ta)
    - 1.43 * (workingCapital / ta)
    + 0.0757 * (current.currentLiabilities / (current.currentAssets || 1))
    - 1.72 * x
    - 2.37 * (current.netIncome / ta)
    - 1.83 * (current.fundsFromOperations / (current.totalLiabilities || 1))
    + 0.285 * y
    - 0.521 * niChange;

  const probability = 1 / (1 + Math.exp(-oScore));
  const risk = probability > 0.5 ? "high" : probability > 0.1 ? "moderate" : "low";
  return { oScore, probability, risk };
}

// ── Sloan Accrual Ratio (1996, balance-sheet approach) ──────────────────────
// Accruals = (ΔNon-cash Current Assets) − (ΔNon-debt Current Liabilities) − D&A
//          = (ΔCurrentAssets − ΔCash) − (ΔCurrentLiabilities − ΔShortTermDebt) − D&A
// Ratio = Accruals / Average Total Assets. Sloan (1996) found |ratio| above
// roughly 10% signals earnings quality skewed toward accruals rather than
// cash -- such firms historically underperform in the following period.

export interface SloanAccrualInputs {
  currentAssets: number; currentAssetsPrior: number;
  cash: number; cashPrior: number;
  currentLiabilities: number; currentLiabilitiesPrior: number;
  shortTermDebt: number; shortTermDebtPrior: number;
  depreciationAndAmortization: number;
  totalAssets: number; totalAssetsPrior: number;
}

export interface SloanAccrualResult { accruals: number; averageTotalAssets: number; accrualRatio: number; flagged: boolean }

export function sloanAccrualRatio(inputs: SloanAccrualInputs): SloanAccrualResult {
  const dCA = inputs.currentAssets - inputs.currentAssetsPrior;
  const dCash = inputs.cash - inputs.cashPrior;
  const dCL = inputs.currentLiabilities - inputs.currentLiabilitiesPrior;
  const dSTD = inputs.shortTermDebt - inputs.shortTermDebtPrior;
  const accruals = (dCA - dCash) - (dCL - dSTD) - inputs.depreciationAndAmortization;
  const averageTotalAssets = (inputs.totalAssets + inputs.totalAssetsPrior) / 2 || 1;
  const accrualRatio = accruals / averageTotalAssets;
  return { accruals, averageTotalAssets, accrualRatio, flagged: Math.abs(accrualRatio) > 0.1 };
}

// ── Cash Earnings Quality (CFO / Net Income) ────────────────────────────────
// The standard "quality of earnings" ratio -- how much of reported net
// income is actually backed by operating cash flow. >1 means cash earnings
// exceed accounting earnings (high quality); persistently <1 is a classic
// red flag (also the basis for one of Piotroski's nine criteria, expressed
// here as a continuous ratio rather than a pass/fail).

export interface CashEarningsQualityInputs { operatingCashFlow: number; netIncome: number }
export interface CashEarningsQualityResult { ratio: number; quality: "high" | "moderate" | "low" }

export function cashEarningsQuality({ operatingCashFlow, netIncome }: CashEarningsQualityInputs): CashEarningsQualityResult {
  const ratio = netIncome !== 0 ? operatingCashFlow / netIncome : (operatingCashFlow > 0 ? Infinity : 0);
  const quality = ratio >= 1.2 ? "high" : ratio >= 0.8 ? "moderate" : "low";
  return { ratio, quality };
}

// ── Revenue Quality (cash-basis conversion of revenue) ──────────────────────
// What fraction of reported revenue was NOT absorbed into a growing
// receivables balance -- i.e. collected rather than merely booked.
// RevenueQuality = (Revenue − ΔReceivables) / Revenue. Close to 1 means
// revenue is backed by cash; a falling ratio (especially alongside rising
// days-sales-outstanding) is a classic aggressive-revenue-recognition signal.

export interface RevenueQualityInputs { revenue: number; netReceivables: number; netReceivablesPrior: number }
export interface RevenueQualityResult { deltaReceivables: number; cashConversionRatio: number; quality: "high" | "moderate" | "low" }

export function revenueQuality({ revenue, netReceivables, netReceivablesPrior }: RevenueQualityInputs): RevenueQualityResult {
  const deltaReceivables = netReceivables - netReceivablesPrior;
  const cashConversionRatio = revenue !== 0 ? (revenue - deltaReceivables) / revenue : 0;
  const quality = cashConversionRatio >= 0.95 ? "high" : cashConversionRatio >= 0.85 ? "moderate" : "low";
  return { deltaReceivables, cashConversionRatio, quality };
}

// ── Earnings Persistence (single-period accrual-based proxy) ────────────────
// A true persistence coefficient (Sloan 1996 / Ball & Brown) is estimated by
// regressing NIt on NIt-1 across many firm-YEARS -- statistically meaningless
// to compute from a single pair of years for one company (n=1 regression is
// a perfect, uninformative fit). This is instead a documented single-period
// PROXY grounded in the same accrual decomposition as the Sloan ratio above:
// the smaller the accrual share of earnings, the more of current earnings is
// cash-backed and, per Sloan's own finding, the more likely to persist.

export interface EarningsPersistenceInputs { netIncome: number; accruals: number }
export interface EarningsPersistenceResult { accrualShare: number; persistenceScore: number; label: "persistent" | "moderate" | "transitory" }

export function earningsPersistenceProxy({ netIncome, accruals }: EarningsPersistenceInputs): EarningsPersistenceResult {
  const accrualShare = netIncome !== 0 ? Math.min(1, Math.abs(accruals / netIncome)) : 1;
  const persistenceScore = 1 - accrualShare;
  const label = persistenceScore >= 0.7 ? "persistent" : persistenceScore >= 0.4 ? "moderate" : "transitory";
  return { accrualShare, persistenceScore, label };
}

// ── Composite Financial Distress Indicator ───────────────────────────────────
// Combines the four independently-validated models above (Altman, Piotroski,
// Beneish, Ohlson) into one 0-100 distress score. This is an explicit,
// documented judgment-call weighting -- NOT itself an academically validated
// model -- so a user can see exactly how the composite is built rather than
// mistaking it for a fifth independent score with equal standing to the others.
// Weights: Altman zone 30%, Ohlson P(bankruptcy) 30%, Piotroski (inverted) 20%, Beneish flag 20%.

export interface FinancialDistressCompositeInputs {
  altmanZone: "safe" | "grey" | "distress";
  ohlsonProbability: number; // 0-1
  piotroskiScore: number; // 0-9
  beneishFlagged: boolean;
}

export interface FinancialDistressCompositeResult {
  score: number; // 0-100, higher = more distressed
  label: "low risk" | "moderate risk" | "high risk";
  components: { label: string; contribution: number }[];
}

export function financialDistressComposite(inputs: FinancialDistressCompositeInputs): FinancialDistressCompositeResult {
  const altmanRisk = inputs.altmanZone === "distress" ? 1 : inputs.altmanZone === "grey" ? 0.5 : 0;
  const ohlsonRisk = Math.max(0, Math.min(1, inputs.ohlsonProbability));
  const piotroskiRisk = 1 - inputs.piotroskiScore / 9;
  const beneishRisk = inputs.beneishFlagged ? 1 : 0;

  const components = [
    { label: "Altman Z-Score zone", contribution: altmanRisk * 30 },
    { label: "Ohlson P(bankruptcy)", contribution: ohlsonRisk * 30 },
    { label: "Piotroski F-Score (inverted)", contribution: piotroskiRisk * 20 },
    { label: "Beneish M-Score flag", contribution: beneishRisk * 20 },
  ];
  const score = components.reduce((sum, c) => sum + c.contribution, 0);
  const label: FinancialDistressCompositeResult["label"] = score >= 60 ? "high risk" : score >= 30 ? "moderate risk" : "low risk";
  return { score, label, components };
}

// ── Merton / KMV Distance-to-Default ────────────────────────────────────────
// Market-implied credit risk: equity is modeled as a call option on the
// firm's assets struck at the default point, so a firm's own share price
// and volatility -- not its accounting ratios -- drive the estimate. This
// is what makes it a genuinely different, independent signal from Altman/
// Piotroski/Beneish/Ohlson above, all of which read purely off filed
// financial statements.
//
// Solves the two Merton equations simultaneously for unobserved asset
// value V and asset volatility σV via fixed-point iteration (Newton step
// on the option-pricing equation, closed-form update on the volatility
// equation) -- the standard practical procedure, not a simplification of
// convenience; see Bharath & Shumway (2008), "Forecasting Default with the
// Merton Distance to Default Model", Review of Financial Studies.
//
//   E = V·N(d1) − D·e^(−rT)·N(d2)              (equity as a call option)
//   σE·E = N(d1)·σV·V                          (equity vol from asset vol)
//   d1 = [ln(V/D) + (r + σV²/2)T] / (σV√T),  d2 = d1 − σV√T
//   DD = d2   (distance to default, in standard deviations of asset value)
//
// IMPORTANT caveat, not glossed over: Moody's KMV maps DD to a "Expected
// Default Frequency" using a proprietary empirical calibration against
// their own historical default database, precisely because realized
// default rates at a given DD run materially higher than the textbook
// normal-CDF predicts (asset returns have fatter tails than the model
// assumes). That proprietary mapping isn't public data, so this function
// deliberately does NOT claim to reproduce it -- probabilityOfDefaultNormal
// below is the textbook N(-DD) figure only, labeled as a theoretical lower
// bound, not a substitute for the real EDF. Fabricating a fake empirical
// table and presenting it as Moody's methodology would be worse than
// admitting the gap.

export interface MertonInputs {
  marketCap: number;          // E -- market value of equity
  equityVolatility: number;   // σE -- annualized, as a fraction (0.35 = 35%)
  defaultPoint: number;       // D -- KMV convention: current liabilities + 0.5 * long-term debt
  riskFreeRate: number;       // r -- annualized, as a fraction (0.045 = 4.5%)
  horizonYears?: number;      // T -- default 1 year
}

export interface MertonResult {
  assetValue: number;
  assetVolatility: number;
  distanceToDefault: number;
  probabilityOfDefaultNormal: number; // N(-DD) -- theoretical lower bound, see note above
  converged: boolean;
  iterations: number;
}

export function mertonDistanceToDefault(inputs: MertonInputs): MertonResult {
  const { marketCap: E, equityVolatility: sigmaE, defaultPoint: D, riskFreeRate: r } = inputs;
  const T = inputs.horizonYears ?? 1;

  if (E <= 0 || D <= 0 || sigmaE <= 0 || !Number.isFinite(E) || !Number.isFinite(D)) {
    return { assetValue: 0, assetVolatility: 0, distanceToDefault: 0, probabilityOfDefaultNormal: 1, converged: false, iterations: 0 };
  }

  let V = E + D;
  let sigmaV = sigmaE * E / (E + D);
  const maxIterations = 100;
  const tolerance = 1e-6;
  let converged = false;
  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(V / D) + (r + (sigmaV * sigmaV) / 2) * T) / (sigmaV * sqrtT);
    const d2 = d1 - sigmaV * sqrtT;
    const Nd1 = stdNormCDF(d1);
    const Nd2 = stdNormCDF(d2);

    // Newton step on f(V) = V·N(d1) − D·e^(−rT)·N(d2) − E = 0; df/dV = N(d1).
    const priceGap = V * Nd1 - D * Math.exp(-r * T) * Nd2 - E;
    const Vnext = Nd1 > 1e-9 ? V - priceGap / Nd1 : V;
    const sigmaVnext = Nd1 > 1e-9 && Vnext > 0 ? (sigmaE * E) / (Nd1 * Vnext) : sigmaV;

    const vConverged = Math.abs(Vnext - V) < tolerance * Math.max(V, 1);
    const solConverged = Math.abs(sigmaVnext - sigmaV) < tolerance;
    V = Vnext > 0 ? Vnext : V;
    sigmaV = sigmaVnext > 0 ? sigmaVnext : sigmaV;

    if (vConverged && solConverged) {
      converged = true;
      iterations += 1;
      break;
    }
  }

  const sqrtT = Math.sqrt(T);
  const d1Final = (Math.log(V / D) + (r + (sigmaV * sigmaV) / 2) * T) / (sigmaV * sqrtT);
  const distanceToDefault = d1Final - sigmaV * sqrtT;
  const probabilityOfDefaultNormal = stdNormCDF(-distanceToDefault);

  return { assetValue: V, assetVolatility: sigmaV, distanceToDefault, probabilityOfDefaultNormal, converged, iterations };
}

// ── Dividend Discount Model -- Gordon Growth (single-stage) and a 2-stage
// (high-growth years N, then a stable terminal growth rate) variant. ──────

export interface GordonGrowthInputs { d0: number; growthRate: number; discountRate: number }
export interface GordonGrowthResult { d1: number; intrinsicValue: number }

export function gordonGrowthDDM({ d0, growthRate, discountRate }: GordonGrowthInputs): GordonGrowthResult {
  const g = growthRate / 100, r = discountRate / 100;
  const d1 = d0 * (1 + g);
  const intrinsicValue = r > g ? d1 / (r - g) : NaN;
  return { d1, intrinsicValue };
}

export interface TwoStageDDMInputs {
  d0: number; highGrowthRate: number; highGrowthYears: number;
  stableGrowthRate: number; discountRate: number;
}
export interface TwoStageDDMResult {
  projections: { year: number; dividend: number; pv: number }[];
  pvHighGrowth: number; terminalValue: number; pvTerminal: number; intrinsicValue: number;
}

export function twoStageDDM({ d0, highGrowthRate, highGrowthYears, stableGrowthRate, discountRate }: TwoStageDDMInputs): TwoStageDDMResult {
  const gHigh = highGrowthRate / 100, gStable = stableGrowthRate / 100, r = discountRate / 100;
  const projections: { year: number; dividend: number; pv: number }[] = [];
  let dividend = d0;
  let pvHighGrowth = 0;
  for (let year = 1; year <= highGrowthYears; year++) {
    dividend = dividend * (1 + gHigh);
    const pv = dividend / Math.pow(1 + r, year);
    projections.push({ year, dividend, pv });
    pvHighGrowth += pv;
  }
  const terminalDividend = dividend * (1 + gStable);
  const terminalValue = r > gStable ? terminalDividend / (r - gStable) : NaN;
  const pvTerminal = terminalValue / Math.pow(1 + r, highGrowthYears);
  return { projections, pvHighGrowth, terminalValue, pvTerminal, intrinsicValue: pvHighGrowth + pvTerminal };
}

// ── Capital Budgeting: NPV / IRR / MIRR / Payback ───────────────────────────
// cashflows[0] is the initial outlay (typically negative, at t=0); cashflows[i]
// for i>0 are period-i net cash flows. Rates are annual percentages (e.g. 10
// for 10%), matching every other rate parameter in this file.

export function computeNPV(cashflows: number[], discountRatePct: number): number {
  const r = discountRatePct / 100;
  return cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + r, t), 0);
}

// Newton-Raphson root-find on NPV(rate) = 0, falling back to bisection over a
// wide sane range if Newton fails to converge (common with cash flow series
// that have multiple sign changes, where the local derivative is unreliable).
// Returns null when the series never changes sign (no real IRR exists).
export function computeIRR(cashflows: number[], guessPct = 10): number | null {
  const hasPositive = cashflows.some((cf) => cf > 0);
  const hasNegative = cashflows.some((cf) => cf < 0);
  if (!hasPositive || !hasNegative) return null;

  const npvAtRate = (r: number) => cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + r, t), 0);
  const dNpvAtRate = (r: number) => cashflows.reduce((sum, cf, t) => sum - (t * cf) / Math.pow(1 + r, t + 1), 0);

  let r = guessPct / 100;
  for (let i = 0; i < 100; i++) {
    const f = npvAtRate(r);
    const fPrime = dNpvAtRate(r);
    if (Math.abs(fPrime) < 1e-10) break;
    const next = r - f / fPrime;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-9) return next * 100;
    r = next;
  }

  let lo = -0.99, hi = 10; // -99% to 1000%
  let fLo = npvAtRate(lo);
  const fHi = npvAtRate(hi);
  if ((fLo < 0) === (fHi < 0)) return null; // no root bracketed in range
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAtRate(mid);
    if (Math.abs(fMid) < 1e-7) return mid * 100;
    if ((fLo < 0) === (fMid < 0)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return ((lo + hi) / 2) * 100;
}

// Modified IRR: PV of negative flows discounted at the financing rate, FV of
// positive flows compounded at the reinvestment rate, geometric-averaged over
// the period count. Fixes IRR's implicit (often unrealistic) assumption that
// interim cash flows reinvest at the IRR itself rather than a market rate.
export function computeMIRR(cashflows: number[], financeRatePct: number, reinvestRatePct: number): number | null {
  const n = cashflows.length - 1;
  if (n <= 0) return null;
  const financeRate = financeRatePct / 100;
  const reinvestRate = reinvestRatePct / 100;

  let pvNegative = 0;
  let fvPositive = 0;
  cashflows.forEach((cf, t) => {
    if (cf < 0) pvNegative += cf / Math.pow(1 + financeRate, t);
    else if (cf > 0) fvPositive += cf * Math.pow(1 + reinvestRate, n - t);
  });
  if (pvNegative === 0 || fvPositive === 0) return null;
  return (Math.pow(fvPositive / -pvNegative, 1 / n) - 1) * 100;
}

// Simple payback period, in periods (fractional, via linear interpolation
// within the period the cumulative balance turns non-negative). Null if the
// outlay is never recovered.
export function paybackPeriod(cashflows: number[]): number | null {
  let cumulative = cashflows[0] ?? 0;
  for (let t = 1; t < cashflows.length; t++) {
    const prev = cumulative;
    cumulative += cashflows[t];
    if (cumulative >= 0) {
      const frac = cashflows[t] !== 0 ? -prev / cashflows[t] : 0;
      return (t - 1) + frac;
    }
  }
  return null;
}

// Same as paybackPeriod, but on cash flows discounted at the given rate first.
export function discountedPaybackPeriod(cashflows: number[], discountRatePct: number): number | null {
  const r = discountRatePct / 100;
  return paybackPeriod(cashflows.map((cf, t) => cf / Math.pow(1 + r, t)));
}

// ── Hidden Markov Model (Gaussian, Baum-Welch/EM) for regime detection ─────
// Fits a k-state Gaussian HMM to a return series: each state is a
// Normal(mean, variance) emission distribution, and states persist according
// to a learned transition matrix (both estimated from the data via EM, using
// the standard scaled forward-backward algorithm for numerical stability --
// Rabiner 1989). This is a real statistical regime-detection model: states
// aren't labeled "bull"/"bear" a priori, they're recovered from the data and
// interpreted afterward by their fitted mean/variance (e.g. the low-mean,
// high-variance state is "risk-off"). Replaces hand-tuned score heuristics
// with an actual fitted model.

export interface HMMResult {
  means: number[];
  variances: number[];
  transitionMatrix: number[][]; // transitionMatrix[i][j] = P(state j at t+1 | state i at t)
  initialProbs: number[];
  stateProbs: number[][];       // posterior P(state | all data) at each t -- stateProbs[t][k]
  mostLikelyStates: number[];   // argmax state per t (posterior/gamma decoding)
  currentState: number;
  currentStateProbs: number[];
  logLikelihood: number;
  iterations: number;
}

function gaussianPdf(x: number, mean: number, variance: number): number {
  const v = Math.max(variance, 1e-10);
  return Math.exp(-((x - mean) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v);
}

function hmmForwardBackward(returns: number[], means: number[], variances: number[], transitionMatrix: number[][], initialProbs: number[]) {
  const n = returns.length;
  const k = means.length;
  const emission: number[][] = returns.map((x) => means.map((m, s) => gaussianPdf(x, m, variances[s])));

  const alpha: number[][] = Array.from({ length: n }, () => Array(k).fill(0));
  const scale: number[] = Array(n).fill(0);
  for (let s = 0; s < k; s++) alpha[0][s] = initialProbs[s] * emission[0][s];
  scale[0] = alpha[0].reduce((a, b) => a + b, 0) || 1e-300;
  for (let s = 0; s < k; s++) alpha[0][s] /= scale[0];

  for (let t = 1; t < n; t++) {
    for (let s = 0; s < k; s++) {
      let sum = 0;
      for (let sPrev = 0; sPrev < k; sPrev++) sum += alpha[t - 1][sPrev] * transitionMatrix[sPrev][s];
      alpha[t][s] = sum * emission[t][s];
    }
    scale[t] = alpha[t].reduce((a, b) => a + b, 0) || 1e-300;
    for (let s = 0; s < k; s++) alpha[t][s] /= scale[t];
  }

  const beta: number[][] = Array.from({ length: n }, () => Array(k).fill(0));
  for (let s = 0; s < k; s++) beta[n - 1][s] = 1;
  for (let t = n - 2; t >= 0; t--) {
    for (let s = 0; s < k; s++) {
      let sum = 0;
      for (let sNext = 0; sNext < k; sNext++) sum += transitionMatrix[s][sNext] * emission[t + 1][sNext] * beta[t + 1][sNext];
      beta[t][s] = sum / scale[t + 1];
    }
  }

  const gamma: number[][] = alpha.map((row, t) => {
    const combined = row.map((a, s) => a * beta[t][s]);
    const rowSum = combined.reduce((a, b) => a + b, 0) || 1e-300;
    return combined.map((v) => v / rowSum);
  });

  const xiSum: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  for (let t = 0; t < n - 1; t++) {
    let denom = 0;
    const xiT: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        xiT[i][j] = alpha[t][i] * transitionMatrix[i][j] * emission[t + 1][j] * beta[t + 1][j];
        denom += xiT[i][j];
      }
    }
    denom = denom || 1e-300;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) xiSum[i][j] += xiT[i][j] / denom;
  }

  const logLikelihood = scale.reduce((s, v) => s + Math.log(v), 0);
  return { gamma, xiSum, logLikelihood };
}

export function fitGaussianHMM(returns: number[], numStates = 2, maxIter = 100, tol = 1e-6): HMMResult {
  const n = returns.length;
  const k = numStates;
  if (n < k * 5) throw new Error(`Need at least ${k * 5} observations to fit a ${k}-state HMM, got ${n}`);

  // Initialize means spread across data quantiles, variance from the overall
  // sample, and a near-diagonal transition matrix (regimes are persistent by
  // default -- a reasonable prior for market states, refined by EM below).
  const sorted = [...returns].sort((a, b) => a - b);
  let means = Array.from({ length: k }, (_, i) => sorted[Math.min(n - 1, Math.floor(((i + 0.5) / k) * n))]);
  const overallMean = returns.reduce((s, v) => s + v, 0) / n;
  const overallVar = returns.reduce((s, v) => s + (v - overallMean) ** 2, 0) / n;
  let variances = Array(k).fill(Math.max(overallVar, 1e-8));
  let transitionMatrix = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 0.9 : 0.1 / (k - 1))));
  let initialProbs = Array(k).fill(1 / k);

  let logLikelihood = -Infinity;
  let gamma: number[][] = [];
  let iter = 0;

  for (; iter < maxIter; iter++) {
    const fb = hmmForwardBackward(returns, means, variances, transitionMatrix, initialProbs);
    gamma = fb.gamma;

    const gammaSum = Array(k).fill(0);
    for (let t = 0; t < n; t++) for (let s = 0; s < k; s++) gammaSum[s] += gamma[t][s];

    const newInitialProbs = gamma[0].slice();
    const newTransitionMatrix = fb.xiSum.map((row, i) => {
      let denom = 0;
      for (let t = 0; t < n - 1; t++) denom += gamma[t][i];
      denom = denom || 1e-300;
      return row.map((v) => v / denom);
    });
    const newMeans = means.map((_, s) => {
      let num = 0;
      for (let t = 0; t < n; t++) num += gamma[t][s] * returns[t];
      return num / (gammaSum[s] || 1e-300);
    });
    const newVariances = variances.map((_, s) => {
      let num = 0;
      for (let t = 0; t < n; t++) num += gamma[t][s] * (returns[t] - newMeans[s]) ** 2;
      return Math.max(num / (gammaSum[s] || 1e-300), 1e-8);
    });

    means = newMeans;
    variances = newVariances;
    transitionMatrix = newTransitionMatrix;
    initialProbs = newInitialProbs;

    if (Math.abs(fb.logLikelihood - logLikelihood) < tol) {
      logLikelihood = fb.logLikelihood;
      iter++;
      break;
    }
    logLikelihood = fb.logLikelihood;
  }

  // One final E-step with the converged parameters so the returned gamma
  // reflects the final means/variances/transitionMatrix, not the pre-update ones.
  const finalFb = hmmForwardBackward(returns, means, variances, transitionMatrix, initialProbs);
  gamma = finalFb.gamma;

  const mostLikelyStates = gamma.map((row) => row.indexOf(Math.max(...row)));
  const currentStateProbs = gamma[n - 1];
  const currentState = mostLikelyStates[n - 1];

  return {
    means, variances, transitionMatrix, initialProbs,
    stateProbs: gamma, mostLikelyStates, currentState, currentStateProbs,
    logLikelihood: finalFb.logLikelihood, iterations: iter,
  };
}

// ── Extreme Value Theory: Peaks-Over-Threshold / Generalized Pareto tail fit ──
// Historical/parametric VaR describe the BULK of the return distribution;
// this fits the TAIL directly. By the Pickands-Balkema-de Haan theorem,
// exceedances over a sufficiently high threshold converge to a Generalized
// Pareto Distribution regardless of the parent distribution -- the right
// tool for genuinely extreme quantiles (99.5%+) where historical VaR has too
// few sample points beyond the cutoff to be reliable. Parameters are fit by
// method of moments (Hosking & Wallis 1987) -- closed-form and robust for
// the sample sizes this terminal works with, vs. a numerical MLE optimizer.

export interface GPDFit {
  threshold: number;        // % loss threshold (positive) the tail is fit above
  numExceedances: number;
  totalObservations: number;
  shape: number;             // xi -- >0 means a fat (Pareto-type) tail
  scale: number;              // beta
}

// thresholdPercentile is on the LOSS distribution (e.g. 90 = fit the tail
// using the worst 10% of days, by loss magnitude).
export function fitGPD(returnsPct: number[], thresholdPercentile = 90): GPDFit {
  const losses = returnsPct.map((r) => -r); // positive = loss
  const sorted = [...losses].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((thresholdPercentile / 100) * sorted.length));
  const threshold = sorted[idx];
  const exceedances = losses.filter((l) => l > threshold).map((l) => l - threshold);
  const n = exceedances.length;
  if (n < 8) throw new Error(`Need at least 8 exceedances above the ${thresholdPercentile}th percentile threshold, got ${n}`);
  const meanY = exceedances.reduce((s, v) => s + v, 0) / n;
  const varY = exceedances.reduce((s, v) => s + (v - meanY) ** 2, 0) / n;
  const shape = varY > 0 ? 0.5 * (1 - (meanY * meanY) / varY) : 0;
  const scale = varY > 0 ? 0.5 * meanY * ((meanY * meanY) / varY + 1) : meanY;
  return { threshold, numExceedances: n, totalObservations: losses.length, shape, scale };
}

// VaR at an extreme confidence level (e.g. 99, 99.5, 99.9), as a % loss.
export function evtVaRPct(gpd: GPDFit, confidence: number): number {
  const { threshold, numExceedances, totalObservations, shape, scale } = gpd;
  const ratio = (totalObservations / numExceedances) * (1 - confidence / 100);
  if (Math.abs(shape) < 1e-8) return threshold + scale * -Math.log(ratio);
  return threshold + (scale / shape) * (Math.pow(ratio, -shape) - 1);
}

// Expected Shortfall beyond the EVT VaR, as a % loss. Infinity when shape >=
// 1 -- the fitted tail is so fat the mean beyond that point doesn't exist.
export function evtExpectedShortfallPct(gpd: GPDFit, confidence: number): number {
  const varPct = evtVaRPct(gpd, confidence);
  const { threshold, shape, scale } = gpd;
  if (shape >= 1) return Infinity;
  return (varPct + scale - shape * threshold) / (1 - shape);
}

// Dollar-scaled wrappers matching parametricVaR/historicalVaR's call signature.
export function evtVaR(positionValue: number, gpd: GPDFit, confidence: number): number {
  return positionValue * (evtVaRPct(gpd, confidence) / 100);
}
export function evtExpectedShortfall(positionValue: number, gpd: GPDFit, confidence: number): number {
  const es = evtExpectedShortfallPct(gpd, confidence);
  return Number.isFinite(es) ? positionValue * (es / 100) : Infinity;
}

// ── Numerical primitives: log-gamma, incomplete beta, Student's t CDF/quantile ──
// (Numerical Recipes-style continued-fraction incomplete beta + Lanczos
// log-gamma.) These underpin the t-copula fit below -- correlation alone
// (what Pearson/Spearman capture) says nothing about whether two assets
// crash together; that's tail dependence, which needs an actual copula.

function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const xm1 = x - 1;
  let a = c[0];
  const t = xm1 + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (xm1 + i);
  return 0.5 * Math.log(2 * Math.PI) + (xm1 + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAXIT = 200, EPS = 3e-7, FPMIN = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(x, a, b)) / a;
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

export function studentTCDF(t: number, nu: number): number {
  const x = nu / (nu + t * t);
  const ib = regularizedIncompleteBeta(x, nu / 2, 0.5);
  return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

// Quantile function (inverse CDF) via bisection -- no closed form for
// Student's t, and a bisection is simple and robust enough for a UI call.
export function studentTQuantile(p: number, nu: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -1000, hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCDF(mid, nu) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── t-Copula: joint tail dependence between two return series ──────────────
// Pearson/Spearman correlation describes co-movement on average; it says
// nothing about whether two assets are MORE likely to crash together than a
// Gaussian model would predict. A Gaussian copula has zero tail dependence
// by construction regardless of its correlation (a well-known blind spot --
// notably implicated in underpricing joint-default risk before 2008); a
// Student-t copula has genuine, quantifiable tail dependence controlled by
// its degrees-of-freedom parameter. This fits rho via the standard rank
// (Spearman) correlation relationship, then grid-searches degrees of
// freedom by maximizing the bivariate t-copula log-likelihood.

export interface CopulaFit {
  rho: number;
  degreesOfFreedom: number;
  tailDependence: number; // symmetric for a t-copula: P(one crashes | other already did), in the joint extreme tail
  logLikelihood: number;
}

function empiricalToUniform(arr: number[]): number[] {
  const n = arr.length;
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  indexed.forEach(({ i }, rank) => { ranks[i] = (rank + 1) / (n + 1); });
  return ranks;
}

function logBivariateTCopulaDensity(x: number, y: number, rho: number, nu: number): number {
  const oneMinusRho2 = Math.max(1 - rho * rho, 1e-8);
  const quadForm = (x * x - 2 * rho * x * y + y * y) / (nu * oneMinusRho2);
  const logJoint = -Math.log(2 * Math.PI) - 0.5 * Math.log(oneMinusRho2)
    + logGamma((nu + 2) / 2) - logGamma(nu / 2) - Math.log(nu * Math.PI)
    - ((nu + 2) / 2) * Math.log(1 + quadForm);
  const logMarginal = (v: number) => logGamma((nu + 1) / 2) - logGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - ((nu + 1) / 2) * Math.log(1 + (v * v) / nu);
  return logJoint - logMarginal(x) - logMarginal(y);
}

export function fitTCopula(returnsA: number[], returnsB: number[], candidateDf: number[] = [3, 4, 5, 6, 8, 10, 15, 20, 30, 50]): CopulaFit {
  const n = Math.min(returnsA.length, returnsB.length);
  if (n < 30) throw new Error(`Need at least 30 paired observations to fit a copula, got ${n}`);
  const u = empiricalToUniform(returnsA.slice(0, n));
  const v = empiricalToUniform(returnsB.slice(0, n));

  const meanU = u.reduce((s, x) => s + x, 0) / n, meanV = v.reduce((s, x) => s + x, 0) / n;
  let cov = 0, varU = 0, varV = 0;
  for (let i = 0; i < n; i++) { cov += (u[i] - meanU) * (v[i] - meanV); varU += (u[i] - meanU) ** 2; varV += (v[i] - meanV) ** 2; }
  const spearmanRho = cov / Math.sqrt(varU * varV || 1e-12);
  const rho = Math.max(-0.999, Math.min(0.999, 2 * Math.sin((Math.PI * spearmanRho) / 6)));

  let bestDf = candidateDf[0], bestLL = -Infinity;
  for (const df of candidateDf) {
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const x = studentTQuantile(u[i], df), yv = studentTQuantile(v[i], df);
      ll += logBivariateTCopulaDensity(x, yv, rho, df);
    }
    if (ll > bestLL) { bestLL = ll; bestDf = df; }
  }

  // Upper (= lower, by symmetry) tail dependence coefficient for a t-copula
  // (Embrechts, McNeil & Straumann 2002): lambda = 2 * t_{nu+1}(-sqrt((nu+1)(1-rho)/(1+rho)))
  const tailArg = -Math.sqrt(((bestDf + 1) * (1 - rho)) / (1 + rho));
  const tailDependence = 2 * studentTCDF(tailArg, bestDf + 1);

  return { rho, degreesOfFreedom: bestDf, tailDependence, logLikelihood: bestLL };
}

// ── Nelder-Mead simplex minimizer ───────────────────────────────────────────
// Derivative-free, robust for the small (2-6 parameter) nonlinear
// maximum-likelihood/least-squares fits below (GARCH, EGARCH,
// Nelson-Siegel/Svensson) -- no need to hand-derive gradients for each one.
export function nelderMead(objective: (params: number[]) => number, initial: number[], maxIter = 800, tol = 1e-10): { params: number[]; value: number } {
  const n = initial.length;
  const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;

  let simplex: number[][] = [initial.slice()];
  for (let i = 0; i < n; i++) {
    const point = initial.slice();
    point[i] += point[i] !== 0 ? point[i] * 0.05 : 0.00025;
    simplex.push(point);
  }
  let values = simplex.map(objective);

  for (let iter = 0; iter < maxIter; iter++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);

    if (Math.abs(values[n] - values[0]) < tol) break;

    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;

    const worst = simplex[n];
    const reflected = centroid.map((c, j) => c + alpha * (c - worst[j]));
    const reflectedVal = objective(reflected);

    if (reflectedVal < values[0]) {
      const expanded = centroid.map((c, j) => c + gamma * (reflected[j] - c));
      const expandedVal = objective(expanded);
      if (expandedVal < reflectedVal) { simplex[n] = expanded; values[n] = expandedVal; }
      else { simplex[n] = reflected; values[n] = reflectedVal; }
    } else if (reflectedVal < values[n - 1]) {
      simplex[n] = reflected; values[n] = reflectedVal;
    } else {
      const contracted = centroid.map((c, j) => c + rho * (worst[j] - c));
      const contractedVal = objective(contracted);
      if (contractedVal < values[n]) { simplex[n] = contracted; values[n] = contractedVal; }
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[0].map((v, j) => v + sigma * (simplex[i][j] - v));
          values[i] = objective(simplex[i]);
        }
      }
    }
  }

  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  return { params: simplex[order[0]], value: values[order[0]] };
}

// ── GARCH(1,1): sigma_t^2 = omega + alpha*e_{t-1}^2 + beta*sigma_{t-1}^2 ───
// Fit by maximizing the Gaussian log-likelihood via Nelder-Mead (the
// standard MLE approach -- there's no closed form). Parameters are
// reparametrized through softplus + a shared rescale so omega>0, alpha>=0,
// beta>=0, and alpha+beta<1 (stationarity) hold automatically instead of
// needing a constrained optimizer.

export interface GARCH11Fit {
  omega: number; alpha: number; beta: number; mu: number;
  conditionalVariances: number[]; // sigma_t^2 per period, in (return-unit)^2
  longRunVariance: number;
  persistence: number; // alpha + beta -- how slowly shocks to volatility decay
  logLikelihood: number;
}

function garch11Params(raw: number[], sampleVar: number): { omega: number; alpha: number; beta: number } {
  const [rawOmega, rawAlpha, rawBeta] = raw;
  const omega = Math.log(1 + Math.exp(rawOmega)) * sampleVar * 0.05 + 1e-10;
  const alphaRaw = Math.log(1 + Math.exp(rawAlpha));
  const betaRaw = Math.log(1 + Math.exp(rawBeta));
  const sumRaw = alphaRaw + betaRaw;
  const scale = sumRaw > 0.999 ? 0.999 / sumRaw : 1;
  return { omega, alpha: alphaRaw * scale, beta: betaRaw * scale };
}

export function fitGARCH11(returnsPct: number[]): GARCH11Fit {
  const n = returnsPct.length;
  if (n < 50) throw new Error(`Need at least 50 observations to fit GARCH(1,1), got ${n}`);
  const mu = returnsPct.reduce((s, v) => s + v, 0) / n;
  const eps = returnsPct.map((r) => r - mu);
  const sampleVar = eps.reduce((s, v) => s + v * v, 0) / n;

  const negLogLik = (raw: number[]): number => {
    const { omega, alpha, beta } = garch11Params(raw, sampleVar);
    let sigma2 = sampleVar;
    let ll = 0;
    for (let t = 0; t < n; t++) {
      if (t > 0) sigma2 = omega + alpha * eps[t - 1] * eps[t - 1] + beta * sigma2;
      if (!Number.isFinite(sigma2) || sigma2 <= 0) return 1e10;
      ll += -0.5 * Math.log(2 * Math.PI) - 0.5 * Math.log(sigma2) - 0.5 * (eps[t] * eps[t]) / sigma2;
    }
    return -ll;
  };

  // GARCH log-likelihood surfaces have a well-known flat ridge along the
  // omega/persistence trade-off, which can strand a single Nelder-Mead run
  // in a local optimum (e.g. persistence pinned near the stationarity
  // boundary with omega compensating). Multiple starts spanning a spread of
  // initial persistence levels and keeping the best-likelihood result is the
  // standard practical fix.
  const starts: number[][] = [[-1, -1, 2], [0, 0, 1], [0, 1, 1], [1, -1, 3], [-2, 0, 0.5]];
  let fitted = nelderMead(negLogLik, starts[0], 1500);
  for (let i = 1; i < starts.length; i++) {
    const candidate = nelderMead(negLogLik, starts[i], 1500);
    if (candidate.value < fitted.value) fitted = candidate;
  }
  const { omega, alpha, beta } = garch11Params(fitted.params, sampleVar);

  const conditionalVariances: number[] = [sampleVar];
  for (let t = 1; t < n; t++) conditionalVariances.push(omega + alpha * eps[t - 1] * eps[t - 1] + beta * conditionalVariances[t - 1]);

  return { omega, alpha, beta, mu, conditionalVariances, longRunVariance: omega / (1 - alpha - beta), persistence: alpha + beta, logLikelihood: -fitted.value };
}

// h-step-ahead variance forecast has a closed form for GARCH(1,1): it decays
// geometrically (rate = persistence) from the current conditional variance
// toward the long-run unconditional variance.
export function forecastGARCH11(fit: GARCH11Fit, horizonDays: number): number[] {
  const lastVar = fit.conditionalVariances[fit.conditionalVariances.length - 1];
  const forecasts: number[] = [];
  for (let h = 1; h <= horizonDays; h++) {
    forecasts.push(fit.longRunVariance + Math.pow(fit.persistence, h) * (lastVar - fit.longRunVariance));
  }
  return forecasts;
}

// ── EGARCH(1,1) (Nelson 1991): log(sigma_t^2) = omega + beta*log(sigma_{t-1}^2)
//    + alpha*(|z_{t-1}| - E|z|) + gamma*z_{t-1}, z_t = e_t/sigma_t ─────────
// Unlike plain GARCH, EGARCH captures the leverage effect: equity volatility
// typically rises more after a negative shock than a positive one of the
// same size (gamma < 0 is the usual empirical finding). Working in log-
// variance also means no positivity constraint is needed on the variance
// itself.

export interface EGARCH11Fit {
  omega: number; alpha: number; beta: number; gamma: number; mu: number;
  conditionalVariances: number[];
  persistence: number;     // beta -- persistence of log-variance
  leverageEffect: number;  // gamma -- negative means bad news raises vol more than good news
  logLikelihood: number;
}

const E_ABS_Z = Math.sqrt(2 / Math.PI); // E|z| for a standard normal z

export function fitEGARCH11(returnsPct: number[]): EGARCH11Fit {
  const n = returnsPct.length;
  if (n < 50) throw new Error(`Need at least 50 observations to fit EGARCH(1,1), got ${n}`);
  const mu = returnsPct.reduce((s, v) => s + v, 0) / n;
  const eps = returnsPct.map((r) => r - mu);
  const sampleVar = eps.reduce((s, v) => s + v * v, 0) / n;

  const negLogLik = (params: number[]): number => {
    const [omega, alpha, rawBeta, gammaP] = params;
    const beta = Math.tanh(rawBeta) * 0.999;
    let logSigma2 = Math.log(sampleVar);
    let ll = 0;
    for (let t = 0; t < n; t++) {
      if (t > 0) {
        const sigmaPrev = Math.sqrt(Math.exp(logSigma2));
        const z = eps[t - 1] / (sigmaPrev || 1e-8);
        logSigma2 = omega + beta * logSigma2 + alpha * (Math.abs(z) - E_ABS_Z) + gammaP * z;
      }
      const sigma2 = Math.exp(logSigma2);
      if (!Number.isFinite(sigma2) || sigma2 <= 0) return 1e10;
      ll += -0.5 * Math.log(2 * Math.PI) - 0.5 * Math.log(sigma2) - 0.5 * (eps[t] * eps[t]) / sigma2;
    }
    return -ll;
  };

  const fitted = nelderMead(negLogLik, [Math.log(sampleVar) * 0.1, 0.1, 0.5, -0.05], 2000);
  const [omega, alpha, rawBeta, gamma] = fitted.params;
  const beta = Math.tanh(rawBeta) * 0.999;

  const conditionalVariances: number[] = [sampleVar];
  let logSigma2 = Math.log(sampleVar);
  for (let t = 1; t < n; t++) {
    const sigmaPrev = Math.sqrt(Math.exp(logSigma2));
    const z = eps[t - 1] / (sigmaPrev || 1e-8);
    logSigma2 = omega + beta * logSigma2 + alpha * (Math.abs(z) - E_ABS_Z) + gamma * z;
    conditionalVariances.push(Math.exp(logSigma2));
  }

  return { omega, alpha, beta, gamma, mu, conditionalVariances, persistence: beta, leverageEffect: gamma, logLikelihood: -fitted.value };
}

// ── Nelson-Siegel / Svensson yield curve fitting ───────────────────────────
// y(τ) = β0 + β1·slope(τ,λ) + β2·curve(τ,λ)                     (Nelson-Siegel)
// y(τ) = β0 + β1·slope(τ,λ1) + β2·curve(τ,λ1) + β3·curve(τ,λ2)  (Svensson)
// β0 = long-run level, β1 = slope (short-rate deviation from level),
// β2/β3 = curvature (hump) loadings, λ = decay rate governing where the
// curvature loading peaks. No closed form for the nonlinear λ, so we fit
// all parameters jointly via Nelder-Mead minimizing SSE against the
// observed tenors; λ is reparametrized through softplus to stay positive.

function nsSlope(tau: number, lambda: number): number {
  const x = tau / lambda;
  if (x < 1e-8) return 1; // limit as τ→0
  return (1 - Math.exp(-x)) / x;
}
function nsCurve(tau: number, lambda: number): number {
  const x = tau / lambda;
  if (x < 1e-8) return 0; // limit as τ→0
  return (1 - Math.exp(-x)) / x - Math.exp(-x);
}
const softplusPositive = (x: number): number => Math.log(1 + Math.exp(x)) + 0.05;

export interface NelsonSiegelFit {
  beta0: number; beta1: number; beta2: number;
  lambda: number;
  fitted: (maturityYears: number) => number;
  rmse: number; // fit error, in the same units as the input yields (e.g. percent)
}

export function fitNelsonSiegel(points: { maturity: number; yield: number }[]): NelsonSiegelFit {
  if (points.length < 4) throw new Error(`Need at least 4 tenor points to fit Nelson-Siegel, got ${points.length}`);

  const objective = (raw: number[]): number => {
    const [beta0, beta1, beta2, rawLambda] = raw;
    const lambda = softplusPositive(rawLambda);
    let sse = 0;
    for (const p of points) {
      const fit = beta0 + beta1 * nsSlope(p.maturity, lambda) + beta2 * nsCurve(p.maturity, lambda);
      sse += (fit - p.yield) ** 2;
    }
    return sse;
  };

  const longEnd = points[points.length - 1].yield;
  const shortEnd = points[0].yield;
  const fitted = nelderMead(objective, [longEnd, shortEnd - longEnd, 0, Math.log(Math.exp(2) - 1)], 3000, 1e-12);
  const [beta0, beta1, beta2, rawLambda] = fitted.params;
  const lambda = softplusPositive(rawLambda);

  return {
    beta0, beta1, beta2, lambda,
    fitted: (maturityYears: number) => beta0 + beta1 * nsSlope(maturityYears, lambda) + beta2 * nsCurve(maturityYears, lambda),
    rmse: Math.sqrt(fitted.value / points.length),
  };
}

export interface SvenssonFit {
  beta0: number; beta1: number; beta2: number; beta3: number;
  lambda1: number; lambda2: number;
  fitted: (maturityYears: number) => number;
  rmse: number;
}

// Svensson (1994) extends Nelson-Siegel with a second curvature hump at an
// independent decay rate λ2 -- captures curves with two humps (e.g. a belly
// bump plus a long-end bump), which plain NS cannot fit.
export function fitSvensson(points: { maturity: number; yield: number }[]): SvenssonFit {
  if (points.length < 6) throw new Error(`Need at least 6 tenor points to fit Svensson, got ${points.length}`);

  const objective = (raw: number[]): number => {
    const [beta0, beta1, beta2, beta3, rawLambda1, rawLambda2] = raw;
    const lambda1 = softplusPositive(rawLambda1);
    const lambda2 = softplusPositive(rawLambda2);
    let sse = 0;
    for (const p of points) {
      const fit = beta0 + beta1 * nsSlope(p.maturity, lambda1) + beta2 * nsCurve(p.maturity, lambda1) + beta3 * nsCurve(p.maturity, lambda2);
      sse += (fit - p.yield) ** 2;
    }
    return sse;
  };

  const longEnd = points[points.length - 1].yield;
  const shortEnd = points[0].yield;
  const initial = [longEnd, shortEnd - longEnd, 0, 0, Math.log(Math.exp(1) - 1), Math.log(Math.exp(5) - 1)];
  const fitted = nelderMead(objective, initial, 4000, 1e-12);
  const [beta0, beta1, beta2, beta3, rawLambda1, rawLambda2] = fitted.params;
  const lambda1 = softplusPositive(rawLambda1);
  const lambda2 = softplusPositive(rawLambda2);

  return {
    beta0, beta1, beta2, beta3, lambda1, lambda2,
    fitted: (maturityYears: number) => beta0 + beta1 * nsSlope(maturityYears, lambda1) + beta2 * nsCurve(maturityYears, lambda1) + beta3 * nsCurve(maturityYears, lambda2),
    rmse: Math.sqrt(fitted.value / points.length),
  };
}

// ── Holt-Winters exponential smoothing (level + trend + optional seasonal) ─
// seasonPeriod=0 (or seasonal="none") reduces to Holt's linear method
// (double exponential smoothing). Smoothing parameters alpha/beta/gamma are
// fit by minimizing one-step-ahead SSE via Nelder-Mead (reparametrized
// through a sigmoid to stay in [0,1]) rather than fixed by hand.

export interface HoltWintersFit {
  alpha: number; beta: number; gamma: number;
  seasonPeriod: number; seasonal: "additive" | "multiplicative" | "none";
  level: number; trend: number; season: number[]; // final state, used to seed forecasting
  fitted: number[]; // one-step-ahead in-sample fitted values (NaN during init burn-in)
  sse: number;
}

const sigmoid01 = (x: number): number => 1 / (1 + Math.exp(-x));

export function fitHoltWinters(
  series: number[],
  seasonPeriod = 0,
  seasonal: "additive" | "multiplicative" | "none" = seasonPeriod > 1 ? "additive" : "none"
): HoltWintersFit {
  const n = series.length;
  const m = seasonal === "none" ? 0 : seasonPeriod;
  if (m > 0 && n < 2 * m) throw new Error(`Need at least ${2 * m} observations for seasonal period ${m}, got ${n}`);
  if (n < 10) throw new Error(`Need at least 10 observations to fit Holt-Winters, got ${n}`);

  const run = (alpha: number, beta: number, gamma: number) => {
    let level = m > 0 ? series.slice(0, m).reduce((s, v) => s + v, 0) / m : series[0];
    let trend = m > 0
      ? (series.slice(m, 2 * m).reduce((s, v) => s + v, 0) / m - level) / m
      : series[1] - series[0];
    const season: number[] = m > 0
      ? series.slice(0, m).map((v) => (seasonal === "multiplicative" ? v / level : v - level))
      : [];

    const fitted: number[] = [];
    let sse = 0;
    const burnIn = m > 0 ? m : 1;
    for (let t = 0; t < n; t++) {
      const s = m > 0 ? season[t % m] : seasonal === "multiplicative" ? 1 : 0;
      const forecast = seasonal === "multiplicative" ? (level + trend) * s : level + trend + s;
      if (t >= burnIn) {
        fitted.push(forecast);
        sse += (series[t] - forecast) ** 2;
      } else {
        fitted.push(NaN);
      }

      const y = series[t];
      const prevLevel = level;
      if (m > 0 && seasonal === "multiplicative") level = alpha * (y / s) + (1 - alpha) * (level + trend);
      else if (m > 0) level = alpha * (y - s) + (1 - alpha) * (level + trend);
      else level = alpha * y + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      if (m > 0) {
        season[t % m] = seasonal === "multiplicative"
          ? gamma * (y / level) + (1 - gamma) * s
          : gamma * (y - level) + (1 - gamma) * s;
      }
    }
    return { level, trend, season: [...season], fitted, sse };
  };

  const objective = (raw: number[]): number => {
    const alpha = sigmoid01(raw[0]);
    const beta = sigmoid01(raw[1] ?? 0);
    const gamma = m > 0 ? sigmoid01(raw[2] ?? 0) : 0;
    const result = run(alpha, beta, gamma);
    return Number.isFinite(result.sse) ? result.sse : 1e12;
  };

  const initial = m > 0 ? [0, 0, 0] : [0, 0];
  const optimized = nelderMead(objective, initial, 1500, 1e-12);
  const alpha = sigmoid01(optimized.params[0]);
  const beta = sigmoid01(optimized.params[1] ?? 0);
  const gamma = m > 0 ? sigmoid01(optimized.params[2] ?? 0) : 0;
  const final = run(alpha, beta, gamma);

  return { alpha, beta, gamma, seasonPeriod: m, seasonal, level: final.level, trend: final.trend, season: final.season, fitted: final.fitted, sse: final.sse };
}

export function forecastHoltWinters(fit: HoltWintersFit, horizon: number): number[] {
  const { level, trend, season, seasonPeriod: m, seasonal } = fit;
  const forecasts: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const s = m > 0 ? season[(m + ((h - 1) % m)) % m] : seasonal === "multiplicative" ? 1 : 0;
    forecasts.push(seasonal === "multiplicative" ? (level + h * trend) * s : level + h * trend + s);
  }
  return forecasts;
}

// ── ARIMA(p,d,q): AutoRegressive Integrated Moving Average ────────────────
// Difference d times to induce stationarity, then fit AR(p)/MA(q) on the
// differenced series by conditional sum-of-squares (CSS, standard practical
// alternative to full Kalman-filter MLE) minimized via Nelder-Mead.
// Forecasts recursively project the fitted ARMA model forward (future
// innovations set to their expectation, zero) and re-integrate the d
// differences via cumulative summation from the last known level(s).

export interface ARIMAFit {
  p: number; d: number; q: number;
  mu: number; phi: number[]; theta: number[];
  residuals: number[]; // CSS residuals on the differenced series
  sse: number; aicc: number;
  lastDiff: number[];       // last p values of the d-times-differenced series
  lastResiduals: number[];  // last q CSS residuals
  integrationTail: number[]; // last value at each differencing level 0..d-1, for re-integration
}

function differenceOnce(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push(series[i] - series[i - 1]);
  return out;
}

function differenceLevels(series: number[], d: number): number[][] {
  const levels: number[][] = [series];
  for (let i = 0; i < d; i++) levels.push(differenceOnce(levels[levels.length - 1]));
  return levels; // levels[0] = original, levels[d] = fully differenced series used for the ARMA fit
}

export function fitARIMA(series: number[], p: number, d: number, q: number): ARIMAFit {
  const levels = differenceLevels(series, d);
  const w = levels[d];
  const n = w.length;
  if (n < p + q + 10) throw new Error(`Not enough observations after differencing to fit ARIMA(${p},${d},${q}): ${n}`);
  const mu0 = w.reduce((s, v) => s + v, 0) / n;

  const css = (params: number[]): { sse: number; residuals: number[] } => {
    const mu = params[0];
    const phi = params.slice(1, 1 + p);
    const theta = params.slice(1 + p, 1 + p + q);
    const eps: number[] = new Array(n).fill(0);
    let sse = 0;
    for (let t = 0; t < n; t++) {
      let pred = mu;
      for (let i = 0; i < p; i++) pred += phi[i] * ((t - 1 - i >= 0 ? w[t - 1 - i] : mu) - mu);
      for (let j = 0; j < q; j++) pred += theta[j] * (t - 1 - j >= 0 ? eps[t - 1 - j] : 0);
      eps[t] = w[t] - pred;
      if (t >= Math.max(p, q)) sse += eps[t] * eps[t]; // exclude burn-in lags, standard CSS
    }
    return { sse, residuals: eps };
  };

  const objective = (params: number[]): number => {
    const { sse } = css(params);
    return Number.isFinite(sse) ? sse : 1e12;
  };

  const initial = [mu0, ...new Array(p).fill(0), ...new Array(q).fill(0)];
  const fitted = p + q > 0 ? nelderMead(objective, initial, 2000, 1e-12) : { params: initial, value: css(initial).sse };
  const mu = fitted.params[0];
  const phi = fitted.params.slice(1, 1 + p);
  const theta = fitted.params.slice(1 + p, 1 + p + q);
  const { sse, residuals } = css(fitted.params);

  const k = 1 + p + q;
  const effectiveN = n - Math.max(p, q);
  const logLikApprox = -0.5 * effectiveN * (Math.log(2 * Math.PI) + Math.log(Math.max(sse, 1e-12) / effectiveN) + 1);
  const aicc = -2 * logLikApprox + (2 * k * effectiveN) / Math.max(1, effectiveN - k - 1);

  return {
    p, d, q, mu, phi, theta, residuals, sse, aicc,
    lastDiff: p > 0 ? w.slice(-p) : [],
    lastResiduals: q > 0 ? residuals.slice(-q) : [],
    integrationTail: d > 0 ? levels.slice(0, d).map((lv) => lv[lv.length - 1]) : [],
  };
}

export function forecastARIMA(fit: ARIMAFit, horizon: number): number[] {
  const { p, q, d, mu, phi, theta } = fit;
  const w = [...fit.lastDiff];
  const eps = [...fit.lastResiduals];
  const diffForecasts: number[] = [];

  for (let h = 0; h < horizon; h++) {
    let pred = mu;
    for (let i = 0; i < p; i++) pred += phi[i] * ((w[w.length - 1 - i] ?? mu) - mu);
    for (let j = 0; j < q; j++) pred += theta[j] * (eps[eps.length - 1 - j] ?? 0);
    w.push(pred);
    eps.push(0); // future innovations have expectation zero
    diffForecasts.push(pred);
  }

  let cur = diffForecasts;
  for (let level = d - 1; level >= 0; level--) {
    let running = fit.integrationTail[level];
    const next: number[] = [];
    for (const v of cur) { running += v; next.push(running); }
    cur = next;
  }
  return cur;
}

// Simplified Dickey-Fuller unit-root test: regress Δy_t on [1, y_{t-1}] and
// reject the unit-root null (i.e. call the series stationary) if the t-stat
// on y_{t-1} is below the approximate 5% critical value. AICc computed on a
// d-times-differenced series is NOT comparable to AICc on a different d --
// differencing changes what "the data" is, so the likelihoods aren't on the
// same scale -- so d must be pinned down by a stationarity test first
// (standard Hyndman-Khandakar approach), and only p,q searched by AICc.
function isStationaryADF(series: number[]): boolean {
  const n = series.length;
  if (n < 20) return true; // too little data to test meaningfully -- don't over-difference
  const y = series.slice(0, n - 1);
  const dy = differenceOnce(series);
  const nObs = dy.length;
  const meanY = y.reduce((s, v) => s + v, 0) / nObs;
  const meanDy = dy.reduce((s, v) => s + v, 0) / nObs;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < nObs; i++) { sxx += (y[i] - meanY) ** 2; sxy += (y[i] - meanY) * (dy[i] - meanDy); }
  if (sxx < 1e-12) return true; // constant series -- nothing left to difference away
  const beta = sxy / sxx;
  const alpha = meanDy - beta * meanY;
  let sse = 0;
  for (let i = 0; i < nObs; i++) { const resid = dy[i] - (alpha + beta * y[i]); sse += resid * resid; }
  const sigma2 = sse / (nObs - 2);
  const tStat = beta / Math.sqrt(sigma2 / sxx);
  return tStat < -2.86; // MacKinnon approx. 5% critical value, constant-only case
}

function selectDifferencingOrder(series: number[], maxD: number): number {
  let w = series;
  for (let d = 0; d < maxD; d++) {
    if (isStationaryADF(w)) return d;
    w = differenceOnce(w);
  }
  return maxD;
}

// Small-grid order search: pin down d via the ADF test above, then search
// (p,q) by corrected AIC (AICc) at that fixed d. Not a full stepwise/
// Hyndman-Khandakar auto.arima, but statistically sound (unlike searching d
// by AICc directly) and fine at the (p,q) sizes financial series typically need.
export function autoARIMA(series: number[], maxP = 2, maxD = 1, maxQ = 2): ARIMAFit {
  const d = selectDifferencingOrder(series, maxD);
  let best: ARIMAFit | null = null;
  for (let p = 0; p <= maxP; p++) {
    for (let q = 0; q <= maxQ; q++) {
      if (p === 0 && q === 0) continue; // pure-integration-only model isn't a useful forecast
      try {
        const candidate = fitARIMA(series, p, d, q);
        if (!best || candidate.aicc < best.aicc) best = candidate;
      } catch {
        // insufficient data / degenerate fit for this order -- skip
      }
    }
  }
  if (!best) throw new Error("autoARIMA: no valid (p,d,q) order could be fit to this series");
  return best;
}

// ── Systematic red-flag detection ───────────────────────────────────────
// Trend-based, multi-metric flags over real multi-year filed history (as
// opposed to Beneish/Sloan/Altman/Piotroski above, which score a single
// current-vs-prior comparison). Two spec items are deliberately NOT
// implemented here -- "Auditor Qualification" and "Accounting Policy
// Changes" -- since detecting either needs real filing *text* (audit
// opinion language, footnote diffs), which this app has no data source for;
// faking a flag from numbers alone for those two would be worse than
// omitting them.

export interface RedFlagPeriod {
  revenue?: number; netReceivables?: number; inventory?: number; costOfRevenue?: number;
  grossProfit?: number; totalLiabilities?: number; totalStockholdersEquity?: number;
  totalCurrentAssets?: number; totalCurrentLiabilities?: number;
}

export interface RedFlagResult {
  key: string;
  label: string;
  triggered: boolean;
  severity: "high" | "medium" | "low";
  detail: string;
}

function pctChange(latest: number | undefined, prior: number | undefined): number | null {
  if (latest === undefined || prior === undefined || prior === 0) return null;
  return (latest - prior) / Math.abs(prior);
}

// `periods` is most-recent-first (periods[0] = latest filed year). Needs at
// least 2 periods for the single-period checks and 3 for the trend checks;
// each flag independently reports itself as untriggered (not "unknown")
// when there isn't enough history for that specific check, same honesty
// convention as the rest of this app's overridable/optional-data patterns.
export function detectRedFlags(periods: RedFlagPeriod[]): RedFlagResult[] {
  const flags: RedFlagResult[] = [];
  const p0 = periods[0];
  const p1 = periods[1];
  const p2 = periods[2];

  // 1. Aggressive revenue recognition: receivables growing meaningfully
  // faster than revenue for two consecutive periods (a sustained DSRI
  // increase, not just one noisy quarter/year).
  {
    const revGrowth0 = pctChange(p0?.revenue, p1?.revenue);
    const recvGrowth0 = pctChange(p0?.netReceivables, p1?.netReceivables);
    const revGrowth1 = pctChange(p1?.revenue, p2?.revenue);
    const recvGrowth1 = pctChange(p1?.netReceivables, p2?.netReceivables);
    const gap0 = revGrowth0 !== null && recvGrowth0 !== null ? recvGrowth0 - revGrowth0 : null;
    const gap1 = revGrowth1 !== null && recvGrowth1 !== null ? recvGrowth1 - revGrowth1 : null;
    const triggered = gap0 !== null && gap1 !== null && gap0 > 0.15 && gap1 > 0.15;
    flags.push({
      key: "aggressiveRevRec", label: "Aggressive Revenue Recognition", triggered,
      severity: "high",
      detail: gap0 !== null ? `Receivables outgrew revenue by ${(gap0 * 100).toFixed(0)}pp last period${gap1 !== null ? ` (${(gap1 * 100).toFixed(0)}pp the period before)` : ""}` : "Not enough history",
    });
  }

  // 2. Inventory build-up: inventory growing meaningfully faster than COGS
  // for two consecutive periods -- goods piling up faster than they're sold.
  {
    const cogsGrowth0 = pctChange(p0?.costOfRevenue, p1?.costOfRevenue);
    const invGrowth0 = pctChange(p0?.inventory, p1?.inventory);
    const cogsGrowth1 = pctChange(p1?.costOfRevenue, p2?.costOfRevenue);
    const invGrowth1 = pctChange(p1?.inventory, p2?.inventory);
    const gap0 = cogsGrowth0 !== null && invGrowth0 !== null ? invGrowth0 - cogsGrowth0 : null;
    const gap1 = cogsGrowth1 !== null && invGrowth1 !== null ? invGrowth1 - cogsGrowth1 : null;
    const triggered = gap0 !== null && gap1 !== null && gap0 > 0.15 && gap1 > 0.15;
    flags.push({
      key: "inventoryBuildup", label: "Inventory Build-Up", triggered,
      severity: "medium",
      detail: gap0 !== null ? `Inventory outgrew cost of revenue by ${(gap0 * 100).toFixed(0)}pp last period` : "Not enough history",
    });
  }

  // 3. Receivable spike: a single large jump in receivables growth well
  // above revenue growth in the latest period alone -- distinct from #1,
  // which needs a sustained two-period trend.
  {
    const revGrowth0 = pctChange(p0?.revenue, p1?.revenue);
    const recvGrowth0 = pctChange(p0?.netReceivables, p1?.netReceivables);
    const triggered = recvGrowth0 !== null && recvGrowth0 > 0.30 && (revGrowth0 === null || recvGrowth0 > revGrowth0 * 2);
    flags.push({
      key: "receivableSpike", label: "Receivable Spike", triggered,
      severity: "medium",
      detail: recvGrowth0 !== null ? `Receivables grew ${(recvGrowth0 * 100).toFixed(0)}% in the latest period` : "Not enough history",
    });
  }

  // 4. Margin compression: gross margin declining for two consecutive periods.
  {
    const gm0 = p0?.revenue ? (p0.grossProfit ?? NaN) / p0.revenue : null;
    const gm1 = p1?.revenue ? (p1.grossProfit ?? NaN) / p1.revenue : null;
    const gm2 = p2?.revenue ? (p2.grossProfit ?? NaN) / p2.revenue : null;
    const triggered = gm0 !== null && gm1 !== null && gm2 !== null && !isNaN(gm0) && !isNaN(gm1) && !isNaN(gm2) && gm0 < gm1 && gm1 < gm2;
    flags.push({
      key: "marginCompression", label: "Margin Compression", triggered,
      severity: "medium",
      detail: gm0 !== null && gm1 !== null && !isNaN(gm0) && !isNaN(gm1) ? `Gross margin ${(gm0 * 100).toFixed(1)}% vs ${(gm1 * 100).toFixed(1)}% the prior period` : "Not enough history",
    });
  }

  // 5. Rising leverage: debt/equity increasing for two consecutive periods.
  {
    const de0 = p0?.totalStockholdersEquity ? (p0.totalLiabilities ?? NaN) / p0.totalStockholdersEquity : null;
    const de1 = p1?.totalStockholdersEquity ? (p1.totalLiabilities ?? NaN) / p1.totalStockholdersEquity : null;
    const de2 = p2?.totalStockholdersEquity ? (p2.totalLiabilities ?? NaN) / p2.totalStockholdersEquity : null;
    const triggered = de0 !== null && de1 !== null && de2 !== null && !isNaN(de0) && !isNaN(de1) && !isNaN(de2) && de0 > de1 && de1 > de2;
    flags.push({
      key: "risingLeverage", label: "Rising Leverage", triggered,
      severity: "medium",
      detail: de0 !== null && !isNaN(de0) ? `Debt/Equity ${de0.toFixed(2)}x, up from ${de1 !== null && !isNaN(de1) ? de1.toFixed(2) : "?"}x` : "Not enough history",
    });
  }

  // 6. Negative working capital trend: working capital is negative AND
  // getting worse period over period.
  {
    const wc0 = p0?.totalCurrentAssets !== undefined && p0?.totalCurrentLiabilities !== undefined ? p0.totalCurrentAssets - p0.totalCurrentLiabilities : null;
    const wc1 = p1?.totalCurrentAssets !== undefined && p1?.totalCurrentLiabilities !== undefined ? p1.totalCurrentAssets - p1.totalCurrentLiabilities : null;
    const triggered = wc0 !== null && wc1 !== null && wc0 < 0 && wc0 < wc1;
    flags.push({
      key: "negativeWorkingCapitalTrend", label: "Negative Working Capital Trend", triggered,
      severity: "low",
      detail: wc0 !== null ? `Working capital ${wc0 < 0 ? "negative" : "positive"}, ${wc1 !== null && wc0 < wc1 ? "worsening" : "improving"} vs prior period` : "Not enough history",
    });
  }

  return flags;
}

// ── Hidden Relationship Detector: residual (factor-adjusted) correlation ───
// A naive "these two move together" screen based on raw pairwise
// correlation conflates two very different things: (1) both assets loading
// on the same common factor -- e.g. both being high-beta tech names, which
// is exactly what PCA's leading components (PC1/PC2 above) already explain
// -- and (2) a genuine idiosyncratic co-movement that exists ON TOP OF
// whatever market/sector factor structure is present. This isolates (2):
// residualize each asset's returns against its regression exposure (beta)
// to the top-K principal-component factor scores (reusing the existing
// `pca`/`olsRegression` above -- no PCA or regression math reimplemented
// here), then Pearson-correlate the LEFTOVER (residual) series pairwise. A
// pair with small raw correlation but large residual correlation is a
// relationship a naive "they're both mega-cap tech" screen would miss
// entirely; a pair with large raw correlation that collapses toward zero
// after residualizing was never anything but shared factor exposure.
//
// Statistical significance of each residual correlation uses the standard
// Fisher (1921) z-transformation test: z = atanh(r) is approximately
// Normal with standard error 1/sqrt(n-3) under the null H0: rho=0, so
// z*sqrt(n-3) ~ N(0,1) and the two-tailed p-value is
// 2*(1 - Phi(|z*sqrt(n-3)|)), using the same stdNormCDF as the rest of
// this file's Normal-distribution math.

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom > 0 ? sxy / denom : 0;
}

// Two-tailed p-value for H0: population correlation = 0, via the Fisher
// z-transformation (valid for any n > 3; standard error is exact under the
// approximation, not simulated).
function fisherZPValue(r: number, n: number): number {
  if (n <= 3) return 1;
  const rClamped = Math.max(-0.999999, Math.min(0.999999, r));
  const z = Math.atanh(rClamped);
  const zStat = z * Math.sqrt(n - 3);
  return 2 * (1 - stdNormCDF(Math.abs(zStat)));
}

export interface HiddenRelationshipPair {
  assetA: string;
  assetB: string;
  rawCorrelation: number;         // naive pairwise Pearson correlation of the raw return series
  residualCorrelation: number;    // Pearson correlation AFTER removing each asset's top-K PCA factor exposure
  pValue: number;                 // two-tailed Fisher z-test p-value on the residual correlation
  isSignificant: boolean;         // pValue below the caller's significance level
}

export interface HiddenRelationshipResult {
  componentsUsed: number;                  // K, the number of leading principal components residualized out
  varianceExplainedByComponents: number;   // % of total variance those K components capture -- context for how much common structure was removed
  pairs: HiddenRelationshipPair[];         // every asset pair, sorted by |residualCorrelation| descending
}

// `assets[i]` labels `returnSeries[i]` (same row convention as `pca`/
// `computeCovarianceMatrix`: one row per asset, one column per period).
// `numComponents` defaults to 2 (matching the PCA tab's PC1/PC2 display)
// and is clamped to at most assets.length - 1 so at least one degree of
// idiosyncratic variation remains to correlate after residualizing.
export function detectHiddenRelationships(
  assets: string[],
  returnSeries: number[][],
  numComponents = 2,
  significanceLevel = 0.05,
): HiddenRelationshipResult {
  const m = assets.length;
  if (m !== returnSeries.length) throw new Error("detectHiddenRelationships: assets and returnSeries must be the same length");
  if (m < 3) throw new Error("detectHiddenRelationships: need at least 3 assets to separate common-factor structure from pairwise residual co-movement");
  const n = returnSeries[0]?.length ?? 0;
  const k = Math.max(1, Math.min(numComponents, m - 1));
  if (n < k + 4) throw new Error("detectHiddenRelationships: not enough observations for the requested number of components (need n >= k + 4 for a meaningful Fisher z-test)");

  const pcaResult = pca(returnSeries);
  const means = returnSeries.map((s) => s.reduce((a, b) => a + b, 0) / n);
  const centered = returnSeries.map((s, i) => s.map((v) => v - means[i]));

  // Factor score series for the top-k components: score_c(t) = sum_j eigenvector_c[j] * centered_j(t).
  const factorScores: number[][] = Array.from({ length: k }, (_, c) =>
    Array.from({ length: n }, (_, t) => centered.reduce((s, series, j) => s + pcaResult.eigenvectors[c][j] * series[t], 0)),
  );

  // Residualize each asset's raw returns against its OLS beta to the top-k factor scores.
  const residuals: number[][] = returnSeries.map((y) => {
    const reg = olsRegression(y, factorScores);
    return y.map((v, t) => v - reg.alpha - factorScores.reduce((s, col, c) => s + reg.betas[c] * col[t], 0));
  });

  const pairs: HiddenRelationshipPair[] = [];
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const rawCorrelation = pearsonCorrelation(returnSeries[i], returnSeries[j]);
      const residualCorrelation = pearsonCorrelation(residuals[i], residuals[j]);
      const pValue = fisherZPValue(residualCorrelation, n);
      pairs.push({ assetA: assets[i], assetB: assets[j], rawCorrelation, residualCorrelation, pValue, isSignificant: pValue < significanceLevel });
    }
  }
  pairs.sort((a, b) => Math.abs(b.residualCorrelation) - Math.abs(a.residualCorrelation));

  const varianceExplainedByComponents = pcaResult.varianceExplainedPct.slice(0, k).reduce((s, v) => s + v, 0);
  return { componentsUsed: k, varianceExplainedByComponents, pairs };
}
