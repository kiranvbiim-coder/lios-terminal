import assert from "node:assert/strict";
import test from "node:test";
import {
  pointInTimeDatasetSnapshotSchema,
  pointInTimeScalarSeriesSnapshotSchema,
} from "./pointInTimeData";

test("P5 point-in-time snapshot schemas preserve entitlement policy evidence", () => {
  const common = {
    id: "11111111-1111-4111-8111-111111111111",
    datasetKey: "financial:AAPL",
    entityKey: "AAPL",
    schemaVersion: "1.0.0",
    source: "fixture",
    provider: "fixture",
    frequency: "annual",
    currency: "USD",
    timezone: "UTC",
    observationStart: "2025-01-01",
    observationEnd: "2025-12-31",
    effectiveAt: "2025-12-31T00:00:00.000Z",
    publishedAt: "2026-02-01T00:00:00.000Z",
    retrievedAt: "2026-02-02T00:00:00.000Z",
    availableAt: "2026-02-01T00:00:00.000Z",
    contentHash: "a".repeat(64),
    parentSnapshotId: null,
    entitlementPolicyId: "policy-1",
    createdByUserId: 1,
    createdAt: "2026-02-02T00:00:00.000Z",
  };
  const financial = pointInTimeDatasetSnapshotSchema.parse({
    ...common,
    dataClass: "financial_statements",
    quality: { score: 1, statementCoverage: { income: 1, balance: 1, cashflow: 1 }, criticalFieldsPresent: 1, criticalFieldsExpected: 1, missingCriticalFields: [], warnings: [] },
    lineage: {},
    payload: { symbol: "AAPL", periods: [{ fiscalYear: "2025", period: "FY", periodEnd: "2025-12-31", filingDate: "2026-02-01", availableAt: "2026-02-01T00:00:00.000Z", currency: "USD", income: {}, balance: {}, cashflow: {}, segments: {}, geographies: {}, sources: [] }] },
  });
  assert.equal(financial.entitlementPolicyId, "policy-1");

  const economic = pointInTimeScalarSeriesSnapshotSchema.parse({
    ...common,
    datasetKey: "economic:GDP",
    entityKey: "GDP",
    dataClass: "economic_series",
    currency: null,
    quality: { score: 1, observationCount: 1, validObservationCount: 1, missingValues: 0, vintageCoverage: 1, warnings: [] },
    lineage: {},
    payload: { seriesId: "GDP", name: "GDP", unit: "USD", category: "Macro", provider: "fred", frequency: "quarterly", observations: [{ date: "2025-12-31", value: 1, realtimeStart: "2026-01-01", realtimeEnd: null, availableAt: "2026-01-01T00:00:00.000Z" }] },
  });
  assert.equal(economic.entitlementPolicyId, "policy-1");
});
