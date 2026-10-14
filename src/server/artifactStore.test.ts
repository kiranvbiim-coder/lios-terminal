import assert from "node:assert/strict";
import test from "node:test";
import { applySpreadsheetDiffs, compareArtifactContents, normalizeConversationDraft } from "./artifactDiff";
import { artifactTrustSourceRefs, assertArtifactContentSafe, assertArtifactRefsSafe, assertArtifactRefreshSpecSafe, assertArtifactTrustSafe } from "./artifactStore";

test("P4 spreadsheet diff application produces deterministic version content", () => {
  const base: any = {
    kind: "spreadsheet",
    sheets: [{ id: "sheet-1", name: "Model", cells: { B4: { raw: "0.08", format: "0.0%" } }, names: {}, rowCount: 20, columnCount: 10 }],
    activeSheetId: "sheet-1",
    rendererPreference: "builtin",
    calculationMode: "automatic",
  };
  const next = applySpreadsheetDiffs(base, [{ sheetId: "sheet-1", ref: "B4", before: { raw: "0.08", format: "0.0%" }, after: { raw: "0.09", format: "0.0%" } }]);
  assert.equal((next as any).sheets[0].cells.B4.raw, "0.09");
  const comparison = compareArtifactContents({ artifactId: "artifact:1", leftVersion: 1, rightVersion: 2, left: base, right: next });
  assert.equal(comparison.changed, true);
  assert.equal(comparison.spreadsheetDiffs.length, 1);
});

test("P4 artifacts reject credential-shaped fields instead of persisting secrets", () => {
  assert.throws(() => assertArtifactContentSafe({ kind: "screen", state: { apiKey: "secret" } }), /credential-shaped/);
});

test("P4 conversation drafts normalize into a canonical persistent Artifact kind", () => {
  const content = normalizeConversationDraft({
    schemaVersion: "1",
    artifactId: "11111111-1111-4111-8111-111111111111",
    artifactType: "analysis.technical",
    title: "Technical",
    projectId: 1,
    sourceRefs: ["provider:test"],
    executionReceiptIds: [],
    data: { symbol: "AAPL", rsi: 50 },
    persistence: "project_candidate",
  });
  assert.equal(content.kind, "screen");
});


test("P4 conversation drafts preserve already-canonical Decision Artifact content", () => {
  const content = normalizeConversationDraft({
    schemaVersion: "1",
    artifactId: "22222222-2222-4222-8222-222222222222",
    artifactType: "personal-finance.decision",
    title: "Personal Finance Snapshot",
    projectId: 1,
    sourceRefs: ["user:personal-finance"],
    executionReceiptIds: [],
    data: {
      kind: "decision",
      objective: "Understand personal financial position from user-owned data.",
      whatChanged: [],
      why: ["Net worth and cash flow were calculated deterministically."],
      scenarios: [],
      constraints: ["No values were inferred."],
      assumptions: { asOf: "2026-09-24" },
      alternatives: [],
      selectedAlternativeId: null,
      uncertainties: [],
      nextActions: ["Refresh after new user-owned data is imported."],
      implementation: [],
      monitoring: ["Refresh after new user-owned data is imported."],
      linkedRefs: { models: ["lios.personal-finance.core-v1"], sources: ["user:personal-finance"], scenarios: [], backtests: [], monitors: [] },
    },
    persistence: "project_candidate",
  });
  assert.equal(content.kind, "decision");
  if (content.kind !== "decision") throw new Error("Expected Decision Artifact content.");
  assert.match(content.objective, /personal financial position/i);
  assert.deepEqual(content.linkedRefs.sources, ["user:personal-finance"]);
});


test("P4 Artifact refs reject credential-bearing query/header material", () => {
  assert.throws(() => assertArtifactRefsSafe(["https://example.test/data?access_token=secret"]), /credential-bearing/);
  assert.throws(() => assertArtifactRefsSafe(["Authorization: Bearer secret"]), /credential-bearing/);
  assert.doesNotThrow(() => assertArtifactRefsSafe(["provider:sec-edgar", "artifact:abc@v2"]));
});


