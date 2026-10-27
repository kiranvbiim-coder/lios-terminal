import * as React from "react";
import { useMemo, useState } from "react";
import { BellRing, CircleAlert, Clock3, Workflow } from "lucide-react";
import { useP9Notifications, useP9Runs, useP9Workflows, type P9RunRecord } from "@/lib/useP9Automation";
import { projectWatchroomSummary, watchroomRecordedHistory } from "@/lib/phase2ProjectPresentation";
import { ProjectAutomationPanel } from "./ProjectAutomationPanel";

const RUN_STATUS_TONE: Record<P9RunRecord["status"], string> = {
  succeeded: "border-emerald-300/70 bg-emerald-300/30",
  failed: "border-rose-300/70 bg-rose-300/30",
  skipped: "border-zinc-400/70 bg-zinc-400/20",
  running: "border-cyan-300/70 bg-cyan-300/30",
};

/**
 * One discovery face over canonical P9 workflow/run/notification records.
 * Creating, enabling, deleting and executing remain in ProjectAutomationPanel.
 */
export function ProjectWatchroomDesk({ projectId }: { projectId: number }) {
  const [managing, setManaging] = useState(false);
  const workflows = useP9Workflows(managing ? null : projectId);
  const runs = useP9Runs(managing ? null : projectId);
  const notifications = useP9Notifications(managing ? null : projectId);
  const summary = useMemo(() => projectWatchroomSummary(projectId, workflows.data ?? [], runs.data ?? [], notifications.data ?? []),
    [projectId, workflows.data, runs.data, notifications.data]);
  const pending = !managing && (workflows.isPending || runs.isPending || notifications.isPending);
  const unavailable = !managing && (workflows.isError || runs.isError || notifications.isError);

  return <section data-testid="lios-project-watchroom-desk" aria-label="Project watchrooms" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Workflow aria-hidden="true" className="h-4 w-4 text-amber-200" />
        <h2 className="font-ui text-base font-semibold text-foreground">Watchrooms</h2>
      </div>
      <button type="button" aria-expanded={managing} onClick={() => setManaging(value => !value)}
        className="min-h-10 rounded-lg border border-border/65 px-3 py-2 font-ui text-sm font-medium text-foreground hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-amber-300/70">
        {managing ? "Back to watchrooms" : "Manage watchrooms"}
      </button>
    </div>

    {managing ? <ProjectAutomationPanel key={projectId} projectId={projectId} /> : <>
      <p className="font-ui text-xs leading-5 text-muted-foreground">Enabled means a saved monitoring intention, not a confirmed run. Scheduling requires an active LiOS Home and current permissions.</p>
      {pending && <p role="status" className="rounded-lg border border-border/55 p-3 font-ui text-sm text-muted-foreground">Loading saved Project monitoring records…</p>}
      {unavailable && <div role="alert" className="rounded-lg border border-amber-300/30 p-3 font-ui text-sm text-amber-100">
        <CircleAlert aria-hidden="true" className="mr-2 inline h-4 w-4"/>Current monitoring data is unavailable. Existing results may be stale; review the source before making changes.
        <button type="button" onClick={() => { void workflows.refetch(); void runs.refetch(); void notifications.refetch(); }} className="ml-2 underline focus-visible:ring-2 focus-visible:ring-amber-300/70">Retry</button>
      </div>}
      {!pending && !unavailable && <>
        <div role="status" className="font-ui text-sm text-muted-foreground">
          {summary.rooms.length} saved · {summary.enabled} enabled · {summary.unread.length} unread notification{summary.unread.length === 1 ? "" : "s"}
        </div>
        {!summary.rooms.length && <div className="rounded-lg border border-dashed border-border/65 p-5 font-ui text-sm text-muted-foreground">
          No saved Watchrooms in this Project. Choose Manage watchrooms to review a new, initially paused monitor, or save a workflow from Chat.
        </div>}
        <div className="grid min-w-0 gap-3 lg:grid-cols-2" aria-label="Saved Project watchrooms">
          {summary.rooms.slice(0, 12).map(room => {
            const recordedRuns = watchroomRecordedHistory(projectId, room.workflow.id, runs.data ?? []);
            return (
            <article key={room.workflow.id} className="min-w-0 space-y-2 rounded-xl border border-border/60 bg-white/[0.018] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-ui text-xs capitalize text-muted-foreground">{room.workflow.template.replaceAll("_", " ")}</span>
                <span className="ml-auto rounded-md border border-border/65 px-2 py-1 font-ui text-xs capitalize text-foreground">{room.state.state}</span>
              </div>
              <h3 className="font-ui text-base font-semibold text-foreground">{room.workflow.name}</h3>
              {room.workflow.description && <p className="line-clamp-2 font-ui text-sm leading-6 text-muted-foreground">{room.workflow.description}</p>}
              <p className="font-ui text-xs text-muted-foreground">{room.schedule}</p>
              <div className="space-y-1 border-t border-border/50 pt-2 font-ui text-xs leading-5 text-muted-foreground">
                <p><Clock3 aria-hidden="true" className="mr-1 inline h-3.5 w-3.5"/>Last observed: {room.latestRun ? room.latestRun.status : "No recorded run"}{room.latestRun?.completedAt ? ` · ${new Date(room.latestRun.completedAt).toLocaleString()}` : ""}</p>
                {room.latestRun?.summary && <p className="line-clamp-2">{room.latestRun.summary}</p>}
                <p>{room.latestRun?.sourceRefs.length ?? 0} run source references · {room.latestRun?.executionReceiptIds.length ?? 0} execution receipt IDs</p>
              </div>
              {recordedRuns.length > 0 && <section aria-label={"Recorded run history for " + room.workflow.name}
                className="space-y-2 border-t border-border/50 pt-3">
                <p className="font-ui text-xs text-muted-foreground">
                  {recordedRuns.length} recent recorded run{recordedRuns.length === 1 ? "" : "s"} · oldest to newest
                </p>
                <ol className="flex min-w-0 flex-wrap gap-1.5" data-testid="watchroom-recorded-run-strip">
                  {recordedRuns.map(run => <li key={run.id}
                    title={new Date(run.startedAt).toLocaleString() + " · " + run.status}
                    className={`flex min-h-8 min-w-8 items-center justify-center rounded-md border ${RUN_STATUS_TONE[run.status]}`}>
                    <span className="sr-only">{run.status} at <time dateTime={run.startedAt}>{run.startedAt}</time></span>
                    <span aria-hidden="true" className="font-ui text-[11px] font-semibold text-foreground">
                      {run.status === "succeeded" ? "✓" : run.status === "failed" ? "!" : run.status === "running" ? "…" : "–"}
                    </span>
                  </li>)}
                </ol>
                <p className="font-ui text-[11px] leading-5 text-muted-foreground">
                  Recorded P9 outcomes only. A paused monitor, skipped run or missing observation is not a successful execution.
                </p>
              </section>}
              <button type="button" onClick={() => setManaging(true)}
                className="min-h-10 rounded-lg border border-border/65 px-3 py-2 font-ui text-sm text-foreground hover:border-amber-300/40 focus-visible:ring-2 focus-visible:ring-amber-300/70">Review workflow and history</button>
            </article>
            ); })}
        </div>
        {summary.rooms.length > 12 && <p className="font-ui text-xs text-muted-foreground">Showing 12 of {summary.rooms.length} saved workflows. Open Manage watchrooms to review all.</p>}
        {summary.unread.length > 0 && <section className="rounded-lg border border-border/55 p-3" aria-label="Unread workflow notifications">
          <h3 className="flex items-center gap-2 font-ui text-sm font-semibold text-foreground"><BellRing aria-hidden="true" className="h-4 w-4 text-amber-200"/>Unread monitoring notifications</h3>
          <ul className="mt-2 space-y-1.5">{summary.unread.slice(0, 3).map(note => <li key={note.id} className="rounded-md border border-border/45 px-3 py-2">
            <p className="font-ui text-sm font-medium text-foreground">{note.title}</p>
            <p className="mt-1 line-clamp-2 font-ui text-xs text-muted-foreground">{note.body}</p>
          </li>)}</ul>
          <button type="button" onClick={() => setManaging(true)} className="mt-2 min-h-10 font-ui text-sm text-amber-200 underline-offset-2 hover:underline">Open notification history</button>
        </section>}
      </>}
    </>}
  </section>;
}
