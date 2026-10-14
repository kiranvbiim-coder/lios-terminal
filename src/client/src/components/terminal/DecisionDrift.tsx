import { useEffect, useMemo, useState } from "react";
import { GitCompareArrows, History, RefreshCw, ShieldAlert, Target, X } from "lucide-react";
import {
  buildDecisionDriftReport,
  captureDecisionCheckpoint,
  latestDecisionCheckpoint,
  loadDecisionCheckpoints,
  subscribeDecisionCheckpoints,
  type DecisionCheckpoint,
} from "@/lib/terminalDecisionCheckpoints";
import { loadDecisionObjects, subscribeDecisionObjects, type DecisionObject } from "@/lib/terminalDecisionObjects";
import { loadIntelligenceObjects, subscribeIntelligenceObjects, type IntelligenceObject } from "@/lib/terminalIntelligenceObjects";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";

interface Props { onClose: () => void }

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
  return String(value);
}

function delta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

export default function DecisionDrift({ onClose }: Props) {
  const [decisions, setDecisions] = useState<DecisionObject[]>(() => loadDecisionObjects());
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [checkpoints, setCheckpoints] = useState<DecisionCheckpoint[]>(() => loadDecisionCheckpoints());
  const [selectedId, setSelectedId] = useState<string | null>(() => loadDecisionObjects()[0]?.id ?? null);

  useEffect(() => subscribeDecisionObjects(setDecisions), []);
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);
  useEffect(() => subscribeDecisionCheckpoints(setCheckpoints), []);

  const selected = decisions.find((decision) => decision.id === selectedId) ?? decisions[0] ?? null;
  const selectedCheckpoint = useMemo(() => selected ? checkpoints.find((checkpoint) => checkpoint.decisionId === selected.id) ?? latestDecisionCheckpoint(selected.id) : null, [checkpoints, selected]);
  const report = useMemo(() => selected && selectedCheckpoint ? buildDecisionDriftReport(selected, selectedCheckpoint, objects) : null, [objects, selected, selectedCheckpoint]);

  const checkpointNow = () => {
    if (!selected) return;
    captureDecisionCheckpoint(selected);
    setCheckpoints(loadDecisionCheckpoints());
  };

  return (
    <div className="fixed inset-0 z-[96] bg-black/84 p-3 backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(860px,calc(100vh-24px))] w-full max-w-7xl flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Decision Drift">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/28%] bg-[hsl(38,100%,50%)/6%]"><History className="h-4 w-4 text-[hsl(38,100%,60%)]" /></div>
          <div className="min-w-0 flex-1"><div className="text-[11px] font-bold tracking-[.14em]">DECISION DRIFT</div><div className="mt-1 text-[8px] text-muted-foreground">WHAT WAS KNOWN THEN · WHAT CHANGED NOW · NO HINDSIGHT REWRITE</div></div>
          <button onClick={() => openTerminalUxSurface("decision-center")} className="lios-v5-hero-action"><Target className="h-3 w-3" /> DECISION CENTER</button>
          <button onClick={checkpointNow} disabled={!selected} className="lios-v5-hero-action disabled:opacity-40"><RefreshCw className="h-3 w-3" /> CHECKPOINT NOW</button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-border/60 bg-black/20 p-2 scrollbar-thin">
            {decisions.map((decision) => {
              const checkpoint = checkpoints.find((item) => item.decisionId === decision.id);
              return <button key={decision.id} onClick={() => setSelectedId(decision.id)} className={`mb-2 w-full border p-3 text-left ${selected?.id === decision.id ? "border-[hsl(38,100%,50%)/38%] bg-[hsl(38,100%,50%)/5%]" : "border-border/65 bg-white/[.012] hover:bg-white/[.025]"}`}>
                <div className="flex items-center justify-between"><span className="text-[7px] font-bold tracking-widest text-[hsl(38,100%,58%)]">{decision.status.toUpperCase()}</span><span className={`text-[6.5px] ${checkpoint ? "text-cyan-300" : "text-muted-foreground"}`}>{checkpoint ? "CHECKPOINTED" : "NO CHECKPOINT"}</span></div>
                <div className="mt-2 truncate text-[9px] font-bold">{decision.title}</div>
                <div className="mt-1 text-[7px] text-muted-foreground">{decision.direction.toUpperCase()} · {decision.confidence}% CONF</div>
              </button>;
            })}
            {!decisions.length && <div className="p-5 text-center text-[8px] text-muted-foreground">No decision objects available.</div>}
          </aside>

          <main className="min-h-0 overflow-y-auto p-4 scrollbar-thin">
            {!selected ? <div className="grid h-full place-items-center text-[9px] text-muted-foreground">SELECT A DECISION</div> : !selectedCheckpoint || !report ? (
              <div className="grid min-h-80 place-items-center border border-dashed border-border/70 text-center"><div><History className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-[9px] font-bold">NO DECISION CHECKPOINT</div><div className="mt-1 max-w-md text-[7px] leading-relaxed text-muted-foreground">Active decisions are checkpointed automatically. You can also capture the current state manually without changing the decision.</div><button onClick={checkpointNow} className="mt-3 border border-[hsl(38,100%,50%)/30%] px-3 py-2 text-[8px] font-bold text-[hsl(38,100%,60%)]">CREATE CHECKPOINT</button></div></div>
            ) : <div className="space-y-4">
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <div className="border border-border/65 bg-white/[.012] p-3 xl:col-span-2"><div className="text-[7px] tracking-widest text-muted-foreground">DECISION</div><div className="mt-2 text-[10px] font-bold">{selected.title}</div><div className="mt-1 text-[7px] text-muted-foreground">CHECKPOINT {new Date(selectedCheckpoint.capturedAt).toLocaleString()}</div></div>
                <div className="border border-border/65 bg-white/[.012] p-3"><div className="text-[7px] tracking-widest text-muted-foreground">CONFIDENCE Δ</div><div className={`mt-2 text-xl font-bold tabular-nums ${report.confidenceDelta < 0 ? "text-red-300" : report.confidenceDelta > 0 ? "text-emerald-300" : "text-foreground"}`}>{delta(report.confidenceDelta)}pp</div></div>
                <div className="border border-border/65 bg-white/[.012] p-3"><div className="text-[7px] tracking-widest text-muted-foreground">SUPPORT Δ</div><div className="mt-2 text-xl font-bold tabular-nums text-emerald-300">{delta(report.evidenceSupportDelta)}</div></div>
                <div className="border border-border/65 bg-white/[.012] p-3"><div className="text-[7px] tracking-widest text-muted-foreground">CONTRADICTION Δ</div><div className="mt-2 text-xl font-bold tabular-nums text-red-300">{delta(report.evidenceContradictionDelta)}</div></div>
                <div className="border border-border/65 bg-white/[.012] p-3"><div className="text-[7px] tracking-widest text-muted-foreground">OBJECT DRIFT</div><div className="mt-2 text-xl font-bold tabular-nums text-cyan-300">{report.changedObjectCount}</div><div className="mt-1 text-[6.5px] text-muted-foreground">{report.materialObjectCount} ≥5%</div></div>
              </section>

              <section className="grid gap-3 md:grid-cols-3">
                <div className={`border p-3 ${report.thesisChanged ? "border-orange-500/30 bg-orange-500/[.03]" : "border-border/60"}`}><div className="text-[7px] font-bold tracking-widest">THESIS</div><div className={`mt-2 text-[8px] ${report.thesisChanged ? "text-orange-300" : "text-muted-foreground"}`}>{report.thesisChanged ? "CHANGED SINCE CHECKPOINT" : "UNCHANGED"}</div></div>
                <div className={`border p-3 ${report.directionChanged ? "border-red-500/30 bg-red-500/[.03]" : "border-border/60"}`}><div className="text-[7px] font-bold tracking-widest">DIRECTION</div><div className={`mt-2 text-[8px] ${report.directionChanged ? "text-red-300" : "text-muted-foreground"}`}>{selectedCheckpoint.direction.toUpperCase()} → {selected.direction.toUpperCase()}</div></div>
                <div className={`border p-3 ${report.scenarioChanged ? "border-cyan-500/30 bg-cyan-500/[.03]" : "border-border/60"}`}><div className="text-[7px] font-bold tracking-widest">SCENARIO</div><div className={`mt-2 text-[8px] ${report.scenarioChanged ? "text-cyan-300" : "text-muted-foreground"}`}>{report.scenarioChanged ? "DECISION SCENARIO REFERENCE CHANGED" : selectedCheckpoint.scenarioName ?? selectedCheckpoint.scenarioId ?? "NO SCENARIO"}</div></div>
              </section>

              <section className="border border-border/70"><div className="flex items-center justify-between border-b border-border/60 bg-[#080808] px-3 py-2"><div className="flex items-center gap-2"><GitCompareArrows className="h-3 w-3 text-cyan-300" /><span className="text-[8px] font-bold tracking-widest">LINKED OBJECT DRIFT</span></div><span className="text-[7px] text-muted-foreground">VALUES ARE OBSERVED CHANGES, NOT CAUSAL EXPLANATIONS</span></div>
                {report.objectDrift.length ? <div className="overflow-x-auto"><table className="lios-signature-table min-w-full border-collapse text-[8px]"><thead><tr><th className="p-2 text-left">OBJECT</th><th className="p-2 text-left">STATUS</th><th className="p-2 text-right">THEN</th><th className="p-2 text-right">NOW</th><th className="p-2 text-right">Δ%</th></tr></thead><tbody>{report.objectDrift.map((item) => <tr key={item.objectId} className={item.changed ? "bg-white/[.012]" : ""}><td className="p-2"><div className="font-bold">{item.label}</div>{item.missing && <div className="mt-0.5 text-[6.5px] text-red-300">OBJECT MISSING</div>}</td><td className="p-2 text-muted-foreground">{item.statusBefore.toUpperCase()} → {(item.statusAfter ?? "missing").toUpperCase()}</td><td className="p-2 text-right tabular-nums">{formatValue(item.before)}</td><td className="p-2 text-right tabular-nums text-cyan-300">{formatValue(item.after)}</td><td className={`p-2 text-right tabular-nums ${typeof item.percentDelta === "number" && Math.abs(item.percentDelta) >= 20 ? "text-red-300" : "text-muted-foreground"}`}>{typeof item.percentDelta === "number" ? `${item.percentDelta >= 0 ? "+" : ""}${item.percentDelta.toFixed(1)}%` : item.changed ? "CHANGED" : "—"}</td></tr>)}</tbody></table></div> : <div className="p-5 text-center text-[7px] text-muted-foreground">No linked object values were frozen in this checkpoint.</div>}
              </section>

              <section className="border border-cyan-400/15 bg-cyan-400/[.018] p-3"><div className="flex items-center gap-2 text-[8px] font-bold text-cyan-300"><ShieldAlert className="h-3 w-3" /> REPLAY RULE</div><p className="mt-2 text-[7px] leading-relaxed text-muted-foreground">Checkpoint state is immutable historical context. Current values are compared against it; LiOS does not retroactively replace what was known at the time of the decision.</p></section>
            </div>}
          </main>
        </div>
      </section>
    </div>
  );
}
