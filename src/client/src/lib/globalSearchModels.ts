// Pure helpers behind two "dark capability" wiring jobs: the Portfolio
// Optimizer's genetic-algorithm global-search cross-check and the
// Valuation panel's Sobol global-sensitivity DCF. Both features POST a
// real objective/model *expression string* to the live
// /api/quant/optimization/{genetic-algorithm,sensitivity-analysis} routes
// (python-service/optimization_engine.py, asteval-evaluated, real pymoo
// GA / SALib Sobol under the hood) -- these helpers build those
// literal-substituted expression strings and score results client-side
// with the exact same closed-form math the server-side asteval expression
// encodes, so the UI never has to trust an opaque server number without a
// locally re-derivable formula behind it.

// ── Portfolio: Max-Sharpe objective for the GA cross-check ─────────────────

export interface PortfolioStats { return: number; risk: number; sharpe: number }

/** Normalizes a raw (possibly non-normalized, non-negative-in-spirit) weight
 * vector to sum to 1. Negative raw entries are clamped to 0 first -- the GA
 * bounds already keep x strictly positive, but this stays defensive for any
 * future caller. */
export function normalizeWeights(raw: number[]): number[] {
  const clamped = raw.map((v) => Math.max(v, 0));
  const sum = clamped.reduce((s, v) => s + v, 0);
  if (sum <= 0) return raw.map(() => 1 / raw.length);
  return clamped.map((v) => v / sum);
}

/** Real portfolio return/risk/Sharpe from weights, expected returns (mu),
 * and a covariance matrix (Sigma) -- the same w^T*Sigma*w / w.mu math used
 * throughout PortfolioOptimizerPanel's Monte-Carlo frontier, applied here to
 * whatever weight vector the caller (Monte-Carlo sample or GA) produced. */
export function portfolioReturnRiskSharpe(weights: number[], mu: number[], sigma: number[][], rf: number): PortfolioStats {
  const n = weights.length;
  let ret = 0;
  for (let i = 0; i < n; i++) ret += weights[i] * mu[i];
  let variance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) variance += weights[i] * weights[j] * sigma[i][j];
  }
  const risk = Math.sqrt(Math.max(variance, 0));
  const sharpe = risk > 0 ? (ret - rf) / risk : 0;
  return { return: ret, risk, sharpe };
}

// JS `String(number)` round-trips through Python's float() parser used by
// asteval (both use the shortest-round-trip decimal representation), so
// this is a lossless literal, not a display-rounded approximation.
function lit(v: number): string {
  return Number.isFinite(v) ? String(v) : "0";
}

/** Builds a maximize-Sharpe objective (expressed as MINIMIZE -Sharpe, since
 * the GA route always minimizes) with the real numeric mu vector and
 * covariance matrix substituted in as literals. `x` (the GA's decision
 * vector) is treated as raw non-negative weights and normalized inside the
 * expression, so bounds can stay simple ([epsilon, 1] per asset) while the
 * portfolio constraint sum(w)=1 is enforced structurally rather than via a
 * penalty. An optional cardinality constraint ("at most K of N assets") is
 * encoded as a penalty term -- a hard combinatorial constraint closed-form
 * mean-variance optimization cannot express at all. */
export function buildMaxSharpeGaExpression(mu: number[], sigma: number[][], rf: number, cardinalityK?: number): string {
  const muLit = `array([${mu.map(lit).join(", ")}])`;
  const sigmaLit = `array([${sigma.map((row) => `[${row.map(lit).join(", ")}]`).join(", ")}])`;
  const lines = [
    `mu = ${muLit}`,
    `Sigma = ${sigmaLit}`,
    `w = x / (sum(x) + 1e-9)`,
    `ret = sum(w * mu)`,
    `var = dot(w, dot(Sigma, w))`,
    `sharpe = (ret - ${lit(rf)}) / sqrt(var + 1e-12)`,
  ];
  if (cardinalityK !== undefined && cardinalityK > 0) {
    lines.push(`active = sum(w > 0.02)`);
    lines.push(`penalty = 50.0 * max(0, active - ${lit(cardinalityK)})`);
    lines.push(`-sharpe + penalty`);
  } else {
    lines.push(`-sharpe`);
  }
  return lines.join("\n");
}

/** Per-asset GA search bounds: strictly positive raw weight in [epsilon, 1],
 * normalized inside the expression itself (see buildMaxSharpeGaExpression). */
export function maxSharpeGaBounds(n: number): [number, number][] {
  return Array.from({ length: n }, () => [0.0001, 1] as [number, number]);
}

// ── Valuation: closed-form 2-stage DCF for the Sobol sensitivity study ─────

/** Real closed-form 2-stage DCF: N years of FCF growing at a constant rate
 * `growth`, discounted at `wacc`, plus a Gordon-growth terminal value on
 * year N's FCF at `termGrowth`. This is a deliberate single-growth-rate
 * simplification of the full multi-year worksheet (each of which has its
 * own margin/growth/capex assumptions) -- the right level of detail for a
 * 3-parameter global sensitivity study, not a replacement for the detailed
 * worksheet. */
export function twoStageDcfValue(fcf0: number, growth: number, wacc: number, termGrowth: number, forecastYears: number): number {
  let pv = 0;
  for (let t = 1; t <= forecastYears; t++) {
    pv += (fcf0 * Math.pow(1 + growth, t)) / Math.pow(1 + wacc, t);
  }
  const fcfN = fcf0 * Math.pow(1 + growth, forecastYears);
  const tv = (fcfN * (1 + termGrowth)) / (wacc - termGrowth);
  return pv + tv / Math.pow(1 + wacc, forecastYears);
}

/** Same formula as twoStageDcfValue, built as an asteval expression string
 * over x=[growth, wacc, termGrowth] with the real FCF0 base and forecast
 * horizon substituted in as literals, for the Sobol sensitivity-analysis
 * route. */
export function buildTwoStageDcfSobolExpression(fcf0: number, forecastYears: number): string {
  return [
    `g = x[0]`,
    `wacc = x[1]`,
    `tg = x[2]`,
    `FCF0 = ${lit(fcf0)}`,
    `N = ${lit(forecastYears)}`,
    `t = arange(1, N + 1)`,
    `fcf_t = FCF0 * (1 + g) ** t`,
    `disc = (1 + wacc) ** t`,
    `pv_fcf = sum(fcf_t / disc)`,
    `fcf_N = FCF0 * (1 + g) ** N`,
    `tv = fcf_N * (1 + tg) / (wacc - tg)`,
    `pv_fcf + tv / (1 + wacc) ** N`,
  ].join("\n");
}
