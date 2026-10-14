import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactReplayDraft,
  buildArtifactDependencyRefs,
  compareArtifactVersionMetadata,
  metadataDeltaLabels,
} from "./p4ArtifactWorkspace";
import type { TrustManifest } from "@shared/trustContracts";

const trust: TrustManifest = {
  schemaVersion: "1",
  trustId: "11111111-1111-4111-8111-111111111111",
  requestId: "22222222-2222-4222-8222-222222222222",
  generatedAt: "2026-09-26T10:00:00.000Z",
  sourceScope: "web",
  summary: {
    freshness: "current",
    quality: "high",
    confidence: "high",
    conflictState: "not_evaluated_single_source",
    evidenceCoveragePct: 100,
    sourceCount: 1,
    receiptCount: 1,
    missingCount: 0,
  },
  evidence: [{
    evidenceId: "33333333-3333-4333-8333-333333333333",
    sourceRef: "provider:yahoo_finance",
    providerId: "yahoo_finance",
    providerLabel: "Yahoo Finance",
    kind: "provider",
    observedAt: "2026-09-26T10:00:00.000Z",
    asOf: "2026-09-26T09:59:00.000Z",
    freshness: "current",
    quality: "high",
    confidence: "high",
    connectorState: "live_verified",
    isFallback: false,
    access: null,
    fields: ["price"],
    valueHash: null,
    notes: [],
  }],
  claims: [],
  conflicts: [],
  methodology: [],
  assumptions: [],
  missing: [],
  warnings: [],
};

test("active P4 builds one deduplicated dependency set from sources evidence and capabilities", () => {
  assert.deepEqual(buildArtifactDependencyRefs({
    sourceRefs: ["provider:yahoo_finance", "artifact:peer@v1"],
    trustManifest: trust,
    capabilityIds: ["security.overview", "security.overview", "market.technical"],
  }), [
    "provider:yahoo_finance",
    "artifact:peer@v1",
    "capability:security.overview",
    "capability:market.technical",
  ]);
});

test("active P4 replay stages the saved governed posture without hidden execution", () => {
  const replay = artifactReplayDraft("Apple overview", {
    kind: "conversation",
    sourceScope: "web",
    executionMode: "ai_assisted",
    capabilityIds: ["security.overview"],
    message: "Analyze Apple",
    selection: null,
    engineRef: null,
  });
  assert.deepEqual(replay, {
    message: "Analyze Apple",
    sourceScope: "web",
    executionMode: "ai_assisted",
  });
});

test("active P4 replay has a safe explicit fallback when legacy metadata has no message", () => {
  const replay = artifactReplayDraft("Valuation", {
    kind: "engine",
    sourceScope: "my_data",
    executionMode: "deterministic_first",
    capabilityIds: [],
    message: null,
    selection: null,
    engineRef: "lios.valuation.dcf",
  });
  assert.match(replay.message, /Rerun Artifact "Valuation"/);
  assert.match(replay.message, /reviewed change/);
});

test("active P4 compares evidence/replay metadata separately from content", () => {
  const base = {
    trustManifest: trust,
    dependencyRefs: ["provider:yahoo_finance"],
    refreshSpec: {
      kind: "conversation" as const,
      sourceScope: "web" as const,
      executionMode: "ai_assisted" as const,
      capabilityIds: ["security.overview"],
      message: "Analyze Apple",
      selection: null,
      engineRef: null,
    },
    executionReceiptIds: ["44444444-4444-4444-8444-444444444444"],
    assumptionRefs: ["assumption:growth"],
    sourceRefs: ["provider:yahoo_finance"],
  };
  const changed = {
    ...base,
    dependencyRefs: ["provider:yahoo_finance", "provider:sec_edgar"],
    refreshSpec: { ...base.refreshSpec, sourceScope: "auto" as const },
    assumptionRefs: ["assumption:growth", "assumption:wacc"],
  };
  const delta = compareArtifactVersionMetadata(base, changed);
  assert.deepEqual(metadataDeltaLabels(delta), ["dependencies", "replay", "assumptions"]);
});
