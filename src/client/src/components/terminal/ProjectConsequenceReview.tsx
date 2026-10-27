import * as React from "react";
import type { P7Insight } from "@shared/p7ResearchContracts";
import { consequenceReviewPrompt, type ConsequenceReview } from "@/lib/recordedConsequenceReview";

const kindLabel: Record<string, string> = { decision: "Decision record", portfolio: "Portfolio reference", scenario: "Scenario reference", assumption: "Assumption record", thesis: "Thesis record" };

/** Collapsed, source-owned P7 review inside the existing Relationships view, not another product. */
export function ProjectConsequenceReview({ projectId, insight, review, onInvestigate }: {
  projectId: number; insight: P7Insight; review: ConsequenceReview; onInvestigate?: (prompt: string) => void;
}) {
  return <details data-testid="project-consequence-review" className="rounded-lg border border-border/55 p-3">
    <summary className="min-h-10 cursor-pointer py-2 font-ui text-sm font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">
      Recorded decision and portfolio references ({review.total})
    </summary>
    <div className="mt-3 space-y-3 font-ui text-sm">
      <p className="text-xs leading-5 text-muted-foreground">Only recorded P7 edges appear. Shared references are not evidence of causal impact, live holdings, quantified exposure or recommendations.</p>
      {review.status === "unavailable" && <p role="status">Project evidence is unavailable.</p>}
      {review.status === "no_sources" && <p role="status">No saved source supports a starting point for this insight.</p>}
      {review.status === "too_large" && <p role="status">Graph exceeds the bounded review limit. Narrow the Project evidence; no links were inferred.</p>}
      {review.status === "ready" && !review.targets.length && <p role="status">No source-backed decision or exposure reference was recorded within two links.</p>}
      {review.targets.map(target => <article key={target.id} className="space-y-2 rounded-lg border border-border/45 p-3">
        <h5 className="text-sm font-semibold">{kindLabel[target.kind]}: {target.label}</h5>
        <ol className="space-y-2">{target.steps.map((step, idx) => <li key={step.id + ":" + idx} className="break-words text-xs text-muted-foreground">
          {idx + 1}. {step.from} → {step.to} · {step.relation}{!step.forward && " (reverse inspection)"}
          <div className="mt-1 break-all font-mono text-[11px]">Stored edge {step.id} · refs: {step.evidenceRefs.join(", ")}</div>
        </li>)}</ol>
        {onInvestigate && review.graphHash && <button type="button"
          className="min-h-10 rounded-lg border border-amber-300/35 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-amber-300/70"
          onClick={() => onInvestigate(consequenceReviewPrompt(projectId, review.graphHash!, insight, target))}>Review path in Chat</button>}
      </article>)}
      {review.omitted > 0 && <p role="status" className="text-xs text-muted-foreground">{review.omitted} additional recorded targets omitted from this bounded view.</p>}
      {review.targets.length > 0 && <p className="text-xs text-muted-foreground">Recheck current source rights and evidence in Chat. This view never executes an action.</p>}
    </div>
  </details>;
}
