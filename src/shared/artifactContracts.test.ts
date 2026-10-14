import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactKindSchema,
  artifactPackageSchema,
  artifactProposalSchema,
  artifactRefreshSpecSchema,
  artifactVersionSchema,
  spreadsheetArtifactContentSchema,
} from "./artifactContracts";
import { resolveArtifactAdapter } from "./artifactAdapterRegistry";

const hash = "a".repeat(64);
const now = new Date().toISOString();

test("P4 supports all canonical Artifact kinds", () => {
  const kinds = [
    "chart","table","screen","valuation","portfolio","research","report",
    "spreadsheet","data","backtest","strategy","decision","timeline","thesis",
  ];
  assert.deepEqual([...artifactKindSchema.options], kinds);
});

test("P4 spreadsheet active sheet must exist", () => {
  assert.equal(spreadsheetArtifactContentSchema.safeParse({
    kind: "spreadsheet",
    sheets: [{ id: "sheet-1", name: "Model", cells: {} }],
    activeSheetId: "missing",
  }).success, false);
});

test("P4 optional renderer falls back to a built-in adapter", () => {
  const resolved = resolveArtifactAdapter({ kind: "spreadsheet", preferredAdapterId: "lios.spreadsheet.univer", availablePackages: new Set() });
  assert.equal(resolved.id, "lios.spreadsheet.native");
});

test("P4 spreadsheet proposals are reviewable immutable diffs", () => {
  const proposal = artifactProposalSchema.parse({
    id: "proposal:1",
    artifactId: "artifact:1",
    baseVersion: 1,
    type: "spreadsheet_ai_diff",
    status: "pending",
    summary: "Update WACC",
    diffs: [{ sheetId: "sheet-1", ref: "B4", before: { raw: "0.08" }, after: { raw: "0.09" } }],
    proposedContentHash: hash,
    createdAt: now,
  });
  assert.equal(proposal.diffs[0].after?.raw, "0.09");
});

test("P4 portable packages are credential-free by contract", () => {
  const parsed = artifactPackageSchema.parse({
    version: 1,
    generatedAt: now,
    sourceProject: { id: 1, name: "Research", manifestHash: hash },
    sessions: [],
    artifacts: [],
    references: [],
    entitlementRequirements: [],
    excludesCredentials: true,
    packageHash: hash,
  });
  assert.equal(parsed.excludesCredentials, true);
});

test("active P4 keeps legacy Artifact packages backward compatible with version trust defaults", () => {
  const parsed = artifactPackageSchema.parse({
    version: 1,
    generatedAt: now,
    sourceProject: { id: 1, name: "Research", manifestHash: hash },
    sessions: [],
    artifacts: [{
      identity: {
        schemaVersion: "1",
        id: "artifact:legacy",
        projectId: 1,
        kind: "screen",
        title: "Legacy screen",
        status: "active",
        origin: "conversation",
        headVersion: 1,
        forkedFromArtifactId: null,
        forkedFromVersion: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      },
      versions: [{
        schemaVersion: "1",
        id: "artifact-version:legacy",
        artifactId: "artifact:legacy",
        version: 1,
        parentVersionId: null,
        adapterId: "lios.screen.native",
        content: { kind: "screen", view: "workspace", symbol: null, state: {} },
        contentHash: hash,
        sourceRefs: [],
        executionReceiptIds: [],
        assumptionRefs: [],
        note: null,
        createdAt: now,
      }],
    }],
    references: [],
    entitlementRequirements: [],
    excludesCredentials: true,
    packageHash: hash,
  });
  const version = parsed.artifacts[0].versions[0];
  assert.equal(version.trustManifest, null);
  assert.deepEqual(version.dependencyRefs, []);
  assert.equal(version.refreshSpec, null);
});


test("P7 Thesis Artifact is first-class and uses the native LiOS adapter", async () => {
  const { thesisArtifactContentSchema } = await import("./artifactContracts");
  const thesis = thesisArtifactContentSchema.parse({
    kind: "thesis",
    entityRef: "AAPL",
    status: "active",
    summary: "Research thesis",
    claims: [{ id: "c1", text: "Margins expand" }],
  });
  assert.equal(thesis.claims[0].status, "open");
  assert.equal(thesis.refresh.snapshotId, null);
  const resolved = resolveArtifactAdapter({ kind: "thesis", availablePackages: new Set() });
  assert.equal(resolved.id, "lios.thesis.native");
});


