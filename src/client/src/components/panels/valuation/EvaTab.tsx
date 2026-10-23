import { useEffect, useMemo, useState } from "react";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { computeEva } from "@/lib/valuationEngines";
import { evToEquityBridge, type EvToEquityBridgeInputs } from "@/lib/valuationModels";
import { AdvancedReceiptFooter, useAdvancedModel, type AdvancedReceipt } from "@/lib/advancedValuationCredit";

// Economic Value Added (EVA) tab: EV = invested capital + PV(future EVA),
// EVA = NOPAT − (WACC × beginning invested capital). Current-period
// NOPAT/invested capital are computeValueCreationMetrics's real numbers
// (Program B2, reused rather than recomputed here); the forecast path
// rolls both forward using the DCF/FCF Worksheet tab's own real capex/D&A/
// ΔNWC projections, so this tab's forecast is consistent with the DCF
// worksheet rather than a second, independent guess.
interface Props {
  symbol: string;
  curr: string;
  price: number;
  sharesOut: number;
  computedWACC: number; // %
  termGrowth: number; // %
  currentNopat: number | null;
  currentInvestedCapital: number | null;
  forecastNopat: number[]; // real, from the DCF worksheet's own NOPAT forecast
  forecastCapex: number[];
  forecastDa: number[];
  forecastNwcChange: number[];
  netDebt: number; // real, same net-debt figure as the DCF worksheet's EV -> equity bridge
  bridgeInputs: Omit<EvToEquityBridgeInputs, "enterpriseValue" | "netDebt">;
  onResult?: (equityValue: number | null) => void;
}

