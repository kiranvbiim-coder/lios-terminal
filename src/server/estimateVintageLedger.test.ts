import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEstimateVintageLedger,
  calculateContributorAccuracy,
  calculateEstimateDispersion,
  calculateEstimateRevision,
  calculateEstimateSurprise,
  mergeEstimateVintageRows,
  type ProviderEstimateActual,
  type ProviderEstimateRow,
} from "./estimateVintageLedger";

function estimate(overrides: Partial<ProviderEstimateRow> = {}): ProviderEstimateRow {
  return {
    symbol: "ACME", metric: "eps", fiscalPeriod: "FY2027", periodEnd: "2027-12-31", contributor: "Analyst A",
    value: 10, low: 9, high: 11, currency: "USD", unit: "per_share", publishedAt: "2026-01-01T00:00:00Z",
    availableAt: "2026-01-02T00:00:00Z", sourceUrl: "https://provider.example/estimates", ...overrides,
  } as ProviderEstimateRow;
}

function actual(overrides: Partial<ProviderEstimateActual> = {}): ProviderEstimateActual {
  return { metric: "eps", fiscalPeriod: "FY2027", periodEnd: "2027-12-31", value: 11, reportedAt: "2027-02-01T00:00:00Z", availableAt: "2027-02-02T00:00:00Z", ...overrides } as ProviderEstimateActual;
}

test("revision returns delta, percent and direction", () => {
  assert.deepEqual(calculateEstimateRevision(10, 12), { delta: 2, percentage: 20, direction: "up" });
  assert.deepEqual(calculateEstimateRevision(10, 8), { delta: -2, percentage: -20, direction: "down" });
  assert.deepEqual(calculateEstimateRevision(0, 2), { delta: 2, percentage: null, direction: "up" });
  assert.deepEqual(calculateEstimateRevision(null, 2), { delta: null, percentage: null, direction: null });
});

test("surprise is actual minus estimate and zero estimates have no percent", () => {
  assert.deepEqual(calculateEstimateSurprise(11, 10), { surprise: 1, surprisePct: 10 });
  assert.deepEqual(calculateEstimateSurprise(2, 0), { surprise: 2, surprisePct: null });
});

test("dispersion calculates population deviation and one-estimate boundary", () => {
  assert.deepEqual(calculateEstimateDispersion([8, 10, 12, 14]), { mean: 11, median: 11, low: 8, high: 14, standardDeviation: 2.236068, dispersionPct: 54.545455, contributorCount: 4 });
  assert.deepEqual(calculateEstimateDispersion([5]), { mean: 5, median: 5, low: 5, high: 5, standardDeviation: 0, dispersionPct: 0, contributorCount: 1 });
  assert.throws(() => calculateEstimateDispersion([]), /At least one/);
  assert.throws(() => calculateEstimateDispersion([1, Number.NaN]), /finite/);
});

