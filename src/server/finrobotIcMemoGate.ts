/**
 * FinRobot-derived Investment Committee review gate.
 *
 * Source pin: AI4Finance-Foundation/FinRobot
 * 2717499b8e30f242640af08c4ad9afd1113c2d45 (Apache-2.0).
 * Primary mechanism: finrobot_desktop/finrobot/engine/pipelines/ic_memo.py
 * blob 2a7585e9849570e0591ed52bf9fd8bb50ac32d1e.
 * Upstream validation reference:
 * finrobot_desktop/tests/artifact/test_numeric_audit_gate.py
 * blob 4e396172a46125607c1de38bdd187537ed44ffc3.
 *
 * LiOS adaptation: preserve the donor invariant that narrative recommendation
 * text cannot substitute for deterministic financial/evidence gates. This
 * module performs no finance calculation, approval, recommendation generation,
 * data refresh, provider access, or action. P4/P7/P11 remain authoritative.
 * FinRobot's donor-specific sponsor IRR threshold is deliberately NOT adopted.
 */
import { z } from "zod";
import type {
  ArtifactContent,
  DecisionArtifactApprovalInspection,
} from "@shared/artifactContracts";
import { finrobotReportAuditSchema } from "./finrobotReportSnapshot";

export const FINROBOT_IC_MEMO_SOURCE_LINEAGE = Object.freeze({
  repository: "AI4Finance-Foundation/FinRobot",
  commit: "2717499b8e30f242640af08c4ad9afd1113c2d45",
  sourcePath: "finrobot_desktop/finrobot/engine/pipelines/ic_memo.py",
  sourceBlob: "2a7585e9849570e0591ed52bf9fd8bb50ac32d1e",
  upstreamTestPath: "finrobot_desktop/tests/artifact/test_numeric_audit_gate.py",
  upstreamTestBlob: "4e396172a46125607c1de38bdd187537ed44ffc3",
  license: "Apache-2.0",
  installedDonorRuntime: false,
  donorIrrThresholdAdopted: false,
});

export const finrobotIcMemoGateSchema = z.object({
  posture: z.enum(["not_applicable", "review_required", "governed_review"]),
  recommendation: z.string().max(20_000).nullable(),
  approvalState: z.enum(["unlinked", "approved", "waived", "stale", "unavailable"]).nullable(),
  reasons: z.array(z.string().trim().min(1).max(500)).max(24),
  deterministicFinanceCalculated: z.literal(false),
  generatedRecommendation: z.literal(false),
  approvalGranted: z.literal(false),
  liveDataRefreshed: z.literal(false),
}).strict();
export type FinRobotIcMemoGate = z.infer<typeof finrobotIcMemoGateSchema>;

type FinRobotReportAudit = z.infer<typeof finrobotReportAuditSchema>;

export interface InspectFinRobotIcMemoGateInput {
  content: ArtifactContent;
  approval: DecisionArtifactApprovalInspection | null;
  provenance: FinRobotReportAudit;
  recordedSourceRefs: readonly string[];
}

function result(
  posture: FinRobotIcMemoGate["posture"],
  recommendation: string | null,
  approvalState: FinRobotIcMemoGate["approvalState"],
  reasons: string[],
): FinRobotIcMemoGate {
  return finrobotIcMemoGateSchema.parse({
    posture,
    recommendation,
    approvalState,
    reasons,
    deterministicFinanceCalculated: false,
    generatedRecommendation: false,
    approvalGranted: false,
    liveDataRefreshed: false,
  });
}

/**
 * Inspect an already-owned immutable P4 Artifact version.
 *
 * `governed_review` means only that the recorded decision body is sufficiently
 * structured for human committee review and that the canonical exact-version
 * approval inspection is currently approved. It is NOT an investment approval,
 * P11 calculation result, suitability determination, or authorization to act.
 */
export function inspectFinRobotIcMemoGate(input: InspectFinRobotIcMemoGateInput): FinRobotIcMemoGate {
  const provenance = finrobotReportAuditSchema.parse(input.provenance);
  const content = input.content;

  if (content.kind !== "decision") {
    return result("not_applicable", null, null, []);
  }

  const recommendation = typeof content.recommendation === "string"
    ? content.recommendation
    : null;
  const reasons: string[] = [];
  const approval = input.approval;

  if (!recommendation?.trim()) {
    reasons.push("No authored committee recommendation is recorded for this decision version.");
  }

  if (!approval) {
    reasons.push("No canonical exact-version decision approval inspection is available.");
  } else if (approval.state === "waived") {
    reasons.push("Canonical review is waived; a waiver is not deterministic finance approval and requires human review.");
  } else if (approval.state !== "approved") {
    reasons.push(
      approval.reason?.trim()
        ? `Canonical decision approval is ${approval.state}: ${approval.reason.trim()}`
        : `Canonical decision approval is ${approval.state}; exact approved review authority is required.`,
    );
  }

  if (content.why.length === 0) {
    reasons.push("Investment thesis or decision rationale is not recorded.");
  }

  const hasRisk = content.alternatives.some((alternative) => alternative.risks.length > 0)
    || content.uncertainties.length > 0
    || (content.dissent?.length ?? 0) > 0;
  if (!hasRisk) {
    reasons.push("Risk or counter-case evidence is not recorded for committee review.");
  }

  if (content.linkedRefs.models.length === 0) {
    reasons.push("No recorded model reference supports the authored recommendation.");
  }

  const immutableSourceRefs = new Set(input.recordedSourceRefs);
  const hasBoundSource = content.linkedRefs.sources.some((sourceRef) => immutableSourceRefs.has(sourceRef));
  if (content.linkedRefs.sources.length === 0 || provenance.sourceCount === 0) {
    reasons.push("No recorded source evidence supports the authored recommendation.");
  } else if (!hasBoundSource) {
    reasons.push("Decision-linked source evidence does not match the immutable Artifact version source references.");
  }

  if (provenance.receiptCount === 0) {
    reasons.push("No execution receipt is recorded for the immutable decision version.");
  }
  if (provenance.warnings.length > 0) {
    reasons.push("Recorded provenance has warnings or caveats that require human review.");
  }

  if (approval && approval.contentHash !== provenance.sourceHash) {
    reasons.push("Canonical approval and immutable provenance hashes do not match.");
  }

  return result(
    reasons.length === 0 ? "governed_review" : "review_required",
    recommendation,
    approval?.state ?? null,
    reasons,
  );
}
