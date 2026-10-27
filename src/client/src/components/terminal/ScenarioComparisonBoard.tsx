import * as React from "react";
import { useState } from "react";
import { ArrowRight, GitCompareArrows, Link2, Scale } from "lucide-react";
import type { AssumptionBinding } from "@/lib/terminalAssumptionRegistry";
import { buildScenarioInputComparison, scenarioInputText, type ComparedScenarioAssumption } from "@/lib/scenarioInputComparison";
import type { TerminalScenario } from "@/lib/terminalScenarioUniverse";

function InputBars({ row }: { row: ComparedScenarioAssumption }) {
  const from = row.reference?.value;
  const to = row.active?.value;
  // Show proportion only for finite, non-negative, same-unit comparable inputs.
  if (!row.comparableNumeric || typeof from !== "number" || typeof to !== "number" || from < 0 || to < 0) return null;
  const denominator = Math.max(from, to);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return <div className="mt-3 grid gap-2" aria-label="Relative size of two recorded input values">
    <div className="flex items-center gap-2"><span className="w-20 shrink-0 font-ui text-[11px] text-muted-foreground">Reference</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-cyan-300/70" style={{ width: `${from / denominator * 100}%` }} /></div></div>
    <div className="flex items-center gap-2"><span className="w-20 shrink-0 font-ui text-[11px] text-muted-foreground">Active</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-amber-300/85" style={{ width: `${to / denominator * 100}%` }} /></div></div>
  </div>;
}

