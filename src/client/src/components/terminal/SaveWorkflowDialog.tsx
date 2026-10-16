import { useMemo, useState } from "react";
import { Clock3, Save, X } from "lucide-react";
import type { ConversationRequest } from "@shared/conversationRuntime";
import type { P9AutomationEventType, P9WorkflowTemplate, P9WorkflowTrigger } from "@shared/p9AutomationContracts";
import { saveConversationAsP9Workflow } from "@/lib/useP9Automation";
import { P9_ACCEPTED_FINANCE_TEMPLATES } from "@shared/p9AutomationContracts";
import { useArtifact } from "@/lib/useArtifacts";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const TEMPLATES: Array<{ value: P9WorkflowTemplate; label: string }> = [
  { value: "custom", label: "Saved analysis" },
  { value: "filing_monitor", label: "Filing monitor" },
  { value: "earnings_monitor", label: "Earnings refresh" },
  { value: "valuation_refresh", label: "Valuation refresh" },
  { value: "portfolio_monitor", label: "Portfolio monitor" },
  { value: "report_refresh", label: "Report refresh" },
];

function defaultEvent(template: P9WorkflowTemplate): P9AutomationEventType {
  if (template === "filing_monitor") return "filing";
  if (template === "earnings_monitor") return "earnings";
  if (template === "portfolio_monitor") return "risk_threshold";
  return "data_refresh";
}

