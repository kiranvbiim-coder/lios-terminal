import type { ArtifactModelMaintenanceApplyRequest, ArtifactModelMaintenanceRequest, ArtifactModelMaintenanceReview, ArtifactModelMaintenanceResult, ArtifactModelMaintenanceTarget } from "@shared/artifactModelMaintenance";
import type { EngineInputRevision } from "./artifactEngineInputReview";

export interface ModelMaintenanceContext extends EngineInputRevision { available: boolean }
export interface ModelMaintenanceReviewState {
  selected: ArtifactModelMaintenanceTarget | null;
  pending: "review" | "apply" | null;
  review: ArtifactModelMaintenanceReview | null;
  result: ArtifactModelMaintenanceResult | null;
  error: string | null;
}
export const initialModelMaintenanceReviewState: ModelMaintenanceReviewState = { selected: null, pending: null, review: null, result: null, error: null };

function sameContext(a: ModelMaintenanceContext, b: ModelMaintenanceContext): boolean {
  return a.artifactId === b.artifactId && a.projectId === b.projectId && a.version === b.version
    && a.headVersion === b.headVersion && a.contentHash === b.contentHash && a.available === b.available;
}
export function modelMaintenanceReviewMatches(review: ArtifactModelMaintenanceReview, context: ModelMaintenanceContext, target: ArtifactModelMaintenanceTarget | null): boolean {
  return context.available && context.version === context.headVersion && target !== null
    && review.artifactId === context.artifactId && review.version === context.version && review.contentHash === context.contentHash
    && review.targetDatasetSnapshotId === target.id && review.targetContentHash === target.contentHash
    && review.target.id === target.id && review.target.contentHash === target.contentHash;
}

interface MaintenanceTransport {
  review: (artifactId: string, input: ArtifactModelMaintenanceRequest) => Promise<ArtifactModelMaintenanceReview>;
  apply: (artifactId: string, input: ArtifactModelMaintenanceApplyRequest) => Promise<ArtifactModelMaintenanceResult>;
}

/** Ephemeral selection/review only. P4 and P11 retain all write, source and execution authority. */
export class ArtifactModelMaintenanceReviewSession {
  private state = initialModelMaintenanceReviewState;
  private context: ModelMaintenanceContext;
  private generation = 0;
  private active = true;
  private applying = false;

  constructor(private readonly current: () => ModelMaintenanceContext, private readonly transport: MaintenanceTransport, private readonly publish: (state: ModelMaintenanceReviewState) => void) {
    this.context = current();
  }
  private update(state: ModelMaintenanceReviewState): void { this.state = state; if (this.active) this.publish(state); }
  reconcile(): void {
    const next = this.current();
    if (sameContext(next, this.context)) return;
    const hadReview = this.state.review !== null || this.state.pending !== null;
    this.context = next;
    this.generation++;
    this.update({ ...initialModelMaintenanceReviewState, pending: this.applying ? "apply" : null,
      error: hadReview ? "The saved revision or author availability changed. Select a snapshot and review the current saved head again." : null });
  }
  select(target: ArtifactModelMaintenanceTarget | null): void {
    if (!this.active || this.applying) return;
    this.reconcile();
    this.generation++;
    this.update({ ...initialModelMaintenanceReviewState, selected: target });
  }
  private accepts(generation: number, context: ModelMaintenanceContext): boolean {
    if (!this.active || generation !== this.generation) return false;
    if (!sameContext(context, this.current())) { this.reconcile(); return false; }
    return true;
  }
  async review(): Promise<void> {
    if (!this.active || this.applying || this.state.pending) return;
    this.reconcile();
    const context = { ...this.current() }, target = this.state.selected;
    if (!context.available || context.version !== context.headVersion || !target) {
      this.update({ ...this.state, review: null, error: "Select an available owned snapshot for the current saved head before reviewing." });
      return;
    }
    const generation = ++this.generation;
    this.update({ ...this.state, pending: "review", review: null, result: null, error: null });
    try {
      const review = await this.transport.review(context.artifactId, { version: context.version, contentHash: context.contentHash, targetDatasetSnapshotId: target.id, targetContentHash: target.contentHash });
      if (!this.accepts(generation, context)) return;
      if (!modelMaintenanceReviewMatches(review, context, target)) throw new Error("The review does not match the saved head and selected immutable snapshot. Reload and review again.");
      this.update({ ...this.state, pending: null, review });
    } catch (cause) {
      if (this.accepts(generation, context)) this.update({ ...this.state, pending: null, review: null, error: cause instanceof Error ? cause.message : "Model maintenance review failed." });
    }
  }
  async apply(): Promise<void> {
    if (!this.active || this.applying || this.state.pending) return;
    this.reconcile();
    const context = { ...this.current() }, review = this.state.review;
    if (!review || !modelMaintenanceReviewMatches(review, context, this.state.selected)) {
      this.update({ ...this.state, review: null, error: "Review the current saved head and selected snapshot before applying." });
      return;
    }
    const generation = ++this.generation;
    this.applying = true;
    this.update({ ...this.state, pending: "apply", result: null, error: null });
    try {
      const result = await this.transport.apply(context.artifactId, { version: review.version, contentHash: review.contentHash, targetDatasetSnapshotId: review.targetDatasetSnapshotId, targetContentHash: review.targetContentHash, reviewHash: review.reviewHash });
      if (!this.accepts(generation, context)) return;
      if (!modelMaintenanceReviewMatches(result.review, context, this.state.selected) || result.review.reviewHash !== review.reviewHash
        || result.review.engineRev !== review.engineRev || result.review.inputHash !== review.inputHash
        || result.review.source.datasetSnapshotId !== review.source.datasetSnapshotId
        || result.review.source.datasetContentHash !== review.source.datasetContentHash || result.review.source.runId !== review.source.runId
        || result.artifact.id !== context.artifactId || result.artifact.projectId !== context.projectId
        || result.version.artifactId !== context.artifactId || result.version.version !== context.version + 1
        || result.artifact.headVersion !== result.version.version || result.receipt.runId === review.source.runId
        || result.receipt.reviewHash !== review.reviewHash || result.receipt.datasetSnapshotId !== review.targetDatasetSnapshotId
        || result.receipt.datasetContentHash !== review.targetContentHash) {
        throw new Error("The response did not identify one new version of this existing model for the captured review. Reload the canonical Artifact before any further action.");
      }
      this.update({ ...initialModelMaintenanceReviewState, result });
    } catch (cause) {
      if (this.accepts(generation, context)) this.update({ ...this.state, pending: null, review: null, error: cause instanceof Error ? cause.message : "The explicit update failed. Reload and review again; it will not retry automatically." });
    } finally {
      this.applying = false;
      if (this.active && this.state.pending === "apply") this.update({ ...this.state, pending: null, review: null });
    }
  }
  dispose(): void { this.active = false; this.generation++; }
}
