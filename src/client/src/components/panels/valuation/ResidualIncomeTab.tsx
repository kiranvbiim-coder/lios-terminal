import { useEffect, useMemo, useState } from "react";
import { useOverridable } from "@/lib/useOverridable";
import { EditableValue, OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { computeResidualIncome } from "@/lib/valuationEngines";
import { AdvancedReceiptFooter, useAdvancedModel, type AdvancedReceipt } from "@/lib/advancedValuationCredit";

// Residual Income (RI) tab: equity value = book value + PV(excess returns
// above the cost of equity charge on book value). The forecast net income
// path is the DCF/FCF Worksheet tab's own real NOPAT projections (same
// revenue/margin/tax assumptions, same forecast horizon) rather than a
// second, inconsistent forecast -- the only new assumption this tab adds is
// the dividend payout ratio needed to roll book value forward under the
// clean-surplus relation the RI model requires (book value_t = book
// value_{t-1} + retained net income_t).
interface Props {
  symbol: string;
  curr: string;
  price: number;
  sharesOut: number;
  costOfEquity: number; // %
  termGrowth: number; // %, shared with the DCF worksheet's terminal-value assumption
  bookValueOfEquity: number | null; // real, from the filed balance sheet
  forecastNetIncome: number[]; // real, from the DCF worksheet's own NOPAT forecast
  onResult?: (equityValue: number | null) => void;
}

export default function ResidualIncomeTab({ symbol, curr, price, sharesOut, costOfEquity, termGrowth, bookValueOfEquity, forecastNetIncome, onResult }: Props) {
  const ov = useOverridable<"payoutRatio">("ResidualIncomeTab.ov");
  const payoutRatio = ov.getValue("payoutRatio", 0); // % of net income paid out as dividends; 0 = full retention (clean surplus)
  const nativeModel = useAdvancedModel<{ equityValue: number; residualIncomePv: number; terminalValuePv: number; receipt: AdvancedReceipt }>("valuation/residual-income");
  const advanced = nativeModel.result;
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const hasRealBookValue = bookValueOfEquity != null && bookValueOfEquity > 0;
  const bv0 = bookValueOfEquity ?? 0;

  const forecastBookValue = useMemo(() => {
    const arr: number[] = [];
    let bv = bv0;
    for (const ni of forecastNetIncome) {
      bv = bv + ni * (1 - payoutRatio / 100);
      arr.push(bv);
    }
    return arr;
  }, [bv0, forecastNetIncome, payoutRatio]);
  const roePct = useMemo(() => {
    let openingBookValue = bv0;
    return forecastNetIncome.map((netIncome) => {
      const roe = openingBookValue === 0 ? 0 : netIncome / openingBookValue * 100;
      openingBookValue += netIncome * (1 - payoutRatio / 100);
      return roe;
    });
  }, [bv0, forecastNetIncome, payoutRatio]);

  async function runCanonicalResidualIncome() {
    const parameters = { bookValueEquity: bv0, roePct, costOfEquityPct: costOfEquity, payoutRatioPct: payoutRatio, terminalRoePct: roePct.at(-1), terminalGrowthPct: termGrowth };
    setRunning(true); setAdvancedError(null);
    try { await nativeModel.run(parameters); }
    catch (error) { setAdvancedError(error instanceof Error ? error.message : "Residual-income run failed."); }
    finally { setRunning(false); }
  }

  const result = useMemo(() => computeResidualIncome({
    bookValueOfEquity: bv0,
    costOfEquity: costOfEquity / 100,
    forecastNetIncome,
    forecastBookValue,
    terminalGrowth: termGrowth / 100,
  }), [bv0, costOfEquity, forecastNetIncome, forecastBookValue, termGrowth]);

  const valuePerShare = sharesOut > 0 ? result.intrinsicValue / sharesOut : 0;
  const upside = price > 0 ? ((valuePerShare - price) / price) * 100 : NaN;

  useEffect(() => {
    onResult?.(hasRealBookValue ? result.intrinsicValue : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealBookValue, result.intrinsicValue, onResult]);

  const uptxt = upside >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]";

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      {!hasRealBookValue && (
        <div className="bg-[hsl(20,90%,50%)/10%] border border-[hsl(20,90%,50%)/40%] p-2 font-terminal text-[8px] text-[hsl(20,90%,60%)]">
          No filed book value of equity for {symbol} -- this tab needs a real balance sheet to be meaningful. Values below are 0 until filed data is available.
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <FormulaTooltip formula="(Book Value + Σ PV(Residual Income) + PV(Terminal RI)) / Shares Outstanding" className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">INTRINSIC VALUE / SHARE</FormulaTooltip>
          <div className={`font-terminal text-[15px] font-bold tabular-nums ${uptxt}`}>{curr}{valuePerShare.toFixed(2)}</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">UPSIDE / DOWNSIDE</span>
          <div className={`font-terminal text-[15px] font-bold tabular-nums ${uptxt}`}>{isFinite(upside) ? `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%` : "—"}</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1 block">CURRENT BOOK VALUE</span>
          <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{curr}{(bv0 / 1e9).toFixed(2)}B</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-2.5">
          <FormulaTooltip formula="Excess Return_t = Net Income_t − (Cost of Equity × Beginning Book Value_t); PV'd at cost of equity and summed" className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">PV OF RESIDUAL INCOME</FormulaTooltip>
          <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{curr}{(result.pvResidualIncomes.reduce((s, v) => s + v, 0) / 1e9).toFixed(2)}B</div>
        </div>
      </div>
      <div className="border border-border bg-[#080808] p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-terminal text-[9px] tracking-widest text-[hsl(38,95%,55%)]">CANONICAL ADVANCED RESIDUAL INCOME</span><button type="button" disabled={running || !hasRealBookValue || roePct.length === 0} onClick={runCanonicalResidualIncome} className="border border-[hsl(38,95%,50%)] px-2 py-1 font-terminal text-[8px] text-[hsl(38,95%,55%)] disabled:opacity-40">{running ? "RUNNING…" : "RUN RECEIPTED MODEL"}</button></div>
        <div className="font-terminal text-[7px] text-muted-foreground">Formal units: money (book value, equity value); percent (ROE, cost of equity, payout, terminal growth). All supplied values are MANUAL because worksheet source data lacks an immutable source binding.</div>
        {advancedError ? <div className="font-terminal text-[8px] text-red-400">{advancedError}</div> : null}
        {advanced ? <><div className="font-terminal text-[8px] text-muted-foreground">Recorded native equity value <b className="text-foreground">{curr}{(advanced.equityValue / 1e9).toFixed(2)}B</b>. Current worksheet estimate {curr}{(result.intrinsicValue / 1e9).toFixed(2)}B is calculated separately from current inputs. The saved native run is not automatically recalculated when inputs change.</div><AdvancedReceiptFooter receipt={advanced.receipt} /></> : null}
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">ASSUMPTIONS</span>
          <OverrideStatusBadge count={ov.overrideCount} onResetAll={ov.resetAll} />
        </div>
        <div className="grid grid-cols-3 gap-x-4">
          <EditableValue variant="field" label="DIVIDEND PAYOUT RATIO" value={payoutRatio} suffix="%" decimals={0} isOverridden={ov.isOverridden("payoutRatio")} onReset={() => ov.resetOverride("payoutRatio")} onChange={v => ov.setOverride("payoutRatio", Math.max(0, Math.min(100, v)))} />
          <div className="font-terminal text-[8px] text-muted-foreground flex items-center">Cost of Equity: <span className="text-foreground ml-1">{costOfEquity.toFixed(2)}%</span> (WACC builder)</div>
          <div className="font-terminal text-[8px] text-muted-foreground flex items-center">Terminal Growth: <span className="text-foreground ml-1">{termGrowth.toFixed(1)}%</span> (shared with DCF)</div>
        </div>
        <p className="font-terminal text-[7px] text-muted-foreground/70 mt-2">
          Forecast net income = the DCF/FCF Worksheet tab's own NOPAT projections (same revenue/margin/tax assumptions). Book value rolls forward under clean surplus: BV_t = BV_t-1 + Net Income_t x (1 − payout ratio).
        </p>
      </div>

      <div className="bg-[#080808] border border-border p-4 overflow-x-auto scrollbar-thin">
        <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">RESIDUAL INCOME WORKSHEET</div>
        <table className="w-full font-terminal text-[9px]">
          <thead>
            <tr className="text-muted-foreground border-b border-border/40">
              <th className="text-left py-1">LINE ITEM</th>
              {forecastNetIncome.map((_, i) => <th key={i} className="text-right py-1 px-1">Y{i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/20">
              <td className="py-1 text-muted-foreground">Net Income</td>
              {forecastNetIncome.map((v, i) => <td key={i} className="text-right py-1 px-1 tabular-nums">{curr}{(v / 1e6).toFixed(0)}M</td>)}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-1 text-muted-foreground">Book Value (End)</td>
              {forecastBookValue.map((v, i) => <td key={i} className="text-right py-1 px-1 tabular-nums">{curr}{(v / 1e6).toFixed(0)}M</td>)}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-1 text-muted-foreground">Residual Income</td>
              {result.residualIncomes.map((v, i) => (
                <td key={i} className={`text-right py-1 px-1 tabular-nums ${v >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{curr}{(v / 1e6).toFixed(0)}M</td>
              ))}
            </tr>
            <tr className="border-b border-border/20">
              <td className="py-1 text-[hsl(38,95%,55%)]">PV of Residual Income</td>
              {result.pvResidualIncomes.map((v, i) => <td key={i} className="text-right py-1 px-1 tabular-nums text-[hsl(38,95%,55%)] font-bold">{curr}{(v / 1e6).toFixed(0)}M</td>)}
            </tr>
          </tbody>
        </table>
        <div className="mt-3 pt-2 border-t border-border/40 space-y-1 font-terminal text-[9px]">
          <div className="flex justify-between"><span className="text-muted-foreground">Terminal Residual Income</span><span className="tabular-nums">{curr}{(result.terminalResidualIncome / 1e6).toFixed(0)}M</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">PV of Terminal Value</span><span className="tabular-nums text-[hsl(38,95%,55%)]">{curr}{(result.pvTerminalValue / 1e6).toFixed(0)}M</span></div>
          <div className="flex justify-between border-t-2 border-[hsl(38,95%,50%)/40%] pt-1.5 mt-1"><span className="font-bold">INTRINSIC EQUITY VALUE</span><span className="font-bold tabular-nums">{curr}{(result.intrinsicValue / 1e9).toFixed(2)}B</span></div>
        </div>
      </div>
    </div>
  );
}