function DifferenceCard({ row }: { row: ComparedScenarioAssumption }) {
  const state = row.status === "changed" ? "Different inputs"
    : row.status === "active_only" ? "Active only"
    : row.status === "reference_only" ? "Reference only" : "Same input";
  const changed = row.status !== "unchanged";
  return <article data-testid="scenario-difference-card" data-difference={row.status}
    className={`min-w-0 rounded-xl border p-4 ${changed ? "border-amber-300/25 bg-amber-300/[0.025]" : "border-border/60 bg-white/[0.015]"}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <h4 className="break-words font-ui text-sm font-semibold text-foreground">{row.label}</h4>
        <p className="mt-1 break-all font-ui text-[11px] text-muted-foreground">Input key: {row.key}</p>
      </div>
      <span className={`rounded-md border px-2 py-1 font-ui text-[11px] ${changed ? "border-amber-300/25 text-amber-200" : "border-border/60 text-muted-foreground"}`}>{state}</span>
    </div>
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <div className="min-w-0 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.035] p-3">
        <div className="font-ui text-[11px] text-cyan-200">Reference case</div>
        <div className="mt-1 break-words font-ui text-sm font-semibold tabular-nums text-foreground">{scenarioInputText(row.reference)}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true"/>
      <div className="min-w-0 rounded-lg border border-amber-300/20 bg-amber-300/[0.035] p-3">
        <div className="font-ui text-[11px] text-amber-200">Active case</div>
        <div className="mt-1 break-words font-ui text-sm font-semibold tabular-nums text-foreground">{scenarioInputText(row.active)}</div>
      </div>
    </div>
    <InputBars row={row} />
    <div className="mt-3 flex flex-wrap items-center gap-3 font-ui text-xs">
      {row.absoluteDelta !== null ? (
        <span className="text-foreground">Input difference: <strong className="tabular-nums">{row.absoluteDelta > 0 ? "+" : ""}{Number(row.absoluteDelta.toPrecision(8))}{row.active?.unit ? ` ${row.active.unit}` : ""}</strong>
          {row.percentDelta !== null ? ` (${row.percentDelta >= 0 ? "+" : ""}${row.percentDelta.toFixed(1)}%)` : ""}
        </span>
      ) : row.reference && row.active && row.reference.unit !== row.active.unit ? (
        <span className="text-amber-200">Different units — no numeric delta calculated</span>
      ) : <span className="text-muted-foreground">No numeric difference calculated</span>}
      {row.liveMatches.length > 0
        ? <span className="inline-flex items-center gap-1 text-emerald-200"><Link2 className="h-3 w-3" aria-hidden="true"/> {row.liveMatches.length} active model input{row.liveMatches.length === 1 ? "" : "s"} matched</span>
        : row.active && <span className="text-muted-foreground">No mounted model input matched</span>}
    </div>
    {row.liveMatches.length > 0 && (
      <p className="mt-2 break-words font-ui text-[11px] leading-5 text-muted-foreground">
        Currently registered: {row.liveMatches.slice(0, 3).map(match => `${match.bindingLabel} (${match.currentValue}${match.unit ? ` ${match.unit}` : ""})`).join(" · ")}
        {row.liveMatches.length > 3 ? ` · +${row.liveMatches.length - 3} more` : ""}
      </p>
    )}
  </article>;
}

export default function ScenarioComparisonBoard({
  active, reference, bindings,
}: {
  active: TerminalScenario;
  reference: TerminalScenario;
  bindings: readonly AssumptionBinding[];
}) {
  const [showAll, setShowAll] = useState(false);
  const comparison = buildScenarioInputComparison(reference, active, bindings);
  const changed = comparison.rows.filter(row => row.status !== "unchanged");
  const unchanged = comparison.rows.filter(row => row.status === "unchanged");
  const ordered = [...changed, ...unchanged];
  const visible = showAll ? ordered : ordered.slice(0, 6);
  return (
    <section data-testid="scenario-comparison-board" aria-label="Recorded scenario input comparison"
      className="space-y-4 rounded-2xl border border-amber-300/20 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.045),transparent_60%)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-amber-200" aria-hidden="true" />
          <div>
            <h3 className="font-ui text-base font-semibold text-foreground">Scenario comparison</h3>
            <p className="mt-1 font-ui text-xs text-muted-foreground">Compare recorded input values before applying anything.</p>
          </div>
        </div>
        <span className="rounded-md border border-border/70 px-2 py-1 font-ui text-xs text-muted-foreground">Preview only</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.035] p-3">
          <div className="font-ui text-[11px] font-medium text-cyan-200">Reference scenario</div>
          <h4 className="mt-1 break-words font-ui text-sm font-semibold text-foreground">{reference.name}</h4>
          <div className="mt-1 font-ui text-[11px] text-muted-foreground">{reference.kind.toUpperCase()} · {reference.assumptions.length} inputs</div>
        </div>
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.035] p-3">
          <div className="font-ui text-[11px] font-medium text-amber-200">Active scenario</div>
          <h4 className="mt-1 break-words font-ui text-sm font-semibold text-foreground">{active.name}</h4>
          <div className="mt-1 font-ui text-[11px] text-muted-foreground">{active.kind.toUpperCase()} · {active.assumptions.length} inputs</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Comparison summary">
        {[
          ["Different", comparison.changedCount],
          ["Only active", comparison.activeOnlyCount],
          ["Only reference", comparison.referenceOnlyCount],
          ["Mounted input matches", comparison.liveMatchedCount],
        ].map(([name, count]) => <div key={name} className="rounded-lg border border-border/55 bg-background/50 p-3">
          <div className="font-ui text-[11px] text-muted-foreground">{name}</div>
          <div className="mt-1 font-ui text-lg font-semibold tabular-nums text-foreground">{count}</div>
        </div>)}
      </div>
      {visible.length ? <div className="grid gap-3 xl:grid-cols-2">
        {visible.map(row => <DifferenceCard key={row.key} row={row} />)}
      </div> : <div className="rounded-lg border border-dashed border-border/60 p-5 text-center font-ui text-sm text-muted-foreground">Neither scenario has recorded assumptions to compare. Add assumptions or choose another case.</div>}
      {ordered.length > 6 && <button type="button" aria-expanded={showAll}
        onClick={() => setShowAll(value => !value)}
        className="min-h-10 w-full rounded-lg border border-border/60 font-ui text-sm text-foreground hover:bg-white/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
        {showAll ? "Show fewer inputs" : `Show all ${ordered.length} recorded inputs`}
      </button>}
      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/40 p-3">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
        <p className="font-ui text-xs leading-5 text-muted-foreground">These are scenario <strong className="text-foreground">assumptions</strong>, not forecasted outputs. Differences are arithmetic on matching input keys with matching units. Registered model inputs show current values; they are not changed until you explicitly use Apply to model. Probability fields are user-entered scenario assessments, not calculated forecasts.</p>
      </div>
    </section>
  );
}