export function SaveWorkflowDialog({
  projectId,
  chatId,
  sourceRequestId,
  request,
  activeArtifactRef,
  onClose,
  onSaved,
}: {
  projectId: number;
  chatId: number;
  sourceRequestId: string;
  request: Omit<ConversationRequest, "requestId" | "continuationOf">;
  activeArtifactRef?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(() => request.message.slice(0, 80) || "Saved analysis");
  const [template, setTemplate] = useState<P9WorkflowTemplate>("custom");
  const [triggerMode, setTriggerMode] = useState<"manual" | "interval" | "daily" | "event">("interval");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [dailyHour, setDailyHour] = useState(9);
  const [dailyMinute, setDailyMinute] = useState(0);
  const [eventType, setEventType] = useState<P9AutomationEventType>("data_refresh");
  const [eventFilterKey, setEventFilterKey] = useState(request.context?.symbol ? "symbol" : "");
  const [eventFilterValue, setEventFilterValue] = useState(request.context?.symbol ?? "");
  const [notify, setNotify] = useState(true);
  const [minRelevance, setMinRelevance] = useState(0.5);
  const [cooldownMinutes, setCooldownMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acceptedArtifactQuery = useArtifact(activeArtifactRef?.startsWith("artifact:") ? activeArtifactRef : null);
  const [acceptedVersion, setAcceptedVersion] = useState<string | null>(null);
  const accepted = acceptedArtifactQuery.data;
  const acceptedIdentity = accepted ? `${accepted.artifact.id}:${accepted.version.version}:${accepted.version.contentHash}` : null;
  const financeMonitor = P9_ACCEPTED_FINANCE_TEMPLATES.includes(template);
  const acceptedCurrent = acceptedIdentity !== null && acceptedVersion === acceptedIdentity;
  const [followCurrentProfile, setFollowCurrentProfile] = useState(false);
  const canFollowProfile = financeMonitor && Boolean(request.context?.personalFinance)
    && accepted?.version.refreshSpec?.executionMode === "deterministic_first";
  const currentProfileQuery = useQuery<{ resourceId: string | null }>({
    queryKey: ["/api/projects", projectId, "personal-finance-profile", "monitor-source"],
    enabled: canFollowProfile,
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/personal-finance-profile`)).json(),
  });

  const trigger = useMemo<P9WorkflowTrigger>(() => {
    if (triggerMode === "manual") return { type: "manual" };
    if (triggerMode === "interval") {
      return { type: "schedule", schedule: { kind: "interval", everyMinutes: Math.min(Math.max(Math.round(intervalMinutes || 60), 5), 10_080) } };
    }
    if (triggerMode === "daily") {
      return { type: "schedule", schedule: { kind: "daily_utc", hour: dailyHour, minute: dailyMinute } };
    }
    const filters: Record<string, string> = {};
    if (eventFilterKey.trim() && eventFilterValue.trim()) filters[eventFilterKey.trim()] = eventFilterValue.trim();
    return { type: "event", eventType, filters };
  }, [dailyHour, dailyMinute, eventFilterKey, eventFilterValue, eventType, intervalMinutes, triggerMode]);

  const changeTemplate = (next: P9WorkflowTemplate) => {
    setTemplate(next);
    setEventType(defaultEvent(next));
    if (next === "filing_monitor" || next === "earnings_monitor" || next === "portfolio_monitor") setTriggerMode("event");
  };

  const save = async () => {
    if (!name.trim()) return;
    if (financeMonitor && (!accepted || !acceptedCurrent)) {
      setError("Inspect and explicitly accept the retained financial Artifact version before saving this monitor.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveConversationAsP9Workflow(projectId, {
        name: name.trim(),
        description: "Saved from Project chat. Reruns preserve the original execution mode, approvals, transmission policy and active context.",
        template,
        chatId,
        sourceRequestId,
        request: financeMonitor && accepted?.version.refreshSpec ? {
          ...request,
          message: accepted.version.refreshSpec.message ?? request.message,
          executionMode: accepted.version.refreshSpec.executionMode,
          sourceScope: accepted.version.refreshSpec.sourceScope,
        } : request,
        ...(financeMonitor && accepted ? { acceptedArtifact: {
          artifactId: accepted.artifact.id,
          version: accepted.version.version,
          contentHash: accepted.version.contentHash,
        } } : {}),
        ...(canFollowProfile && followCurrentProfile && currentProfileQuery.data?.resourceId
          ? { currentPersonalFinanceResourceId: currentProfileQuery.data.resourceId } : {}),
        trigger,
        notificationPolicy: {
          enabled: notify,
          channels: ["in_app"],
          notifyOn: ["failure", "condition_met", "change_detected"],
          minimumRelevanceScore: minRelevance,
          cooldownMinutes,
          suppressUnchanged: true,
        },
        sourceRefs: [],
        engineRefs: ["lios.conversation-runtime"],
        artifactRefs: activeArtifactRef ? [activeArtifactRef] : [],
        enabled: true,
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save workflow.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-3" onMouseDown={onClose}>
      <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-[#080808] shadow-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="Save workflow">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <Save className="h-4 w-4 text-amber-300" />
          <div className="min-w-0 flex-1">
            <div className="font-ui text-[10px] font-semibold text-foreground">Save Workflow</div>
            <div className="mt-0.5 font-ui text-[7px] text-muted-foreground">Run this analysis again on fresh data without changing its permission or AI-sharing policy.</div>
          </div>
          <button type="button" aria-label="Close Save Workflow" onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </header>

        <div className="space-y-4 p-4">
          <label className="block">
            <span className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">Workflow name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} className="mt-1 w-full rounded border border-border/60 bg-black/25 px-3 py-2 font-ui text-[9px] text-foreground outline-none focus:border-amber-300/35" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">Template</span>
              <select value={template} onChange={(event) => changeTemplate(event.target.value as P9WorkflowTemplate)} className="mt-1 w-full rounded border border-border/60 bg-black px-2 py-2 font-ui text-[8px] text-foreground">
                {TEMPLATES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">Trigger</span>
              <select value={triggerMode} onChange={(event) => setTriggerMode(event.target.value as typeof triggerMode)} className="mt-1 w-full rounded border border-border/60 bg-black px-2 py-2 font-ui text-[8px] text-foreground">
                <option value="manual">Manual / Run now</option>
                <option value="interval">Schedule / interval</option>
                <option value="daily">Schedule / daily UTC</option>
                <option value="event">Event</option>
              </select>
            </label>
          </div>

          {financeMonitor && <div className="rounded border border-amber-300/20 p-3 text-sm">
            {accepted ? <>
              <p>Monitor baseline: {accepted.artifact.title} · v{accepted.version.version}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">Content hash: {accepted.version.contentHash}</p>
              <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" checked={acceptedCurrent} onChange={event => setAcceptedVersion(event.target.checked ? acceptedIdentity : null)} />
                <span>I accept this retained version as the monitor baseline. This does not approve a financial Decision or execution. Changed or missing baseline custody stops future runs.</span>
              </label>
            </> : <p role="status">A retained financial Artifact from this successful conversation is required. Keep/open the output, then save this monitor.</p>}
          </div>}

          {canFollowProfile && <label className="flex items-start gap-2 rounded border border-border/50 p-3 text-sm">
            <input type="checkbox" checked={followCurrentProfile} disabled={!currentProfileQuery.data?.resourceId}
              onChange={event => setFollowCurrentProfile(event.target.checked)} />
            <span>Use the latest saved Personal Finance profile on each run, with the deterministic engine only.
              <span className="mt-1 block text-xs text-muted-foreground">Explicit opt-in: the selected Project resource stays private and excluded from ordinary AI context. Missing/deleted/invalid input stops the run; no frozen-input fallback. Without this option, the accepted original inputs are replayed.</span>
              {!currentProfileQuery.data?.resourceId && <span className="mt-1 block text-xs text-amber-200">A current saved Project profile is required for source-following refresh.</span>}
            </span>
          </label>}
          {triggerMode === "interval" && (
            <label className="block rounded border border-border/50 bg-black/15 p-3">
              <span className="flex items-center gap-2 font-terminal text-[6px] uppercase tracking-wider text-muted-foreground"><Clock3 className="h-3 w-3" /> Repeat every minutes</span>
              <input type="number" min={5} max={10080} value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))} className="mt-2 w-32 rounded border border-border/60 bg-black px-2 py-1.5 font-terminal text-[8px] text-foreground" />
              <div className="mt-2 font-ui text-[7px] text-muted-foreground">Minimum 5 minutes. The definition survives application restarts; overdue work is reclaimed by the P9 scheduler.</div>
            </label>
          )}
          {triggerMode === "daily" && <fieldset className="rounded border border-border/50 bg-black/15 p-3">
            <legend className="text-sm font-medium">Daily schedule · UTC</legend>
            <div className="mt-2 flex gap-3">
              <label className="text-sm">UTC hour
                <input aria-label="Daily UTC hour" type="number" min={0} max={23} step={1} value={dailyHour} onChange={event => setDailyHour(Number(event.target.value))} className="ml-2 w-20 rounded border border-border/60 bg-black px-2 py-1" />
              </label>
              <label className="text-sm">UTC minute
                <input aria-label="Daily UTC minute" type="number" min={0} max={59} step={1} value={dailyMinute} onChange={event => setDailyMinute(Number(event.target.value))} className="ml-2 w-20 rounded border border-border/60 bg-black px-2 py-1" />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Runs at this UTC time while your Home is running. After downtime, due work is reclaimed once; LiOS does not invent missed execution receipts or replay every missed day.</p>
          </fieldset>}

          {triggerMode === "event" && (
            <div className="rounded border border-border/50 bg-black/15 p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <label>
                  <span className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">Event</span>
                  <select value={eventType} onChange={(event) => setEventType(event.target.value as P9AutomationEventType)} className="mt-1 w-full rounded border border-border/60 bg-black px-2 py-1.5 font-ui text-[7px] text-foreground">
                    <option value="filing">Filing</option>
                    <option value="earnings">Earnings</option>
                    <option value="data_refresh">Data refresh</option>
                    <option value="price_threshold">Price threshold</option>
                    <option value="risk_threshold">Risk threshold</option>
                    <option value="provider_health">Provider health</option>
                  </select>
                </label>
                <label>
                  <span className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">Filter key</span>
                  <input value={eventFilterKey} onChange={(event) => setEventFilterKey(event.target.value)} placeholder="symbol" className="mt-1 w-full rounded border border-border/60 bg-black px-2 py-1.5 font-ui text-[7px] text-foreground" />
                </label>
                <label>
                  <span className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">Filter value</span>
                  <input value={eventFilterValue} onChange={(event) => setEventFilterValue(event.target.value)} placeholder="AAPL" className="mt-1 w-full rounded border border-border/60 bg-black px-2 py-1.5 font-ui text-[7px] text-foreground" />
                </label>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Only observed events matching this Project/account and filter can run the recipe. Accepted deliveries survive Home restart. Current permissions are rechecked; already-started actions are not blindly replayed.</p>
            </div>
          )}

          <div className="rounded border border-border/50 bg-black/15 p-3">
            <label className="flex items-center justify-between gap-3 font-ui text-[8px] text-foreground">
              Notify only when configured policy permits
              <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">Minimum relevance · {minRelevance.toFixed(2)}</span>
                <input type="range" min={0} max={1} step={0.05} value={minRelevance} onChange={(event) => setMinRelevance(Number(event.target.value))} className="mt-1 w-full" />
              </label>
              <label>
                <span className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">Cooldown minutes</span>
                <input type="number" min={0} max={43200} value={cooldownMinutes} onChange={(event) => setCooldownMinutes(Number(event.target.value))} className="mt-1 w-full rounded border border-border/60 bg-black px-2 py-1.5 font-terminal text-[8px] text-foreground" />
              </label>
            </div>
            <div className="mt-2 font-ui text-[7px] leading-4 text-muted-foreground">Unchanged runs are suppressed by default. Canonical notifications remain in this Project; permitted desktop alerts show redacted text. Your current notification policy is rechecked when a run finishes.</div>
          </div>

          <div className="rounded border border-cyan-300/15 bg-cyan-300/[0.025] p-3 font-ui text-[7px] leading-4 text-muted-foreground">
            Saved request: <span className="text-foreground">{request.message.slice(0, 180)}</span>{request.message.length > 180 ? "…" : ""}<br />
            Execution: {financeMonitor ? accepted?.version.refreshSpec?.executionMode ?? request.executionMode : request.executionMode} · Project approvals carried by this workflow: {request.approvals.length ? request.approvals.map((item) => item.action).join(", ") : "none"}. Missing high-impact approval stops the background run rather than auto-approving it.
          </div>

          {error && <div className="rounded border border-red-400/25 bg-red-400/[0.04] px-3 py-2 font-ui text-[8px] text-red-200">{error}</div>}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded px-3 py-2 font-ui text-[8px] text-muted-foreground hover:text-foreground">Cancel</button>
            <button disabled={saving || !name.trim() || (financeMonitor && !acceptedCurrent)} onClick={() => void save()} className="rounded border border-amber-400/35 bg-amber-400/[0.08] px-3 py-2 font-ui text-[8px] font-medium text-amber-200 disabled:opacity-40">
              {saving ? "Saving…" : "Save Workflow"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
