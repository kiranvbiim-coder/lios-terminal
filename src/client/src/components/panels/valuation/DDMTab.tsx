import { useEffect, useMemo } from "react";
import { useOverridable } from "@/lib/useOverridable";
import { EditableValue, OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { ExportButton } from "@/components/panels/ExportButton";
import { exportWorkbook } from "@/lib/exportXlsx";
import { gordonGrowthDDM, twoStageDDM } from "@/lib/quantModels";
import { useLseDividends } from "@/lib/useLse";
import type { AnalysisTabProps } from "./types";

/** Per-share DDM results, reported upward for the Model Agreement bridge
 * and the Comps tab's optional multi-method football field -- `null` when
 * the company pays no real trailing dividend (a $0-dividend DDM value
 * would be a meaningless method to blend in, not a genuine zero). */
export interface DDMResultSummary {
  gordonValuePerShare: number;
  twoStageValuePerShare: number;
  /** Whether D0 came from the filed dividend feed rather than an analyst override. */
  isFiled?: boolean;
}

type DDMKey = "d0" | "highGrowthRate" | "highGrowthYears" | "stableGrowthRate" | "discountRate";

const DEFAULTS: Record<DDMKey, number> = {
  d0: 0, highGrowthRate: 8, highGrowthYears: 5, stableGrowthRate: 2.5, discountRate: 8.5,
};

export default function DDMTab({ symbol, curr, price, onResult }: AnalysisTabProps & { onResult?: (result: DDMResultSummary | null) => void }) {
  const ov = useOverridable<DDMKey>("DDMTab.ov");
  const { data: dividends } = useLseDividends(symbol);

  // Real trailing-12-month dividend/share: sum of every real declared
  // dividend whose effective date falls in the last 365 days. Falls back to
  // 0 (manual entry) when the feed has nothing for this symbol.
  const trailingD0 = useMemo(() => {
    if (!dividends?.length) return null;
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const sum = dividends
      .filter(d => new Date(d.effective_date).getTime() >= cutoff)
      .reduce((s, d) => s + d.dividend_amount, 0);
    return sum > 0 ? sum : null;
  }, [dividends]);

  const v = {
    d0: ov.getValue("d0", trailingD0 ?? DEFAULTS.d0),
    highGrowthRate: ov.getValue("highGrowthRate", DEFAULTS.highGrowthRate),
    highGrowthYears: ov.getValue("highGrowthYears", DEFAULTS.highGrowthYears),
    stableGrowthRate: ov.getValue("stableGrowthRate", DEFAULTS.stableGrowthRate),
    discountRate: ov.getValue("discountRate", DEFAULTS.discountRate),
  };

  const gordon = useMemo(
    () => gordonGrowthDDM({ d0: v.d0, growthRate: v.stableGrowthRate, discountRate: v.discountRate }),
    [v.d0, v.stableGrowthRate, v.discountRate],
  );
  const years = Math.max(1, Math.round(v.highGrowthYears));
  const twoStage = useMemo(
    () => twoStageDDM({ d0: v.d0, highGrowthRate: v.highGrowthRate, highGrowthYears: years, stableGrowthRate: v.stableGrowthRate, discountRate: v.discountRate }),
    [v.d0, v.highGrowthRate, years, v.stableGrowthRate, v.discountRate],
  );

  const upside = (val: number) => (price > 0 && isFinite(val) ? ((val - price) / price) * 100 : NaN);
  const gordonUpside = upside(gordon.intrinsicValue);
  const twoStageUpside = upside(twoStage.intrinsicValue);

  useEffect(() => {
    if (!onResult) return;
    if (v.d0 <= 0) { onResult(null); return; }
    onResult({
      gordonValuePerShare: isFinite(gordon.intrinsicValue) ? gordon.intrinsicValue : NaN,
      twoStageValuePerShare: isFinite(twoStage.intrinsicValue) ? twoStage.intrinsicValue : NaN,
      isFiled: trailingD0 !== null,
    });
    // Intentionally no cleanup: the last computed value stays available to
    // the Model Agreement bridge / Comps blend even after this tab
    // unmounts, rather than flickering to "unavailable" on every tab switch.
  }, [v.d0, trailingD0, gordon.intrinsicValue, twoStage.intrinsicValue, onResult]);

  const handleExport = () => {
    exportWorkbook(`${symbol}_ddm.xlsx`, [
      {
        name: "DDM Summary",
        rows: [
          ["Metric", "Value"],
          ["Current Annual Div / Share", v.d0],
          ["Discount Rate %", v.discountRate],
          ["High-Growth Rate %", v.highGrowthRate],
          ["High-Growth Years", years],
          ["Stable Terminal Growth %", v.stableGrowthRate],
          [],
          ["Gordon Growth Intrinsic Value", isFinite(gordon.intrinsicValue) ? gordon.intrinsicValue : "N/A"],
          ["Gordon Growth Upside %", isFinite(gordonUpside) ? gordonUpside : "N/A"],
          ["2-Stage DDM Intrinsic Value", isFinite(twoStage.intrinsicValue) ? twoStage.intrinsicValue : "N/A"],
          ["2-Stage DDM Upside %", isFinite(twoStageUpside) ? twoStageUpside : "N/A"],
          ["Current Price", price],
        ],
      },
      {
        name: "Dividend Projection",
        rows: [
          ["Year", "Dividend", "PV"],
          ...twoStage.projections.map(p => [p.year, p.dividend, p.pv]),
        ],
      },
    ]);
  };

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      <div className="flex justify-end">
        <ExportButton onExport={handleExport} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#080808] border border-border p-4">
          <FormulaTooltip formula="V = D0×(1+g) / (r − g)" className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-3">
            GORDON GROWTH (SINGLE-STAGE)
          </FormulaTooltip>
          <div className="font-terminal text-2xl font-bold text-[hsl(38,95%,55%)] mt-1">
            {isFinite(gordon.intrinsicValue) ? `${curr}${gordon.intrinsicValue.toFixed(2)}` : "N/A — growth ≥ discount rate"}
          </div>
          {isFinite(gordonUpside) && (
            <div className={`font-terminal text-[9px] mt-1 ${gordonUpside >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
              {gordonUpside >= 0 ? "+" : ""}{gordonUpside.toFixed(1)}% vs current price {curr}{price.toFixed(2)}
            </div>
          )}
        </div>
        <div className="bg-[#080808] border border-border p-4">
          <FormulaTooltip formula={`PV of ${years}yr high-growth dividends + PV of Gordon-Growth terminal value`} className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-3">
            2-STAGE DDM
          </FormulaTooltip>
          <div className="font-terminal text-2xl font-bold text-[hsl(38,95%,55%)] mt-1">
            {isFinite(twoStage.intrinsicValue) ? `${curr}${twoStage.intrinsicValue.toFixed(2)}` : "N/A — terminal growth ≥ discount rate"}
          </div>
          {isFinite(twoStageUpside) && (
            <div className={`font-terminal text-[9px] mt-1 ${twoStageUpside >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
              {twoStageUpside >= 0 ? "+" : ""}{twoStageUpside.toFixed(1)}% vs current price {curr}{price.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">INPUTS — CLICK ANY VALUE TO EDIT</span>
          <OverrideStatusBadge count={ov.overrideCount} onResetAll={ov.resetAll} />
        </div>
        <p className="font-terminal text-[7px] text-muted-foreground mb-2">
          {trailingD0 !== null
            ? `Current annual dividend/share seeded from real filed dividends (trailing 12 months, ${dividends?.length ?? 0} declarations on record) — click to override.`
            : `No real dividend history found for ${symbol} — type the current annual dividend/share and your own growth/discount assumptions.`}
        </p>
        <div className="grid grid-cols-2 gap-x-4">
          <EditableValue variant="field" label="CURRENT ANNUAL DIV / SHARE" decimals={2} prefix={curr} value={v.d0}
            isOverridden={ov.isOverridden("d0")} onReset={() => ov.resetOverride("d0")} onChange={val => ov.setOverride("d0", val)} />
          <EditableValue variant="field" label="DISCOUNT RATE" decimals={2} suffix="%" value={v.discountRate}
            isOverridden={ov.isOverridden("discountRate")} onReset={() => ov.resetOverride("discountRate")} onChange={val => ov.setOverride("discountRate", val)} />
          <EditableValue variant="field" label="HIGH-GROWTH RATE" decimals={2} suffix="%" value={v.highGrowthRate}
            isOverridden={ov.isOverridden("highGrowthRate")} onReset={() => ov.resetOverride("highGrowthRate")} onChange={val => ov.setOverride("highGrowthRate", val)} />
          <EditableValue variant="field" label="HIGH-GROWTH YEARS" decimals={0} value={v.highGrowthYears}
            isOverridden={ov.isOverridden("highGrowthYears")} onReset={() => ov.resetOverride("highGrowthYears")} onChange={val => ov.setOverride("highGrowthYears", val)} />
          <EditableValue variant="field" label="STABLE TERMINAL GROWTH" decimals={2} suffix="%" value={v.stableGrowthRate}
            isOverridden={ov.isOverridden("stableGrowthRate")} onReset={() => ov.resetOverride("stableGrowthRate")} onChange={val => ov.setOverride("stableGrowthRate", val)} />
        </div>
      </div>

      {twoStage.projections.length > 0 && (
        <div className="bg-[#080808] border border-border p-4 overflow-x-auto scrollbar-thin">
          <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">HIGH-GROWTH DIVIDEND PROJECTION</div>
          <table className="w-full font-terminal text-[9px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border/40">
                <th className="text-left py-1">YEAR</th>
                {twoStage.projections.map(p => <th key={p.year} className="text-right py-1">Y{p.year}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-muted-foreground py-1">DIVIDEND</td>
                {twoStage.projections.map(p => <td key={p.year} className="text-right py-1 tabular-nums">{curr}{p.dividend.toFixed(2)}</td>)}
              </tr>
              <tr>
                <td className="text-muted-foreground py-1">PV</td>
                {twoStage.projections.map(p => <td key={p.year} className="text-right py-1 tabular-nums text-[hsl(38,95%,55%)]">{curr}{p.pv.toFixed(2)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
