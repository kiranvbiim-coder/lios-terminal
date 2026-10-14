import { useEffect, useMemo, useState } from "react";
import { Loader2, Square, SquareTerminal, X } from "lucide-react";
import { useGateway } from "@/lib/gateway/GatewayProvider";
import { GatewayRequestError } from "@/lib/gateway/gatewayErrors";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import type { z } from "zod";
import { GATEWAY_METHODS } from "@shared/gatewayProtocol";

type TerminalInput = z.output<(typeof GATEWAY_METHODS)["execution.session.input"]["params"]>["input"];

export interface ExecutionSessionPanelProps {
  sessionId: string;
  projectId: number | null;
  chatId: number | null;
  interactiveInputs: TerminalInput[];
  onClose: () => void;
}

type PersistedSession = {
  sessionId: string;
  status: "running" | "waiting_approval" | "completed" | "cancelled" | "failed" | "interrupted" | "denied";
  label: string;
  startedAt: string;
  endedAt: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  trust: {
    operationDigest: string | null;
    approvalDigest: string | null;
    permissionClass: "user_confirm" | "admin_confirm";
    policyRevision: string;
    decision: "approved" | "denied";
    denialReason: string | null;
    backendId: string | null;
    backendGenerationId: string | null;
    runtimeReceiptId: string | null;
    interactiveInputDigests?: string[];
  } | null;
};


function eventLine(event: ConversationRuntimeEvent): string | null {
  if (event.type === "text") return event.text;
  if (event.type === "status") return `[${event.state}] ${event.message}`;
  if (event.type === "tool_start") return `[tool] ${event.label}`;
  if (event.type === "tool_result") return `[tool] ${event.summary}`;
  if (event.type === "error") return `[error] ${event.message}`;
  if (event.type === "data_gap") return `[data gap] ${event.gap.message}`;
  if (event.type === "done") return `[done] ${event.status}`;
  return null;
}

