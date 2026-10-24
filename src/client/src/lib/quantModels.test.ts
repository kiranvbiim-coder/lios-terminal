import test from "node:test";
import assert from "node:assert/strict";
import { detectHiddenRelationships, monteCarloVaR } from "./quantModels";

// ─── Hidden Relationship Detector (residual correlation + Fisher z-test) ───

// Deterministic PRNG (mulberry32) so the synthetic dataset -- and therefore
// the assertions below -- is exactly reproducible across runs.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng: () => number): number {
  const u1 = rng() || 1e-9, u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Construct a 6-asset return matrix with three independent, orthogonal
// shock sources of DELIBERATELY different magnitude:
//   - `market`  (amplitude 1.0): affects A, B, C, D, E -- the largest
//     source of shared variance, so it becomes PC1.
//   - `sector`  (amplitude 0.7): affects only A, B, C -- the second-largest
//     source of shared variance (present in 3 of 6 assets, still bigger
//     than any per-asset idiosyncratic noise), so it becomes PC2.
//   - `hidden`  (amplitude 0.25): affects ONLY D and E -- deliberately
//     smaller than both market and sector, and present in just 2 of 6
//     assets, so it is NOT captured by the top-2 principal components. It
//     is exactly the kind of leftover, sub-dominant co-movement a raw
//     correlation screen conflates with shared market/sector exposure but
//     a residual-correlation screen isolates.
// F carries a small amount of purely idiosyncratic noise, uncorrelated with
// every shock above and every other asset, and serves as the
// independent-noise negative control for every pair it appears in.
//
// Because A/B/C share BOTH market and sector, their pairwise RAW
// correlation is higher than D/E's raw correlation (D/E share only market
// plus the small hidden shock) -- so a naive raw-correlation ranking puts
// an A/B/C pair above D-E. After residualizing out the top-2 PCA
// components (market + sector), A/B/C's shared structure is mostly
// explained away (residual correlation shrinks well below its raw value),
// while D-E's un-modeled hidden shock survives essentially undiminished as
// a statistically significant residual correlation -- flipping the
// ranking to put D-E first, which is exactly the scenario this detector
// exists to surface.
function buildSyntheticDataset(n = 400) {
  const rng = mulberry32(20260830);
  const market = Array.from({ length: n }, () => gaussian(rng) * 1.0);
  const sector = Array.from({ length: n }, () => gaussian(rng) * 0.7);
  const hidden = Array.from({ length: n }, () => gaussian(rng) * 0.25);
  const noiseA = Array.from({ length: n }, () => gaussian(rng) * 0.4);
  const noiseB = Array.from({ length: n }, () => gaussian(rng) * 0.4);
  const noiseC = Array.from({ length: n }, () => gaussian(rng) * 0.4);
  const noiseD = Array.from({ length: n }, () => gaussian(rng) * 0.4);
  const noiseE = Array.from({ length: n }, () => gaussian(rng) * 0.4);
  const noiseF = Array.from({ length: n }, () => gaussian(rng) * 0.2); // small purely idiosyncratic noise -- no shared factor with anyone

  const A = market.map((m, t) => m + sector[t] + noiseA[t]);
  const B = market.map((m, t) => m + sector[t] + noiseB[t]);
  const C = market.map((m, t) => m + sector[t] + noiseC[t]);
  const D = market.map((m, t) => m + hidden[t] + noiseD[t]);
  const E = market.map((m, t) => m + hidden[t] + noiseE[t]);
  const F = noiseF;

  return { assets: ["A", "B", "C", "D", "E", "F"], returnSeries: [A, B, C, D, E, F] };
}

