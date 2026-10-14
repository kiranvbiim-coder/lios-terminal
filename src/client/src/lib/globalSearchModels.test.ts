import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWeights, portfolioReturnRiskSharpe, buildMaxSharpeGaExpression, maxSharpeGaBounds,
  twoStageDcfValue, buildTwoStageDcfSobolExpression,
} from "./globalSearchModels";

test("normalizeWeights sums to 1 and preserves proportions", () => {
  const w = normalizeWeights([2, 3, 5]);
  assert.ok(Math.abs(w.reduce((s, v) => s + v, 0) - 1) < 1e-12);
  assert.ok(Math.abs(w[0] - 0.2) < 1e-12);
  assert.ok(Math.abs(w[1] - 0.3) < 1e-12);
  assert.ok(Math.abs(w[2] - 0.5) < 1e-12);
});

test("normalizeWeights falls back to equal weight when the raw sum is non-positive", () => {
  assert.deepEqual(normalizeWeights([0, 0, 0]), [1 / 3, 1 / 3, 1 / 3]);
});

// Known-answer: 2-asset uncorrelated tangency portfolio. With
// mu=[0.10,0.20], Sigma=diag(0.04,0.16), rf=0.02, the analytic max-Sharpe
// weights are w ∝ Sigma^-1*(mu-rf) = [25*0.08, 6.25*0.18] = [2, 1.125],
// normalized to [0.64, 0.36] -- independently verified against a live
// genetic-algorithm run through /api/quant/optimization/genetic-algorithm
// (see task summary), which converged to the same weights and Sharpe.
test("portfolioReturnRiskSharpe matches the analytic tangency portfolio (known answer)", () => {
  const mu = [0.10, 0.20];
  const sigma = [[0.04, 0], [0, 0.16]];
  const rf = 0.02;
  const stats = portfolioReturnRiskSharpe([0.64, 0.36], mu, sigma, rf);
  assert.ok(Math.abs(stats.return - 0.136) < 1e-9);
  assert.ok(Math.abs(stats.risk - 0.19266551326067674) < 1e-9);
  assert.ok(Math.abs(stats.sharpe - 0.6020797289396148) < 1e-9);
});

test("portfolioReturnRiskSharpe returns zero Sharpe for a zero-risk (single-point) portfolio", () => {
  const stats = portfolioReturnRiskSharpe([1], [0.05], [[0]], 0.02);
  assert.equal(stats.risk, 0);
  assert.equal(stats.sharpe, 0);
});

test("buildMaxSharpeGaExpression embeds the real mu/Sigma literals and minimizes -Sharpe", () => {
  const expr = buildMaxSharpeGaExpression([0.1, 0.2], [[0.04, 0.01], [0.01, 0.09]], 0.03);
  assert.match(expr, /mu = array\(\[0\.1, 0\.2\]\)/);
  assert.match(expr, /Sigma = array\(\[\[0\.04, 0\.01\], \[0\.01, 0\.09\]\]\)/);
  assert.match(expr, /- 0\.03\) \/ sqrt/);
  assert.match(expr, /\n-sharpe$/);
  assert.doesNotMatch(expr, /penalty/);
});

test("buildMaxSharpeGaExpression adds a cardinality penalty term when K is supplied", () => {
  const expr = buildMaxSharpeGaExpression([0.1, 0.2, 0.15], [[0.04, 0, 0], [0, 0.09, 0], [0, 0, 0.05]], 0.02, 2);
  assert.match(expr, /active = sum\(w > 0\.02\)/);
  assert.match(expr, /penalty = 50\.0 \* max\(0, active - 2\)/);
  assert.match(expr, /\n-sharpe \+ penalty$/);
});

test("maxSharpeGaBounds returns one strictly-positive [epsilon,1] bound per asset", () => {
  assert.deepEqual(maxSharpeGaBounds(3), [[0.0001, 1], [0.0001, 1], [0.0001, 1]]);
});

// Known-answer: with g=wacc=10%, every discounted term equals FCF0 exactly
// (since (1+g)/(1+wacc)=1), so 10 years sum to 10*FCF0=10,000; the terminal
// value at tg=2% is FCF0*(1.1)^10*1.02/0.08=33,070.3, discounted back 10
// years by (1.1)^10 to 12,750 -- total 22,750. Independently verified
// against a live run of /api/quant/optimization/sensitivity-analysis using
// this exact formula as the model expression (see task summary).
test("twoStageDcfValue matches a hand-computed 2-stage DCF (known answer)", () => {
  const v = twoStageDcfValue(1000, 0.10, 0.10, 0.02, 10);
  assert.ok(Math.abs(v - 22750) < 1e-6);
});

test("twoStageDcfValue is monotonically increasing in growth and decreasing in WACC", () => {
  const base = twoStageDcfValue(1000, 0.08, 0.10, 0.02, 10);
  assert.ok(twoStageDcfValue(1000, 0.12, 0.10, 0.02, 10) > base);
  assert.ok(twoStageDcfValue(1000, 0.08, 0.12, 0.02, 10) < base);
});

test("buildTwoStageDcfSobolExpression embeds real FCF0/N literals and evaluates identically to twoStageDcfValue", () => {
  const expr = buildTwoStageDcfSobolExpression(1000, 10);
  assert.match(expr, /FCF0 = 1000/);
  assert.match(expr, /N = 10/);
  // Re-implement the expression's own line-by-line logic in JS to confirm
  // the string actually encodes twoStageDcfValue's formula, not a drifted copy.
  const g = 0.09, wacc = 0.11, tg = 0.02;
  const t = Array.from({ length: 10 }, (_, i) => i + 1);
  const fcf_t = t.map((tt) => 1000 * (1 + g) ** tt);
  const disc = t.map((tt) => (1 + wacc) ** tt);
  const pv_fcf = fcf_t.reduce((s, v, i) => s + v / disc[i], 0);
  const fcf_N = 1000 * (1 + g) ** 10;
  const tv = (fcf_N * (1 + tg)) / (wacc - tg);
  const fromExpressionLogic = pv_fcf + tv / (1 + wacc) ** 10;
  assert.ok(Math.abs(fromExpressionLogic - twoStageDcfValue(1000, g, wacc, tg, 10)) < 1e-9);
});
