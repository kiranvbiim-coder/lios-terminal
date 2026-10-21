import { useMemo, useState } from "react";
import { useOverridable } from "@/lib/useOverridable";
import { EditableValue, OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { computeImpliedGrowth, computeImpliedWacc, computeImpliedMargin } from "@/lib/valuationEngines";
import { AdvancedReceiptFooter, runAdvancedModel, type AdvancedReceipt } from "@/lib/advancedValuationCredit";

// Reverse DCF: instead of assuming growth/WACC/margin and solving for
// value, this tab takes the REAL current market value (market cap + real
// net debt) as given and solves for what growth, discount rate, or
// operating margin the market must be pricing in -- a Newton-Raphson
// (implied WACC) / binary-search (implied margin) / closed-form (implied
// growth) client-side implementation.
//
// This is intentionally distinct from the Python-side reverse-DCF engine
// already reachable via Quant Lab (advanced_valuation.py /
// valuation_specialized.py), which solves for growth OR margin against
// market value using a different numerical method on the Python service.
// Both stay available rather than picking one -- see this task's final
// report for why neither is redundant with the other.
export interface ReverseDcfInputStatus {
  ready: boolean;
  missing: string[];
}

export function reverseDcfInputStatus(inputs: {
  currentMarketEV: number | null;
  marketEquityValue: number | null;
  netDebt: number | null;
  baseRevenueStartingPoint: number | null;
  fcfForecast: number[];
  computedWACC: number | null;
  termGrowth: number | null;
}): ReverseDcfInputStatus {
  const missing: string[] = [];
  if (inputs.currentMarketEV == null || !Number.isFinite(inputs.currentMarketEV) || inputs.currentMarketEV <= 0) missing.push("market EV");
  if (inputs.marketEquityValue == null || !Number.isFinite(inputs.marketEquityValue) || inputs.marketEquityValue <= 0) missing.push("market equity value");
  if (inputs.netDebt == null || !Number.isFinite(inputs.netDebt)) missing.push("net debt");
  if (inputs.baseRevenueStartingPoint == null || !Number.isFinite(inputs.baseRevenueStartingPoint) || inputs.baseRevenueStartingPoint <= 0) missing.push("base revenue");
  if (!Number.isFinite(inputs.fcfForecast[0]) || (inputs.fcfForecast[0] ?? 0) <= 0) missing.push("FCF forecast");
  if (inputs.computedWACC == null || !Number.isFinite(inputs.computedWACC)) missing.push("WACC");
  if (inputs.termGrowth == null || !Number.isFinite(inputs.termGrowth)) missing.push("terminal growth");
  return { ready: missing.length === 0, missing };
}

interface Props {
  symbol: string;
  curr: string;
  currentMarketEV: number | null;
  marketEquityValue: number | null;
  netDebt: number | null;
  computedWACC: number | null;
  termGrowth: number | null;
  fcfForecast: number[];
  baseRevenueStartingPoint: number | null;
  revenueGrowthStartingPoint: number | null;
  ebitMarginStartingPoint: number | null;
  taxRateStartingPoint: number | null;
  daPercentStartingPoint: number | null;
  capexPercentStartingPoint: number | null;
  nwcChangePercentStartingPoint: number | null;
  forecastYears: number;
}

export default function ReverseDcfTab({
  symbol, curr, currentMarketEV, marketEquityValue, netDebt, computedWACC, termGrowth, fcfForecast,
  baseRevenueStartingPoint, revenueGrowthStartingPoint, ebitMarginStartingPoint, taxRateStartingPoint,
  daPercentStartingPoint, capexPercentStartingPoint, nwcChangePercentStartingPoint, forecastYears,
}: Props) {
  const inputStatus = reverseDcfInputStatus({ currentMarketEV, marketEquityValue, netDebt, baseRevenueStartingPoint, fcfForecast, computedWACC, termGrowth });
  const safeMarketEV = currentMarketEV ?? 0;
  const safeMarketEquity = marketEquityValue ?? 0;
  const safeWacc = computedWACC ?? 0;
  const safeTermGrowth = termGrowth ?? 0;
  const safeRevenue = baseRevenueStartingPoint ?? 0;
  const safeRevenueGrowth = revenueGrowthStartingPoint ?? 0;
  const safeTax = taxRateStartingPoint ?? 0;
  const safeDa = daPercentStartingPoint ?? 0;
  const safeCapex = capexPercentStartingPoint ?? 0;
  const safeNwc = nwcChangePercentStartingPoint ?? 0;
  const ov = useOverridable<"fcfGrowthRate">("ReverseDcfTab.ov");
  const fcfGrowthRatePct = ov.getValue("fcfGrowthRate", revenueGrowthStartingPoint ?? 0);
  const [advanced, setAdvanced] = useState<{ impliedRevenueGrowthPct?: number; impliedEbitMarginPct?: number; repricedEquityValue: number; absoluteError: number; receipt: AdvancedReceipt } | null>(null);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function runCanonicalReverseDcf() {
    if (!inputStatus.ready) return;
    const parameters = {
      currentRevenue: baseRevenueStartingPoint!,
      marketEquityValue: marketEquityValue!,
      netDebt: netDebt!,
      years: forecastYears,
      waccPct: computedWACC!,
      terminalGrowthPct: termGrowth!,
      ebitMarginPct: ebitMarginStartingPoint ?? 0,
      taxRatePct: taxRateStartingPoint ?? 0,
      reinvestmentPctOfRevenue: (nwcChangePercentStartingPoint ?? 0) + (capexPercentStartingPoint ?? 0) - (daPercentStartingPoint ?? 0),
      solveFor: "revenue_growth",
    };
    setRunning(true); setAdvancedError(null);
    try { setAdvanced(await runAdvancedModel("valuation/reverse-dcf", parameters)); }
    catch (error) { setAdvancedError(error instanceof Error ? error.message : "Reverse DCF run failed."); }
    finally { setRunning(false); }
  }

  const impliedGrowth = useMemo(() => computeImpliedGrowth({
    enterpriseValue: currentMarketEV ?? 0,
    lastFcf: fcfForecast[0] ?? 0,
    wacc: safeWacc / 100,
    terminalGrowth: safeTermGrowth / 100,
    forecastYears,
    fcfGrowthRate: fcfGrowthRatePct / 100,
  }), [currentMarketEV, fcfForecast, safeWacc, safeTermGrowth, forecastYears, fcfGrowthRatePct]);

  const impliedWacc = useMemo(() => computeImpliedWacc({
    enterpriseValue: currentMarketEV ?? 0,
    fcfForecast,
    terminalGrowth: safeTermGrowth / 100,
  }), [currentMarketEV, fcfForecast, safeTermGrowth]);

  const impliedMargin = useMemo(() => computeImpliedMargin({
    enterpriseValue: currentMarketEV ?? 0,
    revenue: safeRevenue,
    wacc: safeWacc / 100,
    terminalGrowth: safeTermGrowth / 100,
    revenueGrowth: safeRevenueGrowth / 100,
    forecastYears,
    taxRate: safeTax / 100,
    daPercentRevenue: safeDa / 100,
    capexPercentRevenue: safeCapex / 100,
    nwcPercentRevenue: safeNwc / 100,
  }), [currentMarketEV, safeRevenue, safeWacc, safeTermGrowth, safeRevenueGrowth, forecastYears, safeTax, safeDa, safeCapex, safeNwc]);

  const impliedGrowthPct = impliedGrowth.impliedGrowthRate * 100;
  const impliedWaccPct = impliedWacc.impliedWacc * 100;
  const impliedMarginPct = impliedMargin.impliedOperatingMargin * 100;

  if (!inputStatus.ready) {
    return (
      <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
        <div className="border border-[hsl(20,90%,50%)/40%] bg-[hsl(20,90%,50%)/10%] p-3 font-terminal text-[9px] text-[hsl(20,90%,60%)]">
          REVERSE DCF UNAVAILABLE — deterministic dependencies are incomplete.
        </div>
        <div className="font-terminal text-[8px] text-muted-foreground">
          Missing: {inputStatus.missing.join(", ")}. Provide valid market, balance-sheet, and forecast inputs or use an explicit manual override.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      <div className="bg-[hsl(186,80%,50%)/8%] border border-[hsl(186,80%,50%)/30%] p-2 font-terminal text-[8px] text-[hsl(186,80%,60%)]">
        Canonical reverse DCF runs on the receipted advanced engine. This run is classified MANUAL with the exact submitted parameters.
      </div>
      <div className="bg-[#080808] border border-border p-4">
        <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">CURRENT MARKET VALUE (REAL)</div>
        <div className="font-terminal text-[13px] font-bold text-[hsl(38,95%,55%)] tabular-nums">{curr}{(safeMarketEV / 1e9).toFixed(2)}B Enterprise Value</div>
        <div className="font-terminal text-[7px] text-muted-foreground/70 mt-1">= real market capitalization + real net debt (same figure as the DCF worksheet's EV → equity bridge)</div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#080808] border border-border p-3">
          <FormulaTooltip formula="Solves the explicit-period FCF growth rate implied by current market EV." className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-1">IMPLIED GROWTH RATE</FormulaTooltip>
          <div className="font-terminal text-[18px] font-bold tabular-nums text-foreground">{impliedGrowthPct.toFixed(1)}%</div>
          <div className="font-terminal text-[7px] text-muted-foreground mt-1">vs. worksheet's own Y1 assumption: {safeRevenueGrowth.toFixed(1)}%</div>
        </div>
        <div className="border border-border bg-[#080808] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-terminal text-[9px] tracking-widest text-[hsl(38,95%,55%)]">CANONICAL ADVANCED REVERSE DCF</span><button type="button" disabled={running || safeMarketEquity <= 0 || safeRevenue <= 0} onClick={runCanonicalReverseDcf} className="border border-[hsl(38,95%,50%)] px-2 py-1 font-terminal text-[8px] text-[hsl(38,95%,55%)] disabled:opacity-40">{running ? "RUNNING…" : "RUN RECEIPTED MODEL"}</button></div>
          {advancedError ? <div className="font-terminal text-[8px] text-red-400">{advancedError}</div> : null}
          {advanced ? <AdvancedReceiptFooter receipt={advanced.receipt} /> : null}
        </div>
        <div className="bg-[#080808] border border-border p-3">
          <FormulaTooltip formula="Solves the discount rate implied by current market EV." className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-1">IMPLIED DISCOUNT RATE</FormulaTooltip>
          {impliedWacc.converged ? (
            <>
              <div className="font-terminal text-[18px] font-bold tabular-nums text-foreground">{impliedWaccPct.toFixed(2)}%</div>
              <div className="font-terminal text-[7px] text-muted-foreground mt-1">vs. computed WACC: {safeWacc.toFixed(2)}%</div>
            </>
          ) : (
            <>
              <div className="font-terminal text-[13px] font-bold tabular-nums text-[hsl(20,90%,60%)]">NO SOLUTION IN [0.1%, 50%]</div>
              <div className="font-terminal text-[7px] text-muted-foreground mt-1">No discount rate in that range reconciles the forecast cash flows with the current market EV — the search hit its {impliedWaccPct <= 0.11 ? "lower" : "upper"} bound without converging.</div>
            </>
          )}
        </div>
        <div className="bg-[#080808] border border-border p-3">
          <FormulaTooltip formula="Solves the operating margin implied by current market EV." className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-1">IMPLIED OPERATING MARGIN</FormulaTooltip>
          {impliedMargin.converged ? (
            <div className="font-terminal text-[18px] font-bold tabular-nums text-foreground">{impliedMarginPct.toFixed(1)}%</div>
          ) : (
            <>
              <div className="font-terminal text-[13px] font-bold tabular-nums text-[hsl(20,90%,60%)]">NO SOLUTION IN [-50%, 80%]</div>
              <div className="font-terminal text-[7px] text-muted-foreground mt-1">No operating margin in that range reconciles the forecast with the current market EV.</div>
            </>
          )}
        </div>
      </div>
      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">STARTING-POINT ASSUMPTION (EDITABLE)</span>
          <OverrideStatusBadge count={ov.overrideCount} onResetAll={ov.resetAll} />
        </div>
        <EditableValue variant="field" label="EXPLICIT-PERIOD FCF GROWTH RATE (FOR IMPLIED GROWTH)" value={fcfGrowthRatePct} suffix="%" decimals={1} isOverridden={ov.isOverridden("fcfGrowthRate")} onReset={() => ov.resetOverride("fcfGrowthRate")} onChange={v => ov.setOverride("fcfGrowthRate", v)} />
      </div>
    </div>
  );
}
