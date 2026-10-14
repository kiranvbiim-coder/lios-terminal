import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactContentSchema,
  type DecisionArtifactApprovalInspection,
} from "@shared/artifactContracts";
import { inspectArtifactReviewPackageDiagnostics } from "./artifactReviewPackage";

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