export default function ExecutionSessionPanel({
  sessionId,
  projectId,
  chatId,
  interactiveInputs,
  onClose,
}: ExecutionSessionPanelProps) {
  const gateway = useGateway();
  const [entries, setEntries] = useState<Array<{ seq: number; event: ConversationRuntimeEvent }>>([]);
  const [persisted, setPersisted] = useState<PersistedSession | null>(null);
  const [status, setStatus] = useState<"connecting" | "running" | "finished" | "history" | "unavailable">("connecting");
  const isGovernedSandbox = interactiveInputs.length > 0;
  const [error, setError] = useState<string | null>(null);
  const [inputReady, setInputReady] = useState(false);
  const [pendingInput, setPendingInput] = useState<TerminalInput | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    setEntries([]);
    setPersisted(null);
    setStatus("connecting");
    setError(null);
    setInputReady(false);
    setPendingInput(null);
    setInputError(null);
    if (!gateway) {
      setStatus("unavailable");
      setError("LiOS Home is not connected.");
      return;
    }
    let disposed = false;
    let lastSeq = -1;

    const readPersisted = async () => {
      setInputReady(false);
      try {
        const record = await gateway.request("execution.session.read", {
          sessionId,
          projectId,
          chatId,
        }, { queueUntilReady: true, timeoutMs: 15_000 });
        if (disposed) return;
        setPersisted(record);
        setStatus("history");
        setError(null);
      } catch (readError) {
        if (disposed) return;
        setStatus("unavailable");
        setError(readError instanceof GatewayRequestError && readError.code === "NOT_FOUND"
          ? "This execution session is no longer available in this Project/Chat."
          : "LiOS could not load this execution session.");
      }
    };

    const attach = async () => {
      try {
        const result = await gateway.request("execution.session.attach", {
          sessionId,
          projectId,
          chatId,
          afterSeq: lastSeq,
        }, { queueUntilReady: true, timeoutMs: 15_000 });
        if (disposed) return;
        setStatus(result.status);
        setPersisted(null);
        setError(null);
        if (result.status === "finished" && isGovernedSandbox) await readPersisted();
      } catch (attachError) {
        if (attachError instanceof GatewayRequestError && attachError.code === "NOT_FOUND") {
          await readPersisted();
          return;
        }
        if (disposed) return;
        setStatus("unavailable");
        setError("LiOS could not attach the execution session.");
      }
    };

    const stopEvent = gateway.onEvent("execution.session.event", (payload) => {
      if (
        payload.sessionId !== sessionId ||
        payload.projectId !== projectId ||
        payload.chatId !== chatId ||
        payload.runSeq <= lastSeq
      ) return;
      lastSeq = payload.runSeq;
      setEntries((current) => {
        const retained = payload.event.type === "text"
          ? current.filter((entry) => entry.event.type !== "text")
          : current;
        return [...retained, { seq: payload.runSeq, event: payload.event }].slice(-2_000);
      });
      if (payload.event.type === "status") {
        setInputReady(payload.event.state === "running" && payload.event.message === "Restricted terminal input ready.");
      }
      if (payload.event.type === "done") {
        setStatus("finished");
        setInputReady(false);
        if (isGovernedSandbox) void readPersisted();
      }
    });
    const stopReady = gateway.onReady(({ restarted }) => {
      if (disposed) return;
      if (restarted) {
        setInputReady(false);
        void readPersisted();
      } else void attach();
    });

    if (gateway.state === "ready") void attach();
    return () => {
      disposed = true;
      stopEvent();
      stopReady();
      if (gateway.state === "ready") {
        void gateway.request("execution.session.detach", {
          sessionId,
          projectId,
          chatId,
        }, { timeoutMs: 5_000 }).catch(() => undefined);
      }
    };
  }, [gateway, sessionId, projectId, chatId, isGovernedSandbox]);

  const transcript = useMemo(() => {
    if (persisted) {
      return [persisted.stdout, persisted.stderr ? `[stderr]\n${persisted.stderr}` : ""]
        .filter(Boolean)
        .join("\n");
    }
    return entries
      .map(({ event }) => eventLine(event))
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }, [entries, persisted]);

  const cancel = async () => {
    if (!gateway || status !== "running") return;
    try {
      await gateway.request("execution.session.cancel", {
        sessionId,
        projectId,
        chatId,
      }, { timeoutMs: 15_000 });
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Unable to cancel this execution.");
    }
  };
  const sendInput = async (input: TerminalInput) => {
    if (!gateway || status !== "running" || !inputReady || !interactiveInputs.includes(input) || pendingInput) return;
    setPendingInput(input);
    setInputError(null);
    try {
      await gateway.request("execution.session.input", {
        sessionId,
        projectId,
        chatId,
        input,
      }, { timeoutMs: 15_000 });
    } catch {
      setInputError("LiOS rejected the input or the session is no longer active.");
    } finally {
      setPendingInput(null);
    }
  };

  const statusLabel = persisted?.status ?? status;
  return (
    <aside
      className="mx-auto mb-3 max-w-4xl overflow-hidden rounded-xl border border-border/70 bg-[#050505]"
      data-testid="execution-session-panel"
      data-session-id={sessionId}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <SquareTerminal className="h-3.5 w-3.5 text-cyan-300" />
        <span className="font-ui text-[13px] font-medium text-foreground">Execution Terminal</span>
        <code className="hidden font-terminal text-[10px] text-muted-foreground md:inline">{sessionId.slice(0, 8)}</code>
        <span className="ml-auto font-terminal text-[10px] uppercase tracking-wider text-muted-foreground">
          {statusLabel}
        </span>
        {status === "connecting" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {status === "running" && (
          <button
            type="button"
            onClick={() => void cancel()}
            className="flex items-center gap-1 rounded px-2 py-1 font-ui text-[11px] text-muted-foreground hover:bg-white/[0.04] hover:text-red-200"
          >
            <Square className="h-2.5 w-2.5 fill-current" /> Stop
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close execution terminal" className="rounded p-1 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-64 overflow-auto px-3 py-3">
        {error ? (
          <div className="font-ui text-[12px] text-red-200">{error}</div>
        ) : transcript ? (
          <pre className="whitespace-pre-wrap break-words font-terminal text-[12px] leading-5 text-foreground/85">{transcript}</pre>
        ) : (
          <div className="font-ui text-[12px] text-muted-foreground">No output yet.</div>
        )}
      </div>
      {interactiveInputs.length > 0 && !persisted && (
        <div className="border-t border-border/50 px-3 py-3" data-testid="execution-terminal-controls">
          <div className="mb-2 font-ui text-[11px] text-muted-foreground">
            {inputReady ? "Reviewed read-only commands" : "Waiting for the approved terminal input channel…"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {interactiveInputs.map((input) => (
              <button
                key={input}
                type="button"
                disabled={!inputReady || status !== "running" || pendingInput !== null}
                onClick={() => void sendInput(input)}
                className="rounded border border-cyan-300/20 px-2.5 py-1.5 font-terminal text-[11px] text-cyan-100 hover:bg-cyan-300/[0.06] disabled:opacity-40"
                data-testid={`execution-terminal-input-${input.replaceAll(/[^a-z0-9]+/giu, "-")}`}
              >
                {pendingInput === input ? "Sending…" : input}
              </button>
            ))}
          </div>
          {inputError && <div role="alert" className="mt-2 font-ui text-[11px] text-red-200">{inputError}</div>}
        </div>
      )}
      {persisted?.trust && (
        <div className="border-t border-border/50 px-3 py-2 font-terminal text-[11px] text-muted-foreground" data-testid="execution-trust-receipt">
          <div>Trust receipt: {persisted.trust.decision}{persisted.trust.denialReason ? ` (${persisted.trust.denialReason})` : ""}</div>
          <div>Operation SHA-256: {persisted.trust.operationDigest ?? "not bound before denial"}</div>
          <div>Approval SHA-256: {persisted.trust.approvalDigest ?? "not bound before denial"}</div>
          <div>Policy SHA-256: {persisted.trust.policyRevision} · {persisted.trust.permissionClass}</div>
          <div>Backend: {persisted.trust.backendId ?? "not launched"}{persisted.trust.backendGenerationId ? ` · generation ${persisted.trust.backendGenerationId}` : ""}</div>
          {persisted.trust.runtimeReceiptId && <div>Result receipt: {persisted.trust.runtimeReceiptId}</div>}
          <div>Interactive input digests: {persisted.trust.interactiveInputDigests?.length ?? 0} (raw inputs are not stored)</div>
          {persisted.trust.interactiveInputDigests?.length ? (
            <details className="mt-1">
              <summary className="cursor-pointer">View approved input hashes</summary>
              <ul className="mt-1 space-y-1">
                {persisted.trust.interactiveInputDigests.map((digest, index) => <li key={`${digest}-${index}`} className="break-all">{digest}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      )}
      <div className="border-t border-border/50 px-3 py-2 font-ui text-[11px] text-muted-foreground">
        Chat and Terminal share this exact approved execution session. Terminal controls are limited to the reviewed read-only command set; Stop terminates the governed process.
      </div>
    </aside>
  );
}
