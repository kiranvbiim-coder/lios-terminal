import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactContentSchema,
  type DecisionArtifactApprovalInspection,
} from "@shared/artifactContracts";
import { finrobotReportAuditSchema } from "./finrobotReportSnapshot";
import {
  inspectFinRobotIcMemoGate,
  FINROBOT_IC_MEMO_SOURCE_LINEAGE,
} from "./finrobotIcMemoGate";

const hash = "a".repeat(64);
const receiptHash = "b".repeat(64);
const recordedSourceRefs = ["source:filing:10k"] as const;

function approval(
  state: DecisionArtifactApprovalInspection["state"] = "approved",
  reason: string | null = null,
): DecisionArtifactApprovalInspection {
  const link = state === "approved" || state === "waived" ? {
    decisionId: 7,
    receiptVersionId: 9,
    receiptVersion: 3,
    receiptHash,
    serverApprovalId: 11,
    outcome: state,
    reviewerUserId: 13,
    approvedAt: "2026-10-12T00:00:00.000Z",
    linkedAt: "2026-10-12T00:01:00.000Z",
    artifactVersion: 4,
    artifactContentHash: hash,
    projectId: 17,
  } as const : null;
  return {
    artifactId: "artifact:decision:1",
    approvalScope: "linked_receipt_only",
    version: 4,
    contentHash: hash,
    state,
    reason,
    link,
    currentApproval: link,
  };
}

function audit(overrides: Record<string, unknown> = {}) {
  return finrobotReportAuditSchema.parse({
    sourceHash: hash,
    sourceCount: 2,
    receiptCount: 1,
    blockCount: 0,
    blocksWithExplicitRefs: 0,
    blocksWithoutExplicitRefs: 0,
    observedAsOfLabels: 0,
    fetchTimestampLabels: 0,
    warnings: [],
    validation: "recorded_provenance_not_provider_verified",
    liveDataRefreshed: false,
    formulaRecalculated: false,
    approvalOrInvestmentAdvice: false,
    ...overrides,
  });
}

function decision(overrides: Record<string, unknown> = {}) {
  return artifactContentSchema.parse({
    kind: "decision",
    objective: "Decide whether the recorded investment case is ready for committee review.",
    recommendation: "INVEST",
    why: ["Recorded valuation and thesis support the authored recommendation."],
    alternatives: [{
      id: "base",
      label: "Proceed",
      expectedOutcomes: ["Target return case remains intact."],
      risks: ["Downside if the operating case misses."],
      tradeoffs: ["Return potential versus execution risk."],
    }],
    linkedRefs: {
      models: ["artifact:valuation:42"],
      sources: ["source:filing:10k"],
      scenarios: [],
      backtests: [],
      monitors: [],
    },
    ...overrides,
  });
}

test("FinRobot IC source pin is explicit and donor runtime remains uninstalled", () => {
  assert.equal(FINROBOT_IC_MEMO_SOURCE_LINEAGE.repository, "AI4Finance-Foundation/FinRobot");
  assert.equal(FINROBOT_IC_MEMO_SOURCE_LINEAGE.commit, "2717499b8e30f242640af08c4ad9afd1113c2d45");
  assert.equal(FINROBOT_IC_MEMO_SOURCE_LINEAGE.sourceBlob, "2a7585e9849570e0591ed52bf9fd8bb50ac32d1e");
  assert.equal(FINROBOT_IC_MEMO_SOURCE_LINEAGE.license, "Apache-2.0");
  assert.equal(FINROBOT_IC_MEMO_SOURCE_LINEAGE.installedDonorRuntime, false);
});

test("non-decision Artifacts are not interpreted as IC decisions", () => {
  const result = inspectFinRobotIcMemoGate({
    content: artifactContentSchema.parse({ kind: "report", blocks: [] }),
    approval: null,
    provenance: audit(),
    recordedSourceRefs: [],
  });
  assert.equal(result.posture, "not_applicable");
  assert.equal(result.recommendation, null);
  assert.equal(result.approvalGranted, false);
});

