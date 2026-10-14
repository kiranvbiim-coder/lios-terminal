import assert from "node:assert/strict";
import test from "node:test";
import { buildEstimateIntelligence } from "./EstimateIntelligenceAdapter";

const snapshot = (observations: readonly unknown[], actuals: readonly unknown[] = []) => ({
  provider: "fixture-provider",
  retrievedAt: "2026-02-03T00:00:00Z",
  availableAt: "2026-02-03T00:00:00Z",
  payload: { observations, actuals },
});

const row = (overrides: Record<string, unknown> = {}) => ({
  symbol: "ACME",
  metric: "eps",
  fiscalPeriod: "FY2027",
  periodEnd: "2027-12-31",
  contributor: "Analyst A",
  value: 10,
  low: null,
  high: null,
  currency: "USD",
  unit: "per_share",
  publishedAt: "2026-01-01T00:00:00Z",
  availableAt: "2026-01-02T00:00:00Z",
  sourceUrl: "https://fixture.example/estimate",
  ...overrides,
});

test("labelled fixture rows preserve contributors and calculate revision, dispersion, surprise, accuracy and linked divergence", () => {
  const result = buildEstimateIntelligence({
    symbol: "ACME",
    snapshot: snapshot([
      row({ contributor: "Analyst A", value: 10, availableAt: "2026-01-02T00:00:00Z" }),
      row({ contributor: "Analyst A", value: 12, availableAt: "2026-02-01T00:00:00Z" }),
      row({ contributor: "Analyst B", value: 8, availableAt: "2026-02-01T00:00:00Z" }),
    ], [{
      metric: "eps", fiscalPeriod: "FY2027", periodEnd: "2027-12-31", value: 11,
      reportedAt: "2026-02-02T00:00:00Z", availableAt: "2026-02-02T00:00:00Z",
    }]),
    scenarioInputs: [{ metric: "eps", fiscalPeriod: "FY2027", value: 9, unit: "per_share", currency: "USD", sourceReference: "model://fixture" }],
  });
  assert.equal(result.ledger.rejected.length, 0);
  assert.equal(result.ledger.groups.length, 1);
  const [group] = result.ledger.groups;
  assert.deepEqual(group.latest.map((estimate) => estimate.estimateValue), [12, 8]);
  assert.equal(group.revisionMomentum, 20);
  assert.equal(group.dispersion?.mean, 10);
  assert.equal(group.actual?.consensusEstimate, 10);
  assert.equal(group.actual?.surprise, 1);
  assert.equal(group.contributorAccuracy.find((item) => item.contributor === "Analyst A")?.accuracyPct, 90.909091);
  assert.equal(group.internalDivergence?.difference, 1);
  assert.equal(result.links[0].linked, true);
  assert.match(result.links[0].reason, /exact fiscal period/);
  assert.equal(result.aggregateOnly, false);
});

test("missing snapshots and aggregate fields stay explicit without fabricated contributor rows", () => {
  const result = buildEstimateIntelligence({
    symbol: "ACME",
    snapshot: null,
    consensus: { target_consensus: 125, recommendation: "buy", number_of_analysts: 4, currency: "USD" },
  });
  assert.deepEqual(result.ledger.groups, []);
  assert.equal(result.ledger.rejected.length, 0);
  assert.equal(result.aggregateOnly, true);
  assert.match(result.aggregateMessage ?? "", /Only aggregate target\/recommendation/);
});

test("aggregate provider snapshot is not presented as constituent analyst history", () => {
  const result = buildEstimateIntelligence({
    symbol: "ACME",
    snapshot: snapshot([row({ contributor: "FMP aggregate (4 analysts)", value: 14 })]),
  });
  assert.equal(result.ledger.groups.length, 1);
  assert.equal(result.aggregateOnly, true);
  assert.match(result.aggregateMessage ?? "", /Provider aggregate estimate rows/);
  assert.equal(result.ledger.groups[0].latest[0].contributor, "FMP aggregate (4 analysts)");
});

test("period and currency mismatches remain unlinked and do not create divergence", () => {
  const result = buildEstimateIntelligence({
    symbol: "ACME",
    snapshot: snapshot([row({ value: 10, currency: "USD" })]),
    scenarioInputs: [{ metric: "eps", fiscalPeriod: "FY2028", value: 9, unit: "per_share", currency: "EUR", sourceReference: "model://fixture" }],
  });
  assert.equal(result.ledger.groups[0].internalDivergence, null);
  assert.equal(result.links[0].linked, false);
  assert.match(result.links[0].reason, /not linked/);
});
