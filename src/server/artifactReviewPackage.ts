import { z } from "zod";
import {
  artifactContentSchema,
  type ArtifactContent,
  type DecisionArtifactApprovalInspection,
} from "@shared/artifactContracts";
import { inspectFinRobotIcMemoGate } from "./finrobotIcMemoGate";
import { inspectFinRobotReportSnapshot } from "./finrobotReportSnapshot";
import { recordedValuationReviewSection } from "./finrobotValuationHeadline";
import { getArtifact, getArtifactVersion, listArtifactInteractionReceipts } from "./artifactStore";
import { createProfessionalWorkPackage } from "./professionalWorkPackage";
import { getDecisionObjectArtifactApproval } from "./decisionObjectArtifact";
import type { TenantContext } from "./tenantContext";

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
  const { snapshotAudit, icMemoGate, targetSection } = inspectArtifactReviewPackageDiagnostics({
    content,
    contentHash: version.contentHash,
    sourceRefs: version.sourceRefs,
    executionReceiptIds: version.executionReceiptIds,
    approval,
  });

  return createProfessionalWorkPackage(ctx, {
    projectId: artifact.projectId,
    workflow: "ic_memo",
    title: `${artifact.title} review v${input.version}`,
    audience: "Authorized Project reviewers",
    reportingPeriod: `Recorded revision v${input.version}`,
    sources: [{
      artifactId,
      version: input.version,
      contentHash: input.contentHash,
      role: "decision",
    }],
    authoredSections: [
      {
        title: "Executive recommendation",
        text: "Review package preserves recorded annotations and existing decision-receipt references only. Comments do not approve content or authorize execution.",
      },
      {
        title: "IC memo decision gate",
        text: JSON.stringify(icMemoGate, null, 2),
      },
      {
        title: "Version-bound review history",
        text: JSON.stringify(notes.map(receipt => ({
          id: receipt.id,
          authorUserId: receipt.createdByUserId,
          at: receipt.createdAt,
          ...receipt.detail,
        })), null, 2),
      },
      {
        title: "Canonical linked receipt approval",
        text: approval
          ? JSON.stringify(approval, null, 2)
          : "No Decision receipt approval applies to this source kind.",
      },
      {
        title: "Recorded source snapshot and data warnings",
        text: JSON.stringify(snapshotAudit, null, 2),
      },
      ...(targetSection ? [targetSection] : []),
    ],
  });
}
