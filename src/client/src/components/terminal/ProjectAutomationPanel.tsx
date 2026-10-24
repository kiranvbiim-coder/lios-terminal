import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Pause, Play, RefreshCw, Trash2, Workflow } from "lucide-react";
import {
  createP9Workflow,
  deleteP9Workflow,
  markP9NotificationRead,
  replaceP9Workflow,
  runP9WorkflowNow,
  setP9WorkflowEnabled,
  useInvalidateP9Automation,
  useP9Notifications,
  useP9Runs,
  useP9Workflows,
} from "@/lib/useP9Automation";
import { queueNotificationRead } from "@/lib/p9NotificationReadOutbox";
import {
  discardP9ManualRunDraft,
  listP9ManualRunDrafts,
  prepareP9ManualRunConfirmation,
  saveP9ManualRunDraft,
  subscribeP9ManualRunDrafts,
} from "@/lib/p9ManualRunDrafts";
import {
  checkP9ManualRunAttempt,
  discardP9ManualRunAttempt,
  listP9ManualRunAttempts,
  prepareP9ManualRunAttempt,
  subscribeP9ManualRunAttempts,
} from "@/lib/p9ManualRunAttemptLedger";
import type { P9WorkflowTrigger } from "@shared/p9AutomationContracts";
import { quickMonitorDraft, scheduleEditDefinition, workflowExecutionTruth, workflowScheduleSummary, type QuickMonitorKind } from "@/lib/workflowReviewTruth";
import { HomeAttentionPanel } from "./HomeAttentionPanel";
import { P9NotificationHistory } from "./P9NotificationHistory";
import { PortfolioMaterialityResult } from "./ArtifactPortfolioMateriality";

function time(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "—";
}

type WorkflowReview = {
  projectId: number;
  workflowId: string;
  expectedUpdatedAt: string;
  intent: "pause" | "resume" | "edit" | "delete";
  name: string;
  trigger: P9WorkflowTrigger;
  enabled: boolean;
};

