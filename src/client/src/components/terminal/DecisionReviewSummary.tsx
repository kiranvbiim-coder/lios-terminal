// Server-rendered readable source tests require the classic JSX transform.
import * as React from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import { decisionReviewOverview } from "@/lib/decisionReviewOverview";

type Decision = Extract<ArtifactContent, { kind: "decision" }>;

function TextItems({ values, none }: { values: string[]; none: string }) {
  return values.length
    ? <ul className="list-disc space-y-1 pl-5">{values.map((text, index) => <li key={index} className="whitespace-pre-wrap break-words">{text}</li>)}</ul>
    : <p className="text-muted-foreground">{none}</p>;
}

/** A read-only authored review map; server-owned approval appears in the
 * existing DecisionApprovalInspector, and is never inferred from these fields. */
export default function DecisionReviewSummary({ content, dirty, conflict }: {
  content: Decision; dirty?: boolean; conflict?: boolean;
}) {
  const review = decisionReviewOverview(content);
  return <section aria-label="Decision, evidence, risks and proposed actions" data-testid="decision-review-summary" className="space-y-3 rounded-lg border border-border/50 p-3">
    <div className="space-y-1">
      <h3 className="font-ui text-[15px] font-semibold">Decision review map</h3>
      <p role="status" className="font-ui text-[12px] text-amber-200">
        {conflict ? "Revision conflict: this is the retained local draft, not the latest canonical version."
          : dirty ? "Unsaved authored draft; changes are not yet in the canonical Artifact."
          : "Authored saved decision content; not an approved decision or verified evidence."}
      </p>
      <p className="font-ui text-[12px] text-muted-foreground">The categories below are deliberately separate. Authored references do not prove claims; action tracking does not authorize execution. Only the server-linked receipt inspector below can report actual Decision review authority.</p>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <section aria-label="Authored decision and recommendation" className="space-y-1 rounded border border-cyan-300/20 p-3">
        <h4 className="font-ui text-sm font-semibold text-cyan-200">1. Authored decision</h4>
        <p className="text-xs text-muted-foreground">Recommendation · analyst proposal, not approval</p>
        <p className="whitespace-pre-wrap break-words text-sm">{review.recommendation ?? "No recommendation recorded."}</p>
        <p className="text-xs text-muted-foreground">Selected alternative</p>
        <p className="break-words text-sm">{review.alternative?.label ?? (review.selectedAlternativeMissing ? "Selected reference unresolved" : "None selected")}</p>
      </section>
      <section aria-label="Authored evidence references" className="space-y-1 rounded border border-border/50 p-3">
        <h4 className="font-ui text-sm font-semibold">2. Evidence references</h4>
        <p className="text-xs text-muted-foreground">{review.evidence.total} authored references · no source verification inferred</p>
        <dl className="grid grid-cols-2 gap-1 text-sm">
          {review.evidence.refsByKind.map(item => <div key={item.kind} className="flex gap-2"><dt className="capitalize text-muted-foreground">{item.kind}</dt><dd>{item.count}</dd></div>)}
        </dl>
        <p className="text-xs text-muted-foreground">For source custody, inspect the saved Evidence tab and immutable receipts separately.</p>
      </section>
      <section aria-label="Recorded risks, dissent and uncertainty" className="space-y-2 rounded border border-amber-300/20 p-3">
        <h4 className="font-ui text-sm font-semibold text-amber-200">3. Risks and dissent</h4>
        <details>
          <summary className="cursor-pointer text-sm">Selected alternative risks ({review.risk.selectedAlternativeRisks.length})</summary>
          <TextItems values={review.risk.selectedAlternativeRisks} none="None recorded for the selected alternative."/>
        </details>
        <details>
          <summary className="cursor-pointer text-sm">Uncertainties ({review.risk.uncertainties.length}) and dissent ({review.risk.dissent.length})</summary>
          <TextItems values={review.risk.uncertainties} none="No uncertainties recorded."/>
          <TextItems values={review.risk.dissent} none="No dissent recorded."/>
        </details>
        <details>
          <summary className="cursor-pointer text-sm">Constraints ({review.risk.constraints.length})</summary>
          <TextItems values={review.risk.constraints} none="No constraints recorded."/>
        </details>
      </section>
      <section aria-label="Proposed actions and tracking, not execution" className="space-y-2 rounded border border-border/50 p-3">
        <h4 className="font-ui text-sm font-semibold">4. Proposed actions · not orders</h4>
        <p className="text-xs text-muted-foreground">{review.action.recorded} authored tracking records · {review.action.completed} marked completed · {review.action.blocked} marked blocked. These statuses are not execution proof.</p>
        <TextItems values={review.action.proposed} none="No next actions proposed."/>
        <p className="text-xs text-muted-foreground">Outcome: {review.outcome ? `author-entered ${review.outcome.status}` : "not recorded"} · never a verified execution receipt.</p>
      </section>
    </div>
    <div aria-label="Missing review information" className="rounded border border-border/40 p-3">
      <h4 className="text-sm font-semibold">Review gaps ({review.gaps.length})</h4>
      <TextItems values={review.gaps} none="No basic authored sections missing. This is not evidence verification, suitability certification or approval."/>
    </div>
  </section>;
}
