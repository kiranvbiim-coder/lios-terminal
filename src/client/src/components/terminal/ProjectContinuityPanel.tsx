import { useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import { refreshP6ProjectContinuity, useInvalidateP6ProjectContinuity, useP6ProjectContinuity } from "@/lib/useP6Continuity";
import { ProjectChangeActivity } from "./ProjectChangeActivity";

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

  return (
    <section className="rounded-xl border border-amber-300/20 bg-amber-300/[0.025] p-4" data-p6-project-continuity>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-ui text-[10px] font-semibold text-foreground">
            <GitBranch className="h-3.5 w-3.5 text-amber-300" />
            Project Continuity
          </div>
          <div className="mt-1 max-w-2xl font-ui text-[8px] leading-4 text-muted-foreground">
            Read-only Project-scoped decision and saved-work memory. Recompute writes a retained snapshot for this Project; it does not change other Projects or resume agents or scheduled work.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          Recompute this Project snapshot
        </button>
      </div>

      {message && <div className="mt-3 rounded border border-border/50 bg-black/20 px-3 py-2 font-ui text-[8px] text-muted-foreground">{message}</div>}
      {continuity.isError && <div role="alert" className="mt-3 rounded border border-red-400/20 bg-red-400/[0.03] px-3 py-2 font-ui text-sm text-red-200">This Project's continuity could not be loaded or did not match its identity. Reload before acting.</div>}

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Continue" value={snapshot ? snapshot.counts.continuationItems : "—"} />
        <Metric label="Decisions" value={snapshot ? snapshot.counts.decisions : "—"} />
        <Metric label="Sessions" value={snapshot ? snapshot.counts.sessions : "—"} />
        <Metric label="Active workflows" value={snapshot ? snapshot.counts.activeAutomations : "—"} />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-ui text-[8px] font-semibold text-foreground">Continue work</div>
            <span className="font-terminal text-[6px] text-muted-foreground">DETERMINISTIC QUEUE</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {(snapshot?.continuationQueue ?? []).slice(0, 8).map((item) => (
              <article key={item.id} className="rounded border border-border/40 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-ui text-[8px] text-foreground">{item.title}</span>
                  <span className={`font-terminal text-[6px] uppercase ${item.priority === "high" ? "text-red-300" : item.priority === "medium" ? "text-amber-200" : "text-muted-foreground"}`}>{item.priority}</span>
                </div>
                <div className="mt-1 line-clamp-2 font-ui text-[7px] leading-4 text-muted-foreground">{item.summary}</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-terminal text-[6px] uppercase text-muted-foreground/70">{item.kind.replaceAll("_", " ")}</span>
                  {item.decisionArtifactId && onFocusArtifact && (
                    <button
                      type="button"
                      onClick={() => onFocusArtifact(item.decisionArtifactId!, item.title)}
                      className="font-ui text-[7px] text-cyan-300 hover:text-cyan-200"
                    >
                      Open decision
                    </button>
                  )}
                  {!item.decisionArtifactId && item.workflowId && (
                    <button
                      type="button"
                      onClick={() => document.querySelector("[data-p9-continuous-intelligence]")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="font-ui text-[7px] text-cyan-300 hover:text-cyan-200"
                    >
                      Review workflow
                    </button>
                  )}
                </div>
              </article>
            ))}
            {snapshot && !snapshot.continuationQueue.length && <div className="font-ui text-[7px] text-muted-foreground">No deterministic follow-up is currently outstanding.</div>}
            {!snapshot && !continuity.isError && <div className="font-ui text-[7px] text-muted-foreground">Loading Project continuation state…</div>}
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-ui text-[8px] font-semibold text-foreground">Decision memory</div>
            <span className="font-terminal text-[6px] text-muted-foreground">{snapshot?.counts.unresolvedDecisions ?? 0} OPEN</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {(snapshot?.decisions ?? []).slice(0, 6).map((decision) => (
              <article key={decision.artifactId} className="rounded border border-border/40 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-ui text-[8px] text-foreground">{decision.title}</span>
                  <span className="font-terminal text-[6px] text-muted-foreground">v{decision.version}</span>
                </div>
                <div className="mt-1 line-clamp-2 font-ui text-[7px] leading-4 text-muted-foreground">{decision.objective}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-terminal text-[6px] text-muted-foreground/75">
                  <span>{decision.selectedAlternativeLabel ? "SELECTED · " + decision.selectedAlternativeLabel : "NO SELECTION"}</span>
                  <span>{decision.monitoring.length} MONITOR CONDITION{decision.monitoring.length === 1 ? "" : "S"}</span>
                  <span>{time(decision.updatedAt)}</span>
                  {onFocusArtifact && (
                    <button
                      type="button"
                      onClick={() => onFocusArtifact(decision.artifactId, decision.title)}
                      className="ml-auto font-ui text-[7px] normal-case text-cyan-300 hover:text-cyan-200"
                    >
                      Open
                    </button>
                  )}
                </div>
              </article>
            ))}
            {snapshot && !snapshot.decisions.length && <div className="font-ui text-[7px] text-muted-foreground">No Decision Artifact has been kept in this Project yet.</div>}
          </div>
        </div>
      </div>

      {snapshot && <ProjectChangeActivity summary={snapshot.changeSummary} />}

      <div className="mt-3 font-terminal text-[6px] leading-3 text-muted-foreground/70">
        FINGERPRINT · {snapshot?.fingerprint.slice(0, 12) ?? "—"} · PROJECT GRAPH + DECISION ARTIFACTS + CONTINUOUS INTELLIGENCE
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border border-border/45 bg-black/15 px-3 py-2">
    <div className="font-terminal text-[6px] uppercase text-muted-foreground">{label}</div>
    <div className="mt-1 font-ui text-[13px] font-semibold text-foreground">{value}</div>
  </div>;
}
