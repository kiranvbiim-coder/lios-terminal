import * as React from "react";
import { Play } from "lucide-react";
import type { ResumableCheckpointView } from "@/lib/researchCheckpoint";

interface Props {
  requestId: string;
  checkpoint: ResumableCheckpointView | null;
  onResume: () => void;
}

/**
 * The Home alone offers this control via owner-scoped execution history.
 * This never retries a prompt, creates a local checkpoint, or submits a grant.
 */
export default function ResearchCheckpointCard({ requestId, checkpoint, onResume }: Props) {
  const exact = checkpoint?.requestId === requestId ? checkpoint : null;
  return (
    <section
      data-testid="trace-resumable-checkpoint"
      data-request-id={requestId}
      aria-label="Interrupted agent checkpoint"
      className="my-2 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.025] px-3 py-3"
    >
      <div className="font-ui text-[13px] font-semibold text-foreground">Interrupted research checkpoint</div>
      <p className="mt-1 font-ui text-[12px] leading-5 text-muted-foreground">
        Your Home marked this interrupted run eligible for an explicit resume attempt. Nothing continues automatically.
      </p>
      {exact?.totalSteps !== null && exact?.totalSteps !== undefined
        && exact.completedSteps !== null ? (
        <div className="mt-2 font-ui text-[12px] text-foreground/85" data-testid="checkpoint-recorded-progress">
          Last saved checkpoint: {exact.completedSteps} of {exact.totalSteps} steps recorded complete.
          {exact.awaitingReviewSteps ? ` ${exact.awaitingReviewSteps} ${exact.awaitingReviewSteps === 1 ? "step was" : "steps were"} waiting for review when saved.` : ""}
          {exact.recordedReferenceCount !== null
            ? ` ${exact.recordedReferenceCount} ${exact.recordedReferenceCount === 1 ? "reference" : "references"} recorded, not independently verified.`
            : ""}
        </div>
      ) : (
        <p className="mt-2 font-ui text-[12px] text-muted-foreground">
          Detailed checkpoint step counts are unavailable; no progress is being inferred.
        </p>
      )}
      <p className="mt-2 font-ui text-[12px] leading-5 text-amber-100/85">
        Any previous results are partial. Before continuing, the Home rechecks current ownership, context, tools, policy and unsafe or unknown tool outcomes. Resume can be refused.
      </p>
      <button
        type="button"
        data-testid="agent-run-resume"
        data-request-id={requestId}
        onClick={onResume}
        className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300/[0.06] px-3 py-2 font-ui text-[12px] font-semibold text-cyan-100 hover:bg-cyan-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
      >
        <Play className="h-3.5 w-3.5" aria-hidden="true" /> Resume from checkpoint
      </button>
    </section>
  );
}