export function ProjectAutomationPanel({ projectId }: { projectId: number }) {
  const workflowsQuery = useP9Workflows(projectId);
  const runsQuery = useP9Runs(projectId);
  const notificationsQuery = useP9Notifications(projectId);
  const invalidate = useInvalidateP9Automation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(() => listP9ManualRunDrafts(projectId));
  const [attempts, setAttempts] = useState(() => listP9ManualRunAttempts(projectId));
  const confirming = useRef(false);
  const [createKind, setCreateKind] = useState<QuickMonitorKind | null>(null);
  const [createEnabled, setCreateEnabled] = useState(false);
  const [createMinutes, setCreateMinutes] = useState(60);
  const [review, setReview] = useState<WorkflowReview | null>(null);
  const selectedProject = useRef(projectId);
  selectedProject.current = projectId;
  const managementInFlight = useRef(false);
  useEffect(() => {
    setCreateKind(null); setReview(null); setMessage(null);
  }, [projectId]);

  useEffect(() => {
    const refresh = () => setDrafts(listP9ManualRunDrafts(projectId));
    refresh();
    return subscribeP9ManualRunDrafts(refresh);
  }, [projectId]);

  useEffect(() => {
    const refresh = () => setAttempts(listP9ManualRunAttempts(projectId));
    refresh();
    return subscribeP9ManualRunAttempts(refresh);
  }, [projectId]);

  const workflows = workflowsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const latestRun = useMemo(() => {
    const map = new Map<string, (typeof runs)[number]>();
    for (const run of runs) if (!map.has(run.workflowId)) map.set(run.workflowId, run);
    return map;
  }, [runs]);
  const unread = notifications.filter((item) => item.projectId === projectId && item.status === "delivered" && !item.readAt);

  const run = async (id: string, updatedAt: string) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const saved = saveP9ManualRunDraft(projectId, id, updatedAt);
      setMessage(saved
        ? "Manual run saved as an offline draft. It will NOT execute automatically; review and confirm after reconnect."
        : "Could not save an offline run draft; nothing has been scheduled.");
      return;
    }
    setBusyId(id);
    setMessage(null);
    try {
      const result = await runP9WorkflowNow(projectId, id);
      setMessage(result.error || result.run?.summary || "Workflow completed.");
      invalidate(projectId);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Workflow run failed.");
      invalidate(projectId);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDraft = async (id: string) => {
    if (confirming.current) return;
    confirming.current = true;
    setBusyId("confirm:" + id);
    setMessage(null);
    let requestKey: string | null = null;
    try {
      const draft = drafts.find((item) => item.projectId === projectId && item.workflowId === id);
      if (!draft) {
        setMessage("Offline draft is unavailable. No workflow was started.");
        return;
      }
      const permitted = await prepareP9ManualRunConfirmation(projectId, id);
      if (!permitted) {
        setMessage("Confirmation blocked. Reconnect, sign in and verify that this workflow has not changed; discard any stale draft.");
        return;
      }
      // Persist the exact key before sending anything to P9. A browser crash
      // cannot silently turn an uncertain attempt into a new UUID/execution.
      requestKey = crypto.randomUUID();
      if (!prepareP9ManualRunAttempt(projectId, id, requestKey)) {
        setMessage("Could not save a durable receipt bookmark. No workflow request was sent.");
        return;
      }
      const outcome = await runP9WorkflowNow(projectId, id, {
        idempotencyKey: requestKey,
        expectedUpdatedAt: draft.expectedUpdatedAt,
      });
      if (outcome.run && outcome.receiptStatus === "completed") {
        discardP9ManualRunAttempt(projectId, id, requestKey);
      }
      setMessage(outcome.error || outcome.run?.summary || "Check your P9 run receipt before any new request.");
    } catch {
      if (requestKey) {
        const receipt = await checkP9ManualRunAttempt(projectId, id, requestKey);
        setMessage(receipt.state === "completed" || receipt.state === "in_progress"
          ? `Server receipt ${receipt.runId}: ${receipt.state}. No duplicate execution was requested.`
          : "Run outcome not confirmed. The request key is saved under your account for read-only reconciliation. Do not start a duplicate run.");
      } else {
        setMessage("Unable to prepare a governed run; no automatic retry was scheduled.");
      }
    } finally {
      invalidate(projectId);
      confirming.current = false;
      setBusyId(null);
    }
  };

  const checkAttempt = async (workflowId: string, requestKey: string) => {
    setBusyId("receipt:" + requestKey);
    setMessage(null);
    try {
      const receipt = await checkP9ManualRunAttempt(projectId, workflowId, requestKey);
      setMessage(receipt.state === "completed" || receipt.state === "in_progress"
        ? `P9 server receipt ${receipt.runId}: ${receipt.state}.`
        : receipt.state === "unconfirmed"
          ? "No server receipt is confirmed yet. This bookmark is kept; no workflow was rerun."
          : "Receipt recheck blocked. Sign in online with the original account and retry the read-only check.");
    } finally {
      setBusyId(null);
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    setMessage(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const queued = queueNotificationRead(projectId, notificationId);
      setMessage(queued
        ? "Read receipt saved on this device; not yet confirmed by the server. It will be retried after reconnect."
        : "Unable to save the read receipt offline. It remains unread.");
      return;
    }
    try {
      await markP9NotificationRead(projectId, notificationId);
      invalidate(projectId);
    } catch (error) {
      // Fetch TypeErrors indicate a transport/network failure; API HTTP
      // errors (auth, tenant or missing notification) must never be queued.
      if (error instanceof TypeError && queueNotificationRead(projectId, notificationId)) {
        setMessage("Read receipt saved locally after a connection failure; not yet server-confirmed.");
      } else {
        setMessage(error instanceof Error ? error.message : "Could not mark this notification read.");
      }
    }
  };

  const createTemplate = async () => {
    if (!createKind || managementInFlight.current) return;
    managementInFlight.current = true;
    setBusyId("create");
    setMessage(null);
    const originalProject = projectId;
    try {
      const saved = await createP9Workflow(projectId, quickMonitorDraft(createKind, createEnabled, createMinutes));
      invalidate(originalProject);
      if (selectedProject.current === originalProject) {
        setMessage(saved.projectId === originalProject && saved.enabled === createEnabled
          ? createEnabled
            ? "Workflow saved enabled. Home scheduling still requires current runtime, permissions and a recorded execution receipt."
            : "Workflow saved paused. Nothing was scheduled until you explicitly enable it."
          : "The server response did not confirm the reviewed Project and enable state. Reload workflow records.");
        setCreateKind(null);
      }
    } catch (cause) {
      if (selectedProject.current === originalProject) setMessage(cause instanceof Error ? cause.message : "Unable to save this reviewed workflow.");
    } finally {
      managementInFlight.current = false;
      // Workbench may have switched Projects while P9 was responding. Always
      // release the UI lock, but never show the old Project's response there.
      setBusyId(null);
    }
  };

  const requestWorkflowReview = (workflow: (typeof workflows)[number], intent: WorkflowReview["intent"]) => {
    if (busyId || managementInFlight.current || workflow.projectId !== projectId) return;
    setCreateKind(null);
    setMessage(null);
    setReview({ projectId, workflowId: workflow.id, expectedUpdatedAt: workflow.updatedAt,
      name: workflow.name, intent, trigger: workflow.trigger, enabled: workflow.enabled });
  };

  const confirmWorkflowReview = async () => {
    const candidate = review;
    if (!candidate || managementInFlight.current || candidate.projectId !== projectId) return;
    const current = workflows.find(item => item.projectId === candidate.projectId && item.id === candidate.workflowId);
    if (!current || current.updatedAt !== candidate.expectedUpdatedAt || current.name !== candidate.name || current.enabled !== candidate.enabled) {
      setReview(null);
      setMessage("The workflow changed since you opened the review. Refresh and inspect it again.");
      return;
    }
    managementInFlight.current = true;
    setBusyId("review:" + candidate.workflowId);
    setMessage(null);
    const originalProject = candidate.projectId;
    try {
      if (candidate.intent === "delete") {
        await deleteP9Workflow(originalProject, candidate.workflowId, candidate.expectedUpdatedAt);
        if (selectedProject.current === originalProject) setMessage("The exact reviewed workflow was deleted. This does not undo previously recorded runs or outside-system effects.");
      } else if (candidate.intent === "edit") {
        const definition = scheduleEditDefinition(current, candidate.trigger);
        // Changing a schedule does not create an execution; retain original
        // enabled state so editing an inactive workflow never starts it.
        const saved = await replaceP9Workflow(originalProject, candidate.workflowId, definition, candidate.expectedUpdatedAt);
        if (selectedProject.current === originalProject) setMessage(saved.projectId === originalProject && saved.enabled === current.enabled
          ? "Workflow schedule saved at the server. Next execution depends on Home, current rights and scheduler acceptance."
          : "The server response did not confirm exact workflow scope/state; refresh before relying on this edit.");
      } else {
        const enabled = candidate.intent === "resume";
        const saved = await setP9WorkflowEnabled(originalProject, candidate.workflowId, enabled, candidate.expectedUpdatedAt);
        if (selectedProject.current === originalProject) setMessage(saved.projectId === originalProject && saved.enabled === enabled
          ? enabled
            ? "Workflow enabled on the server. This is not a run receipt or a promise that an event will occur."
            : "Workflow paused on the server. Previously claimed or completed runs cannot be rolled back."
          : "The server did not confirm the exact requested enabled state; refresh this Project.");
      }
      invalidate(originalProject);
      if (selectedProject.current === originalProject) setReview(null);
    } catch (cause) {
      if (selectedProject.current === originalProject) setMessage(cause instanceof Error ? cause.message : "Workflow update failed. No change is confirmed. Reload the workflow before retrying.");
    } finally {
      managementInFlight.current = false;
      // Workbench may have switched Projects while P9 was responding. Always
      // release the UI lock, but never show the old Project's response there.
      setBusyId(null);
    }
  };

  if (workflowsQuery.isLoading || runsQuery.isLoading || notificationsQuery.isLoading) return <p role="status" className="mt-6 text-sm">Loading Project automations…</p>;
  if ((workflowsQuery.isError && !workflowsQuery.data) || (runsQuery.isError && !runsQuery.data) || (notificationsQuery.isError && !notificationsQuery.data)) return <p role="alert" className="mt-6 text-sm">Unable to load automations. <button onClick={() => { void workflowsQuery.refetch(); void runsQuery.refetch(); void notificationsQuery.refetch(); }}>Retry</button></p>;

  return (
    <section className="mt-4 rounded-xl border border-border/60 bg-white/[0.015] p-4" data-p9-continuous-intelligence>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-ui text-[10px] font-semibold text-foreground">
            <Workflow className="h-3.5 w-3.5 text-amber-300" />
            Continuous Intelligence
          </div>
          <div className="mt-1 max-w-2xl font-ui text-[13px] leading-4 text-muted-foreground">
            Saved analysis can run again on fresh data. Notifications are Project-scoped, permission-bound and suppressed when configured relevance/cooldown rules say nothing material changed.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setReview(null); setCreateKind("changes"); setCreateEnabled(false); setCreateMinutes(60); }} disabled={Boolean(busyId)} className="rounded border border-border/60 px-2.5 py-1.5 font-ui text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-40">
            + What changed
          </button>
          <button type="button" onClick={() => { setReview(null); setCreateKind("provider"); setCreateEnabled(false); setCreateMinutes(60); }} disabled={Boolean(busyId)} className="rounded border border-border/60 px-2.5 py-1.5 font-ui text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-40">
            + Provider health
          </button>
          <span className="rounded border border-amber-400/20 bg-amber-400/[0.04] px-2 py-1 font-terminal text-[12px] text-amber-200">
            {workflows.filter((item) => item.enabled).length} ENABLED · NOT EXECUTION CONFIRMATION
          </span>
        </div>
      </div>

      {(workflowsQuery.isError || runsQuery.isError || notificationsQuery.isError) && <p role="status" className="mt-3 text-sm text-amber-200">Home refresh is unavailable. Showing previously loaded state; offline run drafts still require fresh online confirmation. <button onClick={() => { void workflowsQuery.refetch(); void runsQuery.refetch(); void notificationsQuery.refetch(); }}>Retry refresh</button></p>}
      {message && <div role="status" className="mt-3 rounded border border-border/50 bg-black/20 px-3 py-2 font-ui text-[13px] text-muted-foreground">{message}</div>}
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Workflows never start merely from opening this panel. Enabling a schedule opts in to future claims by the original P9 Home scheduler; completed, failed and skipped states come from server run records, not the UI.</p>
      {createKind && <section aria-label="Review new Project workflow" data-testid="p9-create-review" className="mt-3 space-y-2 rounded-lg border border-amber-300/30 p-3">
        <h3 className="font-ui text-sm font-semibold">Review {createKind === "provider" ? "Provider health" : "Project what changed"} monitor · Project {projectId}</h3>
        <p className="text-xs text-muted-foreground">Action: {createKind === "provider" ? "check configured provider health" : "compare saved Project intelligence"}. No external action permission, data rights or completed execution is granted by saving.</p>
        <label className="block font-ui text-sm">Interval in minutes (5 to 10080)
          <input type="number" min={5} max={10080} step={1} value={createMinutes} disabled={Boolean(busyId)}
            onChange={event => setCreateMinutes(Number(event.target.value))} className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2" />
        </label>
        <label className="flex items-start gap-2 font-ui text-sm">
          <input type="checkbox" data-testid="p9-create-enable-consent" checked={createEnabled} disabled={Boolean(busyId)} onChange={event => setCreateEnabled(event.target.checked)} />
          <span>Enable future scheduled execution after saving. Unchecked saves a paused workflow that cannot be claimed by the scheduler.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busyId) || !Number.isInteger(createMinutes) || createMinutes < 5 || createMinutes > 10080}
            onClick={() => void createTemplate()} className="min-h-10 rounded border border-amber-300/50 px-3 py-2 text-sm disabled:opacity-40">Save reviewed workflow {createEnabled ? "enabled" : "paused"}</button>
          <button type="button" disabled={Boolean(busyId)} onClick={() => setCreateKind(null)} className="min-h-10 rounded border border-border px-3 py-2 text-sm">Cancel</button>
        </div>
      </section>}
      {review?.projectId === projectId && (() => {
        const current = workflows.find(item => item.id === review.workflowId && item.projectId === projectId);
        const unchanged = !!current && current.updatedAt === review.expectedUpdatedAt && current.enabled === review.enabled && current.name === review.name;
        return <section aria-label="Review exact scheduled workflow change" data-testid="p9-workflow-review" className="mt-3 space-y-2 rounded-lg border border-amber-300/30 p-3">
          <h3 className="font-ui text-sm font-semibold">Review {review.intent} · {review.name} · Project {projectId}</h3>
          <p className="break-all text-xs text-muted-foreground">Workflow {review.workflowId} · version {review.expectedUpdatedAt}</p>
          <p className="text-xs text-muted-foreground">Current status: {review.enabled ? "enabled" : "paused"}. {current ? workflowScheduleSummary(current) : "Workflow no longer listed."}</p>
          {review.intent === "edit" && review.trigger.type === "schedule" && review.trigger.schedule.kind === "interval" && (
            <label className="block text-sm">New interval · minutes (5 to 10080)
              <input type="number" min={5} max={10080} step={1} disabled={Boolean(busyId)}
                value={review.trigger.schedule.everyMinutes}
                onChange={event => setReview(previous => previous && previous.trigger.type === "schedule"
                  ? { ...previous, trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: Number(event.target.value) } } }
                  : previous)}
                className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2" />
            </label>
          )}
          {review.intent === "edit" && review.trigger.type === "schedule" && review.trigger.schedule.kind === "daily_utc" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Hour UTC (0–23)<input type="number" min={0} max={23} step={1} disabled={Boolean(busyId)} value={review.trigger.schedule.hour}
                onChange={event => setReview(previous => previous && previous.trigger.type === "schedule" && previous.trigger.schedule.kind === "daily_utc"
                  ? { ...previous, trigger: { type: "schedule", schedule: { kind: "daily_utc", hour: Number(event.target.value), minute: previous.trigger.schedule.minute } } }
                  : previous)}
                className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2" /></label>
              <label className="text-sm">Minute UTC (0–59)<input type="number" min={0} max={59} step={1} disabled={Boolean(busyId)} value={review.trigger.schedule.minute}
                onChange={event => setReview(previous => previous && previous.trigger.type === "schedule" && previous.trigger.schedule.kind === "daily_utc"
                  ? { ...previous, trigger: { type: "schedule", schedule: { kind: "daily_utc", hour: previous.trigger.schedule.hour, minute: Number(event.target.value) } } }
                  : previous)}
                className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2" /></label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{review.intent === "resume"
            ? "Resuming opts into future scheduled or conditional checks, not a confirmed run."
            : review.intent === "pause" ? "Pausing stops new scheduled claims; already admitted runs or external actions are not rolled back."
            : review.intent === "delete" ? "Deleting this exact workflow does not delete historical receipts, reverse earlier notifications, or undo external effects."
            : "Save only this workflow's trigger. Its actions, permissions, source refs and enabled state are preserved; schedule changes may recalculate the next due time."}</p>
          {!unchanged && <p role="alert" className="text-amber-200">Workflow changed or is unavailable since review. Refresh and inspect again.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busyId) || !unchanged || (review.intent === "edit" && review.trigger.type === "schedule" &&
              (review.trigger.schedule.kind === "interval"
                ? !Number.isInteger(review.trigger.schedule.everyMinutes) || review.trigger.schedule.everyMinutes < 5 || review.trigger.schedule.everyMinutes > 10080
                : !Number.isInteger(review.trigger.schedule.hour) || review.trigger.schedule.hour < 0 || review.trigger.schedule.hour > 23 ||
                  !Number.isInteger(review.trigger.schedule.minute) || review.trigger.schedule.minute < 0 || review.trigger.schedule.minute > 59))}
              onClick={() => void confirmWorkflowReview()} className="min-h-10 rounded border border-amber-300/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-40">Confirm {review.intent} for this workflow</button>
            <button type="button" disabled={Boolean(busyId)} onClick={() => setReview(null)} className="min-h-10 rounded border border-border px-3 py-2 text-sm">Cancel</button>
          </div>
        </section>;
      })()}
      <HomeAttentionPanel />

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {workflows.slice(0, 12).map((workflow) => {
          const last = latestRun.get(workflow.id);
          const truth = workflowExecutionTruth(workflow, last);
          return (
            <article key={workflow.id} className="rounded-lg border border-border/50 bg-black/15 p-3">
              <div className="flex items-start gap-2">
                <button type="button" disabled={Boolean(busyId)}
                  onClick={() => requestWorkflowReview(workflow, workflow.enabled ? "pause" : "resume")}
                  className={`mt-0.5 rounded border p-1 disabled:opacity-40 ${workflow.enabled ? "border-emerald-400/35 text-emerald-300" : "border-border/60 text-muted-foreground"}`}
                  title={workflow.enabled ? "Review pause" : "Review resume"}
                  aria-label={`Review ${workflow.enabled ? "pause" : "resume"} for ${workflow.name}`}
                >
                  {workflow.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-ui text-[14px] font-medium text-foreground">{workflow.name}</span>
                    <span className="rounded border border-border/50 px-1.5 py-0.5 font-terminal text-[12px] uppercase text-cyan-300">{workflow.template}</span>
                    <span className="font-terminal text-[12px] uppercase text-muted-foreground">{workflow.trigger.type}</span>
                  </div>
                  <div className="mt-1 font-ui text-[13px] leading-4 text-muted-foreground">
                    {workflow.description || "Saved Project workflow."}
                  </div>
                  {workflow.trigger.type === "schedule" && <p className="mt-1 text-xs text-muted-foreground">
                    {workflow.trigger.schedule.kind === "daily_utc"
                      ? `Daily at ${String(workflow.trigger.schedule.hour).padStart(2, "0")}:${String(workflow.trigger.schedule.minute).padStart(2, "0")} UTC`
                      : `Every ${workflow.trigger.schedule.everyMinutes} minutes`}
                    {" · Requires a running Home"}
                  </p>}
                  {workflow.trigger.type === "event" && <p className="mt-1 text-xs text-muted-foreground">
                    {workflow.trigger.eventType}{" · "}
                    {Object.entries(workflow.trigger.filters).map(([key, value]) => `${key} = ${String(value)}`).join(", ") || "All permitted matching events"}
                    {Array.isArray(workflow.eventCursor.pendingAutomationEvents) && workflow.eventCursor.pendingAutomationEvents.length > 0
                      ? ` · ${workflow.eventCursor.pendingAutomationEvents.length} pending delivery`
                      : ""}
                  </p>}
                  {workflow.action.kind === "model_refresh_review" && <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Model source review · no automatic apply</summary>
                    <p className="break-all">Accepted {workflow.action.acceptedArtifact.artifactId} · v{workflow.action.acceptedArtifact.version} · {workflow.action.sourceProvider}</p>
                    <p>Open this model's existing reported-period maintenance surface to select, review and explicitly apply an eligible immutable snapshot. This monitor never overwrites your model.</p>
                    {last?.output.review != null && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(last.output.review, null, 2)}</pre>}
                  </details>}
                  {last?.output.kind === "portfolio_materiality" && <PortfolioMaterialityResult output={last.output} />}
                  {workflow.action.kind === "conversation_rerun" && workflow.action.acceptedArtifact && <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Accepted monitor baseline · v{workflow.action.acceptedArtifact.version}</summary>
                    <p className="mt-1 break-all">{workflow.action.acceptedArtifact.artifactId}</p>
                    <p className="break-all">Content hash: {workflow.action.acceptedArtifact.contentHash}</p>
                    <p>Home rechecks this exact baseline, successful-run custody and current permissions before each rerun. New outputs do not approve or overwrite your financial Decision.</p>
                  </details>}
                  <div data-testid="p9-workflow-execution-truth" className="mt-2 space-y-1 font-ui text-xs text-muted-foreground">
                    <p>{truth.state.toUpperCase()} · {workflowScheduleSummary(workflow)}</p>
                    <p>Next due: {truth.next === workflow.nextRunAt ? time(workflow.nextRunAt) : truth.next}</p>
                    <p>Last observed run: {truth.latest} · {truth.receiptCount} linked execution receipt ID{truth.receiptCount === 1 ? "" : "s"}</p>
                    <p>{truth.warning}</p>
                  </div>
                  {last?.summary && <div className="mt-2 line-clamp-2 font-ui text-[13px] leading-4 text-muted-foreground/90">{last.summary}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={Boolean(busyId)} onClick={() => void run(workflow.id, workflow.updatedAt)} className="rounded border border-border/60 p-1.5 text-cyan-300 hover:bg-white/[0.03] disabled:opacity-40" title="Run now · explicit manual action">
                    <RefreshCw className={`h-3 w-3 ${busyId === workflow.id ? "animate-spin" : ""}`} />
                  </button>
                  <button type="button" disabled={Boolean(busyId) || workflow.trigger.type !== "schedule"} onClick={() => requestWorkflowReview(workflow, "edit")}
                    className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground disabled:opacity-40" title="Review interval or UTC daily schedule edit">Edit schedule</button>
                  <button type="button" disabled={Boolean(busyId)} onClick={() => requestWorkflowReview(workflow, "delete")} className="rounded p-1.5 text-muted-foreground hover:bg-white/[0.03] hover:text-red-300 disabled:opacity-40" title="Review workflow deletion">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!workflows.length && (
          <div className="rounded-lg border border-dashed border-border/50 p-4 font-ui text-[13px] text-muted-foreground lg:col-span-2">
            No saved workflows yet. Run an analysis in a Project chat and use <span className="text-amber-200">Save Workflow</span>, or add a simple Project/provider monitor here.
          </div>
        )}
      </div>

      {attempts.length > 0 && (
        <div className="mt-4 border-t border-border/50 pt-3" data-p9-manual-receipt-bookmarks>
          <h3 className="font-ui text-[13px] font-semibold text-foreground">Manual run receipts to reconcile</h3>
          <p className="mt-1 font-ui text-[12px] text-muted-foreground">
            These are locally saved request identifiers, not confirmed executions. Checking them only reads server receipts; it never runs a workflow.
          </p>
          {attempts.map((attempt) => (
            <div key={attempt.requestKey} className="mt-2 flex flex-wrap items-center gap-2 rounded border border-border/50 px-3 py-2">
              <span className="flex-1 font-ui text-[12px] text-muted-foreground">
                {workflows.find(item => item.id === attempt.workflowId)?.name ?? "Workflow unavailable"}
                {" · "}
                <span className="font-mono">{attempt.requestKey.slice(0, 8)}</span>
              </span>
              <button type="button" disabled={Boolean(busyId)} onClick={() => void checkAttempt(attempt.workflowId, attempt.requestKey)}
                className="rounded border border-border/60 px-2 py-1 text-[12px] disabled:opacity-40">
                Check server receipt
              </button>
              <button type="button" disabled={Boolean(busyId)}
                onClick={() => {
                  discardP9ManualRunAttempt(projectId, attempt.workflowId, attempt.requestKey);
                  setMessage("Local bookmark discarded. This does not cancel or rerun any server workflow.");
                }}
                className="rounded border border-border/60 px-2 py-1 text-[12px] text-muted-foreground disabled:opacity-40">
                Remove bookmark
              </button>
            </div>
          ))}
        </div>
      )}

      {drafts.length > 0 && (
        <div className="mt-4 border-t border-border/50 pt-3" data-p9-manual-run-drafts>
          <h3 className="font-ui text-[13px] font-semibold text-foreground">Offline manual-run drafts — confirmation required</h3>
          <p className="mt-1 font-ui text-[12px] text-muted-foreground">
            Nothing is queued for automatic execution. After reconnect, review the current workflow and explicitly confirm each request.
          </p>
          {drafts.map((draft) => {
            const workflow = workflows.find((item) => item.id === draft.workflowId);
            const current = workflow?.updatedAt === draft.expectedUpdatedAt;
            return (
              <div key={draft.workflowId} className="mt-2 flex flex-wrap items-center gap-2 rounded border border-border/50 px-3 py-2">
                <span className="flex-1 font-ui text-[13px]">
                  {workflow?.name ?? "Workflow unavailable"}
                  {!current && <span className="ml-2 text-amber-300">Changed or unavailable — discard</span>}
                </span>
                <button type="button" disabled={Boolean(busyId) || !current}
                  onClick={() => void confirmDraft(draft.workflowId)}
                  className="rounded border border-border/60 px-2 py-1 text-[12px] disabled:opacity-40">
                  Confirm run now
                </button>
                <button type="button" disabled={Boolean(busyId)}
                  onClick={() => { discardP9ManualRunDraft(projectId, draft.workflowId); setMessage("Offline draft discarded; no workflow was run."); }}
                  className="rounded border border-border/60 px-2 py-1 text-[12px] text-muted-foreground disabled:opacity-40">
                  Discard
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 border-t border-border/50 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 font-ui text-[13px] font-medium text-foreground"><BellRing className="h-3 w-3 text-amber-300" /> Notifications</div>
          <span className="font-terminal text-[12px] text-muted-foreground">{unread.length} UNREAD · PROJECT</span>
        </div>
        <div className="space-y-1.5">
          {unread.slice(0, 5).map((item) => (
            <button key={item.id} onClick={() => void markNotificationRead(item.id)} className="block w-full rounded border border-border/45 bg-black/15 px-3 py-2 text-left hover:bg-white/[0.025]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-ui text-[13px] text-foreground">{item.title}</span>
                <span className="font-terminal text-[12px] text-muted-foreground">{time(item.createdAt)}</span>
              </div>
              <div className="mt-1 line-clamp-2 font-ui text-[13px] leading-4 text-muted-foreground">{item.body}</div>
            </button>
          ))}
          {!unread.length && <div className="font-ui text-[13px] text-muted-foreground">No unread material workflow notifications.</div>}
        </div>
      </div>

      <P9NotificationHistory key={projectId} projectId={projectId} notifications={notifications}
        busy={Boolean(busyId)} onRead={notificationId => void markNotificationRead(notificationId)}
        onRefetch={() => { void notificationsQuery.refetch(); }} />

      <div className="mt-3 font-terminal text-[12px] leading-3 text-muted-foreground/70">
        Workflows use the selected Project's existing P9 sources and permissions. Reviewed schedule edits are available for interval and daily UTC schedules; conditional event filter authoring and the full visual editor remain under the existing P9 service, not a separate automation engine.
      </div>
    </section>
  );
}
