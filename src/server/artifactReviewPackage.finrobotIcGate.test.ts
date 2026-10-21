import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactContentSchema,
  type DecisionArtifactApprovalInspection,
} from "@shared/artifactContracts";
import { composeArtifactReviewSections, inspectArtifactReviewPackageDiagnostics } from "./artifactReviewPackage";
import { assembleProfessionalWorkPackage, professionalWorkPackageRequestSchema } from "./professionalWorkPackage";
import type { ArtifactInteractionReceiptRow } from "@shared/schema";

const hash = "a".repeat(64);

function approved(): DecisionArtifactApprovalInspection {
  const link = {
    decisionId: 7,
    receiptVersionId: 9,
    receiptVersion: 3,
    receiptHash: "b".repeat(64),
    serverApprovalId: 11,
    outcome: "approved" as const,
    reviewerUserId: 13,
    approvedAt: "2026-10-12T00:00:00.000Z",
    linkedAt: "2026-10-12T00:01:00.000Z",
    artifactVersion: 4,
    artifactContentHash: hash,
    projectId: 17,
  };
  return {
    artifactId: "artifact:decision:1",
    approvalScope: "linked_receipt_only",
    version: 4,
    contentHash: hash,
    state: "approved",
    reason: null,
    link,
    currentApproval: link,
  };
}

const decision = artifactContentSchema.parse({
  kind: "decision",
  objective: "Determine whether the recorded case is ready for committee review.",
  recommendation: "INVEST",
  why: ["Recorded thesis and valuation support the authored recommendation."],
  alternatives: [{
    id: "base",
    label: "Proceed",
    expectedOutcomes: ["Target case remains intact."],
    risks: ["Operating downside remains possible."],
    tradeoffs: ["Return potential versus execution risk."],
  }],
  linkedRefs: {
    models: ["artifact:valuation:42"],
    sources: ["source:filing:10k"],
    scenarios: [],
    backtests: [],
    monitors: [],
  },
});

test("Artifact review diagnostics bind the exact immutable P4 version into the FinRobot IC gate", () => {
  const diagnostics = inspectArtifactReviewPackageDiagnostics({
    content: decision,
    contentHash: hash,
    sourceRefs: ["source:filing:10k"],
    executionReceiptIds: ["receipt:deterministic:1"],
    approval: approved(),
  });

  assert.equal(diagnostics.snapshotAudit.sourceHash, hash);
  assert.equal(diagnostics.snapshotAudit.sourceCount, 1);
  assert.equal(diagnostics.snapshotAudit.receiptCount, 1);
  assert.equal(diagnostics.icMemoGate.posture, "governed_review");
  assert.equal(diagnostics.icMemoGate.approvalState, "approved");
  assert.equal(diagnostics.icMemoGate.generatedRecommendation, false);
  assert.equal(diagnostics.icMemoGate.deterministicFinanceCalculated, false);
  assert.equal(diagnostics.icMemoGate.approvalGranted, false);
  assert.equal(diagnostics.icMemoGate.liveDataRefreshed, false);
});

test("Artifact review diagnostics preserve hash disagreement as review-required", () => {
  const diagnostics = inspectArtifactReviewPackageDiagnostics({
    content: decision,
    contentHash: "c".repeat(64),
    sourceRefs: ["source:filing:10k"],
    executionReceiptIds: ["receipt:deterministic:1"],
    approval: approved(),
  });

  assert.equal(diagnostics.icMemoGate.posture, "review_required");
  assert.match(diagnostics.icMemoGate.reasons.join(" "), /hash/i);
});

test("Artifact review diagnostics reject unrelated immutable sources", () => {
  const diagnostics = inspectArtifactReviewPackageDiagnostics({
    content: decision,
    contentHash: hash,
    sourceRefs: ["source:unrelated:news"],
    executionReceiptIds: ["receipt:deterministic:1"],
    approval: approved(),
  });

  assert.equal(diagnostics.snapshotAudit.sourceCount, 1);
  assert.equal(diagnostics.icMemoGate.posture, "review_required");
  assert.match(diagnostics.icMemoGate.reasons.join(" "), /source.*match|immutable.*source|evidence/i);
});

test("FinRobot target withhold is composed into exact-P4 review diagnostics without weakening IC gate", () => {
  const content = artifactContentSchema.parse({
    kind: "valuation", symbol: "ABC", modelId: "dcf",
    assumptions: {}, summary: {},
    outputs: { structured: {
      valuation_withheld: true,
      thesis: { price_target: null },
      implied_price: 987.65,
    } },
  });
  const diagnostics = inspectArtifactReviewPackageDiagnostics({
    content,
    contentHash: hash,
    sourceRefs: ["source:filing:10k"],
    executionReceiptIds: ["receipt:deterministic:1"],
    approval: null,
  });
  assert.equal(diagnostics.icMemoGate.posture, "not_applicable");
  assert.ok(diagnostics.targetSection);
  assert.match(diagnostics.targetSection.title, /unverified, not investment advice/);
  assert.match(diagnostics.targetSection.text, /"status": "withheld"/);
  assert.match(diagnostics.targetSection.text, /"targetPrice": null/);
  assert.doesNotMatch(diagnostics.targetSection.text, /987\.65/);
  assert.equal(diagnostics.snapshotAudit.sourceHash, hash);
});

test("FinRobot IC decision review remains distinct from saved valuation target gate", () => {
  const diagnostics = inspectArtifactReviewPackageDiagnostics({
    content: decision,
    contentHash: hash,
    sourceRefs: ["source:filing:10k"],
    executionReceiptIds: ["receipt:deterministic:1"],
    approval: approved(),
  });
  assert.equal(diagnostics.icMemoGate.posture, "governed_review");
  assert.equal(diagnostics.targetSection, null);
});

