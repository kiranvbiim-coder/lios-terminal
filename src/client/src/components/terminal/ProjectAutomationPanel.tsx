import { useMemo, useState } from "react";
import { BellRing, Pause, Play, RefreshCw, Trash2, Workflow } from "lucide-react";
import {
  createP9Workflow,
  deleteP9Workflow,
  markP9NotificationRead,
  runP9WorkflowNow,
  setP9WorkflowEnabled,
  useInvalidateP9Automation,
  useP9Notifications,
  useP9Runs,
  useP9Workflows,
} from "@/lib/useP9Automation";
import type { P9NotificationPolicy, P9WorkflowDefinitionInput } from "@shared/p9AutomationContracts";

function time(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "—";
}

function defaultPolicy(): P9NotificationPolicy {
  return {
    enabled: true,
    channels: ["in_app"],
    notifyOn: ["failure", "condition_met", "change_detected"],
    minimumRelevanceScore: 0.5,
    cooldownMinutes: 60,
    suppressUnchanged: true,
  };
}

export function ProjectAutomationPanel({ projectId }: { projectId: number }) {
  const workflowsQuery = useP9Workflows(projectId);
  const runsQuery = useP9Runs(projectId);
  const notificationsQuery = useP9Notifications(projectId);
  const invalidate = useInvalidateP9Automation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const workflows = workflowsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const latestRun = useMemo(() => {
    const map = new Map<string, (typeof runs)[number]>();
    for (const run of runs) if (!map.has(run.workflowId)) map.set(run.workflowId, run);
    return map;
  }, [runs]);
  const unread = notifications.filter((item) => item.status === "delivered" && !item.readAt);

  const run = async (id: string) => {
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

  const createTemplate = async (kind: "provider" | "changes") => {
    setBusyId("create:" + kind);
    setMessage(null);
    try {
      const input: P9WorkflowDefinitionInput = kind === "provider"
        ? {
            schemaVersion: "1",
            name: "Provider health monitor",
            description: "Check configured providers and user-connected source health without exposing credentials.",
            template: "provider_health",
            trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } },
            action: { kind: "provider_health" },
            notificationPolicy: defaultPolicy(),
            sourceRefs: [],
            engineRefs: ["lios.provider-status", "lios.source-connections"],
            artifactRefs: [],
            enabled: true,
          }
        : {
            schemaVersion: "1",
            name: "Project what changed",
            description: "Compare Project Intelligence against its previous snapshot and surface material source changes.",
            template: "custom",
            trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } },
            action: { kind: "project_what_changed" },
            notificationPolicy: defaultPolicy(),
            sourceRefs: [],
            engineRefs: ["lios.project-intelligence"],
            artifactRefs: [],
            enabled: true,
          };
      await createP9Workflow(projectId, input);
      invalidate(projectId);
      setMessage(kind === "provider" ? "Provider health workflow saved." : "Project change workflow saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save this workflow.");
    } finally {
      setBusyId(null);
    }
  };

  if (workflowsQuery.isLoading || runsQuery.isLoading || notificationsQuery.isLoading) return <p role="status" className="mt-6 text-sm">Loading Project automations…</p>;
  if (workflowsQuery.isError || runsQuery.isError || notificationsQuery.isError) return <p role="alert" className="mt-6 text-sm">Unable to load automations. <button onClick={() => { void workflowsQuery.refetch(); void runsQuery.refetch(); void notificationsQuery.refetch(); }}>Retry</button></p>;

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
          <button onClick={() => void createTemplate("changes")} disabled={Boolean(busyId)} className="rounded border border-border/60 px-2.5 py-1.5 font-ui text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-40">
            + What changed
          </button>
          <button onClick={() => void createTemplate("provider")} disabled={Boolean(busyId)} className="rounded border border-border/60 px-2.5 py-1.5 font-ui text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-40">
            + Provider health
          </button>
          <span className="rounded border border-amber-400/20 bg-amber-400/[0.04] px-2 py-1 font-terminal text-[12px] text-amber-200">
            {workflows.filter((item) => item.enabled).length} ACTIVE
          </span>
        </div>
      </div>

      {message && <div className="mt-3 rounded border border-border/50 bg-black/20 px-3 py-2 font-ui text-[13px] text-muted-foreground">{message}</div>}

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {workflows.slice(0, 12).map((workflow) => {
          const last = latestRun.get(workflow.id);
          return (
            <article key={workflow.id} className="rounded-lg border border-border/50 bg-black/15 p-3">
              <div className="flex items-start gap-2">
                <button
                  onClick={() => void setP9WorkflowEnabled(projectId, workflow.id, !workflow.enabled).then(() => invalidate(projectId))}
                  className={`mt-0.5 rounded border p-1 ${workflow.enabled ? "border-emerald-400/35 text-emerald-300" : "border-border/60 text-muted-foreground"}`}
                  title={workflow.enabled ? "Pause workflow" : "Resume workflow"}
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
                  <div className="mt-2 grid grid-cols-2 gap-2 font-terminal text-[12px] text-muted-foreground">
                    <span>NEXT · {time(workflow.nextRunAt)}</span>
                    <span>LAST · {last ? last.status.toUpperCase() + " · " + time(last.completedAt) : "NOT RUN"}</span>
                  </div>
                  {last?.summary && <div className="mt-2 line-clamp-2 font-ui text-[13px] leading-4 text-muted-foreground/90">{last.summary}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <button disabled={busyId === workflow.id} onClick={() => void run(workflow.id)} className="rounded border border-border/60 p-1.5 text-cyan-300 hover:bg-white/[0.03] disabled:opacity-40" title="Run now">
                    <RefreshCw className={`h-3 w-3 ${busyId === workflow.id ? "animate-spin" : ""}`} />
                  </button>
                  <button onClick={() => void deleteP9Workflow(projectId, workflow.id).then(() => invalidate(projectId))} className="rounded p-1.5 text-muted-foreground hover:bg-white/[0.03] hover:text-red-300" title="Delete workflow">
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

      <div className="mt-4 border-t border-border/50 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 font-ui text-[13px] font-medium text-foreground"><BellRing className="h-3 w-3 text-amber-300" /> Notifications</div>
          <span className="font-terminal text-[12px] text-muted-foreground">{unread.length} UNREAD · IN-APP ONLY</span>
        </div>
        <div className="space-y-1.5">
          {unread.slice(0, 5).map((item) => (
            <button key={item.id} onClick={() => void markP9NotificationRead(projectId, item.id).then(() => invalidate(projectId))} className="block w-full rounded border border-border/45 bg-black/15 px-3 py-2 text-left hover:bg-white/[0.025]">
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

      <div className="mt-3 font-terminal text-[12px] leading-3 text-muted-foreground/70">
        Workflows use the selected Project’s sources and permissions. Visual workflow editing is not available. Use Save Workflow from a Project chat or add a monitor above.
      </div>
    </section>
  );
}
