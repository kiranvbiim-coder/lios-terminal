import { useMemo, useState } from "react";
import {
  CheckCircle2,
  FileSearch,
  GitCompareArrows,
  History,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useInvalidateProjects, type ProjectSession } from "@/lib/useProjects";
import {
  explainProjectSessionChange,
  fetchProjectPortabilityManifest,
  fetchShowWork,
  undoProjectLedgerEvent,
  useProjectLedger,
  verifyProjectLedger,
  type ProjectLedgerEvent,
} from "@/lib/useProjectLedger";
import type {
  LedgerIntegrityReport,
  ProjectPortabilityManifestV1,
  ReproducibilityReceipt,
  SessionChangeExplanation,
} from "@shared/ledgerContracts";

function shortHash(value: string | null | undefined) {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";
}

function eventLabel(event: ProjectLedgerEvent): string {
  const labels: Record<string, string> = {
    "conversation.requested": "Conversation requested",
    "conversation.completed": "Conversation completed",
    "conversation.failed": "Conversation failed",
    "execution.planned": "Execution planned",
    "execution.receipt": "Execution receipt",
    "execution.approval": "Approval checkpoint",
    "decision.recorded": "Decision recorded",
    "state.changed": "State changed",
    "state.reverted": "State reverted",
    "session.created": "Session created",
    "session.updated": "Session updated",
    "session.forked": "Session forked",
    "session.archived": "Session archived",
    "session.restored": "Session restored",
    "source.observed": "Source observed",
    "model.executed": "Model executed",
    "artifact.draft.emitted": "Artifact draft emitted",
    "policy.changed": "Policy changed",
  };
  return labels[event.eventType] ?? event.eventType;
}

