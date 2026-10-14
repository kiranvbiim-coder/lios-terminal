import assert from "node:assert/strict";
import test from "node:test";
import type { DataLineageReceipt } from "@shared/universalDataFabric";
import {
  P10_OPENLINEAGE_CONTRACT,
  dataLineageReceiptToOpenLineage,
  p10OpenLineageConfig,
} from "./p10OpenLineage";

const receipt: DataLineageReceipt = {
  schemaVersion: "1",
  id: "11111111-1111-4111-8111-111111111111",
  projectId: 7,
  requestId: "22222222-2222-4222-8222-222222222222",
  capability: "prices",
  entityRef: "security:AAPL",
  pointInTime: {
    mode: "latest",
    asKnownOn: null,
    revision: null,
    requirePublicationTime: false,
    allowLaterRevisions: false,
  },
  stages: [
    {
      stage: "connector",
      componentId: "provider:test",
      inputRefs: ["request:test"],
      outputRefs: ["provider-response:test"],
      contentHash: "a".repeat(64),
      at: "2026-09-23T00:00:00.000Z",
      metadata: {},
    },
    {
      stage: "artifact",
      componentId: "artifact-store",
      inputRefs: ["provider-response:test"],
      outputRefs: ["artifact:test"],
      contentHash: "b".repeat(64),
      at: "2026-09-23T00:00:01.000Z",
      metadata: {},
    },
  ],
  createdAt: "2026-09-23T00:00:01.000Z",
};

test("P10 OpenLineage projection fingerprints raw entity and dataset references", () => {
  const event = dataLineageReceiptToOpenLineage(receipt);
  const serialized = JSON.stringify(event);
  assert.equal(event.eventType, "COMPLETE");
  assert.equal(event.job.name, "data.prices");
  assert.equal(event.run.runId, receipt.id);
  assert.doesNotMatch(serialized, /security:AAPL/);
  assert.doesNotMatch(serialized, /request:test/);
  assert.doesNotMatch(serialized, /artifact:test/);
  assert.match(serialized, /entityFingerprint/);
});

test("P10 OpenLineage remote export is disabled until explicitly confirmed", () => {
  assert.equal(p10OpenLineageConfig({}).remoteEnabled, false);
  assert.equal(p10OpenLineageConfig({
    LIOS_OPENLINEAGE_REMOTE_ENABLED: "true",
    OPENLINEAGE_URL: "https://lineage.example.com",
  }).remoteEnabled, false);
  assert.equal(p10OpenLineageConfig({
    LIOS_OPENLINEAGE_REMOTE_ENABLED: "true",
    LIOS_OPENLINEAGE_REMOTE_CONFIRMATION: "fingerprinted-only",
    OPENLINEAGE_URL: "https://lineage.example.com",
  }).remoteEnabled, true);
});

test("P10 OpenLineage remains an optional non-authoritative projection", () => {
  assert.equal(P10_OPENLINEAGE_CONTRACT.authoritative, false);
  assert.equal(P10_OPENLINEAGE_CONTRACT.canonicalSource, "LiOS P5 DataLineageReceipt");
  assert.equal(P10_OPENLINEAGE_CONTRACT.remoteEnabledByDefault, false);
});


test("P10 OpenLineage bounds local lineage evidence and honors local disable policy", () => {
  assert.equal(P10_OPENLINEAGE_CONTRACT.boundedLocalFileBytes, 5 * 1024 * 1024);
  assert.equal(p10OpenLineageConfig({ LIOS_OPENLINEAGE_LOCAL_ENABLED: "false" }).localEnabled, false);
});
