import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, GitBranch, Network, Route, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import { listAssumptionBindings, subscribeAssumptionBindings, type AssumptionBinding } from "@/lib/terminalAssumptionRegistry";
import { buildScenarioImpactMap } from "@/lib/terminalImpactMap";
import { loadIntelligenceObjects, subscribeIntelligenceObjects, type IntelligenceObject } from "@/lib/terminalIntelligenceObjects";
import { getActiveScenario, subscribeScenarioUniverse, type TerminalScenario } from "@/lib/terminalScenarioUniverse";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose: () => void;
}

function deltaText(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function ImpactMap({ onOpen, onClose }: Props) {
  const [scenario, setScenario] = useState<TerminalScenario | null>(() => getActiveScenario());
  const [bindings, setBindings] = useState<AssumptionBinding[]>(() => listAssumptionBindings());
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());

  useEffect(() => subscribeScenarioUniverse((_scenarios, active) => setScenario(active)), []);
  useEffect(() => subscribeAssumptionBindings(setBindings), []);
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);

  const impact = useMemo(() => scenario ? buildScenarioImpactMap(scenario, bindings, objects) : null, [bindings, objects, scenario]);

  return (
    <div className="fixed inset-0 z-[95] bg-black/84 p-3 backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(860px,calc(100vh-24px))] w-full max-w-7xl flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Scenario Impact Map">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-cyan-400/25 bg-cyan-400/[.045]"><Route className="h-4 w-4 text-cyan-300" /></div>
          <div className="min-w-0 flex-1"><div className="text-[11px] font-bold tracking-[.14em]">SCENARIO IMPACT MAP</div><div className="mt-1 text-[8px] text-muted-foreground">ASSUMPTION → LIVE BINDING → IMPACTED VIEW → EXPLICIT OBJECT DEPENDENCY</div></div>
          <button onClick={() => openTerminalUxSurface("scenario-workbench")} className="lios-v5-hero-action"><GitBranch className="h-3 w-3" /> SCENARIO</button>
          <button onClick={() => openTerminalUxSurface("graph-explorer")} className="lios-v5-hero-action"><Network className="h-3 w-3 text-cyan-300" /> GRAPH</button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>

        {!impact || !scenario ? <div className="grid flex-1 place-items-center text-[9px] text-muted-foreground">NO ACTIVE SCENARIO</div> : (
          <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px]">
            <main className="min-h-0 overflow-y-auto p-4 scrollbar-thin">
              <section className="grid gap-3 sm:grid-cols-4">
                <div className="border border-[hsl(38,100%,50%)/25%] bg-[hsl(38,100%,50%)/3%] p-3"><div className="text-[7px] tracking-widest text-muted-foreground">SCENARIO</div><div className="mt-2 text-[11px] font-bold text-[hsl(38,100%,60%)]">{scenario.name}</div><div className="mt-1 text-[7px] text-muted-foreground">{scenario.kind.toUpperCase()} · {scenario.scope.toUpperCase()}</div></div>
                <div className="border border-border/65 bg-white/[.012] p-3"><div className="text-[7px] tracking-widest text-muted-foreground">BINDING COVERAGE</div><div className="mt-2 text-xl font-bold tabular-nums text-cyan-300">{impact.coveragePct.toFixed(0)}%</div><div className="mt-1 text-[7px] text-muted-foreground">{impact.matchedAssumptionCount} / {impact.assumptionCount - impact.skippedAssumptions.length} numeric assumptions matched</div></div>
                <div className="border border-border/65 bg-white/[.012] p-3"><div className="text-[7px] tracking-widest text-muted-foreground">IMPACTED SURFACES</div><div className="mt-2 text-xl font-bold tabular-nums">{impact.impactedViews.length}</div><div className="mt-1 text-[7px] text-muted-foreground">Currently mounted model bindings only</div></div>
                <div className="border border-border/65 bg-white/[.012] p-3"><div className="text-[7px] tracking-widest text-muted-foreground">EXPLICIT GRAPH LINKS</div><div className="mt-2 text-xl font-bold tabular-nums">{impact.explicitObjectLinks.length}</div><div className="mt-1 text-[7px] text-muted-foreground">No inferred causal claims</div></div>
              </section>

              <section className="mt-4 border border-border/70">
                <div className="flex items-center justify-between border-b border-border/60 bg-[#080808] px-3 py-2"><div className="text-[8px] font-bold tracking-widest">LIVE ASSUMPTION IMPACT</div><span className="text-[7px] text-muted-foreground">DELTA IS INPUT DELTA, NOT PREDICTED OUTPUT DELTA</span></div>
                <div className="overflow-x-auto"><table className="lios-signature-table min-w-full border-collapse text-[8px]"><thead><tr><th className="p-2 text-left">ASSUMPTION</th><th className="p-2 text-left">MODEL INPUT</th><th className="p-2 text-left">SURFACE</th><th className="p-2 text-right">CURRENT</th><th className="p-2 text-right">SCENARIO</th><th className="p-2 text-right">INPUT Δ</th></tr></thead><tbody>{impact.bindingMatches.map((match) => <tr key={`${match.assumptionKey}:${match.bindingId}`}><td className="p-2"><div className="font-bold">{match.assumptionLabel}</div><div className="mt-0.5 text-[6.5px] text-muted-foreground">{match.assumptionKey}</div></td><td className="p-2">{match.bindingLabel}</td><td className="p-2"><button onClick={() => onOpen(match.view, "tab", match.symbol)} className="text-cyan-300 hover:text-cyan-200">{getTerminalCapability(match.view).shortLabel}{match.symbol ? ` · ${match.symbol}` : ""}</button></td><td className="p-2 text-right tabular-nums">{match.currentValue}{match.unit ?? ""}</td><td className="p-2 text-right tabular-nums text-[hsl(38,100%,60%)]">{match.targetValue}{match.unit ?? ""}</td><td className={`p-2 text-right tabular-nums ${Math.abs(match.percentDelta ?? 0) >= 20 ? "text-red-300" : "text-muted-foreground"}`}>{deltaText(match.percentDelta)}</td></tr>)}{!impact.bindingMatches.length && <tr><td colSpan={6} className="p-5 text-center text-muted-foreground">No currently mounted model inputs match this scenario.</td></tr>}</tbody></table></div>
              </section>

              <section className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="border border-border/70 p-3"><div className="text-[8px] font-bold tracking-widest">IMPACTED SURFACES</div><div className="mt-3 space-y-1.5">{impact.impactedViews.map((view) => <button key={`${view.view}:${view.symbol ?? ""}`} onClick={() => onOpen(view.view, "tab", view.symbol)} className="flex w-full items-center gap-3 border border-border/60 bg-white/[.01] p-2.5 text-left hover:border-cyan-400/25"><div className="min-w-0 flex-1"><div className="text-[8px] font-bold">{getTerminalCapability(view.view).label}{view.symbol ? ` · ${view.symbol}` : ""}</div><div className="mt-1 text-[6.5px] text-muted-foreground">{view.matchedAssumptions.join(" · ")}</div></div><span className="text-[7px] text-cyan-300">{view.bindingCount} INPUTS</span></button>)}{!impact.impactedViews.length && <div className="border border-dashed border-border/60 p-4 text-center text-[7px] text-muted-foreground">No impacted live surfaces yet.</div>}</div></div>
                <div className="border border-border/70 p-3"><div className="text-[8px] font-bold tracking-widest">EXPLICIT OBJECT DEPENDENCIES</div><div className="mt-3 space-y-1.5">{impact.explicitObjectLinks.slice(0, 30).map((link) => <div key={`${link.sourceObjectId}:${link.targetObjectId}:${link.relation}`} className="border border-border/60 bg-white/[.01] p-2.5"><div className="text-[7.5px] font-bold">{link.sourceLabel}</div><div className="mt-1 text-[6.5px] text-cyan-300">{link.relation.toUpperCase()} → {link.targetLabel}</div></div>)}{!impact.explicitObjectLinks.length && <div className="border border-dashed border-border/60 p-4 text-center text-[7px] text-muted-foreground">No explicit depends-on / affects / derived-from object links have been published.</div>}</div></div>
              </section>
            </main>

            <aside className="min-h-0 overflow-y-auto border-l border-border/60 bg-black/20 p-3 scrollbar-thin">
              <div className="flex items-center gap-2 text-[8px] font-bold tracking-widest"><AlertTriangle className="h-3 w-3 text-[hsl(38,100%,60%)]" /> COVERAGE GAPS</div>
              <p className="mt-2 text-[7px] leading-relaxed text-muted-foreground">A gap means LiOS cannot currently bind that scenario assumption to a mounted model input. It does not mean the assumption is economically irrelevant.</p>
              <div className="mt-3 space-y-1.5">{impact.unmatchedAssumptions.map((key) => <div key={key} className="border border-orange-500/20 bg-orange-500/[.025] p-2 text-[7px] text-orange-300">UNMATCHED · {key}</div>)}{impact.skippedAssumptions.map((key) => <div key={key} className="border border-border/60 p-2 text-[7px] text-muted-foreground">NON-NUMERIC · {key}</div>)}{!impact.unmatchedAssumptions.length && !impact.skippedAssumptions.length && <div className="border border-emerald-500/20 bg-emerald-500/[.025] p-2 text-[7px] text-emerald-300">ALL NUMERIC ASSUMPTIONS HAVE LIVE BINDINGS</div>}</div>
              <div className="mt-5 border border-cyan-400/15 bg-cyan-400/[.02] p-3"><div className="text-[8px] font-bold text-cyan-300">WHY THIS MATTERS</div><p className="mt-2 text-[7px] leading-relaxed text-muted-foreground">Before applying a scenario, users can see exactly which live model inputs will move and which assumptions have nowhere to propagate. LiOS therefore separates dependency coverage from calculated impact.</p></div>
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}