test("P7 ResearchArtifact carries planning evidence and only-source policy without creating a second object model", async () => {
  const { researchArtifactContentSchema } = await import("./artifactContracts");
  const research=researchArtifactContentSchema.parse({
    kind:"research",
    question:"What changed in margins?",
    blocks:[],
    claims:[],
    plan:{status:"active",steps:[{id:"s1",objective:"Review latest filing",sourceKinds:["filing"]}]},
    evidence:[{id:"e1",title:"10-K risk factors",snippet:"Margin pressure increased.",sourceRef:"sec:10-k:2026",sourceType:"filing"}],
    sourcePolicy:{mode:"only_refs",allowedSourceRefs:["sec:10-k:2026"]},
    contradictions:[{id:"x1",summary:"Management guidance conflicts with filing.",evidenceRefs:["sec:10-k:2026"]}],
    executionTrail:[{at:now,action:"Compared filing",sourceRefs:["sec:10-k:2026"],receiptId:null}],
  });
  assert.equal(research.sourcePolicy.mode,"only_refs");
  assert.equal(research.evidence[0].snippet,"Margin pressure increased.");
  assert.equal(research.plan.steps[0].status,"todo");
  assert.equal(research.contradictions[0].status,"open");
});


test("active P4 Artifact replay contract preserves governed conversation posture", () => {
  const spec = artifactRefreshSpecSchema.parse({
    kind: "conversation",
    sourceScope: "web",
    executionMode: "ai_assisted",
    capabilityIds: ["security.overview", "market.technical"],
    message: "Analyze Apple and show technical context",
    selection: {
      kind: "security",
      id: "AAPL",
      label: "Apple",
      view: "workspace",
      symbol: "AAPL",
    },
    engineRef: null,
  });
  assert.equal(spec.sourceScope, "web");
  assert.equal(spec.executionMode, "ai_assisted");
  assert.deepEqual(spec.capabilityIds, ["security.overview", "market.technical"]);
});

test("active P4 Artifact versions can carry durable trust dependencies and replay lineage", () => {
  const version = artifactVersionSchema.parse({
    schemaVersion: "1",
    id: "artifact-version:1",
    artifactId: "artifact:1",
    version: 1,
    parentVersionId: null,
    adapterId: "lios.screen.native",
    content: { kind: "screen", view: "workspace", symbol: "AAPL", state: {} },
    contentHash: hash,
    sourceRefs: ["provider:yahoo_finance"],
    executionReceiptIds: ["11111111-1111-4111-8111-111111111111"],
    assumptionRefs: ["assumption:window"],
    trustManifest: {
      schemaVersion: "1",
      trustId: "22222222-2222-4222-8222-222222222222",
      requestId: "33333333-3333-4333-8333-333333333333",
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
      evidence: [],
      claims: [],
      conflicts: [],
      methodology: [],
      assumptions: [],
      missing: [],
      warnings: [],
    },
    dependencyRefs: ["provider:yahoo_finance", "capability:security.overview"],
    refreshSpec: {
      kind: "conversation",
      sourceScope: "web",
      executionMode: "ai_assisted",
      capabilityIds: ["security.overview"],
      message: "Analyze Apple",
      selection: null,
      engineRef: null,
    },
    note: "Kept from conversation",
    createdAt: "2026-09-26T10:00:00.000Z",
  });
  assert.equal(version.trustManifest?.summary.confidence, "high");
  assert.deepEqual(version.dependencyRefs, ["provider:yahoo_finance", "capability:security.overview"]);
  assert.equal(version.refreshSpec?.message, "Analyze Apple");
});

test("active P4 replay contracts reject unbounded or unsupported execution state", () => {
  assert.equal(artifactRefreshSpecSchema.safeParse({
    kind: "conversation",
    sourceScope: "everything",
    executionMode: "ai_assisted",
    capabilityIds: [],
    message: "Analyze Apple",
  }).success, false);
  assert.equal(artifactRefreshSpecSchema.safeParse({
    kind: "conversation",
    sourceScope: "web",
    executionMode: "autonomous_unbounded",
    capabilityIds: [],
    message: "Analyze Apple",
  }).success, false);
});