test("hidden relationship detector: flags the sub-dominant D-E shock the top-2 PCA components miss", () => {
  const { assets, returnSeries } = buildSyntheticDataset();
  const result = detectHiddenRelationships(assets, returnSeries, 2, 0.05);

  const findPair = (a: string, b: string) =>
    result.pairs.find((p) => (p.assetA === a && p.assetB === b) || (p.assetA === b && p.assetB === a))!;

  const de = findPair("D", "E");
  const ab = findPair("A", "B");

  // Known-answer construction check #1: raw correlation ranks A-B (shared
  // market+sector) ABOVE D-E (shared market + small hidden shock only) --
  // this is what a naive raw-correlation screen would rank first.
  assert.ok(ab.rawCorrelation > de.rawCorrelation, `expected raw corr(A,B)=${ab.rawCorrelation} > raw corr(D,E)=${de.rawCorrelation}`);

  // Known-answer construction check #2: after residualizing against the
  // top-2 principal components, A-B's shared structure is mostly explained
  // away while D-E's un-modeled hidden shock survives -- the ranking flips.
  assert.ok(Math.abs(de.residualCorrelation) > Math.abs(ab.residualCorrelation),
    `expected |residual corr(D,E)|=${de.residualCorrelation} > |residual corr(A,B)|=${ab.residualCorrelation}`);
  assert.ok(Math.abs(ab.residualCorrelation) < Math.abs(ab.rawCorrelation) * 0.7,
    `A-B residual correlation should shrink well below its raw value once market+sector are removed, raw=${ab.rawCorrelation} residual=${ab.residualCorrelation}`);

  // The detector must actually flag D-E as significant...
  assert.ok(de.isSignificant, `expected D-E to be flagged significant, pValue=${de.pValue}`);
  assert.ok(de.pValue < 0.05);
  assert.ok(Math.abs(de.residualCorrelation) > 0.2, `expected a real residual signal for D-E, got ${de.residualCorrelation}`);

  // ...and D-E must be the top-ranked pair by |residual correlation| (list
  // is sorted descending in that field).
  assert.equal(result.pairs[0].assetA === "D" || result.pairs[0].assetB === "D", true);
  assert.equal(result.pairs[0].assetA === "E" || result.pairs[0].assetB === "E", true);
  for (let i = 1; i < result.pairs.length; i++) {
    assert.ok(Math.abs(result.pairs[i - 1].residualCorrelation) >= Math.abs(result.pairs[i].residualCorrelation));
  }

  // Independent-noise control pair: F shares no factor with anyone, so
  // neither its raw NOR its residual correlation with any other asset
  // should be flagged significant.
  const controlPairs = result.pairs.filter((p) => p.assetA === "F" || p.assetB === "F");
  assert.equal(controlPairs.length, 5);
  for (const p of controlPairs) {
    assert.equal(p.isSignificant, false, `independent-noise control pair ${p.assetA}-${p.assetB} should not be flagged significant (pValue=${p.pValue})`);
  }

  assert.equal(result.componentsUsed, 2);
  assert.ok(result.varianceExplainedByComponents > 50, "market+sector should dominate total variance");
});

test("hidden relationship detector: validates inputs", () => {
  assert.throws(() => detectHiddenRelationships(["A", "B"], [[1, 2, 3], [1, 2, 3]], 1, 0.05));
  assert.throws(() => detectHiddenRelationships(["A", "B", "C"], [[1, 2], [1, 2]], 1, 0.05));
});

test("original Monte Carlo VaR replays its seed and scales with stated notional", () => {
  const value = monteCarloVaR(1_000_000, 2, 0, 95, 1, 3000, 17);
  assert.equal(monteCarloVaR(1_000_000, 2, 0, 95, 1, 3000, 17), value);
  assert.ok(Math.abs(monteCarloVaR(2_000_000, 2, 0, 95, 1, 3000, 17) - 2 * value) < 1e-6);
  const lognormalQuantile = 1_000_000 * (1 - Math.exp(-0.5 * 0.02 ** 2 - 1.6448536269514722 * 0.02));
  assert.ok(Math.abs(value - lognormalQuantile) < 3000, "Fixed-seed GBM loss quantile reconciles its independent analytic lognormal percentile.");
  assert.throws(() => monteCarloVaR(100, 2, 0, 95, 1, 100, -1));
});
