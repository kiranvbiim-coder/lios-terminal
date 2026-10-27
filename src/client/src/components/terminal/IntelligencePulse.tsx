import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BellRing, Clock3, GitCompareArrows, Radar, ShieldAlert, Target, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import { getRecentAnalyticalContextChanges, subscribeChangeIntelligence } from "@/lib/terminalChangeIntelligence";
import { AnalyticalChangeStories } from "./AnalyticalChangeStories";
import { subscribeDecisionObjects } from "@/lib/terminalDecisionObjects";
import { subscribeIntelligenceObjects } from "@/lib/terminalIntelligenceObjects";
import { buildIntelligencePulse, buildScenarioMatrix, type IntelligencePulseItem, type PulsePriority } from "@/lib/terminalIntelligencePulse";
import { setActiveScenario, subscribeScenarioUniverse } from "@/lib/terminalScenarioUniverse";
import { subscribeTerminalTimeContext } from "@/lib/terminalTimeTravel";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose: () => void;
}

type Tab = "pulse" | "changes" | "matrix";

const PRIORITY_STYLE: Record<PulsePriority, string> = {
  critical: "border-red-500/35 bg-red-500/[.045] text-red-300",
  high: "border-orange-500/30 bg-orange-500/[.035] text-orange-300",
  medium: "border-[hsl(38,100%,50%)/28%] bg-[hsl(38,100%,50%)/3%] text-[hsl(38,100%,60%)]",
  low: "border-border/70 bg-white/[.01] text-muted-foreground",
};

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "NOW";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}M`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}H`;
  return `${Math.floor(delta / 86_400_000)}D`;
}

function PulseIcon({ item }: { item: IntelligencePulseItem }) {
  if (item.kind === "reversal") return <ShieldAlert className="h-3.5 w-3.5" />;
  if (item.kind === "decision-risk") return <Target className="h-3.5 w-3.5" />;
  if (item.kind === "monitor") return <BellRing className="h-3.5 w-3.5" />;
  if (item.kind === "time-context") return <Clock3 className="h-3.5 w-3.5" />;
  if (item.kind === "scenario") return <GitCompareArrows className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5" />;
}

