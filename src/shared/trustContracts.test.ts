import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceObservationSchema,
  trustManifestSchema,
  universalDataPlanSchema,
  universalDataRequestSchema,
} from "./trustContracts";

const latest = {
  mode: "latest" as const,
  asKnownOn: null,
  revision: null,
  requirePublicationTime: false,
  allowLaterRevisions: false,
};

test("P3 trust planning extends the canonical provider-neutral data request", () => {
  const request = universalDataRequestSchema.parse({
    schemaVersion: "1",
    requestId: "4761cf5d-d742-48e6-a739-5af7bd605e8a",
    projectId: null,
    capability: "statements",
    entity: { ref: "AAPL", symbol: "AAPL", identifiers: {} },
    fields: ["revenue", "eps"],
    parameters: {},
    pointInTime: latest,
    providerAllow: [],
    providerDeny: [],
    sourceScope: "web",
  });
  assert.equal(request.capability, "statements");
  assert.equal(request.sourceScope, "web");
  assert.equal(request.allowPartial, true);
  assert.equal(request.pointInTime.mode, "latest");
  assert.equal("provider" in request, false);
});

test("P3 data plans distinguish connection gaps from unsupported coverage", () => {
  const plan = universalDataPlanSchema.parse({
    schemaVersion: "1",
    request: {
      schemaVersion: "1",
      requestId: "f0fbab76-118e-4aba-989a-bf028aed608d",
      projectId: null,
      capability: "prices",
      entity: { ref: "MSFT", symbol: "MSFT", identifiers: {} },
      fields: ["quote"],
      parameters: { series: "quote" },
      pointInTime: latest,
      providerAllow: [],
      providerDeny: [],
      sourceScope: "web",
      allowPartial: false,
      maxAgeMs: null,
    },
    candidates: [{
      connectorId: "twelve_data",
      label: "Twelve Data",
      contractFamily: "market_data",
      fields: ["quote"],
      coverage: "global",
      runtimeState: "adapter_available",
      operational: false,
      requiresConnection: true,
      rank: 0,
      reason: "Credential missing.",
    }],
    selectedCandidateIds: [],
    availability: "not_connected",
    missingFields: [],
    recoveryActions: ["Connect twelve_data"],
    plannedAt: new Date().toISOString(),
  });
  assert.equal(plan.availability, "not_connected");
  assert.equal(plan.candidates[0].requiresConnection, true);
});

test("P3 evidence observations carry freshness quality confidence and value hashes without raw value duplication", () => {
  const observation = evidenceObservationSchema.parse({
    evidenceId: "8b3f02a1-8d4e-4a82-aaed-8cf1d0dc160a",
    sourceRef: "provider:test",
    providerLabel: "Test",
    kind: "provider",
    observedAt: new Date().toISOString(),
    asOf: null,
    freshness: "daily",
    quality: "high",
    confidence: "high",
    access: {
      state: "delayed_available",
      servedTier: "delayed",
      bestAvailableTier: "real_time",
      entitlementRequired: true,
      upgradeConnectorId: "twelve_data",
      upgradeConnectorLabel: "Twelve Data",
      reason: "Connect a real-time source to upgrade.",
    },
    fields: ["price"],
    valueHash: "a".repeat(64),
  });
  assert.equal(observation.valueHash?.length, 64);
  assert.equal(observation.access?.servedTier, "delayed");
  assert.equal(observation.access?.entitlementRequired, true);
  assert.equal("value" in observation, false);
});

test("P3 trust manifest keeps conflict not-evaluated distinct from no conflict", () => {
  const manifest = trustManifestSchema.parse({
    schemaVersion: "1",
    trustId: "50ec401f-46dc-43e6-83c3-14e94c73f86a",
    requestId: "42c061e3-ae6f-4e18-8fa9-bef5473e1a85",
    generatedAt: new Date().toISOString(),
    sourceScope: "auto",
    summary: {
      freshness: "daily",
      quality: "medium",
      confidence: "medium",
      conflictState: "not_evaluated_single_source",
      evidenceCoveragePct: 100,
      sourceCount: 1,
      receiptCount: 1,
      missingCount: 0,
    },
  });
  assert.equal(manifest.summary.conflictState, "not_evaluated_single_source");
});