test("active P4 durable trust snapshots reject credential-shaped nested values", () => {
  assert.throws(() => assertArtifactContentSafe({
    schemaVersion: "1",
    assumptions: [{ ref: "a", value: { apiKey: "should-never-persist" } }],
  }, "trustManifest"), /credential-shaped/);
  assert.doesNotThrow(() => assertArtifactContentSafe({
    schemaVersion: "1",
    assumptions: [{ ref: "a", value: { growthRate: 0.08 } }],
  }, "trustManifest"));
});


test("active P4 durable trust snapshots reject credential-bearing evidence refs", () => {
  const manifest = {
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
      receiptCount: 0,
      missingCount: 0,
    },
    evidence: [{
      evidenceId: "33333333-3333-4333-8333-333333333333",
      sourceRef: "https://example.test/data?api_key=secret",
      providerId: "test",
      providerLabel: "Test",
      kind: "provider",
      observedAt: "2026-09-26T10:00:00.000Z",
      asOf: null,
      freshness: "current",
      quality: "high",
      confidence: "high",
      connectorState: "live_verified",
      isFallback: false,
      access: null,
      fields: [],
      valueHash: null,
      notes: [],
    }],
    claims: [],
    conflicts: [],
    methodology: [],
    assumptions: [],
    missing: [],
    warnings: [],
  } as any;
  assert.throws(() => assertArtifactTrustSafe(manifest), /credential-bearing/);
});


test("active P4 replay metadata rejects obvious credential-bearing text before persistence or package export", () => {
  assert.throws(() => assertArtifactRefreshSpecSafe({
    kind: "conversation",
    sourceScope: "web",
    executionMode: "ai_assisted",
    capabilityIds: ["security.overview"],
    message: "Use api_key=123456789abcdef for this request",
    selection: null,
    engineRef: null,
  }), /credential-bearing text/);
  assert.doesNotThrow(() => assertArtifactRefreshSpecSafe({
    kind: "conversation",
    sourceScope: "web",
    executionMode: "ai_assisted",
    capabilityIds: ["security.overview"],
    message: "Analyze Apple using connected market data",
    selection: null,
    engineRef: null,
  }));
});

test("active P4 derives dependency refs from every TrustManifest source-bearing surface", () => {
  const refs = artifactTrustSourceRefs({
    schemaVersion: "1",
    trustId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    generatedAt: "2026-09-26T10:00:00.000Z",
    sourceScope: "web",
    summary: {
      freshness: "current",
      quality: "high",
      confidence: "high",
      conflictState: "material",
      evidenceCoveragePct: 100,
      sourceCount: 3,
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
    claims: [{
      claimId: "44444444-4444-4444-8444-444444444444",
      label: "Filing-backed revenue",
      path: "fundamentals.revenue",
      status: "supported",
      sourceRefs: ["provider:sec_edgar"],
      receiptIds: [],
      formulaRefs: [],
      assumptionRefs: [],
      confidence: "high",
      explanation: "Supported by filing evidence.",
    }],
    conflicts: [{
      field: "revenue",
      state: "material",
      sourceRefs: ["provider:sec_edgar", "provider:finnhub"],
      relativeDifference: 0.02,
      summary: "Providers disagree.",
    }],
    methodology: [{
      step: 1,
      label: "Resolve evidence",
      componentId: "lios.fundamentals",
      deterministic: true,
      sourceRefs: ["provider:finnhub"],
      receiptIds: [],
      notes: [],
    }],
    assumptions: [],
    missing: [],
    warnings: [],
  });
  assert.deepEqual(refs, ["provider:yahoo_finance", "provider:sec_edgar", "provider:finnhub"]);
});
