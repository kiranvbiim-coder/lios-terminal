import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import {
  addMetricRequestSchema,
  addSeriesRequestSchema,
  buildCapabilityManifestV2,
  parseUniversalDataObject,
  universalDataObjectSchema,
} from "@shared/dataFabric";

test("Capability Manifest v2 projects existing connector definitions without credentials", () => {
  const fred = BUILT_IN_CONNECTORS.find((connector) => connector.id === "fred");
  assert.ok(fred);
  const manifest = buildCapabilityManifestV2(fred, "credential_configured");
  assert.equal(manifest.schemaVersion, "2");
  assert.equal(manifest.connectorId, "fred");
  assert.equal(manifest.capabilities.some((capability) => capability.contractFamily === "macro"), true);
  assert.equal(manifest.entitlements.credentialRequired, true);
  assert.equal(manifest.availability.runtimeState, "credential_configured");
  assert.equal(JSON.stringify(manifest).includes("FRED_API_KEY"), false);
  assert.equal(JSON.stringify(manifest).toLowerCase().includes("apikey"), false);
});

test("Universal data object preserves semantic/provenance evidence and accepts canonical plus extended fields", () => {
  const object = universalDataObjectSchema.parse({
    schemaVersion: "1",
    objectId: "udo_financials_aapl_2026",
    type: "financial_statements",
    source: { provider: "sec_edgar", connectorId: "sec_edgar", connectionId: null },
    entity: { kind: "company", primaryId: "AAPL", identifiers: { ticker: "AAPL", cik: "0000320193" } },
    clocks: {
      asOf: "2026-09-17T00:00:00.000Z",
      retrievedAt: "2026-09-17T01:00:00.000Z",
      periodStart: "2025-10-01",
      periodEnd: "2026-09-30",
    },
    currency: "USD",
    unit: null,
    frequency: "annual",
    fields: [
      { id: "financial_statements.revenue", kind: "canonical", providerField: "Revenue", type: "currency_amount" },
      { id: "sec_edgar:EntityCommonStockSharesOutstanding", kind: "extended", providerField: "EntityCommonStockSharesOutstanding", type: "number" },
    ],
    transforms: ["xbrl-normalize"],
    freshness: { state: "current", degraded: false, reasons: [] },
    entitlement: { decision: "allowed", policyId: null, reasons: ["public source"] },
    lineage: {
      snapshotId: "snap_1",
      contentHash: "a".repeat(64),
      sourceReference: "https://www.sec.gov/Archives/example",
    },
    payload: { kind: "dataset_page", reference: "company.financials:AAPL" },
  });
  assert.equal(object.fields.length, 2);
  assert.equal(object.fields[1]?.kind, "extended");
  assert.equal(parseUniversalDataObject(object)?.objectId, object.objectId);
});

test("Universal data object rejects credential-bearing references", () => {
  const base = {
    schemaVersion: "1" as const,
    objectId: "udo_quotes_aapl",
    type: "market_data",
    source: { provider: "user_api", connectorId: "private_api", connectionId: "conn_1" },
    entity: { kind: "security", primaryId: "AAPL", identifiers: { ticker: "AAPL" } },
    clocks: { asOf: "2026-09-17T00:00:00.000Z", retrievedAt: "2026-09-17T00:00:01.000Z", periodStart: null, periodEnd: null },
    currency: "USD",
    unit: null,
    frequency: "realtime",
    fields: [{ id: "market_data.quote", kind: "canonical" as const, providerField: "price", type: "number" as const }],
    transforms: [],
    freshness: { state: "current" as const, degraded: false, reasons: [] },
    entitlement: { decision: "allowed" as const, policyId: null, reasons: [] },
    lineage: { snapshotId: null, contentHash: "b".repeat(64), sourceReference: "https://vendor.example/quote?api_key=secret" },
    payload: { kind: "dataset_page" as const, reference: "quote:AAPL" },
  };
  assert.equal(universalDataObjectSchema.safeParse(base).success, false);
});

test("Universal data object rejects duplicate field ids and inconsistent degraded status", () => {
  const parsed = universalDataObjectSchema.safeParse({
    schemaVersion: "1",
    objectId: "udo_bad",
    type: "market_data",
    source: { provider: "fred", connectorId: "fred", connectionId: null },
    entity: { kind: "series", primaryId: "GDP", identifiers: {} },
    clocks: { asOf: "2026-09-17T00:00:00.000Z", retrievedAt: "2026-09-17T00:00:01.000Z", periodStart: null, periodEnd: null },
    currency: null,
    unit: "index",
    frequency: "quarterly",
    fields: [
      { id: "macro.gdp", kind: "canonical", providerField: "GDP", type: "number" },
      { id: "macro.gdp", kind: "canonical", providerField: "GDP2", type: "number" },
    ],
    transforms: [],
    freshness: { state: "current", degraded: true, reasons: [] },
    entitlement: { decision: "unknown", policyId: null, reasons: [] },
    lineage: { snapshotId: null, contentHash: "c".repeat(64), sourceReference: "FRED:GDP" },
    payload: { kind: "dataset_page", reference: "macro:GDP" },
  });
  assert.equal(parsed.success, false);
});

test("Add Metric and Add Series contracts require a stable data field identity", () => {
  const metric = addMetricRequestSchema.parse({
    name: "Revenue",
    fieldId: "financial_statements.revenue",
    datasetKey: "company.financials",
    aggregation: "last",
  });
  assert.equal(metric.fieldId, "financial_statements.revenue");

  const series = addSeriesRequestSchema.parse({
    name: "GDP",
    fieldId: "macro.gdp",
    datasetKey: "macro.series",
    frequency: "quarterly",
    transform: "none",
  });
  assert.equal(series.frequency, "quarterly");
  assert.equal(addMetricRequestSchema.safeParse({ name: "Bad", datasetKey: "x" }).success, false);
});