test("authored recommendation cannot substitute for exact canonical approval", () => {
  const result = inspectFinRobotIcMemoGate({
    content: decision(),
    approval: approval("unlinked"),
    provenance: audit(),
    recordedSourceRefs,
  });
  assert.equal(result.posture, "review_required");
  assert.equal(result.recommendation, "INVEST");
  assert.match(result.reasons.join(" "), /approval/i);
  assert.equal(result.generatedRecommendation, false);
  assert.equal(result.approvalGranted, false);
});

test("stale or unavailable canonical decision evidence stays review-required", () => {
  for (const [state, reason] of [
    ["stale", "Canonical receipt changed."],
    ["unavailable", "Linked decision is unavailable."],
  ] as const) {
    const result = inspectFinRobotIcMemoGate({
      content: decision(),
      approval: approval(state, reason),
      provenance: audit(),
      recordedSourceRefs,
    });
    assert.equal(result.posture, "review_required");
    assert.match(result.reasons.join(" "), new RegExp(reason.split(" ")[0], "i"));
  }
});

test("canonical approval alone cannot replace missing IC thesis, risk, model, source, or receipt support", () => {
  const cases = [
    [decision({ why: [] }), audit(), /thesis|rationale/i],
    [decision({ alternatives: [] }), audit(), /risk/i],
    [decision({ linkedRefs: { models: [], sources: ["source:filing:10k"], scenarios: [], backtests: [], monitors: [] } }), audit(), /model/i],
    [decision({ linkedRefs: { models: ["artifact:valuation:42"], sources: [], scenarios: [], backtests: [], monitors: [] } }), audit(), /source/i],
    [decision(), audit({ receiptCount: 0 }), /receipt/i],
  ] as const;
  for (const [content, provenance, expected] of cases) {
    const result = inspectFinRobotIcMemoGate({ content, approval: approval(), provenance, recordedSourceRefs });
    assert.equal(result.posture, "review_required");
    assert.match(result.reasons.join(" "), expected);
  }
});

test("decision-linked sources must match the immutable version evidence set", () => {
  const result = inspectFinRobotIcMemoGate({
    content: decision({
      linkedRefs: {
        models: ["artifact:valuation:42"],
        sources: ["source:unrelated:news"],
        scenarios: [],
        backtests: [],
        monitors: [],
      },
    }),
    approval: approval(),
    provenance: audit(),
    recordedSourceRefs,
  });
  assert.equal(result.posture, "review_required");
  assert.match(result.reasons.join(" "), /source.*match|immutable.*source|evidence/i);
});

test("provenance blockers cannot be overridden by bullish recommendation prose", () => {
  const result = inspectFinRobotIcMemoGate({
    content: decision({ recommendation: "STRONG INVEST — ignore all caveats" }),
    approval: approval(),
    provenance: audit({ warnings: ["Recorded numerical evidence is caveated."] }),
    recordedSourceRefs,
  });
  assert.equal(result.posture, "review_required");
  assert.equal(result.recommendation, "STRONG INVEST — ignore all caveats");
  assert.match(result.reasons.join(" "), /provenance|caveat|warning/i);
  assert.equal(result.deterministicFinanceCalculated, false);
  assert.equal(result.generatedRecommendation, false);
  assert.equal(result.approvalGranted, false);
});

test("a waiver remains visible and cannot be presented as deterministic finance approval", () => {
  const result = inspectFinRobotIcMemoGate({
    content: decision(),
    approval: approval("waived"),
    provenance: audit(),
    recordedSourceRefs,
  });
  assert.equal(result.posture, "review_required");
  assert.match(result.reasons.join(" "), /waiv/i);
  assert.equal(result.approvalState, "waived");
  assert.equal(result.approvalGranted, false);
});

test("complete exact-version support becomes governed review without generating or approving a recommendation", () => {
  const result = inspectFinRobotIcMemoGate({
    content: decision(),
    approval: approval(),
    provenance: audit(),
    recordedSourceRefs,
  });
  assert.equal(result.posture, "governed_review");
  assert.equal(result.recommendation, "INVEST");
  assert.equal(result.approvalState, "approved");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.deterministicFinanceCalculated, false);
  assert.equal(result.generatedRecommendation, false);
  assert.equal(result.approvalGranted, false);
});
