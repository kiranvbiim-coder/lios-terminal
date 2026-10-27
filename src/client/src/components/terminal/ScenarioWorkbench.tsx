import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitBranch, Play, Plus, Route, Trash2, X } from "lucide-react";
import {
  applyScenarioToBindings,
  listAssumptionBindings,
  previewScenarioBindingApplication,
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
import { scenarioBindingReviewKey } from "@/lib/scenarioBindingReview";
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
  const [reviewedApplicationKey, setReviewedApplicationKey] = useState<string | null>(null);

  useEffect(() => subscribeScenarioUniverse((next, current) => { setScenarios(next); setActive(current); }), []);
  useEffect(() => subscribeAssumptionBindings(setBindings), []);

  const activeBindings = useMemo(() => listAssumptionBindings({ view: activeView, symbol: activeSymbol }), [activeSymbol, activeView, bindings]);
  const applicable = scenarioAppliesTo(active, activeView, activeSymbol);
  const preview = useMemo(
    () => active ? previewScenarioBindingApplication(active, { view: activeView, symbol: activeSymbol })
      : { matched: [], unmatched: [], skipped: [] },
    [active, activeView, activeSymbol, bindings],
  );
  const currentApplicationKey = scenarioBindingReviewKey(active, activeView, activeSymbol, preview);
  const inputApplyReviewed = currentApplicationKey !== null && reviewedApplicationKey === currentApplicationKey;
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
    if (!active || !applicable) return;
    const freshPlan = previewScenarioBindingApplication(active, { view: activeView, symbol: activeSymbol });
    const freshKey = scenarioBindingReviewKey(active, activeView, activeSymbol, freshPlan);
    if (!freshKey || !inputApplyReviewed || freshKey !== currentApplicationKey) {
      setReviewedApplicationKey(null);
      setApplyMessage("Model inputs changed after review. Inspect and confirm the updated preview.");
      return;
    }
    const result = applyScenarioToBindings(active, { view: activeView, symbol: activeSymbol });
    setReviewedApplicationKey(null);
    setApplyMessage(`${result.applied.length} actual model input(s) applied · ${result.unmatched.length} unmatched · ${result.skipped.length} skipped. No P11 model was run and no P4 Artifact was saved.`);
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
          {active && <span className={`border px-2 py-1 text-xs font-bold ${applicable ? "border-emerald-500/30 text-emerald-300" : "border-red-500/30 text-red-300"}`}>{applicable ? "APPLIES TO ACTIVE PANE" : "OUT OF SCOPE"}</span>}
          <button onClick={() => openTerminalUxSurface("impact-map")} disabled={!active} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-cyan-400/20 px-3 font-ui text-xs text-cyan-200 hover:bg-cyan-400/[.04] disabled:opacity-40"><Route className="h-4 w-4" /> Impact map</button>
          <button onClick={branch} disabled={!active} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 font-ui text-xs text-foreground hover:border-amber-300/40 disabled:opacity-40"><GitBranch className="h-4 w-4" /> Branch case</button>
          <button type="button" onClick={() => {
            if (inputApplyReviewed) apply();
            else { setReviewedApplicationKey(currentApplicationKey); setApplyMessage(""); }
          }} disabled={!active || !applicable || !currentApplicationKey}
            aria-pressed={inputApplyReviewed} data-testid="scenario-apply-review-control"
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-300/[0.06] px-3 font-ui text-sm font-semibold text-amber-200 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
            <Play className="h-4 w-4" aria-hidden="true" /> {inputApplyReviewed ? "Confirm apply to model" : "Review model input changes"}
          </button>
          <button type="button" onClick={onClose} aria-label="Close Scenario Playground" className="grid min-h-10 min-w-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"><X className="h-4 w-4" /></button>
        </header>

        {applyMessage && <div role="status" className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-3 font-ui text-sm leading-6 text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{applyMessage}
        </div>}
        {inputApplyReviewed && <section data-testid="scenario-apply-reviewed-preview" aria-label="Model inputs pending explicit confirmation"
          className="space-y-2 border-b border-amber-300/30 bg-amber-300/[0.035] p-3 font-ui text-sm">
          <p className="font-semibold text-foreground">Review {preview.matched.length} exact input changes before applying</p>
          <p className="text-xs leading-5 text-muted-foreground">
            This modifies registered inputs in the active pane only. It does not run a deterministic P11 engine, verify predicted model output, save a P4 Artifact, trade, or launch an automation.
          </p>
          <ul className="max-h-44 space-y-1 overflow-y-auto">
            {preview.matched.slice(0, 16).map((item, i) => <li key={item.bindingId + ":" + item.assumptionKey + ":" + i} className="break-words rounded border border-border/50 p-2">
              {item.bindingLabel}: {item.currentValue} {item.unit ?? ""} → {item.value} {item.unit ?? ""} · source input: {item.assumptionKey}
            </li>)}
          </ul>
          {preview.matched.length > 16 && <p className="text-xs text-muted-foreground">Showing 16 of {preview.matched.length} actual input changes. Other exact changes are included in this review token.</p>}
          {(preview.unmatched.length > 0 || preview.skipped.length > 0) && <p className="text-xs text-amber-200">
            {preview.unmatched.length} unmatched and {preview.skipped.length} skipped; they will not be applied.
          </p>}
          <button type="button" onClick={() => setReviewedApplicationKey(null)}
            className="min-h-11 rounded-lg border border-border/60 px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-amber-300">Cancel review</button>
        </section>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(110px,180px)_minmax(0,1fr)] md:grid-cols-[238px_minmax(0,1fr)] md:grid-rows-1">
          <aside className="overflow-y-auto border-b border-border/60 bg-black/20 p-3 scrollbar-thin md:border-b-0 md:border-r">
            {scenarios.map((scenario) => <button key={scenario.id} onClick={() => setActiveScenario(scenario.id)} className={`mb-2 w-full border p-3 text-left ${active?.id === scenario.id ? "border-[hsl(38,100%,50%)/38%] bg-[hsl(38,100%,50%)/5%]" : "border-border/65 bg-white/[.012] hover:bg-white/[.025]"}`}>
              <div className="flex items-center justify-between gap-2"><span className="break-words font-ui text-sm font-semibold text-foreground">{scenario.name}</span><span className="font-ui text-[11px] tracking-wider text-muted-foreground">{scenario.kind.toUpperCase()}</span></div>
              <div className="mt-1 font-ui text-[11px] text-muted-foreground">{scenario.scope.toUpperCase()}{scenario.symbol ? ` · ${scenario.symbol}` : ""}{scenario.probability == null ? "" : ` · Assigned ${scenario.probability}%`}</div>
              <div className="mt-2 font-ui text-[11px] text-muted-foreground">{scenario.assumptions.length} recorded inputs</div>
            </button>)}
          </aside>

          <main className="min-h-0 min-w-0 overflow-y-auto p-3 scrollbar-thin sm:p-4">
            {!active ? <div className="grid h-full place-items-center text-sm text-muted-foreground">NO ACTIVE SCENARIO</div> : <div className="space-y-4">
              <section className="grid gap-3 border border-border/70 bg-black/15 p-3 md:grid-cols-[1fr_150px]">
                <div><label htmlFor="scenario-name-field" className="font-ui text-sm font-semibold text-muted-foreground">Scenario name</label><input id="scenario-name-field" value={active.name} onChange={(event) => persist(patchScenario(active, { name: event.target.value }))} className="mt-1 w-full border border-border bg-black/30 px-2 py-2 text-sm" /></div>
                <div><label htmlFor="scenario-probability-field" className="font-ui text-sm font-semibold text-muted-foreground">User-assigned probability (%)</label><input id="scenario-probability-field" type="number" min={0} max={100} value={active.probability ?? 0} onChange={(event) => persist(patchScenario(active, { probability: Number(event.target.value) }))} className="mt-1 w-full border border-border bg-black/30 px-2 py-2 text-sm" /></div>
                <div className="md:col-span-2"><label htmlFor="scenario-thesis-field" className="font-ui text-sm font-semibold text-muted-foreground">Scenario thesis</label><textarea id="scenario-thesis-field" rows={2} value={active.thesis ?? ""} onChange={(event) => persist(patchScenario(active, { thesis: event.target.value }))} className="mt-1 w-full resize-y border border-border bg-black/30 px-2 py-2 text-xs leading-relaxed" /></div>
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
                <div className="flex items-center justify-between"><div><div className="text-sm font-bold">ASSUMPTIONS</div><div className="mt-1 font-ui text-xs leading-5 text-muted-foreground">Assumption keys match model inputs where available. Nothing applies until you choose Apply to model.</div></div><span className="text-xs text-muted-foreground">{active.assumptions.length} TOTAL</span></div>
                <div className="mt-3 grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_120px_80px_auto]">
                  <input aria-label="Assumption input key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="KEY" className="border border-border bg-black/30 px-2 py-2 text-xs" />
                  <input aria-label="Assumption display label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="LABEL / MODEL INPUT" className="border border-border bg-black/30 px-2 py-2 text-xs" />
                  <input aria-label="Assumption recorded value" value={value} onChange={(event) => setValue(event.target.value)} placeholder="VALUE" className="border border-border bg-black/30 px-2 py-2 text-xs" />
                  <input aria-label="Assumption unit (no automatic conversion)" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="UNIT" className="border border-border bg-black/30 px-2 py-2 text-xs" />
                  <button type="button" onClick={addAssumption} disabled={!key.trim()} className="flex min-h-11 items-center gap-1 border border-[hsl(38,100%,50%)/30%] px-2 py-2 text-xs font-bold text-[hsl(38,100%,60%)] disabled:opacity-40"><Plus className="h-3 w-3" />ADD</button>
                </div>
                <div className="mt-3 space-y-1.5">{active.assumptions.map((assumption) => <div key={assumption.key} className="grid grid-cols-[160px_minmax(0,1fr)_140px_30px] items-center gap-2 border border-border/55 bg-white/[.01] px-2.5 py-2"><span className="truncate text-xs text-cyan-300">{assumption.key}</span><span className="truncate text-xs font-bold">{assumption.label}</span><span className="text-right text-xs text-[hsl(38,100%,60%)]">{String(assumption.value ?? "—")}{assumption.unit ? ` ${assumption.unit}` : ""}</span><button type="button" aria-label={`Remove scenario assumption ${assumption.label}`} onClick={() => persist(removeScenarioAssumption(active, assumption.key))} className="min-h-10 min-w-10 p-2 text-muted-foreground hover:text-red-300"><Trash2 className="h-3 w-3" /></button></div>)}{!active.assumptions.length && <div className="border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">No assumptions yet.</div>}</div>
              </section>

              <section className="border border-border/70 bg-black/12 p-3">
                <div className="flex items-center justify-between"><div><div className="text-sm font-bold">LIVE MODEL BINDINGS</div><div className="mt-1 font-ui text-xs leading-5 text-muted-foreground">Current editable inputs registered by the active analytical pane. Only same-key, same-unit finite scenario inputs are eligible to apply; use the two-step review above.</div></div><span className="text-xs text-muted-foreground">{activeBindings.length} BOUND INPUTS</span></div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">{activeBindings.map((binding) => {
                  const match = preview.matched.some(item => item.bindingId === binding.id);
                  return <div key={binding.id} className={`border p-2.5 ${match ? "border-emerald-500/25 bg-emerald-500/4" : "border-border/60 bg-white/[.01]"}`}><div className="flex items-center justify-between"><span className="text-xs font-bold">{binding.label}</span><span className={`text-xs font-bold ${match ? "text-emerald-300" : "text-muted-foreground"}`}>{match ? "ELIGIBLE" : "NOT ELIGIBLE"}</span></div><div className="mt-1 text-xs text-muted-foreground">{binding.key} · CURRENT {binding.value}{binding.unit ?? ""}</div></div>;
                })}{!activeBindings.length && <div className="md:col-span-2 border border-dashed border-border/60 p-5 text-center text-xs text-muted-foreground">Open a model surface containing editable assumptions (DCF/WACC/etc.) to expose live bindings.</div>}</div>
              </section>
            </div>}
          </main>
        </div>
      </section>
    </div>
  );
}
