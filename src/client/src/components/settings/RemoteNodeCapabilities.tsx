import { useEffect, useRef, useState } from "react";
import { useGateway, useGatewayState } from "@/lib/gateway/GatewayProvider";
import { REMOTE_DIAGNOSIS_CAPABILITY, REMOTE_FINANCE_CAPABILITY, type RemoteNodePlacementPolicy, type RemoteNodePlacementSelection, type RemoteOperationOutcome } from "@shared/remoteNode";
import { ReadableValueTable } from "@/components/terminal/ReadableValueTable";

type Target = RemoteNodePlacementSelection["target"];
type Destination = { id: number; label: string };
function destinations(records: Record<string, unknown>[]): Destination[] {
  return records.filter(row => typeof row.id === "number" && Number.isInteger(row.id) && row.id > 0 && row.archivedAt == null).map(row => ({ id: row.id as number, label: typeof row.name === "string" ? row.name : typeof row.title === "string" ? row.title : `#${row.id}` }));
}

/** A view of the existing paired Gateway's currently executable closed capabilities, never an execution registry. */
export function RemoteNodeCapabilities() {
  const gateway = useGateway();
  const state = useGatewayState();
  const [targets, setTargets] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RemoteOperationOutcome | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [projects, setProjects] = useState<Destination[]>([]);
  const [chats, setChats] = useState<Destination[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [report, setReport] = useState<{ requestId: string; chatId: number; status: string; receiptId?: string } | null>(null);
  const reportRequest = useRef<string | null>(null);
  useEffect(() => gateway?.onEvent("conversation.event", event => {
    if (event.requestId !== reportRequest.current) return;
    if (event.event.type === "receipt") {
      const receiptId = event.event.receipt.id;
      setReport(current => current && ({ ...current, receiptId }));
    }
    if (event.event.type === "error") { setError(event.event.message); setReport(current => current && ({ ...current, status: "failed" })); }
    if (event.event.type === "done") {
      const status = event.event.status === "completed" ? "finished" : event.event.status;
      setReport(current => current && ({ ...current, status }));
    }
  }), [gateway]);
  useEffect(() => {
    if (state !== "ready") {
      setTargets([]); setOutcome(null); setRefreshed(false); setProjects([]); setChats([]); setProjectId(null); setChatId(null);
      setReport(current => current?.status === "running" ? { ...current, status: "disconnected · inspect retained Chat before retrying" } : current);
    }
  }, [state]);
  const refresh = async () => {
    if (!gateway || state !== "ready" || busy) return;
    setBusy(true); setError(null); setOutcome(null);
    try {
      const [diagnosis, finance, listed] = await Promise.all([gateway.request("node.diagnosis.list", {}), gateway.request("node.finance.list", {}), gateway.request("projects.list", {})]);
      setTargets([...diagnosis.nodes, ...finance.nodes]); setProjects(destinations(listed.projects)); setChats([]); setProjectId(null); setChatId(null); setRefreshed(true);
    } catch (cause) { setTargets([]); setError(cause instanceof Error ? cause.message : "Executable node discovery failed."); }
    finally { setBusy(false); }
  };
  const run = async (target: Target) => {
    if (!gateway || state !== "ready" || busy) return;
    setBusy(true); setError(null); setOutcome(null);
    try {
      const requestId = crypto.randomUUID();
      const policy: RemoteNodePlacementPolicy = target.capability === REMOTE_FINANCE_CAPABILITY
        ? { capability: target.capability, source: target.source, approvedDeviceIds: [target.deviceId], hardware: null }
        : { capability: REMOTE_DIAGNOSIS_CAPABILITY, approvedDeviceIds: [target.deviceId], hardware: null };
      const selection = await gateway.request("node.operation.select", { requestId, policy });
      if (selection.target.generationId !== target.generationId) throw new Error("The selected node reconnected. Refresh and inspect its current capability before running.");
      const placement = { policy, selection };
      const result = selection.target.capability === REMOTE_FINANCE_CAPABILITY
        ? await gateway.request("node.finance.run", { ...selection.target, requestId, placement })
        : await gateway.request("node.diagnosis.run", { ...selection.target, requestId, placement });
      setOutcome(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Node operation failed. Inspect retained outcome before retrying."); }
    finally { setBusy(false); }
  };
  const chooseProject = async (id: number | null) => {
    setProjectId(id); setChatId(null); setChats([]);
    if (!id || !gateway || busy || state !== "ready") return;
    setBusy(true); setError(null);
    try { const data = await gateway.request("device.continuity.read", { projectId: id, limit: 1, artifactsLimit: 1 }); setChats(destinations(data.chats)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Current Project Chats could not be read."); }
    finally { setBusy(false); }
  };
  const runReport = async (target: Target) => {
    if (!gateway || busy || state !== "ready" || !projectId || !chatId || target.capability !== REMOTE_FINANCE_CAPABILITY || report?.status === "running") return;
    const requestId = crypto.randomUUID();
    reportRequest.current = requestId; setReport({ requestId, chatId, status: "running" }); setBusy(true); setError(null);
    try {
      await gateway.request("conversation.start", { chatId, body: { requestId, message: `Calculate my explicitly selected node-local personal-finance snapshot from ${target.source.sourceId}.`, executionMode: "deterministic_first", sourceScope: "my_data", context: { nodeFinancePolicy: { capability: target.capability, source: target.source, approvedDeviceIds: [target.deviceId], hardware: null } } } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inspect the retained request before retrying."); setReport(current => current && ({ ...current, status: "not confirmed · inspect retained Chat before retrying" })); }
    finally { setBusy(false); }
  };
  return <section aria-label="Executable paired-node capabilities" className="space-y-3 rounded border border-border/60 p-3">
    <h3 className="text-sm font-semibold">Executable paired-node capabilities</h3>
    <p className="text-xs text-muted-foreground">Signed advertisements alone do not make a device executable. An explicitly started, pinned worker must be live now. Only runtime diagnosis and its locally approved user-owned P6 profile snapshot are supported; no shell, broker action, model inference or Home fallback.</p>
    <button type="button" disabled={busy || state !== "ready"} onClick={() => void refresh()} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">{busy ? "Checking node operation…" : "Refresh executable nodes"}</button>
    {state !== "ready" && <p className="text-xs text-muted-foreground">Home Gateway is disconnected. No node operation is available or automatically queued.</p>}
    {refreshed && !targets.length && <p className="text-xs text-muted-foreground">No live worker currently offers these closed capabilities. Pairing or an installed executable is not readiness proof.</p>}
    {refreshed && targets.some(target => target.capability === REMOTE_FINANCE_CAPABILITY) && <fieldset className="space-y-2 text-xs" disabled={busy || state !== "ready" || report?.status === "running"}>
      <legend className="font-semibold">Retain a node-local report in an existing Project Chat</legend>
      <p className="text-muted-foreground">Explicit selected device and source only. Uses canonical P6, conversation receipts and saved reports; zero AI calls. No new Project or Chat is created.</p>
      <label className="block">Report Project <select aria-label="Node report Project" value={projectId ?? ""} onChange={event => void chooseProject(event.target.value ? Number(event.target.value) : null)} className="ml-2 rounded border border-border bg-background p-1"><option value="">Select existing Project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.label}</option>)}</select></label>
      <label className="block">Report Chat <select aria-label="Node report Chat" value={chatId ?? ""} onChange={event => setChatId(event.target.value ? Number(event.target.value) : null)} className="ml-2 rounded border border-border bg-background p-1"><option value="">Select existing Chat</option>{chats.map(chat => <option key={chat.id} value={chat.id}>{chat.label}</option>)}</select></label>
    </fieldset>}
    {targets.map(target => <div key={`${target.deviceId}:${target.generationId}:${target.capability}`} className="space-y-1 rounded border border-border/40 p-2 text-xs">
      <p className="break-all">{target.deviceId} · {target.capability}</p>
      <p className="break-all text-muted-foreground">Connection generation: {target.generationId}</p>
      {target.capability === REMOTE_FINANCE_CAPABILITY && <p className="break-all text-muted-foreground">Locally approved source {target.source.sourceId} · exact byte hash {target.source.inputHash}. Raw accounts and local paths are not returned.</p>}
      <button type="button" disabled={busy || state !== "ready"} onClick={() => void run(target)} className="rounded border border-border px-3 py-2 disabled:opacity-40">{target.capability === REMOTE_FINANCE_CAPABILITY ? "Compute node-local profile summary" : "Read node runtime diagnosis"}</button>
      {target.capability === REMOTE_FINANCE_CAPABILITY && <button type="button" disabled={busy || state !== "ready" || !projectId || !chatId || report?.status === "running"} onClick={() => void runReport(target)} className="ml-2 rounded border border-border px-3 py-2 disabled:opacity-40">Compute and save report in selected Chat</button>}
    </div>)}
    {error && <p role="alert" className="break-words text-xs text-red-200">{error}</p>}
    {report && <p role="status" className="break-all text-xs">Report {report.status} · Chat {report.chatId} · request {report.requestId}{report.receiptId ? ` · receipt ${report.receiptId}` : ""}. Disconnects never resubmit the operation; inspect this Chat for its retained report and outcome.</p>}
    {outcome && <div role="status" className="space-y-1 text-xs">
      <p>{outcome.status} · {outcome.outcome} · {outcome.reason}</p>
      <p className="text-muted-foreground">Home verifies the authenticated device and operation binding, not independent hardware/financial attestation. Request {outcome.binding.requestId} is retained in the canonical encrypted journal. Disconnect/unknown outcomes never automatically replay.</p>
      <ReadableValueTable values={outcome.report} className="max-h-80 overflow-auto" />
    </div>}
  </section>;
}