function relativeTime(value: string) {
  const ms = Math.max(0, Date.now() - new Date(value).getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function ShowWork({ receipt }: { receipt: ReproducibilityReceipt }) {
  return (
    <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.025] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-terminal text-[7px] uppercase tracking-wider text-amber-200">Show Work</span>
        <span className="font-terminal text-[6px] text-muted-foreground">
          {receipt.deterministic ? "DETERMINISTIC" : receipt.aiInvolvement === "direct" ? "AI-DIRECT" : receipt.aiInvolvement === "assisted" ? "AI-ASSISTED" : "OBSERVED"}
        </span>
        {receipt.asOf && <span className="font-terminal text-[6px] text-muted-foreground">AS OF {new Date(receipt.asOf).toLocaleString()}</span>}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="font-terminal text-[6px] uppercase text-muted-foreground">Engine / formula</div>
          <div className="mt-1 space-y-1">
            {receipt.engines.map((engine) => <div key={engine.id} className="font-ui text-[8px] text-foreground">{engine.id} <span className="text-muted-foreground">{engine.version ?? ""}</span></div>)}
            {receipt.formulas.map((formula) => <div key={formula.name} className="font-ui text-[8px] text-foreground">{formula.name}: <span className="text-muted-foreground">{formula.expression ?? "registered formula"}</span></div>)}
            {!receipt.formulas.length && <div className="font-ui text-[8px] text-muted-foreground">No formula layer for this operation.</div>}
          </div>
        </div>
        <div>
          <div className="font-terminal text-[6px] uppercase text-muted-foreground">Sources</div>
          <div className="mt-1 space-y-1">
            {receipt.sourceRefs.slice(0, 8).map((source) => <div key={source} className="truncate font-ui text-[8px] text-foreground">{source}</div>)}
            {!receipt.sourceRefs.length && <div className="font-ui text-[8px] text-muted-foreground">No external source references.</div>}
          </div>
        </div>
      </div>
      <details className="mt-3 rounded border border-border/40 bg-black/15 p-2">
        <summary className="cursor-pointer font-terminal text-[6px] uppercase text-muted-foreground">Inputs / outputs</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 p-2 font-terminal text-[6px] leading-3 text-muted-foreground">{JSON.stringify(receipt.inputSnapshot, null, 2)}</pre>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 p-2 font-terminal text-[6px] leading-3 text-muted-foreground">{JSON.stringify(receipt.outputSnapshot, null, 2)}</pre>
        </div>
      </details>
      <div className="mt-3 grid gap-1 font-terminal text-[6px] text-muted-foreground">
        <div>INPUT {shortHash(receipt.inputHash)}</div>
        <div>OUTPUT {shortHash(receipt.outputHash)}</div>
        <div>RECEIPT {shortHash(receipt.integrityHash)}</div>
      </div>
      {!!receipt.warnings.length && (
        <div className="mt-2 rounded border border-red-300/15 bg-red-300/[0.025] px-2 py-1.5 font-ui text-[8px] text-red-200">
          {receipt.warnings.join(" · ")}
        </div>
      )}
    </div>
  );
}

export function ProjectLedgerPanel({
  projectId,
  sessions,
}: {
  projectId: number;
  sessions: ProjectSession[];
}) {
  const ledger = useProjectLedger(projectId, 100);
  const invalidateProjects = useInvalidateProjects();
  const events = ledger.data ?? [];
  const [showWork, setShowWork] = useState<ReproducibilityReceipt | null>(null);
  const [integrity, setIntegrity] = useState<LedgerIntegrityReport | null>(null);
  const [manifest, setManifest] = useState<ProjectPortabilityManifestV1 | null>(null);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [comparison, setComparison] = useState<SessionChangeExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = useMemo(() => events.slice(0, 20), [events]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ledger action failed."); }
  };

  return (
    <section className="mt-4 rounded-xl border border-border/60 bg-white/[0.015] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-amber-300" />
            <div className="font-ui text-[10px] font-semibold">Project History & Ledger</div>
          </div>
          <div className="mt-1 font-ui text-[8px] text-muted-foreground">Reproducible execution, branch ancestry, changes and reversible actions.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void run(async () => setIntegrity(await verifyProjectLedger(projectId)))}
            className="rounded-md border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-muted-foreground hover:border-emerald-300/25 hover:text-foreground"
          >
            Verify integrity
          </button>
          <button
            onClick={() => void run(async () => setManifest(await fetchProjectPortabilityManifest(projectId)))}
            className="rounded-md border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-muted-foreground hover:border-cyan-300/25 hover:text-foreground"
          >
            Portability manifest
          </button>
        </div>
      </div>

      {integrity && (
        <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${integrity.valid ? "border-emerald-300/20 bg-emerald-300/[0.025]" : "border-red-300/20 bg-red-300/[0.025]"}`}>
          {integrity.valid ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <XCircle className="h-3.5 w-3.5 text-red-300" />}
          <span className="font-ui text-[8px] text-foreground">{integrity.valid ? "Hash chain verified" : integrity.reason || "Integrity check failed"}</span>
          <span className="ml-auto font-terminal text-[6px] text-muted-foreground">{integrity.checkedEvents} EVENTS · HEAD {shortHash(integrity.headHash)}</span>
        </div>
      )}

      {manifest && (
        <div className="mt-3 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.02] px-3 py-2">
          <div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-cyan-300" /><span className="font-ui text-[8px] text-foreground">Manifest v{manifest.version} · credentials excluded</span></div>
          <div className="mt-1 font-terminal text-[6px] text-muted-foreground">{manifest.sessions.length} SESSIONS · {manifest.ledger.eventCount} EVENTS · {shortHash(manifest.manifestHash)}</div>
        </div>
      )}

      {sessions.length >= 2 && (
        <div className="mt-4 rounded-lg border border-border/50 p-3">
          <div className="flex items-center gap-2"><GitCompareArrows className="h-3.5 w-3.5 text-fuchsia-300" /><span className="font-ui text-[9px] font-medium">Why did these Sessions change?</span></div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select value={leftId} onChange={(event) => setLeftId(event.target.value)} className="rounded border border-border/60 bg-[#090909] px-2 py-1.5 font-ui text-[8px] text-foreground">
              <option value="">Base Session</option>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
            </select>
            <select value={rightId} onChange={(event) => setRightId(event.target.value)} className="rounded border border-border/60 bg-[#090909] px-2 py-1.5 font-ui text-[8px] text-foreground">
              <option value="">Compare Session</option>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
            </select>
            <button
              disabled={!leftId || !rightId || leftId === rightId}
              onClick={() => void run(async () => setComparison(await explainProjectSessionChange(leftId, rightId)))}
              className="rounded border border-fuchsia-300/20 px-2.5 py-1.5 font-ui text-[7px] text-fuchsia-200 disabled:opacity-40"
            >
              Explain
            </button>
          </div>
          {comparison && (
            <div className="mt-3">
              <div className="font-terminal text-[6px] text-muted-foreground">COMMON ANCESTOR {comparison.commonAncestorId ?? "NONE"}</div>
              <div className="mt-2 space-y-1">
                {comparison.explanation.map((item) => <div key={item} className="font-ui text-[8px] leading-4 text-foreground">• {item}</div>)}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-1.5">
        {visible.map((event) => (
          <div key={event.id} className="rounded-lg border border-border/45 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-ui text-[8px] text-foreground">{eventLabel(event)}</span>
              <span className="font-terminal text-[6px] text-muted-foreground">#{event.sequence}</span>
              <span className="font-terminal text-[6px] text-muted-foreground">{relativeTime(event.createdAt)}</span>
              {event.receiptId && (
                <button
                  onClick={() => void run(async () => setShowWork((await fetchShowWork(event.receiptId!)).receipt))}
                  className="flex items-center gap-1 rounded border border-amber-300/15 px-2 py-1 font-ui text-[6px] text-amber-200"
                >
                  <FileSearch className="h-3 w-3" /> Show Work
                </button>
              )}
              {event.reversible && (
                <button
                  onClick={() => void run(async () => { await undoProjectLedgerEvent(event.id); setShowWork(null); invalidateProjects(projectId); await ledger.refetch(); })}
                  className="flex items-center gap-1 rounded border border-border/50 px-2 py-1 font-ui text-[6px] text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" /> Undo
                </button>
              )}
            </div>
            <div className="mt-1 font-terminal text-[6px] text-muted-foreground">HASH {shortHash(event.eventHash)} · {event.actorType.toUpperCase()}</div>
          </div>
        ))}
        {!visible.length && !ledger.isLoading && (
          <div className="rounded-lg border border-dashed border-border/50 px-3 py-5 font-ui text-[8px] text-muted-foreground">
            Ledger events will appear as this Project is used.
          </div>
        )}
      </div>

      {showWork && <ShowWork receipt={showWork} />}
      {error && <div className="mt-3 rounded border border-red-300/20 bg-red-300/[0.02] px-3 py-2 font-ui text-[8px] text-red-200">{error}</div>}
    </section>
  );
}
