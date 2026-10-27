import * as React from "react";
import { Timeline as BeuiTimeline, type TimelineEvent } from "../vendor/beui/BeuiTimeline";
import type { P9RunRecord } from "@/lib/useP9Automation";
import { watchroomRecordedHistory } from "@/lib/phase2ProjectPresentation";

/**
 * Read-only P9 run history using the already imported, free MIT beUI Timeline.
 * P9 remains the ONLY run/receipt/source authority; this component neither
 * schedules tasks nor invents monitoring periods between saved observations.
 */
export default function WatchroomRecordedRunTimeline({
  projectId, workflowId, runs,
}: {
  projectId: number;
  workflowId: string;
  runs: readonly P9RunRecord[];
}) {
  // Revalidate the actual ownership and chronology even if the caller changes.
  const history = watchroomRecordedHistory(projectId, workflowId, runs);
  if (history.length < 2) return null;
  const events: TimelineEvent[] = history.map(run => ({
    id: run.id,
    date: run.startedAt,
    title: run.status === "succeeded" ? "Succeeded"
      : run.status === "failed" ? "Failed"
      : run.status === "running" ? "Running" : "Skipped",
    media: <div className="flex h-full flex-col justify-center gap-2 overflow-hidden p-3 font-ui">
      <p className="line-clamp-3 break-words text-sm font-semibold leading-5 text-foreground">
        {run.summary?.trim() || "No run summary recorded"}
      </p>
      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
        {run.sourceRefs.length} source references · {run.executionReceiptIds.length} execution receipts
      </p>
      {run.status === "failed" && <p className="line-clamp-2 text-xs leading-4 text-rose-200">
        This execution failed. Open workflow history for the authorized diagnostic record.
      </p>}
    </div>,
    meta: <span className="font-ui text-[11px] text-muted-foreground">
      {run.changed ? "Change detected" : "No change recorded"} · {run.conditionMet ? "Condition met" : "No condition recorded"}
    </span>,
  }));
  return <section data-testid="watchroom-beui-run-timeline"
    className="mt-3 min-w-0 overflow-hidden rounded-xl border border-border/55 bg-background/50">
    <p className="px-3 pt-3 font-ui text-xs leading-5 text-muted-foreground">
      Recorded P9 execution timestamps, oldest to newest. Missing observations do not imply successful or scheduled runs.
      Review original workflow history for source references and receipts.
    </p>
    <BeuiTimeline events={events} defaultValue={events[events.length - 1].id}
      height={278} itemWidth={296} years={false} cables={false}
      aria-label="Recorded workflow executions and their outcomes" />
  </section>;
}
