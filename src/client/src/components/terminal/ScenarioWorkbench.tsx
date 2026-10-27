import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitBranch, Play, Plus, Route, Trash2, X } from "lucide-react";
import {
  applyScenarioToBindings,
  listAssumptionBindings,
  subscribeAssumptionBindings,
  type AssumptionBinding,
} from "@/lib/terminalAssumptionRegistry";
import {
  cloneScenarioBranch,
  ensureDefaultScenarios,
  getActiveScenario,
  patchScenario,
  removeScenarioAssumption,
  saveScenarios,
  setActiveScenario,
  subscribeScenarioUniverse,
  updateScenarioAssumption,
  upsertScenario,
  type TerminalScenario,
} from "@/lib/terminalScenarioUniverse";
import { publishScenarioContext, scenarioAppliesTo } from "@/lib/terminalScenarioPropagation";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import type { ViewMode } from "@/lib/terminalTypes";
import ScenarioComparisonBoard from "./ScenarioComparisonBoard";

interface Props {
  activeView: ViewMode;
  activeSymbol?: string;
  onClose: () => void;
}

export default function ScenarioWorkbench({ activeView, activeSymbol, onClose }: Props) {
  const [scenarios, setScenarios] = useState<TerminalScenario[]>(() => ensureDefaultScenarios());
  const [active, setActive] = useState<TerminalScenario | null>(() => getActiveScenario());
  const [bindings, setBindings] = useState<AssumptionBinding[]>(() => listAssumptionBindings());
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [applyMessage, setApplyMessage] = useState("");
  const [comparisonId, setComparisonId] = useState<string>("");

  useEffect(() => subscribeScenarioUniverse((next, current) => { setScenarios(next); setActive(current); }), []);
  useEffect(() => subscribeAssumptionBindings(setBindings), []);

  const activeBindings = useMemo(() => listAssumptionBindings({ view: activeView, symbol: activeSymbol }), [activeSymbol, activeView, bindings]);
  const applicable = scenarioAppliesTo(active, activeView, activeSymbol);
  const comparisonReference = scenarios.find(scenario => scenario.id === comparisonId && scenario.id !== active?.id)
    ?? scenarios.find(scenario => scenario.kind === "base" && scenario.id !== active?.id)
    ?? scenarios.find(scenario => scenario.id !== active?.id)
    ?? null;

  const persist = (scenario: TerminalScenario) => {
    const next = upsertScenario(scenarios, scenario);
    setScenarios(next);
    setActive(scenario);
    saveScenarios(next);
    setActiveScenario(scenario.id);
    publishScenarioContext(activeView, activeSymbol, scenario);
  };

  const addAssumption = () => {
    if (!active || !key.trim()) return;
    const parsed = Number(value);
    const assumptionValue = value.trim() === "" ? null : Number.isFinite(parsed) ? parsed : value;
    persist(updateScenarioAssumption(active, {
      key: key.trim(),
      label: label.trim() || key.trim(),
      value: assumptionValue,
      unit: unit.trim() || undefined,
      source: "scenario-workbench",
    }));
    setKey(""); setLabel(""); setValue(""); setUnit("");
  };

  const apply = () => {
    if (!active) return;
    const result = applyScenarioToBindings(active, { view: activeView, symbol: activeSymbol });
    setApplyMessage(`${result.applied.length} APPLIED · ${result.unmatched.length} UNMATCHED · ${result.skipped.length} SKIPPED`);
    window.setTimeout(() => setApplyMessage(""), 2800);
  };

  const branch = () => {
    if (!active) return;
    const nextScenario = cloneScenarioBranch(active, { name: `${active.name} · BRANCH`, kind: "custom" });
    saveScenarios([nextScenario, ...scenarios]);
    setActiveScenario(nextScenario.id);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/78 p-2 backdrop-blur-[5px] sm:p-3" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(900px,calc(100vh-16px))] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border/70 sm:h-[min(900px,calc(100vh-24px))]" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="LiOS Scenario Workbench">
        <header className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3 sm:gap-3 sm:px-4">
          <div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/30%] bg-[hsl(38,100%,50%)/7%]"><GitBranch className="h-4 w-4 text-[hsl(38,100%,58%)]" /></div>
          <div className="min-w-0 flex-1"><h2 className="font-ui text-lg font-semibold text-foreground">Scenario Playground</h2><p className="mt-1 font-ui text-xs text-muted-foreground">Explore assumptions · compare cases · explicitly apply to models</p></div>
          {active && <span className={`border px-2 py-1 text-[8px] font-bold ${applicable ? "border-emerald-500/30 text-emerald-300" : "border-red-500/30 text-red-300"}`}>{applicable ? "APPLIES TO ACTIVE PANE" : "OUT OF SCOPE"}</span>}
          <button onClick={() => openTerminalUxSurface("impact-map")} disabled={!active} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-cyan-400/20 px-3 font-ui text-xs text-cyan-200 hover:bg-cyan-400/[.04] disabled:opacity-40"><Route className="h-4 w-4" /> Impact map</button>
          <button onClick={branch} disabled={!active} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 font-ui text-xs text-foreground hover:border-amber-300/40 disabled:opacity-40"><GitBranch className="h-4 w-4" /> Branch case</button>
          <button onClick={apply} disabled={!active || !applicable} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-300/[0.06] px-3 font-ui text-xs font-semibold text-amber-200 disabled:opacity-40"><Play className="h-4 w-4" /> Apply to model</button>
          <button type="button" onClick={onClose} aria-label="Close Scenario Playground" className="grid min-h-10 min-w-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"><X className="h-4 w-4" /></button>
        </header>

        {applyMessage && <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-[8px] font-bold text-emerald-300"><CheckCircle2 className="h-3 w-3" />{applyMessage}</div>}

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(110px,180px)_minmax(0,1fr)] md:grid-cols-[238px_minmax(0,1fr)] md:grid-rows-1">
          <aside className="overflow-y-auto border-b border-border/60 bg-black/20 p-3 scrollbar-thin md:border-b-0 md:border-r">
            {scenarios.map((scenario) => <button key={scenario.id} onClick={() => setActiveScenario(scenario.id)} className={`mb-2 w-full border p-3 text-left ${active?.id === scenario.id ? "border-[hsl(38,100%,50%)/38%] bg-[hsl(38,100%,50%)/5%]" : "border-border/65 bg-white/[.012] hover:bg-white/[.025]"}`}>
              <div className="flex items-center justify-between gap-2"><span className="break-words font-ui text-sm font-semibold text-foreground">{scenario.name}</span><span className="font-ui text-[11px] tracking-wider text-muted-foreground">{scenario.kind.toUpperCase()}</span></div>
              <div className="mt-1 font-ui text-[11px] text-muted-foreground">{scenario.scope.toUpperCase()}{scenario.symbol ? ` · ${scenario.symbol}` : ""}{scenario.probability == null ? "" : ` · Assigned ${scenario.probability}%`}</div>
              <div className="mt-2 font-ui text-[11px] text-muted-foreground">{scenario.assumptions.length} recorded inputs</div>
            </button>)}
          </aside>

          <main className="min-h-0 min-w-0 overflow-y-auto p-3 scrollbar-thin sm:p-4">
            {!active ? <div className="grid h-full place-items-center text-[9px] text-muted-foreground">NO ACTIVE SCENARIO</div> : <div className="space-y-4">
              <section className="grid gap-3 border border-border/70 bg-black/15 p-3 md:grid-cols-[1fr_150px]">
                <div><label className="text-[7px] font-bold tracking-widest text-muted-foreground">SCENARIO NAME</label><input value={active.name} onChange={(event) => persist(patchScenario(active, { name: event.target.value }))} className="mt-1 w-full border border-border bg-black/30 px-2 py-2 text-[9px]" /></div>
                <div><label className="font-ui text-xs font-semibold text-muted-foreground">User-assigned probability (%)</label><input type="number" min={0} max={100} value={active.probability ?? 0} onChange={(event) => persist(patchScenario(active, { probability: Number(event.target.value) }))} className="mt-1 w-full border border-border bg-black/30 px-2 py-2 text-[9px]" /></div>
                <div className="md:col-span-2"><label className="text-[7px] font-bold tracking-widest text-muted-foreground">THESIS</label><textarea rows={2} value={active.thesis ?? ""} onChange={(event) => persist(patchScenario(active, { thesis: event.target.value }))} className="mt-1 w-full resize-y border border-border bg-black/30 px-2 py-2 text-[8px] leading-relaxed" /></div>
              </section>

              <section className="space-y-3 rounded-2xl border border-border/70 bg-black/12 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-ui text-base font-semibold">Before & after · scenario inputs</h3>
                  <label className="flex min-w-0 flex-wrap items-center gap-2 font-ui text-xs text-muted-foreground">
                    Compare with
                    <select aria-label="Choose reference scenario" value={comparisonReference?.id ?? ""}
                      onChange={event => setComparisonId(event.target.value)} disabled={!comparisonReference}
                      className="min-h-10 max-w-full rounded-lg border border-border/70 bg-background px-3 font-ui text-sm text-foreground">
                      {scenarios.filter(scenario => scenario.id !== active.id).map(scenario => <option value={scenario.id} key={scenario.id}>{scenario.name}</option>)}
                    </select>
                  </label>
                </div>
                {comparisonReference
                  ? <ScenarioComparisonBoard key={`${active.id}:${comparisonReference.id}`} active={active} reference={comparisonReference} bindings={applicable ? activeBindings : []} />
                  : <p className="rounded-lg border border-dashed border-border/60 p-4 font-ui text-sm text-muted-foreground">Create another scenario branch to compare recorded assumptions.</p>}
                {!applicable && <p className="font-ui text-xs text-amber-200">This scenario does not apply to the active pane. Model input matches are withheld; comparison is read-only.</p>}
              </section>

              <section className="border border-border/70 bg-black/12 p-3">
                <div className="flex items-center justify-between"><div><div className="text-[9px] font-bold">ASSUMPTIONS</div><div className="mt-1 font-ui text-xs leading-5 text-muted-foreground">Assumption keys match model inputs where available. Nothing applies until you choose Apply to model.</div></div><span className="text-[7px] text-muted-foreground">{active.assumptions.length} TOTAL</span></div>
                <div className="mt-3 grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_120px_80px_auto]">
                  <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="KEY" className="border border-border bg-black/30 px-2 py-2 text-[8px]" />
                  <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="LABEL / MODEL INPUT" className="border border-border bg-black/30 px-2 py-2 text-[8px]" />
                  <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="VALUE" className="border border-border bg-black/30 px-2 py-2 text-[8px]" />
                  <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="UNIT" className="border border-border bg-black/30 px-2 py-2 text-[8px]" />
                  <button onClick={addAssumption} disabled={!key.trim()} className="flex items-center gap-1 border border-[hsl(38,100%,50%)/30%] px-2 py-2 text-[8px] font-bold text-[hsl(38,100%,60%)] disabled:opacity-40"><Plus className="h-3 w-3" />ADD</button>
                </div>
                <div className="mt-3 space-y-1.5">{active.assumptions.map((assumption) => <div key={assumption.key} className="grid grid-cols-[160px_minmax(0,1fr)_140px_30px] items-center gap-2 border border-border/55 bg-white/[.01] px-2.5 py-2"><span className="truncate text-[7px] text-cyan-300">{assumption.key}</span><span className="truncate text-[8px] font-bold">{assumption.label}</span><span className="text-right text-[8px] text-[hsl(38,100%,60%)]">{String(assumption.value ?? "—")}{assumption.unit ? ` ${assumption.unit}` : ""}</span><button onClick={() => persist(removeScenarioAssumption(active, assumption.key))} className="p-1 text-muted-foreground hover:text-red-300"><Trash2 className="h-3 w-3" /></button></div>)}{!active.assumptions.length && <div className="border border-dashed border-border/60 p-4 text-center text-[7px] text-muted-foreground">No assumptions yet.</div>}</div>
              </section>

              <section className="border border-border/70 bg-black/12 p-3">
                <div className="flex items-center justify-between"><div><div className="text-[9px] font-bold">LIVE MODEL BINDINGS</div><div className="mt-1 font-ui text-xs leading-5 text-muted-foreground">Current editable inputs registered by the active analytical pane.</div></div><span className="text-[7px] text-muted-foreground">{activeBindings.length} BOUND INPUTS</span></div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">{activeBindings.map((binding) => {
                  const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
                  const match = active.assumptions.some((assumption) => normalized(assumption.key) === normalized(binding.key) || normalized(assumption.label) === normalized(binding.label));
                  return <div key={binding.id} className={`border p-2.5 ${match ? "border-emerald-500/25 bg-emerald-500/4" : "border-border/60 bg-white/[.01]"}`}><div className="flex items-center justify-between"><span className="text-[8px] font-bold">{binding.label}</span><span className={`text-[6.5px] font-bold ${match ? "text-emerald-300" : "text-muted-foreground"}`}>{match ? "MATCHED" : "UNMATCHED"}</span></div><div className="mt-1 text-[7px] text-muted-foreground">{binding.key} · CURRENT {binding.value}{binding.unit ?? ""}</div></div>;
                })}{!activeBindings.length && <div className="md:col-span-2 border border-dashed border-border/60 p-5 text-center text-[7px] text-muted-foreground">Open a model surface containing editable assumptions (DCF/WACC/etc.) to expose live bindings.</div>}</div>
              </section>
            </div>}
          </main>
        </div>
      </section>
    </div>
  );
}