export default function IntelligencePulse({ onOpen, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("pulse");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => subscribeChangeIntelligence(refresh), [refresh]);
  useEffect(() => subscribeDecisionObjects(refresh), [refresh]);
  useEffect(() => subscribeIntelligenceObjects(refresh), [refresh]);
  useEffect(() => subscribeScenarioUniverse(refresh), [refresh]);
  useEffect(() => subscribeTerminalTimeContext(refresh), [refresh]);

  const pulse = useMemo(() => buildIntelligencePulse(100), [revision]);
  const matrix = useMemo(() => buildScenarioMatrix(), [revision]);
  const recordedChanges = useMemo(() => getRecentAnalyticalContextChanges(80), [revision]);

  const openItem = (item: IntelligencePulseItem) => {
    if (item.kind === "decision-risk" || item.kind === "reversal") {
      openTerminalUxSurface("decision-center");
      return;
    }
    if (item.kind === "scenario") {
      openTerminalUxSurface("scenario-workbench");
      return;
    }
    if (item.objectId && item.kind === "monitor") {
      openTerminalUxSurface("object-workbench");
      return;
    }
    if (item.view) onOpen(item.view, "tab", item.symbol);
  };

  return (
    <div className="fixed inset-0 z-[94] bg-black/82 p-3 backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(860px,calc(100vh-24px))] w-full max-w-7xl flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Intelligence Pulse">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/32%] bg-[hsl(38,100%,50%)/7%]"><Radar className="h-4 w-4 text-[hsl(38,100%,60%)]" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="font-ui text-base font-semibold text-foreground">Intelligence Pulse</h2>
            <p className="mt-1 font-ui text-xs text-muted-foreground">What needs attention · What Changed · Scenario comparison</p>
          </div>
          <div className="hidden items-center gap-1.5 lg:flex">
            {(["critical", "high", "medium", "low"] as PulsePriority[]).map((priority) => <span key={priority} className={`border px-2 py-1 text-[7px] font-bold tracking-wider ${PRIORITY_STYLE[priority]}`}>{priority.toUpperCase()} {pulse.counts[priority]}</span>)}
          </div>
          <button onClick={() => openTerminalUxSurface("decision-center")} className="lios-v5-hero-action"><Target className="h-3 w-3" /> DECISIONS</button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex flex-wrap items-center border-b border-border/60 bg-black/20 px-2">
          <button type="button" aria-pressed={tab === "pulse"} onClick={() => setTab("pulse")} className={`min-h-11 border-b-2 px-3 py-2 font-ui text-xs font-semibold ${tab === "pulse" ? "border-amber-300 text-amber-200" : "border-transparent text-muted-foreground hover:text-foreground"}`}>Attention queue</button>
          <button type="button" aria-pressed={tab === "changes"} onClick={() => setTab("changes")} className={`min-h-11 border-b-2 px-3 py-2 font-ui text-xs font-semibold ${tab === "changes" ? "border-amber-300 text-amber-200" : "border-transparent text-muted-foreground hover:text-foreground"}`}>What Changed</button>
          <button type="button" aria-pressed={tab === "matrix"} onClick={() => setTab("matrix")} className={`min-h-11 border-b-2 px-3 py-2 font-ui text-xs font-semibold ${tab === "matrix" ? "border-cyan-300 text-cyan-200" : "border-transparent text-muted-foreground hover:text-foreground"}`}>Scenario matrix</button>
          <div className="ml-auto px-2 text-[7px] text-muted-foreground">{pulse.activeScenario ? `SCENARIO ${pulse.activeScenario.name}` : "NO ACTIVE SCENARIO"}</div>
        </div>

        {tab === "pulse" ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="min-h-0 overflow-y-auto p-3 scrollbar-thin">
              {pulse.items.length ? <div className="space-y-2">{pulse.items.map((item) => (
                <button key={item.id} onClick={() => openItem(item)} className={`group flex w-full items-start gap-3 border p-3 text-left transition-colors hover:bg-white/[.025] ${PRIORITY_STYLE[item.priority]}`}>
                  <div className="mt-0.5 shrink-0"><PulseIcon item={item} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate text-[9px] font-bold text-foreground">{item.title}</span>{item.symbol && <span className="shrink-0 text-[7px] font-bold text-[hsl(38,100%,60%)]">{item.symbol}</span>}</div>
                    <div className="mt-1 text-[7.5px] leading-relaxed text-muted-foreground">{item.detail}</div>
                    <div className="mt-2 flex gap-2 text-[6.5px] tracking-wider text-muted-foreground/75"><span>{item.kind.toUpperCase()}</span><span>· SCORE {item.score}</span><span>· {relativeTime(item.createdAt)}</span></div>
                  </div>
                  <span className="mt-0.5 text-[7px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">OPEN →</span>
                </button>
              ))}</div> : <div className="grid h-full min-h-64 place-items-center border border-dashed border-border/70 text-center"><div><Activity className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-[9px] font-bold">NO MATERIAL PULSE ITEMS</div><div className="mt-1 text-[7px] text-muted-foreground">As analytical snapshots, monitors and decisions accumulate, LiOS will prioritize them here.</div></div></div>}
            </main>
            <aside className="border-l border-border/60 bg-black/20 p-3">
              <div className="text-[8px] font-bold tracking-widest text-muted-foreground">FAST ROUTES</div>
              <div className="mt-3 space-y-1.5">
                <button onClick={() => openTerminalUxSurface("scenario-workbench")} className="w-full border border-border/65 p-2.5 text-left text-[8px] hover:border-[hsl(38,100%,50%)/30%]">SCENARIO WORKBENCH</button>
                <button onClick={() => openTerminalUxSurface("decision-center")} className="w-full border border-border/65 p-2.5 text-left text-[8px] hover:border-[hsl(38,100%,50%)/30%]">DECISION CENTER</button>
                <button onClick={() => openTerminalUxSurface("graph-explorer")} className="w-full border border-border/65 p-2.5 text-left text-[8px] hover:border-cyan-400/30">CROSS-DOMAIN GRAPH</button>
                <button onClick={() => openTerminalUxSurface("object-workbench")} className="w-full border border-border/65 p-2.5 text-left text-[8px] hover:border-cyan-400/30">OBJECT WORKBENCH</button>
              </div>
              <div className="mt-5 border border-border/60 bg-white/[.012] p-3">
                <div className="flex items-center gap-2 text-[8px] font-bold"><AlertTriangle className="h-3 w-3 text-[hsl(38,100%,60%)]" /> DETERMINISTIC PRIORITY</div>
                <p className="mt-2 text-[7px] leading-relaxed text-muted-foreground">Pulse ranking is computed from published snapshot deltas, explicit decision evidence, reversal thresholds and monitor state. It does not invent market explanations.</p>
              </div>
            </aside>
          </div>
        ) : tab === "changes" ? (
          <AnalyticalChangeStories entries={recordedChanges} onOpen={(view, symbol) => onOpen(view, "tab", symbol)} />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-4 scrollbar-thin">
            <div className="mb-3 flex items-center justify-between"><div><div className="text-[9px] font-bold">SCENARIO ASSUMPTION MATRIX</div><div className="mt-1 text-[7px] text-muted-foreground">Compare assumptions across Base / Bull / Bear / Stress / custom branches. Largest numeric spreads rise to the top.</div></div><button onClick={() => openTerminalUxSurface("scenario-workbench")} className="lios-v5-hero-action"><GitCompareArrows className="h-3 w-3" /> EDIT SCENARIOS</button></div>
            {matrix.scenarios.length ? <table className="lios-signature-table min-w-full border-collapse text-[8px]">
              <thead><tr><th className="sticky left-0 z-10 bg-[#080808] p-2 text-left">ASSUMPTION</th><th className="p-2 text-right">SPREAD</th>{matrix.scenarios.map((scenario) => <th key={scenario.id} className="min-w-28 p-2 text-right"><button onClick={() => { setActiveScenario(scenario.id); openTerminalUxSurface("scenario-workbench"); }} className="hover:text-[hsl(38,100%,60%)]"><span className="block text-[7px] text-muted-foreground">{scenario.kind.toUpperCase()} · {scenario.probability ?? 0}%</span><span className="mt-1 block text-[8px] text-foreground">{scenario.name}</span></button></th>)}</tr></thead>
              <tbody>{matrix.rows.map((row) => <tr key={row.key}><td className="sticky left-0 bg-[#070707] p-2"><span className="font-bold text-foreground">{row.label}</span>{row.unit && <span className="ml-1 text-muted-foreground">{row.unit}</span>}</td><td className="p-2 text-right tabular-nums text-cyan-300">{typeof row.spread === "number" ? row.spread.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}</td>{matrix.scenarios.map((scenario) => <td key={scenario.id} className="p-2 text-right tabular-nums">{row.values[scenario.id] === undefined || row.values[scenario.id] === null ? "—" : String(row.values[scenario.id])}</td>)}</tr>)}</tbody>
            </table> : <div className="grid min-h-64 place-items-center border border-dashed border-border/70 text-[8px] text-muted-foreground">CREATE SCENARIOS TO BUILD THE MATRIX</div>}
          </div>
        )}
      </section>
    </div>
  );
}
