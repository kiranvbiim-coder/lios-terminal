import * as React from "react";
import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { GovernedVisualAnswerRequest, GovernedVisualAnswerDecision } from "@shared/governedVisualAnswer";
import { resolveGovernedVisualAnswer } from "@shared/governedVisualAnswer";

const ArtifactChart = lazy(() => import("./ArtifactChart"));

class GovernedChartBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="alert" className="font-ui text-sm text-amber-200">
      Visual renderer unavailable. The canonical saved Artifact is unchanged; open it in the existing Workbench to inspect the exact saved records.
    </p> : this.props.children;
  }
}

function recordedValue(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "Invalid recorded number";
  return "Structured recorded value · open saved Artifact";
}

export function GovernedVisualAnswer({ request }: { request: GovernedVisualAnswerRequest }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<{ phase: "idle" | "loading" | "ready" | "blocked"; decision?: GovernedVisualAnswerDecision }>({ phase: "idle" });

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setState({ phase: "loading" });
    void (async () => {
      try {
        const response = await fetch(
          `/api/artifacts/${encodeURIComponent(request.artifactId)}?version=${request.version}`,
          { credentials: "same-origin", cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("Saved Artifact authorization or revision read failed.");
        const remote: unknown = await response.json();
        const decision = resolveGovernedVisualAnswer(request, remote);
        if (!controller.signal.aborted) setState({ phase: decision.status, decision });
      } catch {
        if (!controller.signal.aborted) setState({ phase: "blocked" });
      }
    })();
    return () => { controller.abort(); };
  }, [expanded, request.artifactId, request.version, request.projectId, request.kind]);

  const decision = state.decision?.status === "ready" ? state.decision : null;
  return <section aria-label="Governed visual answer from saved Artifact" data-testid="governed-chat-visual-answer"
    className="mb-2 min-w-0 rounded-xl border border-border/55 bg-card/45 p-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-ui text-sm font-semibold text-foreground">Saved {request.kind === "chart" ? "chart" : "table"} · version {request.version}</p>
        <p className="font-ui text-xs text-muted-foreground">The exact saved version and source references are rechecked before display.</p>
      </div>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
        className="min-h-10 rounded-lg border border-border/65 px-3 font-ui text-sm text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">
        {expanded ? "Hide visual" : "View visual"}
      </button>
    </div>
    {expanded && <div className="mt-3 space-y-3" data-testid="governed-chat-visual-content">
      {state.phase === "loading" && <p role="status" className="font-ui text-sm text-muted-foreground">Checking the saved source-backed revision…</p>}
      {state.phase === "blocked" && <p role="alert" className="font-ui text-sm text-amber-200">
        {state.decision?.status === "blocked" ? state.decision.reason : "Authorization or saved revision is unavailable. No visual answer is displayed."}
      </p>}
      {decision && <>
        <p className="break-words font-ui text-sm font-semibold text-foreground">{decision.title}</p>
        <p className="font-ui text-xs text-muted-foreground">
          Recorded source IDs: {decision.sourceRefs.length}. Saved v{decision.version}. These are retained references, not independent verification or redistribution rights.
        </p>
        {decision.kind === "chart" ? <GovernedChartBoundary>
          <Suspense fallback={<p role="status" className="font-ui text-xs text-muted-foreground">Rendering the saved chart…</p>}>
            <ArtifactChart content={decision.content} readOnly/>
          </Suspense>
        </GovernedChartBoundary> : <div className="max-h-80 overflow-auto rounded-lg border border-border/55" role="region"
          tabIndex={0} aria-label="Exact saved table values">
          <table className="w-full min-w-[350px] border-collapse font-ui text-xs">
            <caption className="sr-only">First 40 records and first 12 columns of the authorized saved table, without calculation or inference.</caption>
            <thead><tr>{decision.content.columns.slice(0, 12).map(column =>
              <th scope="col" key={column.key} className="sticky top-0 border border-border/50 bg-background px-2 py-2 text-left">{column.label}</th>)}</tr></thead>
            <tbody>{decision.content.rows.slice(0, 40).map((row, index) => <tr key={index}>
              {decision.content.columns.slice(0, 12).map(column =>
                <td key={column.key} className="break-words border border-border/50 p-2">{recordedValue(row[column.key])}</td>)}
            </tr>)}</tbody>
          </table>
        </div>}
        {decision.kind === "table" && (decision.content.rows.length > 40 || decision.content.columns.length > 12) &&
          <p role="status" className="font-ui text-xs text-muted-foreground">
            Displaying {Math.min(40,decision.content.rows.length)} of {decision.content.rows.length} recorded rows and
            {Math.min(12,decision.content.columns.length)} of {decision.content.columns.length} columns. Open the saved Artifact for complete data.
          </p>}
        <details className="rounded border border-border/50 p-2 font-ui text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground">Recorded source IDs</summary>
          <ul className="mt-2 max-h-32 space-y-1 overflow-auto">
            {decision.sourceRefs.map(ref => <li key={ref} className="break-all"><code>{ref}</code></li>)}
          </ul>
        </details>
      </>}
    </div>}
  </section>;
}
