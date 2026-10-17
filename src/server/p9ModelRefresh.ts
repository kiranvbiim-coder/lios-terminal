import type { ProjectAutomationRun, ProjectAutomationWorkflow } from "@shared/schema";
import type { P9WorkflowRunResult } from "@shared/p9AutomationContracts";
import type { TenantContext } from "./tenantContext";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { listArtifactModelMaintenanceOptions, reviewArtifactModelMaintenance } from "./artifactModelMaintenance";
import { hashLedgerValue } from "./ledgerStore";

export interface ModelRefreshReviewAction {
  kind: "model_refresh_review";
  acceptedArtifact: { artifactId: string; version: number; contentHash: string };
  sourceProvider: string;
  engineRev: string;
}

export async function requireP9ModelRefreshReview(ctx: TenantContext, projectId: number, action: ModelRefreshReviewAction) {
  if (ctx.role !== "internal_admin" && ctx.role !== "internal_analyst") throw new Error("Model refresh review requires current model-author authority.");
  const artifact = await getArtifact(ctx, action.acceptedArtifact.artifactId);
  if (artifact.projectId !== projectId || artifact.kind !== "spreadsheet" || artifact.headVersion !== action.acceptedArtifact.version) throw new Error("Accepted model head changed; explicitly review and bind the current saved model before monitoring again.");
  const version = await getArtifactVersion(ctx, artifact.id, action.acceptedArtifact.version);
  if (version.contentHash !== action.acceptedArtifact.contentHash) throw new Error("Accepted model content hash does not match retained custody.");
  const options = await listArtifactModelMaintenanceOptions(ctx, artifact.id, { version: action.acceptedArtifact.version, contentHash: action.acceptedArtifact.contentHash });
  if (options.engineRev !== action.engineRev) throw new Error("Model engine revision changed; a new explicit monitor acceptance is required.");
  return { artifact, version, options };
}

/** Observe eligible immutable snapshots and produce an exact review; never apply, overwrite, or approve owner work. */
export async function runP9ModelRefreshReview(ctx: TenantContext, workflow: ProjectAutomationWorkflow, action: ModelRefreshReviewAction, previous: ProjectAutomationRun | null): Promise<P9WorkflowRunResult> {
  const { artifact, options } = await requireP9ModelRefreshReview(ctx, workflow.projectId, action);
  const targets = options.targets.filter(target => target.provider === action.sourceProvider).sort((a, b) => Date.parse(b.availableAt) - Date.parse(a.availableAt));
  const latest = targets[0];
  if (latest && targets[1]?.availableAt === latest.availableAt && targets[1]?.contentHash !== latest.contentHash) throw new Error("Multiple different source revisions have the same availability time; choose the immutable snapshot explicitly in model maintenance.");
  const review = latest ? await reviewArtifactModelMaintenance(ctx, artifact.id, {
    version: action.acceptedArtifact.version, contentHash: action.acceptedArtifact.contentHash,
    targetDatasetSnapshotId: latest.id, targetContentHash: latest.contentHash,
  }) : null;
  const outputHash = hashLedgerValue(review ? { reviewHash: review.reviewHash, target: latest?.contentHash, baseline: action.acceptedArtifact, engineRev: action.engineRev } : { baseline: action.acceptedArtifact, provider: action.sourceProvider, noEligibleSource: true });
  const changed = Boolean(review) && previous?.output.outputHash !== outputHash;
  return {
    summary: review ? `${review.changes.length} reported-source changes are ready for explicit model review; ${review.preservedCells.length} authored/formula/override cells remain protected. No model update was applied.` : "No newer eligible immutable source is available for this accepted model/provider. No fetch or model update was performed.",
    changed, conditionMet: changed, relevanceScore: changed ? 0.9 : 0.1,
    sourceRefs: [...new Set([...workflow.sourceRefs, ...review?.sourceRefs ?? [], ...(latest ? [`snapshot:${latest.id}`, `snapshot-sha256:${latest.contentHash}`] : [])])],
    engineRefs: [action.engineRev], artifactRefs: [artifact.id], executionReceiptIds: [],
    output: { outputHash, mode: "review_only", applied: false, acceptedArtifact: action.acceptedArtifact, sourceProvider: action.sourceProvider, review },
  };
}
