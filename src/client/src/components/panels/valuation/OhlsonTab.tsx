import { useMemo } from "react";
import { useOverridable, type Overridable } from "@/lib/useOverridable";
import { OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { ExportButton } from "@/components/panels/ExportButton";
import { exportWorkbook } from "@/lib/exportXlsx";
import { MoneyFieldGrid } from "./FieldGrid";
import { ohlsonOScore, type OhlsonYearInputs } from "@/lib/quantModels";
import type { AnalysisTabProps, FullBalanceSheetData, FullIncomeData, FullCashflowData } from "./types";

type OKey = keyof OhlsonYearInputs;

const FIELDS: Array<{ key: OKey; label: string }> = [
  { key: "totalAssets", label: "TOTAL ASSETS" },
  { key: "totalLiabilities", label: "TOTAL LIABILITIES" },
  { key: "currentAssets", label: "TOTAL CURRENT ASSETS" },
  { key: "currentLiabilities", label: "TOTAL CURRENT LIABILITIES" },
  { key: "netIncome", label: "NET INCOME" },
  { key: "fundsFromOperations", label: "FUNDS FROM OPS (≈ OCF)" },
];

function buildDefaults(bal: FullBalanceSheetData | null, inc: FullIncomeData | null, cf: FullCashflowData | null): OhlsonYearInputs {
  return {
    totalAssets: bal?.totalAssets ?? 0, totalLiabilities: bal?.totalLiabilities ?? 0,
    currentAssets: bal?.totalCurrentAssets ?? 0, currentLiabilities: bal?.totalCurrentLiabilities ?? 0,
    netIncome: inc?.netIncome ?? 0, fundsFromOperations: cf?.operatingCashFlow ?? 0,
  };
}

function resolve(ov: Overridable<OKey>, d: OhlsonYearInputs): OhlsonYearInputs {
  const out = {} as OhlsonYearInputs;
  (Object.keys(d) as OKey[]).forEach(k => { out[k] = ov.getValue(k, d[k]); });
  return out;
}

export default function OhlsonTab({ symbol, curr, balCurrent, balPrior, incCurrent, incPrior, cfCurrent, cfPrior }: AnalysisTabProps) {
  const curOv = useOverridable<OKey>("OhlsonTab.curOv");
  const priorOv = useOverridable<OKey>("OhlsonTab.priorOv");
  const curInputs = resolve(curOv, buildDefaults(balCurrent, incCurrent, cfCurrent));
  const priorInputs = resolve(priorOv, buildDefaults(balPrior, incPrior, cfPrior));
  const result = useMemo(() => ohlsonOScore(curInputs, priorInputs), [curInputs, priorInputs]);
  const hasLiveData = !!(balCurrent && balPrior && incCurrent && incPrior && cfCurrent);

  const riskColor = result.risk === "high" ? "text-[hsl(0,80%,55%)]" : result.risk === "moderate" ? "text-[hsl(38,95%,55%)]" : "text-[hsl(142,71%,55%)]";

  const handleExport = () => {
    exportWorkbook(`${symbol}_ohlson_oscore.xlsx`, [
      {
        name: "O-Score",
        rows: [
          ["O-Score", result.oScore],
          ["P(bankruptcy)", result.probability],
          ["Risk", result.risk],
        ],
      },
      {
        name: "Raw Inputs",
        rows: [
          ["Line Item", "Current Year", "Prior Year"],
          ...FIELDS.map(f => [f.label, curInputs[f.key], priorInputs[f.key]]),
        ],
      },
    ]);
  };

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      <div className="flex justify-end">
        <ExportButton onExport={handleExport} />
      </div>
      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">OHLSON O-SCORE {hasLiveData ? "(REAL FILED DATA)" : "(MANUAL ENTRY)"}</span>
          <OverrideStatusBadge count={curOv.overrideCount + priorOv.overrideCount} onResetAll={() => { curOv.resetAll(); priorOv.resetAll(); }} />
        </div>
        <div className="flex items-baseline gap-4">
          <FormulaTooltip formula="−1.32 − 0.407·ln(TA) + 6.03·(TL/TA) − 1.43·(WC/TA) + 0.0757·(CL/CA) − 1.72·X − 2.37·(NI/TA) − 1.83·(FFO/TL) + 0.285·Y − 0.521·ΔNI">
            <span className={`font-terminal text-3xl font-bold ${riskColor}`}>{result.oScore.toFixed(3)}</span>
          </FormulaTooltip>
          <FormulaTooltip formula="1 / (1 + e⁻ᴼ) — logistic transform of the O-Score">
            <span className={`font-terminal text-lg font-bold ${riskColor}`}>{(result.probability * 100).toFixed(1)}% P(bankruptcy)</span>
          </FormulaTooltip>
        </div>
        <div className={`font-terminal text-[9px] mt-1 uppercase ${riskColor}`}>{result.risk} RISK</div>
        {!hasLiveData && (
          <p className="font-terminal text-[7px] text-muted-foreground mt-2">Needs 2 years of filed balance/income/cash-flow data — not fully available for {symbol}. Type the raw figures below to compute a real score.</p>
        )}
        <div className="mt-3 border-t border-border/30 grid grid-cols-2 gap-x-3">
          <div>
            <div className="font-terminal text-[7px] tracking-widest text-muted-foreground py-1">CURRENT YEAR</div>
            <MoneyFieldGrid ov={curOv} values={curInputs} fields={FIELDS} curr={curr} />
          </div>
          <div>
            <div className="font-terminal text-[7px] tracking-widest text-muted-foreground py-1">PRIOR YEAR</div>
            <MoneyFieldGrid ov={priorOv} values={priorInputs} fields={FIELDS} curr={curr} />
          </div>
        </div>
      </div>
      <div className="bg-[#080808] border border-border p-4 font-terminal text-[9px] text-muted-foreground space-y-1">
        <div className="text-foreground font-bold mb-1 tracking-widest">MODEL NOTES</div>
        <p>O = −1.32 − 0.407·ln(Total Assets) + 6.03·(TL/TA) − 1.43·(WC/TA) + 0.0757·(CL/CA) − 1.72·X − 2.37·(NI/TA) − 1.83·(FFO/TL) + 0.285·Y − 0.521·ΔNI</p>
        <p>Uses ln(Total Assets) in place of the original 1980 GNP price-level deflator, which isn't meaningfully comparable across countries in a global multi-exchange terminal. P(bankruptcy) = 1 / (1 + e⁻ᴼ).</p>
      </div>
    </div>
  );
}
