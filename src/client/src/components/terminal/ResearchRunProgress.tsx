import * as React from "react";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { observedResearchProgress } from "@/lib/observedResearchProgress";

interface Props {
  events: readonly ConversationRuntimeEvent[];
  view: "inline" | "findings";
  requestId?: string | null;
}

/** Only observed plan/tool events; no synthetic percentage, ETA, AI claim, or background job. */
export default function ResearchRunProgress({ events, view, requestId }: Props) {
  const progress = observedResearchProgress(events, requestId);
  if (!progress) return null;

  if (view === "inline") {
    return (
      <span data-testid="trace-observed-progress" className="ml-1 inline-flex min-w-0 items-center gap-1 font-ui text-[12px]">
        <span aria-hidden="true">·</span>
        <span>{progress.completed} of {progress.total} steps completed</span>
        {progress.activeLabel && <span className="max-w-[16rem] truncate" title={progress.activeLabel}>· {progress.activeLabel}</span>}
      </span>
    );
  }

  return (
    <section data-testid="trace-research-findings" aria-label="Recent observed results" className="space-y-2 border-t border-border/45 pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-ui text-[12px] font-semibold text-foreground">Reported results</h3>
        <span className="font-ui text-[12px] text-muted-foreground">{progress.completed} of {progress.total} steps completed</span>
      </div>
      {progress.runOutcome === "cancelled" && (
        <p role="status" className="font-ui text-[12px] text-amber-200/90">
          Run stopped — any results listed below are partial and may need rechecking.
        </p>
      )}
      {progress.runOutcome === "failed" && (
        <p role="status" className="font-ui text-[12px] text-amber-200/90">
          Run failed — the recorded results are partial, not a completed research answer.
        </p>
      )}
      {progress.runOutcome === "waiting_approval" && (
        <p role="status" className="font-ui text-[12px] text-muted-foreground">
          Waiting for approval — no further steps have been assumed complete.
        </p>
      )}
      {progress.results.length > 0 ? (
        <ol className="space-y-2">
          {progress.results.map((result) => (
            <li key={result.stepId} className="rounded-lg border border-border/50 bg-white/[0.018] px-3 py-2">
              <div className="font-ui text-[12px] font-semibold text-foreground">{result.label}</div>
              <p className="mt-1 line-clamp-3 break-words font-ui text-[12px] leading-5 text-muted-foreground">{result.summary}</p>
              <div className="mt-1 font-ui text-[11px] text-muted-foreground">
                {result.referenceCount > 0
                  ? `${result.referenceCount} reference${result.referenceCount === 1 ? "" : "s"} recorded; inspect Sources and Trust for coverage`
                  : "No source references recorded for this step"}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="font-ui text-[12px] leading-5 text-muted-foreground">No completed tool results reported yet. Steps may still be running, waiting for approval, or missing required inputs.</p>
      )}
      <p className="font-ui text-[11px] text-muted-foreground">
        These are tool-reported summaries, not independently verified conclusions. Use source and trust details to check evidence.
      </p>
    </section>
  );
}
