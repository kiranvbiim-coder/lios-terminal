import type { ArtifactDetail, IntegratedModelArtifactRunResult, IntegratedModelInputReview } from "./useArtifacts";

export interface EngineInputRevision {
  artifactId: string;
  projectId: number | null;
  owningChatId?: number | null;
  version: number;
  headVersion: number;
  contentHash: string;
}

export interface EngineInputReviewState {
  pending: "review" | "run" | null;
  review: IntegratedModelInputReview | null;
  result: IntegratedModelArtifactRunResult | null;
  error: string | null;
}

export const initialEngineInputReviewState: EngineInputReviewState = { pending: null, review: null, result: null, error: null };

export function isIntegratedModelWorkbook(detail: ArtifactDetail): boolean {
  return detail.version.content.kind === "spreadsheet" && detail.version.refreshSpec?.kind === "engine"
    && /^integrated_financial_model:[^:]+:run:[^:]+$/.test(detail.version.refreshSpec.engineRef ?? "");
}

function sameRevision(left: EngineInputRevision, right: EngineInputRevision): boolean {
  return left.artifactId === right.artifactId && left.projectId === right.projectId && left.owningChatId === right.owningChatId && left.version === right.version
    && left.contentHash === right.contentHash && left.headVersion === right.headVersion;
}

function reviewMatches(review: IntegratedModelInputReview, revision: EngineInputRevision): boolean {
  return review.artifactId === revision.artifactId && review.version === revision.version && review.contentHash === revision.contentHash;
}

interface ReviewTransport {
  review: (artifactId: string, version: number) => Promise<IntegratedModelInputReview>;
  run: (artifactId: string, input: { version: number; contentHash: string; reviewHash: string }) => Promise<IntegratedModelArtifactRunResult>;
}

/** Only ephemeral inspector state; source, policy and run authority remain on the server. */
export class ArtifactEngineInputReviewSession {
  private state: EngineInputReviewState = initialEngineInputReviewState;
  private revision: EngineInputRevision;
  private generation = 0;
  private active = true;

  constructor(
    private readonly currentRevision: () => EngineInputRevision,
    private readonly transport: ReviewTransport,
    private readonly publish: (state: EngineInputReviewState) => void,
  ) {
    this.revision = currentRevision();
  }

  private update(state: EngineInputReviewState): void {
    this.state = state;
    if (this.active) this.publish(state);
  }

  reconcileRevision(): void {
    const next = this.currentRevision();
    if (sameRevision(this.revision, next)) return;
    const hadReview = this.state.review !== null || this.state.pending !== null;
    this.generation++;
    this.revision = next;
    this.update({ ...initialEngineInputReviewState, error: hadReview ? "The saved Artifact revision changed. Review the current saved engine inputs again before running." : null });
  }

  private accepts(generation: number, revision: EngineInputRevision): boolean {
    if (!this.active || generation !== this.generation) return false;
    if (!sameRevision(revision, this.currentRevision())) {
      this.reconcileRevision();
      return false;
    }
    return true;
  }

  async review(): Promise<void> {
    if (!this.active || this.state.pending) return;
    this.reconcileRevision();
    const revision = { ...this.currentRevision() };
    if (revision.version !== revision.headVersion) {
      this.update({ ...initialEngineInputReviewState, error: "This is not the current Artifact head. Reload the saved revision before reviewing engine inputs." });
      return;
    }
    const generation = ++this.generation;
    this.update({ ...initialEngineInputReviewState, pending: "review" });
    try {
      const review = await this.transport.review(revision.artifactId, revision.version);
      if (!this.accepts(generation, revision)) return;
      if (!reviewMatches(review, revision)) throw new Error("The engine input review does not match this saved revision. Reload and review again.");
      this.update({ ...initialEngineInputReviewState, review });
    } catch (cause) {
      if (this.accepts(generation, revision)) this.update({ ...initialEngineInputReviewState, error: cause instanceof Error ? cause.message : "Engine input review failed." });
    }
  }

  async run(): Promise<void> {
    if (!this.active || this.state.pending) return;
    this.reconcileRevision();
    const revision = { ...this.currentRevision() };
    const review = this.state.review;
    if (!review || revision.version !== revision.headVersion || !reviewMatches(review, revision)) {
      this.update({ ...initialEngineInputReviewState, error: "Review the current saved engine inputs before running." });
      return;
    }
    const generation = ++this.generation;
    this.update({ pending: "run", review, result: null, error: null });
    try {
      const result = await this.transport.run(revision.artifactId, { version: review.version, contentHash: review.contentHash, reviewHash: review.reviewHash });
      if (!this.accepts(generation, revision)) return;
      if (!reviewMatches(result.review, revision) || result.review.reviewHash !== review.reviewHash
        || result.outputArtifact.projectId !== revision.projectId || result.outputArtifact.id !== revision.artifactId
        || (revision.projectId === null && result.outputArtifact.owningChatId !== revision.owningChatId)
        || result.outputVersion.artifactId !== revision.artifactId || result.outputVersion.version !== revision.version + 1
        || result.outputArtifact.headVersion !== result.outputVersion.version || result.receipt.runId === review.source.runId) {
        throw new Error("The engine run response does not identify the next canonical revision of this reviewed Artifact.");
      }
      this.update({ ...initialEngineInputReviewState, result });
    } catch (cause) {
      // A failed attempt requires another explicit review; never replay an uncertain run automatically.
      if (this.accepts(generation, revision)) this.update({ ...initialEngineInputReviewState, error: cause instanceof Error ? cause.message : "Reviewed engine run failed. Review again before retrying." });
    }
  }

  dismissReview(): void {
    if (!this.active || this.state.pending === "run") return;
    this.generation++;
    this.update(initialEngineInputReviewState);
  }

  dispose(): void {
    this.active = false;
    this.generation++;
  }
}
