import { useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import { refreshP6ProjectContinuity, useInvalidateP6ProjectContinuity, useP6ProjectContinuity } from "@/lib/useP6Continuity";
import { ProjectChangeActivity } from "./ProjectChangeActivity";
import { ProjectContinuationActivitiesCard } from "./ProjectContinuationActivitiesCard";
import { focusProjectWorkflowRow } from "@/lib/projectWorkflowFocus";

function time(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "—";
}

export function ProjectContinuityPanel({
  projectId,
  onFocusArtifact,
}: {
  projectId: number;
  onFocusArtifact?: (artifactId: string, title: string) => void;
}) {
  const continuity = useP6ProjectContinuity(projectId);
  const invalidate = useInvalidateP6ProjectContinuity();
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const snapshot = !continuity.isError ? continuity.data : undefined;

  const refresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const next = await refreshP6ProjectContinuity(projectId);
      invalidate(projectId);
      const changed = next.changeSummary
        ? next.changeSummary.added + next.changeSummary.changed + next.changeSummary.removed
        : 0;
      setMessage(changed ? `${changed} retained source change(s) are visible in Project Continuity.` : "Continuity refreshed. No retained source delta is currently available.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Project Continuity refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const reviewExactWorkflow = (workflowId: string) => {
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const focused = focusProjectWorkflowRow(document, projectId, workflowId, prefersReducedMotion);
    setMessage(focused ? null : "This exact workflow is not visible in this Project's Automations panel. Open or refresh Continuous Intelligence before reviewing it. Nothing was run or changed.");
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card/50 p-4" data-p6-project-continuity>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-ui text-sm font-semibold text-foreground">
            <GitBranch className="h-3.5 w-3.5 text-amber-300" />
            Project Continuity
          </div>
          <div className="mt-1 max-w-2xl font-ui text-[13px] leading-5 text-muted-foreground">
            Read-only Project-scoped decision and saved-work memory. Recompute writes a retained snapshot for this Project; it does not change other Projects or resume agents or scheduled work.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex min-h-11 items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 font-ui text-[13px] text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "motion-safe:animate-spin" : ""}`} />
          Recompute this Project snapshot
        </button>
      </div>

      {message && <div role="status" className="mt-3 rounded border border-border/50 bg-background/60 px-3 py-2 font-ui text-[13px] leading-5 text-foreground">{message}</div>}
      {continuity.isError && <div role="alert" className="mt-3 rounded border border-red-400/20 bg-red-400/[0.03] px-3 py-2 font-ui text-sm text-destructive">This Project's continuity could not be loaded or did not match its identity. Reload before acting.</div>}

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Continue" value={snapshot ? snapshot.counts.continuationItems : "—"} />
        <Metric label="Decisions" value={snapshot ? snapshot.counts.decisions : "—"} />
        <Metric label="Sessions" value={snapshot ? snapshot.counts.sessions : "—"} />
        <Metric label="Active workflows" value={snapshot ? snapshot.counts.activeAutomations : "—"} />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <ProjectContinuationActivitiesCard
          items={snapshot?.continuationQueue ?? []}
          loading={!snapshot && !continuity.isError}
          unavailable={continuity.isError}
          onOpenDecision={onFocusArtifact}
          onReviewWorkflow={reviewExactWorkflow}
        />

        <div className="rounded-lg border border-border/50 bg-background/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-ui text-sm font-semibold text-foreground">Decision memory</div>
            <span className="font-ui text-xs text-muted-foreground">{snapshot?.counts.unresolvedDecisions ?? 0} open</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {(snapshot?.decisions ?? []).slice(0, 6).map((decision) => (
              <article key={decision.artifactId} className="rounded border border-border/40 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words font-ui text-sm font-medium text-foreground">{decision.title}</span>
                  <span className="shrink-0 font-ui text-xs text-muted-foreground">v{decision.version}</span>
                </div>
                <div className="mt-1 line-clamp-2 font-ui text-[13px] leading-5 text-muted-foreground">{decision.objective}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-xs text-muted-foreground">
                  <span>{decision.selectedAlternativeLabel ? "SELECTED · " + decision.selectedAlternativeLabel : "NO SELECTION"}</span>
                  <span>{decision.monitoring.length} MONITOR CONDITION{decision.monitoring.length === 1 ? "" : "S"}</span>
                  <span>{time(decision.updatedAt)}</span>
                  {onFocusArtifact && (
                    <button
                      type="button"
                      onClick={() => onFocusArtifact(decision.artifactId, decision.title)}
                      className="ml-auto min-h-11 rounded-md border border-border/60 px-3 font-ui text-[13px] text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
                    >
                      Open
                    </button>
                  )}
                </div>
              </article>
            ))}
            {snapshot && !snapshot.decisions.length && <div className="font-ui text-[13px] leading-5 text-muted-foreground">No Decision Artifact has been kept in this Project yet.</div>}
          </div>
        </div>
      </div>

      {snapshot && <ProjectChangeActivity summary={snapshot.changeSummary} />}

      <div className="mt-3 break-all font-ui text-[11px] leading-4 text-muted-foreground">
        FINGERPRINT · {snapshot?.fingerprint.slice(0, 12) ?? "—"} · PROJECT GRAPH + DECISION ARTIFACTS + CONTINUOUS INTELLIGENCE
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-border/45 bg-background/60 px-3 py-2">
    <div className="font-ui text-xs uppercase text-muted-foreground">{label}</div>
    <div className="mt-1 font-ui text-[13px] font-semibold text-foreground">{value}</div>
  </div>;
}