export default function EvaTab({
  symbol, curr, price, sharesOut, computedWACC, termGrowth,
  currentNopat, currentInvestedCapital, forecastNopat, forecastCapex, forecastDa, forecastNwcChange,
  netDebt, bridgeInputs, onResult,
}: Props) {
  const hasRealCurrentData = currentNopat != null && currentInvestedCapital != null && currentInvestedCapital > 0;
  const nopat0 = currentNopat ?? 0;
  const ic0 = currentInvestedCapital ?? 0;
  const nativeModel = useAdvancedModel<{ enterpriseValue: number; evaPv: number; terminalEvaPv: number; receipt: AdvancedReceipt }>("valuation/eva");
  const advanced = nativeModel.result;
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Invested capital rolls forward the same way the DCF worksheet already
  // implies: net capex (capex - D&A) plus the change in net working
  // capital both add to the capital base each year.
  const forecastInvestedCapital = useMemo(() => {
    const arr: number[] = [];
    let ic = ic0;
    for (let i = 0; i < forecastNopat.length; i++) {
      ic = ic + (forecastCapex[i] ?? 0) - (forecastDa[i] ?? 0) + (forecastNwcChange[i] ?? 0);
      arr.push(ic);
    }
    return arr;
  }, [ic0, forecastNopat.length, forecastCapex, forecastDa, forecastNwcChange]);
  const capitalGrowthPct = ic0 === 0 ? 0 : ((forecastInvestedCapital[0] ?? ic0) / ic0 - 1) * 100;

  async function runCanonicalEva() {
    const parameters = { investedCapital: ic0, nopat: forecastNopat, waccPct: computedWACC, capitalGrowthPct, terminalEvaGrowthPct: termGrowth };
    setRunning(true); setAdvancedError(null);
    try { await nativeModel.run(parameters); }
    catch (error) { setAdvancedError(error instanceof Error ? error.message : "EVA run failed."); }
    finally { setRunning(false); }
  }

  const result = useMemo(() => computeEva({
    investedCapital: ic0,
    nopat: nopat0,
    wacc: computedWACC / 100,
    forecastNopat,
    forecastInvestedCapital,
    terminalGrowth: termGrowth / 100,
  }), [ic0, nopat0, computedWACC, forecastNopat, forecastInvestedCapital, termGrowth]);

  const bridge = useMemo(() => evToEquityBridge({
    enterpriseValue: result.intrinsicEnterpriseValue,
    netDebt,
    ...bridgeInputs,
  }), [result.intrinsicEnterpriseValue, netDebt, bridgeInputs]);

  const valuePerShare = sharesOut > 0 ? bridge.equityValue / sharesOut : 0;
  const upside = price > 0 ? ((valuePerShare - price) / price) * 100 : NaN;

  useEffect(() => {
    onResult?.(hasRealCurrentData ? bridge.equityValue : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealCurrentData, bridge.equityValue, onResult]);

  const uptxt = upside >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]";
  const roic = ic0 > 0 ? (nopat0 / ic0) * 100 : 0;

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      {!hasRealCurrentData && (
        <div className="bg-[hsl(20,90%,50%)/10%] border border-[hsl(20,90%,50%)/40%] p-2 font-terminal text-[8px] text-[hsl(20,90%,60%)]">
          No filed income/balance-sheet data for {symbol} to derive real NOPAT and invested capital -- values below are 0 until filed data is available.
        </div>
      )}

      <div className="grid grid-cols-5 gap-2">
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <FormulaTooltip formula="(Invested Capital + Σ PV(EVA) + PV(Terminal EVA) − Net Debt ± Bridge Adjustments) / Shares Outstanding" className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">INTRINSIC VALUE / SHARE</FormulaTooltip>
          <div className={`font-terminal text-[15px] font-bold tabular-nums ${uptxt}`}>{curr}{valuePerShare.toFixed(2)}</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">UPSIDE / DOWNSIDE</span>
          <div className={`font-terminal text-[15px] font-bold tabular-nums ${uptxt}`}>{isFinite(upside) ? `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%` : "—"}</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <FormulaTooltip formula="NOPAT / Invested Capital, both from computeValueCreationMetrics on the latest filed period" className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">CURRENT ROIC</FormulaTooltip>
          <div className={`font-terminal text-[15px] font-bold tabular-nums ${result.currentSpread >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{roic.toFixed(1)}%</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <FormulaTooltip formula="ROIC − WACC: positive means the business earns more than its cost of capital" className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">ROIC − WACC SPREAD</FormulaTooltip>
          <div className={`font-terminal text-[15px] font-bold tabular-nums ${result.currentSpread >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{result.currentSpread >= 0 ? "+" : ""}{(result.currentSpread * 100).toFixed(2)}pp</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">MARKET VALUE ADDED</span>
          <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{curr}{(result.marketValueAdded / 1e9).toFixed(2)}B</div>
        </div>
      </div>
      <div className="border border-border bg-[#080808] p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-terminal text-[9px] tracking-widest text-[hsl(38,95%,55%)]">CANONICAL ADVANCED EVA</span><button type="button" disabled={running || !hasRealCurrentData || forecastNopat.length === 0} onClick={runCanonicalEva} className="border border-[hsl(38,95%,50%)] px-2 py-1 font-terminal text-[8px] text-[hsl(38,95%,55%)] disabled:opacity-40">{running ? "RUNNING…" : "RUN RECEIPTED MODEL"}</button></div>
        <div className="font-terminal text-[7px] text-muted-foreground">Formal units: money (invested capital, NOPAT, EV); percent (WACC, capital growth, terminal EVA growth). This manual run uses the exact NOPAT path and a constant capital-growth input derived from the worksheet’s Y1 capital roll-forward; the reconciliation identifies that changed simplifying assumption.</div>
        {advancedError ? <div className="font-terminal text-[8px] text-red-400">{advancedError}</div> : null}
        {advanced ? <><div className="font-terminal text-[8px] text-muted-foreground">Recorded native EV <b className="text-foreground">{curr}{(advanced.enterpriseValue / 1e9).toFixed(2)}B</b>. Current worksheet EV {curr}{(result.intrinsicEnterpriseValue / 1e9).toFixed(2)}B is a separate calculation using current authored inputs; the headline bridge does not relabel the saved native EV as a new equity result. Run explicitly after changing assumptions.</div><AdvancedReceiptFooter receipt={advanced.receipt} /></> : null}
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">CURRENT PERIOD (REAL, FROM FILED FINANCIALS)</div>
        <div className="grid grid-cols-3 gap-2 font-terminal text-[9px]">
          <div className="flex justify-between"><span className="text-muted-foreground">NOPAT</span><span className="tabular-nums">{curr}{(nopat0 / 1e6).toFixed(1)}M</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Invested Capital</span><span className="tabular-nums">{curr}{(ic0 / 1e6).toFixed(1)}M</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Current EVA</span><span className={`tabular-nums ${result.currentEva >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{curr}{(result.currentEva / 1e6).toFixed(1)}M</span></div>
        </div>
        <p className="font-terminal text-[7px] text-muted-foreground/70 mt-2">
          Forecast NOPAT = the DCF/FCF Worksheet tab's own projections. Invested capital rolls forward by net capex (CapEx − D&A) plus ΔNWC each year, using the same worksheet rows. WACC = {computedWACC.toFixed(2)}% (WACC builder). Net debt and bridge adjustments = the same figures as the DCF worksheet's EV → equity bridge.
        </p>
      </div>

      <div className="bg-[#080808] border border-border p-4 overflow-x-auto scrollbar-thin">
        <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">EVA WORKSHEET</div>
        <table className="w-full font-terminal text-[9px]">
          <thead>
            <tr className="text-muted-foreground border-b border-border/40">
              <th className="text-left py-1">LINE ITEM</th>
              {forecastNopat.map((_, i) => <th key={i} className="text-right py-1 px-1">Y{i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/20">
              <td className="py-1 text-muted-foreground">NOPAT</td>
              {forecastNopat.map((v, i) => <td key={i} className="text-right py-1 px-1 tabular-nums">{curr}{(v / 1e6).toFixed(0)}M</td>)}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-1 text-muted-foreground">Invested Capital (End)</td>
              {forecastInvestedCapital.map((v, i) => <td key={i} className="text-right py-1 px-1 tabular-nums">{curr}{(v / 1e6).toFixed(0)}M</td>)}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-1 text-muted-foreground">EVA</td>
              {result.evaPerPeriod.map((v, i) => (
                <td key={i} className={`text-right py-1 px-1 tabular-nums ${v >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{curr}{(v / 1e6).toFixed(0)}M</td>
              ))}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-1 text-[hsl(38,95%,55%)]">PV of EVA</td>
              {result.pvEva.map((v, i) => <td key={i} className="text-right py-1 px-1 tabular-nums text-[hsl(38,95%,55%)] font-bold">{curr}{(v / 1e6).toFixed(0)}M</td>)}
            </tr>
          </tbody>
        </table>
        <div className="mt-3 pt-2 border-t border-border/40 space-y-1 font-terminal text-[9px]">
          <div className="flex justify-between"><span className="text-muted-foreground">Terminal EVA</span><span className="tabular-nums">{curr}{(result.terminalEva / 1e6).toFixed(0)}M</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">PV of Terminal Value</span><span className="tabular-nums text-[hsl(38,95%,55%)]">{curr}{(result.pvTerminalValue / 1e6).toFixed(0)}M</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Intrinsic Enterprise Value</span><span className="tabular-nums">{curr}{(result.intrinsicEnterpriseValue / 1e9).toFixed(2)}B</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Net Debt (−)</span><span className="tabular-nums">({curr}{(netDebt / 1e9).toFixed(2)}B)</span></div>
          <div className="flex justify-between border-t-2 border-[hsl(38,95%,50%)/40%] pt-1.5 mt-1"><span className="font-bold">INTRINSIC EQUITY VALUE</span><span className="font-bold tabular-nums">{curr}{(bridge.equityValue / 1e9).toFixed(2)}B</span></div>
        </div>
      </div>
    </div>
  );
}