test("readable review composition retains exact diagnostic, receipt and snapshot-only approval data", () => {
  const approval = approved();
  const note: ArtifactInteractionReceiptRow = {
    id: "00000000-0000-4000-8000-000000000001", artifactId: approval.artifactId,
    action: "inspect_source", actorType: "user", fromVersion: 4, toVersion: 4,
    requestId: null, createdByUserId: 13, createdAt: new Date("2026-10-12T01:00:00.000Z"),
    detail: { reviewNote: { version: 4, contentHash: hash, text: "Confirm downside case", status: "open", anchor: "base" },
      opaque: { decimal: "000123.450000", formula: "=A1+B2", evidence: [null, false, { source: "source:filing:10k" }] } },
  };
  const diagnosticInput = {
    content: decision, contentHash: hash, sourceRefs: ["source:filing:10k"],
    executionReceiptIds: ["receipt:deterministic:1"], approval,
  };
  const diagnostics = inspectArtifactReviewPackageDiagnostics(diagnosticInput);
  const reviewSections = composeArtifactReviewSections({ ...diagnosticInput, notes: [note] });
  const input = professionalWorkPackageRequestSchema.parse({
    projectId: 17, workflow: "ic_memo", title: "Exact review", audience: "Reviewers", reportingPeriod: "v4",
    sources: [{ artifactId: approval.artifactId, version: 4, contentHash: hash, role: "decision" }],
    authoredSections: [{ title: "Review scope", text: "Recorded review" }],
  });
  const output = assembleProfessionalWorkPackage(input, [{
    id: approval.artifactId, version: 4, hash, title: "Decision", role: "decision", content: decision,
    sourceRefs: diagnosticInput.sourceRefs,
  }], { reviewSections });
  if (output.content.kind !== "report") throw new Error("Expected report");
  const blocks = output.content.blocks;
  const recorded = (title: string) => blocks.find(block => block.type === "heading" && block.text === title)!.attrs.recordedReviewSection;
  assert.deepEqual(recorded("IC memo decision gate"), diagnostics.icMemoGate);
  assert.deepEqual(recorded("Version-bound review history"), [{ ...note, createdAt: note.createdAt.toISOString() }]);
  assert.deepEqual(recorded("Canonical linked receipt approval snapshot"), reviewSections[3].content);
  const wrapper = recorded("Canonical linked receipt approval snapshot");
  assert.ok(wrapper && typeof wrapper === "object" && "authority" in wrapper && "inspection" in wrapper);
  assert.equal(wrapper.authority, "snapshot_only");
  assert.deepEqual(wrapper.inspection, approval);
  assert.deepEqual(recorded("Recorded source snapshot and data warnings"), {
    audit: diagnostics.snapshotAudit, sourceRefs: diagnosticInput.sourceRefs, executionReceiptIds: diagnosticInput.executionReceiptIds,
  });
  assert.deepEqual(blocks.find(block => block.id === "source-heading-0")!.attrs.sourceContent, decision);
  assert.ok(blocks.some(block => block.type === "table"));
  assert.ok(blocks.some(block => block.type === "bullet_list" && block.text.includes("Recorded thesis")));
  assert.ok(blocks.some(block => block.text.includes("not approval of this review package")));
  assert.ok(!blocks.some(block => block.type === "code" || /^[\s]*[{\[]/.test(block.text)));
  assert.ok(!blocks.some(block => block.text.startsWith("Not supplied:")));
  assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length);
  assert.deepEqual(approval, approved());
});

for (const state of ["unlinked", "waived", "stale", "unavailable"] as const) {
  test(`readable review retains ${state} approval and exact gate reasons without granting authority`, () => {
    const approval = { ...approved(), state, reason: `Recorded ${state} explanation` };
    const input = { content: decision, contentHash: hash, sourceRefs: [], executionReceiptIds: [], approval, notes: [] };
    const diagnostics = inspectArtifactReviewPackageDiagnostics(input);
    const sections = composeArtifactReviewSections(input);
    assert.equal(diagnostics.icMemoGate.posture, "review_required");
    assert.deepEqual(sections[1].content, diagnostics.icMemoGate);
    assert.ok(diagnostics.icMemoGate.reasons.some(reason => /source/i.test(reason)));
    assert.equal(diagnostics.icMemoGate.approvalGranted, false);
    const wrapper = sections[3].content;
    assert.ok(wrapper && typeof wrapper === "object" && "inspection" in wrapper);
    assert.deepEqual(wrapper.inspection, approval);
    assert.equal(typeof sections[2].content, "string");
  });
}

test("readable valuation review projects the withheld trust gate rather than a raw fallback target", () => {
  const content = artifactContentSchema.parse({
    kind: "valuation", symbol: "ABC", modelId: "dcf", assumptions: {}, summary: {},
    outputs: { structured: { valuation_withheld: true, thesis: { price_target: null }, implied_price: 987.65 } },
  });
  const sections = composeArtifactReviewSections({
    content, contentHash: hash, sourceRefs: [], executionReceiptIds: [], approval: null, notes: [],
  });
  const target = sections.find(section => /valuation target trust gate/.test(section.title))!;
  assert.ok(target.content && typeof target.content === "object" && "status" in target.content && "targetPrice" in target.content);
  assert.equal(target.content.status, "withheld");
  assert.equal(target.content.targetPrice, null);
  assert.ok(!JSON.stringify(target.content).includes("987.65"));
});
