import assert from "node:assert/strict";
import test from "node:test";
import {
  browserConnectorPolicySchema,
  canonicalDataRequestSchema,
  canonicalDataResponseSchema,
  coverageLedgerSnapshotSchema,
  dataQualityReportSchema,
  mcpServerExposureContractSchema,
  semanticMetricDefinitionSchema,
  structuredDataGapSchema,
} from "./universalDataFabric";

const requestId = "11111111-1111-4111-8111-111111111111";
const latest = { mode: "latest" as const, asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false };

test("P5 canonical request requires explicit capability and point-in-time semantics", () => {
  const parsed = canonicalDataRequestSchema.parse({
    schemaVersion: "1", requestId, projectId: null, capability: "statements",
    entity: { ref: "lios:entity:1", symbol: "AAPL", identifiers: {} },
    fields: ["revenue"], parameters: {}, pointInTime: latest,
  });
  assert.equal(parsed.capability, "statements");
});

test("P5 missing observations fail closed into a structured data gap", () => {
  assert.equal(canonicalDataResponseSchema.safeParse({
    schemaVersion: "1", requestId, capability: "prices", entityRef: "AAPL",
    observation: null, observations: [], attempts: [], gap: null, resolvedAt: new Date().toISOString(),
  }).success, false);
  const gap = structuredDataGapSchema.parse({
    schemaVersion: "1", capability: "prices", entityRef: "AAPL", reason: "entitlement_required",
    providersChecked: [{ providerId: "vendor", status: "entitlement_denied", detail: "No entitlement.", latencyMs: 1, quota: null, entitlement: { decision: "denied", policyId: null, permittedUses: [], reasons: ["not configured"] } }],
    requestedPointInTime: latest,
    nextActions: [{ action: "connect_provider", providerId: "vendor", label: "Connect vendor" }],
  });
  assert.equal(gap.providersChecked[0].status, "entitlement_denied");
});

test("P5 semantic metric catalog is versioned and source-policy aware", () => {
  const metric = semanticMetricDefinitionSchema.parse({
    schemaVersion: "1", metricId: "revenue", version: 1, name: "Revenue", category: "income_statement",
    aliases: ["sales"], unit: "currency", formula: null,
    sourcePolicy: { preferredCapabilities: ["statements"], preferredProviders: [], pointInTimeRequired: true },
  });
  assert.equal(metric.sourcePolicy.pointInTimeRequired, true);
});

test("P5 generalized quality report exposes measurable dimensions", () => {
  const report = dataQualityReportSchema.parse({
    schemaVersion: "1", datasetRef: "snapshot:1", score: 0.9,
    dimensions: { completeness: 1, validity: 1, consistency: 0.8, uniqueness: 1, freshness: 0.8, pointInTimeIntegrity: 0.8 },
    issues: [], checkedAt: new Date().toISOString(),
  });
  assert.equal(report.dimensions.completeness, 1);
});

test("P5 governed MCP exposure forbids filesystem secrets and internal-state exposure", () => {
  const contract = mcpServerExposureContractSchema.parse({
    version: "1", exposedTools: ["lios.quote"], exposedResources: [],
    filesystemExposure: false, secretExposure: false, internalStateExposure: false, tenantScoped: true,
  });
  assert.equal(contract.secretExposure, false);
});

test("P5 browser connector policy is bounded by Project/domain/time/page limits", () => {
  const policy = browserConnectorPolicySchema.parse({ projectId: 1, allowedDomains: ["sec.gov"] });
  assert.equal(policy.allowDownloads, false);
  assert.equal(policy.maxPages, 1);
});

test("P5 coverage ledger distinguishes real coverage from capacity proof", () => {
  const snapshot = coverageLedgerSnapshotSchema.parse({
    schemaVersion: "1", generatedAt: new Date().toISOString(), realUniverseSize: 82800, indexedUniverseSize: 82800,
    capacityProofSize: 120000, warmSearchP95Ms: 10, providers: 30, implementedProviders: 20, capabilityFamilies: 12,
    fieldStages: { exposed: 100, retrievable: 80, mapped: 70, visible: 60, engineIntegrated: 50 }, gaps: [],
  });
  assert.equal(snapshot.realUniverseSize < snapshot.capacityProofSize, true);
});