test("ledger tracks revisions, breadth, dispersion, surprise and internal divergence", () => {
  const rows = [
    estimate({ contributor: "Analyst A", value: 10, publishedAt: "2026-01-01T00:00:00Z", availableAt: "2026-01-02T00:00:00Z" }),
    estimate({ contributor: "Analyst A", value: 12, publishedAt: "2026-02-01T00:00:00Z", availableAt: "2026-02-02T00:00:00Z" }),
    estimate({ contributor: "Analyst B", value: 8, publishedAt: "2026-02-01T00:00:00Z", availableAt: "2026-02-02T00:00:00Z", sourceUrl: "https://other.example/estimates" }),
  ];
  const result = buildEstimateVintageLedger(rows, { actuals: [actual()], internalEstimates: [{ metric: "eps", fiscalPeriod: "FY2027", value: 9, unit: "per_share", currency: "USD", sourceReference: "model://internal", asOf: "2026-02-03T00:00:00Z" }] });
  assert.equal(result.rejected.length, 0);
  const [group] = result.groups;
  assert.deepEqual(group.latest.map((row) => row.estimateValue), [12, 8]);
  assert.equal(group.latest[0].revisionDelta, 2);
  assert.equal(group.latest[0].revisionPct, 20);
  assert.equal(group.latest[0].revisionDirection, "up");
  assert.equal(group.breadth, 1);
  assert.equal(group.revisionMomentum, 20);
  assert.equal(group.dispersion?.mean, 10);
  assert.equal(group.dispersion?.dispersionPct, 40);
  assert.equal(group.observations[0].provider, "Analyst A");
  assert.equal(group.observations[0].retrievedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(group.observations[0].vintageAt, "2026-01-02T00:00:00.000Z");
  assert.equal(group.observations[0].status, "estimate");
  assert.equal(group.actual?.actualValue, 11);
  assert.equal(group.actual?.surprise, 1);
  assert.equal(group.actual?.surprisePct, 10);
  assert.equal(group.estimateVsInternalDivergence, 11.111111);
});

test("provider rows remain separate when their definitions differ; strict merge rejects incompatible rows", () => {
  const rows = [estimate(), estimate({ currency: "EUR", sourceUrl: "https://provider.example/eur" })];
  assert.equal(buildEstimateVintageLedger(rows).groups.length, 2);
  assert.throws(() => mergeEstimateVintageRows(rows), /Incompatible/);
});

test("invalid periods, timestamps, currency, bounds and source references are rejected without fallback", () => {
  const cases: Array<[string, Partial<ProviderEstimateRow>]> = [
    ["period", { fiscalPeriod: "future-ish" }],
    ["timestamp", { availableAt: "not-a-time" }],
    ["finite value", { value: Number.NaN }],
    ["currency", { currency: "US dollars" }],
    ["bounds", { low: 12, high: 11 }],
    ["source", { sourceUrl: null }],
  ];
  for (const [label, patch] of cases) {
    const result = buildEstimateVintageLedger([estimate(patch)]);
    assert.equal(result.groups.length, 0, label);
    assert.equal(result.rejected.length, 1, label);
  }
});

test("contributor accuracy uses resolved actuals, preserves zero-actual absolute error and avoids fabricated percentage", () => {
  const rows = [
    estimate({ contributor: "Accurate", value: 10, availableAt: "2026-01-02T00:00:00Z", sourceUrl: "https://a.example" }),
    estimate({ contributor: "Accurate", value: 12, publishedAt: "2027-01-01T00:00:00Z", availableAt: "2027-01-02T00:00:00Z", sourceUrl: "https://a.example" }),
    estimate({ contributor: "Zero", value: 2, publishedAt: "2026-03-01T00:00:00Z", availableAt: "2026-03-02T00:00:00Z", sourceUrl: "https://z.example" }),
  ];
  const accuracies = calculateContributorAccuracy(rows, [actual({ value: 10, reportedAt: "2026-02-01T00:00:00Z" }), actual({ value: 0, reportedAt: "2027-02-01T00:00:00Z" })]);
  const accurate = accuracies.find((row) => row.contributor === "Accurate")!;
  assert.equal(accurate.resolvedCount, 2);
  assert.equal(accurate.meanError, 6);
  assert.equal(accurate.meanAbsoluteError, 6);
  assert.equal(accurate.meanAbsolutePercentageError, 0);
  assert.equal(accurate.accuracyPct, 100);
  const zero = accuracies.find((row) => row.contributor === "Zero")!;
  assert.equal(zero.resolvedCount, 1);
  assert.equal(zero.meanAbsoluteError, 2);
  assert.equal(zero.accuracyPct, null);
});

test("missing actuals produce no surprise, and incompatible currencies do not cross-match", () => {
  const rows = [estimate(), estimate({ currency: "EUR", sourceUrl: "https://provider.example/eur" })];
  const result = buildEstimateVintageLedger(rows, { actuals: [actual({ currency: "GBP" })] });
  assert.equal(result.groups.every((group) => group.actual === null), true);
});
