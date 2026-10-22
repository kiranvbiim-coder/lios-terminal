import { useTerminalArtifactState, useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, Check, CirclePause, CirclePlay, GitBranch, ListRestart, Pencil, Play, RefreshCw, ShieldCheck, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

type RunStatus = "planned" | "running" | "paused" | "awaiting_approval" | "completed" | "incomplete" | "failed" | "rejected";
type TaskStatus = "pending" | "running" | "completed" | "incomplete" | "failed" | "blocked" | "awaiting_approval" | "rejected";
type View = "graph" | "ledger" | "tools" | "synthesis";

interface BrainTask {
  id: number; taskKey: string; label: string; agentRole: string; toolId: string | null; dependencies: string[];
  expectedEvidence: string[]; completionCriteria: string; status: TaskStatus; input: Record<string, unknown>;
  output: Record<string, unknown> | null; provenance: Array<Record<string, unknown>>; deterministicRefs: string[];
  attemptCount: number; error: string | null;
}
interface BrainRunSummary { id: number; title: string; question: string; decisionType: string; status: RunStatus; updatedAt: string }
interface BrainRun extends BrainRunSummary {
  intent: { entities?: string[]; horizon?: string | null; constraints?: string[]; requiredOutputs?: string[] };
  requiredOutputs: string[]; policies: Record<string, unknown>; synthesis: string | null;
  tasks: BrainTask[];
  toolCalls: Array<{ id: number; taskId: number; toolId: string; agentRole: string; status: TaskStatus; provider: string | null; modelId: string | null; latencyMs: number | null; error: string | null; createdAt: string; provenance: Array<Record<string, unknown>>; deterministicRefs: string[] }>;
  approvals: Array<{ id: number; taskId: number; status: "pending" | "approved" | "rejected"; snapshotHash: string; note: string | null; createdAt: string }>;
}
interface ToolResponse { tools: Array<{ id: string; label: string; description: string; allowedAgents: string[]; allowedRoles: string[]; dataClass: string; tenantScoped: boolean; writeOperation: boolean; inputSchema: Record<string, string>; outputContract: string; safeFailure: string }> }

const STATUS_STYLE: Record<TaskStatus | RunStatus, string> = {
  planned: "border-sky-400/40 text-sky-300", running: "border-cyan-400/40 text-cyan-300", paused: "border-zinc-400/40 text-zinc-300",
  pending: "border-border text-muted-foreground", completed: "border-emerald-400/40 text-emerald-300", incomplete: "border-amber-400/40 text-amber-300",
  failed: "border-red-400/40 text-red-300", blocked: "border-red-400/40 text-red-300", awaiting_approval: "border-violet-400/40 text-violet-300",
  rejected: "border-red-400/40 text-red-300",
};
const VIEWS: View[] = ["graph", "ledger", "tools", "synthesis"];

function statusLabel(value: string) { return value.replaceAll("_", " ").toUpperCase(); }
function formatDate(value: string) { return new Date(value).toLocaleString(); }
function outputSummary(task: BrainTask) {
  if (!task.output) return task.error ?? "No output recorded.";
  if (typeof task.output.reason === "string") return task.output.reason;
  if (typeof task.output.resultCount === "number") return `${task.output.resultCount} normalized result(s)`;
  if (task.output.coverage && typeof task.output.coverage === "object") return `Coverage: ${String((task.output.coverage as { state?: string }).state ?? "recorded")}`;
  if (typeof task.output.gapCount === "number") return `${task.output.gapCount} explicit gap(s)`;
  if (typeof task.output.passed === "boolean") return task.output.passed ? "Provenance gate passed" : "Provenance gate incomplete";
  if (typeof task.output.markdown === "string") return "Approved synthesis assembled";
  return "Structured output recorded";
}

export default function LimuriaBrainPanel({ symbol, role }: { symbol: string; role: string }) {
  const canAuthor = role === "internal_admin" || role === "internal_analyst";
  const [selectedId, setSelectedId] = useTerminalArtifactState<number | null>("LimuriaBrainPanel.selectedId", null);
  const [view, setView] = useTerminalArtifactState<View>("LimuriaBrainPanel.view", "graph");
  const [question, setQuestion] = useTerminalArtifactState("LimuriaBrainPanel.question", `Should we invest in ${symbol || "AAPL"} over the next 12 months?`);
  const [primaryEntity, setPrimaryEntity] = useTerminalArtifactState("LimuriaBrainPanel.primaryEntity", (symbol || "AAPL").toUpperCase());
  const [message, setMessage] = useState("");
  const [editingTaskId, setEditingTaskId] = useTerminalArtifactState<number | null>(`LimuriaBrainPanel.editingTaskId.${selectedId}`, null);
  const [editCriteria, setEditCriteria] = useTerminalArtifactState(`LimuriaBrainPanel.editCriteria.${selectedId}`, "");
  const [editInput, setEditInput] = useTerminalArtifactState(`LimuriaBrainPanel.editInput.${selectedId}`, "");
  const previousDraft = useTerminalArtifactContext()?.state;
  const earlierCriteria = typeof previousDraft?.["LimuriaBrainPanel.editCriteria"] === "string" ? previousDraft["LimuriaBrainPanel.editCriteria"] as string : "";
  const earlierInput = typeof previousDraft?.["LimuriaBrainPanel.editInput"] === "string" ? previousDraft["LimuriaBrainPanel.editInput"] as string : "";

  const { data: runs = [] } = useQuery<BrainRunSummary[]>({ queryKey: ["/api/brain/runs"] });
  useEffect(() => { if (!selectedId && runs[0]) setSelectedId(runs[0].id); }, [runs, selectedId]);
  const detailKey = selectedId ? `/api/brain/runs/${selectedId}` : null;
  const { data: run, isLoading } = useQuery<BrainRun>({ queryKey: [detailKey], enabled: Boolean(detailKey) });
  const { data: toolResponse } = useQuery<ToolResponse>({ queryKey: ["/api/brain/tools"] });
  const pendingApproval = run?.approvals.find((item) => item.status === "pending");
  const hasPendingTasks = run?.tasks.some((task) => task.status === "pending") ?? false;
  const taskById = useMemo(() => new Map(run?.tasks.map((item) => [item.id, item]) ?? []), [run]);

  const refresh = async (id?: number) => {
    await queryClient.invalidateQueries({ queryKey: ["/api/brain/runs"] });
    if (id ?? selectedId) await queryClient.invalidateQueries({ queryKey: [`/api/brain/runs/${id ?? selectedId}`] });
  };
  const createRun = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/brain/runs", { question, primaryEntity: primaryEntity || null })).json() as Promise<BrainRun>,
    onSuccess: async (created) => { setSelectedId(created.id); setMessage("Inspectable task graph created."); await refresh(created.id); },
    onError: (error: Error) => setMessage(error.message),
  });
  const action = useMutation({
    mutationFn: async ({ endpoint, body }: { endpoint: string; body?: unknown }) => (await apiRequest("POST", endpoint, body)).json() as Promise<BrainRun>,
    onSuccess: async (updated) => { setMessage(`Run ${statusLabel(updated.status)}.`); await refresh(updated.id); },
    onError: (error: Error) => setMessage(error.message),
  });
  const editTask = useMutation({
    mutationFn: async (task: BrainTask) => {
      if (!run || run.id !== selectedId || !run.tasks.some(current => current.id === task.id) || task.id !== editingTaskId) throw new Error("The selected task is no longer available in this authorized run.");
      let input: Record<string, unknown>;
      try { input = JSON.parse(editInput); } catch { throw new Error("Task input must be valid JSON."); }
      return (await apiRequest("PATCH", `/api/brain/runs/${run!.id}/tasks/${task.id}`, { completionCriteria: editCriteria, input })).json() as Promise<BrainRun>;
    },
    onSuccess: async (updated) => { setEditingTaskId(null); setMessage("Task edited; downstream execution reset for replay."); await refresh(updated.id); },
    onError: (error: Error) => setMessage(error.message),
  });
  const approve = (decision: "approved" | "rejected") => pendingApproval && action.mutate({ endpoint: `/api/brain/runs/${run!.id}/approvals/${pendingApproval.id}`, body: { decision, note: decision === "approved" ? "Evidence boundary reviewed in Limuria Brain." : "Evidence package rejected for revision." } });

  return <div className="h-full min-h-0 flex flex-col bg-[#050505]">
    <header className="shrink-0 px-4 py-3 border-b border-border bg-[#070707] flex flex-wrap items-center gap-3">
      <BrainCircuit className="w-4 h-4 text-amber-300" />
      <div><div className="font-terminal text-[10px] tracking-widest">LIMURIA BRAIN</div><div className="font-terminal text-[7px] text-muted-foreground mt-0.5">INSPECTABLE PLANS, GOVERNED TOOLS, HUMAN APPROVAL, REPLAYABLE SYNTHESIS</div></div>
      <div className="ml-auto flex items-center gap-2"><span className="px-2 py-1 border border-emerald-400/30 text-emerald-300 font-terminal text-[7px]">PROVIDER NEUTRAL</span><span className="px-2 py-1 border border-amber-400/30 text-amber-300 font-terminal text-[7px]">NO UNSUPPORTED NUMBERS</span></div>
    </header>

    <div className="shrink-0 border-b border-border p-3 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_150px_auto] gap-2">
      <textarea value={question} onChange={(event) => setQuestion(event.target.value)} disabled={!canAuthor} aria-label="Decision question" className="min-h-16 xl:min-h-10 resize-y bg-black border border-border px-3 py-2 font-mono text-[10px] outline-none focus:border-amber-400/50 disabled:opacity-50" />
      <input value={primaryEntity} onChange={(event) => setPrimaryEntity(event.target.value.toUpperCase())} disabled={!canAuthor} placeholder="PRIMARY ENTITY" className="h-10 bg-black border border-border px-3 font-terminal text-[8px] outline-none focus:border-amber-400/50 disabled:opacity-50" />
      <div className="flex gap-2">
        <button onClick={() => { setQuestion(`Should we invest in ${primaryEntity || "AAPL"} over the next 12 months?`); }} disabled={!canAuthor} className="h-10 px-3 border border-border font-terminal text-[8px] text-muted-foreground">INVESTMENT</button>
        <button onClick={() => { setPrimaryEntity(""); setQuestion("How would tighter monetary policy affect employment and growth over the next 2 years?"); }} disabled={!canAuthor} className="h-10 px-3 border border-border font-terminal text-[8px] text-muted-foreground">POLICY</button>
        <button onClick={() => createRun.mutate()} disabled={!canAuthor || createRun.isPending || question.trim().length < 10} className="h-10 px-4 bg-amber-400 text-black font-terminal text-[8px] font-bold disabled:opacity-40 flex items-center gap-2"><GitBranch className="w-3.5 h-3.5" /> PLAN</button>
      </div>
    </div>

    {message && <button onClick={() => setMessage("")} className="shrink-0 px-4 py-2 border-b border-border text-left font-terminal text-[8px] text-amber-300">{message}</button>}

    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-h-0 border-b lg:border-b-0 lg:border-r border-border flex flex-col max-h-48 lg:max-h-none">
        <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2"><span className="font-terminal text-[8px]">RUN HISTORY</span><button onClick={() => refresh()} title="Refresh runs" className="ml-auto text-muted-foreground"><RefreshCw className="w-3 h-3" /></button></div>
        <div className="overflow-y-auto flex-1">{runs.length === 0 ? <div className="p-4 font-terminal text-[8px] text-muted-foreground">No Brain runs yet.</div> : runs.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full text-left px-3 py-3 border-b border-border/70 ${selectedId === item.id ? "bg-amber-400/5" : "hover:bg-white/[0.03]"}`}><div className="flex gap-2 items-center"><span className="font-mono text-[8px] text-muted-foreground">#{item.id}</span><span className={`ml-auto border px-1.5 py-0.5 font-terminal text-[6px] ${STATUS_STYLE[item.status]}`}>{statusLabel(item.status)}</span></div><div className="font-terminal text-[8px] mt-2 line-clamp-2">{item.title}</div><div className="font-mono text-[7px] text-muted-foreground mt-1">{statusLabel(item.decisionType)} / {formatDate(item.updatedAt)}</div></button>)}</div>
      </aside>

      <section className="min-h-0 flex flex-col">
        {!run ? <div className="p-8"><BrainCircuit className="w-8 h-8 text-muted-foreground/30" /><div className="font-terminal text-[10px] mt-3">CREATE A ONE-CLICK INVESTIGATION</div><p className="text-[11px] text-muted-foreground mt-2 max-w-xl">A saved plan will expose every dependency, specialist grant, source, failure, approval, and replay reference.</p></div> : <>
          <div className="shrink-0 px-3 py-2 border-b border-border flex flex-wrap items-center gap-2">
            <span className={`border px-2 py-1 font-terminal text-[7px] ${STATUS_STYLE[run.status]}`}>{statusLabel(run.status)}</span>
            <span className="font-terminal text-[9px]">#{run.id} {run.title}</span>
            <span className="font-mono text-[7px] text-muted-foreground">{statusLabel(run.decisionType)} / {(run.intent.entities ?? []).join(", ") || "NO ENTITY"} / {run.intent.horizon ?? "NO HORIZON"}</span>
            {canAuthor && <div className="ml-auto flex gap-1">
              {run.status === "paused" ? <button onClick={() => action.mutate({ endpoint: `/api/brain/runs/${run.id}/resume` })} title="Resume run" className="w-8 h-8 border border-border flex items-center justify-center"><CirclePlay className="w-3.5 h-3.5" /></button> : (hasPendingTasks || run.status === "running") && !["completed", "rejected", "awaiting_approval"].includes(run.status) ? <button onClick={() => action.mutate({ endpoint: `/api/brain/runs/${run.id}/pause` })} title="Pause run" className="w-8 h-8 border border-border flex items-center justify-center"><CirclePause className="w-3.5 h-3.5" /></button> : null}
              {hasPendingTasks && !run.status.includes("approval") && !["completed", "rejected", "paused"].includes(run.status) && <button onClick={() => action.mutate({ endpoint: `/api/brain/runs/${run.id}/execute` })} disabled={action.isPending} title="Execute ready tasks" className="h-8 px-3 bg-amber-400 text-black font-terminal text-[8px] font-bold flex items-center gap-1.5 disabled:opacity-50"><Play className="w-3 h-3" /> EXECUTE</button>}
            </div>}
          </div>

          {pendingApproval && <div className="shrink-0 px-4 py-3 border-b border-violet-400/30 bg-violet-400/5 flex flex-wrap items-center gap-3"><ShieldCheck className="w-4 h-4 text-violet-300" /><div><div className="font-terminal text-[8px] text-violet-300">HUMAN MATERIALITY GATE</div><div className="font-mono text-[7px] text-muted-foreground mt-1">Snapshot {pendingApproval.snapshotHash.slice(0, 16)} / review sources, gaps, and deterministic references</div></div>{canAuthor && <div className="ml-auto flex gap-2"><button onClick={() => approve("rejected")} className="h-8 px-3 border border-red-400/40 text-red-300 font-terminal text-[8px] flex items-center gap-1"><X className="w-3 h-3" /> REJECT</button><button onClick={() => approve("approved")} className="h-8 px-3 border border-emerald-400/40 text-emerald-300 font-terminal text-[8px] flex items-center gap-1"><Check className="w-3 h-3" /> APPROVE</button></div>}</div>}

          <nav className="h-10 shrink-0 border-b border-border px-2 flex items-stretch overflow-x-auto">{VIEWS.map((item) => <button key={item} onClick={() => setView(item)} className={`px-3 border-b-2 font-terminal text-[8px] uppercase ${view === item ? "border-amber-400 text-amber-300" : "border-transparent text-muted-foreground"}`}>{item}</button>)}</nav>

          <main className="flex-1 min-h-0 overflow-y-auto">
            {isLoading && <div className="p-6 font-terminal text-[8px] text-muted-foreground">Loading execution record...</div>}
            {view === "graph" && <div>{run.tasks.map((task, index) => <article key={task.id} className="border-b border-border/70 px-4 py-3 grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 items-start">
              <div className={`w-7 h-7 border flex items-center justify-center font-mono text-[8px] ${STATUS_STYLE[task.status]}`}>{index + 1}</div>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-terminal text-[9px]">{task.label}</span><span className="font-terminal text-[7px] text-amber-300">{statusLabel(task.agentRole)}</span>{task.toolId && <span className="font-mono text-[7px] text-muted-foreground">{task.toolId}</span>}</div><div className="font-mono text-[7px] text-muted-foreground mt-1">DEPENDS: {task.dependencies.join(", ") || "ROOT"}</div><div className="text-[10px] text-muted-foreground mt-2">{task.completionCriteria}</div><div className="font-mono text-[8px] mt-2">{outputSummary(task)}</div><div className="font-mono text-[7px] text-muted-foreground mt-1">{task.provenance.length} source refs / {task.deterministicRefs.length} deterministic refs / {task.attemptCount} attempt(s)</div>
                {editingTaskId === task.id && <div className="mt-3 space-y-2"><input value={editCriteria} onChange={(event) => setEditCriteria(event.target.value)} className="w-full h-8 bg-black border border-border px-2 font-mono text-[8px]" /><textarea value={editInput} onChange={(event) => setEditInput(event.target.value)} className="w-full min-h-20 bg-black border border-border p-2 font-mono text-[8px]" /><button onClick={() => editTask.mutate(task)} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px]">SAVE TASK EDIT</button></div>}
                {editingTaskId === task.id && (earlierCriteria || earlierInput) && <details className="mt-2 text-xs"><summary>Earlier shared task draft · run/task assignment was not recorded</summary><pre className="whitespace-pre-wrap">{earlierCriteria}{"\n"}{earlierInput}</pre><button type="button" onClick={() => { setEditCriteria(earlierCriteria); setEditInput(earlierInput); }}>Use this reviewed draft for the selected task</button></details>}
              </div>
              <div className="flex gap-1"><span className={`border px-1.5 py-1 font-terminal text-[6px] ${STATUS_STYLE[task.status]}`}>{statusLabel(task.status)}</span>{canAuthor && ["pending", "incomplete", "failed", "blocked"].includes(task.status) && <button title="Edit task" onClick={() => { setEditingTaskId(task.id); setEditCriteria(task.completionCriteria); setEditInput(JSON.stringify(task.input, null, 2)); }} className="w-7 h-7 border border-border flex items-center justify-center"><Pencil className="w-3 h-3" /></button>}{canAuthor && ["incomplete", "failed", "blocked"].includes(task.status) && <button title="Retry task" onClick={() => action.mutate({ endpoint: `/api/brain/runs/${run.id}/tasks/${task.id}/retry` })} className="w-7 h-7 border border-border flex items-center justify-center"><ListRestart className="w-3 h-3" /></button>}</div>
            </article>)}</div>}

            {view === "ledger" && <div className="overflow-x-auto"><div className="min-w-[820px]"><div className="grid grid-cols-[60px_1.2fr_1fr_0.7fr_0.7fr_1.2fr] px-4 py-2 bg-black/40 border-b border-border font-terminal text-[7px] text-muted-foreground"><span>CALL</span><span>TOOL / AGENT</span><span>PROVIDER</span><span>STATUS</span><span>LATENCY</span><span>REFERENCES</span></div>{run.toolCalls.map((call) => <div key={call.id} className="grid grid-cols-[60px_1.2fr_1fr_0.7fr_0.7fr_1.2fr] px-4 py-3 border-b border-border/60 font-mono text-[8px]"><span>#{call.id}</span><span>{call.toolId}<br /><span className="text-muted-foreground">{statusLabel(call.agentRole)}</span></span><span>{call.provider ?? "Unavailable"}{call.modelId ? ` / ${call.modelId}` : ""}</span><span className={STATUS_STYLE[call.status].split(" ").at(-1)}>{statusLabel(call.status)}</span><span>{call.latencyMs == null ? "N/A" : `${call.latencyMs}ms`}</span><span>{call.provenance.length} source / {call.deterministicRefs.length} deterministic{call.error && <><br /><span className="text-red-300">{call.error}</span></>}</span></div>)}</div></div>}

            {view === "tools" && <div>{toolResponse?.tools.map((tool) => <article key={tool.id} className="px-4 py-4 border-b border-border/70 grid grid-cols-1 xl:grid-cols-[1fr_1.2fr_1fr] gap-3"><div><div className="font-mono text-[9px] text-amber-300">{tool.id}</div><div className="font-terminal text-[8px] mt-1">{tool.label}</div><div className="text-[10px] text-muted-foreground mt-2">{tool.description}</div></div><div><div className="font-terminal text-[7px] text-muted-foreground">GRANTS</div><div className="font-mono text-[8px] mt-1">Agents: {tool.allowedAgents.map(statusLabel).join(", ")}</div><div className="font-mono text-[8px] mt-1">Roles: {tool.allowedRoles.map(statusLabel).join(", ")}</div><div className="font-mono text-[8px] mt-1">{statusLabel(tool.dataClass)} / {tool.tenantScoped ? "TENANT SCOPED" : "PUBLIC"} / {tool.writeOperation ? "WRITE" : "READ"}</div></div><div><div className="font-terminal text-[7px] text-muted-foreground">CONTRACT</div><div className="text-[10px] mt-1">{tool.outputContract}</div><div className="font-terminal text-[7px] text-red-300 mt-2">SAFE FAILURE</div><div className="text-[10px] mt-1 text-muted-foreground">{tool.safeFailure}</div></div></article>)}</div>}

            {view === "synthesis" && <div className="p-5"><div className="font-terminal text-[8px] text-muted-foreground">APPROVED SOURCE-CONSTRAINED OUTPUT</div>{run.synthesis ? <pre className="mt-4 whitespace-pre-wrap font-mono text-[10px] leading-relaxed max-w-4xl">{run.synthesis}</pre> : <div className="mt-4 font-terminal text-[9px] text-muted-foreground">Synthesis remains unavailable until execution and human approval are complete.</div>}</div>}
          </main>
        </>}
      </section>
    </div>
  </div>;
}
