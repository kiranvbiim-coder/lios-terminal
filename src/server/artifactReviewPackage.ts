import { z } from "zod";
import {
  artifactContentSchema,
  type ArtifactContent,
  type DecisionArtifactApprovalInspection,
} from "@shared/artifactContracts";
import { inspectFinRobotIcMemoGate } from "./finrobotIcMemoGate";
import { inspectFinRobotReportSnapshot } from "./finrobotReportSnapshot";
import { inspectRecordedValuationHeadline, recordedValuationReviewSection } from "./finrobotValuationHeadline";
import { getArtifact, getArtifactVersion, listArtifactInteractionReceipts } from "./artifactStore";
import { createProfessionalWorkPackage } from "./professionalWorkPackage";
import { getDecisionObjectArtifactApproval } from "./decisionObjectArtifact";
import type { TenantContext } from "./tenantContext";
import type { ReportSection } from "./reportEngine";
import type { ArtifactInteractionReceiptRow } from "@shared/schema";

export interface ArtifactReviewPackageDiagnosticsInput {
  content: ArtifactContent;
  contentHash: string;
  sourceRefs: readonly string[];
  executionReceiptIds: readonly string[];
  approval: DecisionArtifactApprovalInspection | null;
}

/**
 * Pure, read-only projection for the exact immutable Artifact version already
 * loaded by P4. It composes existing FinRobot-derived provenance and IC-review
 * diagnostics without introducing another Artifact, approval, finance, or
 * evidence authority.
 */
export function inspectArtifactReviewPackageDiagnostics(input: ArtifactReviewPackageDiagnosticsInput) {
  const snapshotAudit = inspectFinRobotReportSnapshot({
    contentHash: input.contentHash,
    sourceRefs: [...input.sourceRefs],
    executionReceiptIds: [...input.executionReceiptIds],
    content: input.content,
  });
  const icMemoGate = inspectFinRobotIcMemoGate({
    content: input.content,
    approval: input.approval,
    provenance: snapshotAudit,
    recordedSourceRefs: input.sourceRefs,
  });
  const targetSection = recordedValuationReviewSection(input.content);

  return { snapshotAudit, icMemoGate, targetSection } as const;
}


/** Only presentation: original diagnostics, receipt details and approval inspection
 * remain structured in section attrs when the existing report projector renders them. */
export function composeArtifactReviewSections(
  input: ArtifactReviewPackageDiagnosticsInput & { notes: readonly ArtifactInteractionReceiptRow[] },
): ReportSection[] {
  const { snapshotAudit, icMemoGate } = inspectArtifactReviewPackageDiagnostics(input);
  const sections: ReportSection[] = [
    {
      type: "summary", title: "Review scope", order: 0,
      content: "This package preserves the exact recorded source revision, annotations and linked receipt references. It does not refresh data, recalculate finance, generate a recommendation, approve content or authorize execution.",
    },
    { type: "key_metrics", title: "IC memo decision gate", order: 1, content: icMemoGate },
    {
      type: "table", title: "Version-bound review history", order: 2,
      content: input.notes.length ? input.notes.map(receipt => ({
        ...receipt,
        createdAt: receipt.createdAt.toISOString(),
      })) : "No review notes are recorded for this exact revision.",
    },
    {
      type: "decision_receipt", title: "Canonical linked receipt approval snapshot", order: 3,
      content: {
        authority: "snapshot_only",
        summary: "Historical inspection of the source revision only. This wrapper is not approval of this review package, does not transfer approval to it and grants no execution permission.",
        inspection: input.approval,
        ...(!input.approval ? { limitation: "No Decision receipt approval applies to this source kind." } : {}),
      },
    },
    {
      type: "sources", title: "Recorded source snapshot and data warnings", order: 4,
      content: {
        audit: snapshotAudit,
        sourceRefs: [...input.sourceRefs],
        executionReceiptIds: [...input.executionReceiptIds],
      },
    },
  ];
  if (input.content.kind === "valuation") sections.push({
    type: "key_metrics", title: "Recorded valuation target trust gate (unverified, not investment advice)",
    order: sections.length, content: inspectRecordedValuationHeadline(input.content),
  });
  return sections;
}

export async function createArtifactReviewPackage(ctx: TenantContext, artifactId: string, raw: unknown) {
  const input = z.object({
    version: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().parse(raw);
  const artifact = await getArtifact(ctx, artifactId);
  const version = await getArtifactVersion(ctx, artifactId, input.version);
  if (version.contentHash !== input.contentHash) throw new Error("Review package source hash changed.");

  const notes = (await listArtifactInteractionReceipts(ctx, artifactId))
    .filter(receipt => receipt.toVersion === input.version && receipt.detail.reviewNote);
  const approval = artifact.kind === "decision"
    ? await getDecisionObjectArtifactApproval(ctx, artifactId, input.version)
    : null;
  const content = artifactContentSchema.parse(version.content);

  // FinRobot-derived read-only diagnostics use only this already-owned,
  // hash-matched immutable P4 version. They never refetch live market values,
  // recalculate finance, grant approval, or generate an investment recommendation.
  const reviewSections = composeArtifactReviewSections({
    content,
    contentHash: version.contentHash,
    sourceRefs: version.sourceRefs,
    executionReceiptIds: version.executionReceiptIds,
    approval,
    notes,
  });

  return createProfessionalWorkPackage(ctx, {
    projectId: artifact.projectId,
    workflow: "ic_memo",
    title: `${artifact.title} review v${input.version}`,
    audience: artifact.projectId === null ? "Authorized originating Chat reviewer" : "Authorized Project reviewers",
    reportingPeriod: `Recorded revision v${input.version}`,
    sources: [{
      artifactId,
      version: input.version,
      contentHash: input.contentHash,
      role: artifact.kind === "decision" ? "decision" : "evidence",
    }],
    authoredSections: [{ title: "Review scope", text: "Recorded immutable review, not an approval or execution instruction." }],
  }, {
    reviewSections,
    owningChatId: artifact.projectId === null ? artifact.owningChatId : null,
  });
}
