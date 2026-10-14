import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2, Plus, ShieldAlert, Target, Trash2, X } from "lucide-react";
import {
  activateDecision,
  addDecisionEvidence,
  addReversalCondition,
  createDecisionObject,
  decisionEvidenceBalance,
  loadDecisionObjects,
  patchDecisionObject,
  removeDecisionEvidence,
  removeReversalCondition,
  saveDecisionObjects,
  subscribeDecisionObjects,
  upsertDecisionObject,
  type DecisionDirection,
  type DecisionEvidenceLink,
  type DecisionObject,
} from "@/lib/terminalDecisionObjects";
import { decisionMonitorSummary } from "@/lib/terminalDecisionMonitor";
import { loadIntelligenceObjects, subscribeIntelligenceObjects, type IntelligenceObject } from "@/lib/terminalIntelligenceObjects";
import { getActiveScenario } from "@/lib/terminalScenarioUniverse";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  activeView: ViewMode;
  activeSymbol?: string;
  onClose: () => void;
}

const DIRECTIONS: DecisionDirection[] = ["buy", "sell", "hold", "avoid", "allocate", "deallocate", "approve", "reject", "monitor", "custom"];

export default function DecisionCenter({ activeView, activeSymbol, onClose }: Props) {
  const [decisions, setDecisions] = useState<DecisionObject[]>(() => loadDecisionObjects());
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [selectedId, setSelectedId] = useState<string | null>(() => loadDecisionObjects()[0]?.id ?? null);
  const [reversalObjectId, setReversalObjectId] = useState("");
  const [reversalComparator, setReversalComparator] = useState<"gt" | "gte" | "lt" | "lte" | "eq" | "changed">("changed");
  const [reversalThreshold, setReversalThreshold] = useState("");

  useEffect(() => subscribeDecisionObjects(setDecisions), []);
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);

  const selected = decisions.find((decision) => decision.id === selectedId) ?? decisions[0] ?? null;
  const relevantObjects = useMemo(() => objects.filter((object) => !activeSymbol || !object.symbol || object.symbol === activeSymbol).slice(0, 120), [activeSymbol, objects]);
  const monitor = selected ? decisionMonitorSummary(selected, objects) : null;
  const balance = selected ? decisionEvidenceBalance(selected) : null;

  const persist = (decision: DecisionObject) => {
    const next = upsertDecisionObject(decisions, decision);
    setDecisions(next);
    setSelectedId(decision.id);
    saveDecisionObjects(next);
  };

  const create = () => {
    const scenario = getActiveScenario();
    const decision = createDecisionObject({
      title: `${activeSymbol ? `${activeSymbol} · ` : ""}Decision`,
      symbol: activeSymbol,
      direction: "monitor",
      status: "draft",
      thesis: `Decision thesis from ${activeView}`,
      confidence: 50,
      scenarioId: scenario?.id,
    });
    persist(decision);
  };

  const attach = (object: IntelligenceObject, role: DecisionEvidenceLink["role"]) => {
    if (!selected) return;
    persist(addDecisionEvidence(selected, { objectId: object.id, role, weight: 1 }));
  };

  const addReversal = () => {
    if (!selected || !reversalObjectId) return;
    const linked = objects.find((object) => object.id === reversalObjectId);
    const numericThreshold = Number(reversalThreshold);
    const threshold = reversalComparator === "changed"
      ? linked?.value?.raw as string | number | undefined
      : Number.isFinite(numericThreshold) ? numericThreshold : reversalThreshold;
    persist(addReversalCondition(selected, {
      label: linked ? `${linked.label} reversal` : "Reversal condition",
      description: linked ? `Monitor ${linked.label} for thesis reversal.` : "Monitor linked object for thesis reversal.",
      objectId: reversalObjectId,
      comparator: reversalComparator,
      threshold,
    }));
    setReversalThreshold("");
  };

  return (
    <div className="fixed inset-0 z-[89] bg-black/76 p-3 backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(820px,calc(100vh-24px))] w-full max-w-7xl flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Decision Center">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/30%] bg-[hsl(38,100%,50%)/7%]"><Target className="h-4 w-4 text-[hsl(38,100%,58%)]" /></div>
          <div className="min-w-0 flex-1"><div className="text-[11px] font-bold tracking-[.13em]">DECISION CENTER</div><div className="mt-1 text-[8px] text-muted-foreground">THESIS · EVIDENCE · CONTRADICTION · REVERSAL CONDITIONS · MONITORING</div></div>
          <button onClick={create} className="flex items-center gap-1.5 border border-[hsl(38,100%,50%)/30%] bg-[hsl(38,100%,50%)/6%] px-3 py-2 text-[8px] font-bold text-[hsl(38,100%,60%)]"><Plus className="h-3 w-3" /> NEW DECISION</button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-r border-border/60 bg-black/20 p-2 scrollbar-thin">
            {decisions.map((decision) => {
              const summary = decisionMonitorSummary(decision, objects);
              return <button key={decision.id} onClick={() => setSelectedId(decision.id)} className={`mb-2 w-full border p-3 text-left ${selected?.id === decision.id ? "border-[hsl(38,100%,50%)/38%] bg-[hsl(38,100%,50%)/5%]" : "border-border/65 bg-white/[.012] hover:bg-white/[.025]"}`}>
                <div className="flex items-center justify-between"><span className="text-[7px] font-bold tracking-widest text-[hsl(38,100%,58%)]">{decision.status.toUpperCase()}</span>{summary.triggered > 0 && <ShieldAlert className="h-3.5 w-3.5 text-red-400" />}</div>
                <div className="mt-2 truncate text-[9px] font-bold text-foreground">{decision.title}</div>
                <div className="mt-1 text-[7px] text-muted-foreground">{decision.direction.toUpperCase()} · {decision.confidence}% CONF · {decision.evidence.length} EVIDENCE</div>
              </button>;
            })}
            {!decisions.length && <div className="p-5 text-center text-[8px] text-muted-foreground">No decisions yet. Convert analysis into an explicit, monitored decision object.</div>}
          </aside>

          <main className="min-h-0 overflow-y-auto p-4 scrollbar-thin">
            {!selected ? <div className="grid h-full place-items-center text-[9px] text-muted-foreground">CREATE A DECISION TO BEGIN</div> : <div className="space-y-4">
              <section className="grid gap-3 border border-border/70 bg-black/15 p-3 lg:grid-cols-[1fr_160px_130px]">
                <div><label className="text-[7px] font-bold tracking-widest text-muted-foreground">TITLE</label><input value={selected.title} onChange={(event) => persist(patchDecisionObject(selected, { title: event.target.value }))} className="mt-1 w-full border border-border bg-black/30 px-2 py-2 text-[9px] outline-none focus:border-[hsl(38,100%,50%)/40%]" /></div>
                <div><label className="text-[7px] font-bold tracking-widest text-muted-foreground">DIRECTION</label><select value={selected.direction} onChange={(event) => persist(patchDecisionObject(selected, { direction: event.target.value as DecisionDirection }))} className="mt-1 w-full border border-border bg-black px-2 py-2 text-[9px]">{DIRECTIONS.map((direction) => <option key={direction} value={direction}>{direction.toUpperCase()}</option>)}</select></div>
                <div><label className="text-[7px] font-bold tracking-widest text-muted-foreground">CONFIDENCE</label><input type="number" min={0} max={100} value={selected.confidence} onChange={(event) => persist(patchDecisionObject(selected, { confidence: Number(event.target.value) }))} className="mt-1 w-full border border-border bg-black/30 px-2 py-2 text-[9px]" /></div>
                <div className="lg:col-span-3"><label className="text-[7px] font-bold tracking-widest text-muted-foreground">THESIS</label><textarea value={selected.thesis} onChange={(event) => persist(patchDecisionObject(selected, { thesis: event.target.value }))} rows={3} className="mt-1 w-full resize-y border border-border bg-black/30 px-2 py-2 text-[9px] leading-relaxed" /></div>
                <div className="lg:col-span-3 flex flex-wrap items-center gap-2">
                  {selected.status !== "active" && <button onClick={() => persist(activateDecision(selected))} className="flex items-center gap-1.5 border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-[8px] text-emerald-300"><CheckCircle2 className="h-3 w-3" /> ACTIVATE DECISION</button>}
                  <span className="text-[8px] text-muted-foreground">EVIDENCE BALANCE {balance?.net ?? 0} · REVERSALS {monitor?.triggered ?? 0}/{monitor?.configured ?? 0}</span>
                </div>
              </section>

              <section className="border border-border/70 bg-black/12 p-3">
                <div className="flex items-center justify-between"><div><div className="text-[9px] font-bold">EVIDENCE MAP</div><div className="mt-1 text-[7px] text-muted-foreground">Attach support, contradiction or context explicitly. Contradictory evidence is never hidden.</div></div><Link2 className="h-4 w-4 text-cyan-300/80" /></div>
                <div className="mt-3 grid gap-2 lg:grid-cols-2">{relevantObjects.slice(0, 40).map((object) => {
                  const links = selected.evidence.filter((item) => item.objectId === object.id);
                  return <article key={object.id} className="border border-border/60 bg-white/[.01] p-2.5">
                    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-[8px] font-bold text-foreground">{object.label}</div><div className="mt-1 text-[6.5px] text-muted-foreground">{object.kind.toUpperCase()} {object.symbol ? `· ${object.symbol}` : ""}</div></div>{object.value && <span className="shrink-0 text-[8px] text-[hsl(38,100%,60%)]">{object.value.display ?? String(object.value.raw ?? "—")}</span>}</div>
                    <div className="mt-2 flex flex-wrap gap-1">{(["support", "contradiction", "context"] as const).map((role) => {
                      const active = links.some((item) => item.role === role);
                      return <button key={role} onClick={() => active ? persist(removeDecisionEvidence(selected, object.id, role)) : attach(object, role)} className={`border px-1.5 py-1 text-[6.5px] font-bold ${active ? role === "contradiction" ? "border-red-500/35 bg-red-500/7 text-red-300" : role === "support" ? "border-emerald-500/30 bg-emerald-500/6 text-emerald-300" : "border-cyan-500/30 bg-cyan-500/6 text-cyan-300" : "border-border text-muted-foreground"}`}>{role.toUpperCase()}</button>;
                    })}</div>
                  </article>;
                })}</div>
              </section>

              <section className="border border-border/70 bg-black/12 p-3">
                <div className="text-[9px] font-bold">REVERSAL CONDITIONS</div><div className="mt-1 text-[7px] text-muted-foreground">Define exactly what would make the decision wrong or require review.</div>
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_110px_140px_auto]">
                  <select value={reversalObjectId} onChange={(event) => setReversalObjectId(event.target.value)} className="border border-border bg-black px-2 py-2 text-[8px]"><option value="">SELECT INTELLIGENCE OBJECT</option>{relevantObjects.filter((object) => object.value).map((object) => <option key={object.id} value={object.id}>{object.label}{object.symbol ? ` · ${object.symbol}` : ""}</option>)}</select>
                  <select value={reversalComparator} onChange={(event) => setReversalComparator(event.target.value as typeof reversalComparator)} className="border border-border bg-black px-2 py-2 text-[8px]"><option value="changed">CHANGED</option><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="eq">=</option></select>
                  <input disabled={reversalComparator === "changed"} value={reversalThreshold} onChange={(event) => setReversalThreshold(event.target.value)} placeholder={reversalComparator === "changed" ? "BASELINE=AUTO" : "THRESHOLD"} className="border border-border bg-black/30 px-2 py-2 text-[8px] disabled:opacity-50" />
                  <button onClick={addReversal} disabled={!reversalObjectId} className="border border-[hsl(38,100%,50%)/30%] px-2 py-2 text-[8px] font-bold text-[hsl(38,100%,60%)] disabled:opacity-40">ADD</button>
                </div>
                <div className="mt-3 space-y-2">{selected.reversalConditions.map((condition) => {
                  const evaluation = monitor?.evaluations.find((item) => item.conditionId === condition.id);
                  return <div key={condition.id} className={`flex items-center gap-3 border p-2.5 ${evaluation?.triggered ? "border-red-500/35 bg-red-500/5" : "border-border/60 bg-white/[.01]"}`}><ShieldAlert className={`h-3.5 w-3.5 ${evaluation?.triggered ? "text-red-400" : "text-muted-foreground"}`} /><div className="min-w-0 flex-1"><div className="text-[8px] font-bold">{condition.label}</div><div className="mt-1 text-[6.5px] text-muted-foreground">{evaluation?.reason ?? condition.description}</div></div><span className={`text-[7px] font-bold ${evaluation?.triggered ? "text-red-300" : "text-muted-foreground"}`}>{evaluation?.triggered ? "TRIGGERED" : "WATCHING"}</span><button onClick={() => persist(removeReversalCondition(selected, condition.id))} className="p-1 text-muted-foreground hover:text-red-300"><Trash2 className="h-3 w-3" /></button></div>;
                })}{!selected.reversalConditions.length && <div className="border border-dashed border-border/60 p-4 text-center text-[7px] text-muted-foreground">No reversal conditions defined.</div>}</div>
              </section>
            </div>}
          </main>
        </div>
      </section>
    </div>
  );
}
