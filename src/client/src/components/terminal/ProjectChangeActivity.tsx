import * as React from "react";
import type { P6ChangeSummary } from "@shared/p6ContinuityContracts";
import { GitCompareArrows } from "lucide-react";
import { projectChangePresentation } from "@/lib/projectChangePresentation";

const VISIBLE_SOURCE_LIMIT = 12;

/**
 * Retained P6 Project comparison. Neither timestamps nor per-source change
 * categories are inferred: the upstream contract contains only aggregate
 * counters, opaque snapshot IDs and recorded source references.
 */
export function ProjectChangeActivity({ summary }: { summary: P6ChangeSummary | null }) {
  const change = projectChangePresentation(summary);
  const visibleRefs = change.sourceRefs.slice(0, VISIBLE_SOURCE_LIMIT);
  const omitted = change.sourceRefs.length - visibleRefs.length;

  return (
    <section className="mt-4 rounded-xl border border-border/60 bg-white/[0.02] p-4" aria-label="Project changes" data-testid="project-change-activity">
      <div className="flex items-center gap-2">
        <GitCompareArrows aria-hidden="true" className="h-4 w-4 text-amber-200" />
        <h3 className="font-ui text-base font-semibold text-foreground">What changed</h3>
      </div>
      {change.status === "unavailable" ? (
        <p className="mt-3 font-ui text-sm leading-6 text-muted-foreground" role="status">
          No retained comparison is available. Refresh Project Continuity after another saved snapshot to inspect recorded changes.
        </p>
      ) : (
        <>
          <p className="mt-2 font-ui text-sm text-muted-foreground" role="status">
            {change.status === "unchanged"
              ? "No differences recorded between these two retained snapshots."
              : `${change.total} recorded change${change.total === 1 ? "" : "s"} between retained snapshots.`}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Recorded change counts">
            {([
              ["Added", change.added],
              ["Updated", change.changed],
              ["Removed", change.removed],
            ] as const).map(([label, count]) => (
              <div key={label} className="min-w-0 rounded-lg border border-border/60 px-3 py-3">
                <div className="font-ui text-2xl font-semibold tabular-nums text-foreground">{count}</div>
                <div className="mt-0.5 font-ui text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <details className="mt-3 rounded-lg border border-border/55 px-3 py-2">
            <summary className="min-h-9 cursor-pointer py-1 font-ui text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70">
              Inspect comparison evidence
            </summary>
            <div className="space-y-3 border-t border-border/50 pb-1 pt-3 font-ui text-sm text-muted-foreground">
              <p>Comparison is aggregate only; individual source references have no recorded added/updated/removed label.</p>
              <div className="grid gap-1">
                <div><span className="font-medium text-foreground">From</span> <code className="break-all">{change.fromSnapshotId}</code></div>
                <div><span className="font-medium text-foreground">To</span> <code className="break-all">{change.toSnapshotId}</code></div>
              </div>
              <div>
                <h4 className="font-ui text-sm font-medium text-foreground">Recorded source references ({change.sourceRefs.length})</h4>
                {visibleRefs.length ? (
                  <ul className="mt-2 space-y-1">
                    {visibleRefs.map((ref, index) => <li key={index} className="rounded-md border border-border/45 px-2 py-1.5">
                      <code className="break-all text-xs">{ref}</code>
                    </li>)}
                  </ul>
                ) : <p className="mt-1 text-sm">No source references attached to this comparison.</p>}
                {omitted > 0 && <p className="mt-2 text-xs">Showing the first {visibleRefs.length} references; {omitted} additional references are retained but not shown in this compact view.</p>}
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
