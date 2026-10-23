import { useMemo } from "react";
import { useOverridable, type Overridable } from "@/lib/useOverridable";
import { OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { ExportButton } from "@/components/panels/ExportButton";
import { exportWorkbook } from "@/lib/exportXlsx";
import { MoneyFieldGrid } from "./FieldGrid";
import { beneishMScore, type BeneishYearInputs } from "@/lib/quantModels";
import type { AnalysisTabProps, FullBalanceSheetData, FullIncomeData, FullCashflowData } from "./types";

type BKey = keyof BeneishYearInputs;

const FIELDS: Array<{ key: BKey; label: string }> = [
  { key: "receivables", label: "ACCOUNTS RECEIVABLE" },
  { key: "revenue", label: "REVENUE" },
  { key: "grossProfit", label: "GROSS PROFIT" },
  { key: "currentAssets", label: "TOTAL CURRENT ASSETS" },
  { key: "ppe", label: "PP&E, NET" },
  { key: "totalAssets", label: "TOTAL ASSETS" },
  { key: "depreciation", label: "DEPRECIATION & AMORT." },
  { key: "sga", label: "SG&A EXPENSE" },
  { key: "currentLiabilities", label: "TOTAL CURRENT LIABILITIES" },
  { key: "longTermDebt", label: "LONG-TERM DEBT" },
  { key: "netIncome", label: "NET INCOME" },
  { key: "operatingCashFlow", label: "OPERATING CASH FLOW" },
];

function buildDefaults(bal: FullBalanceSheetData | null, inc: FullIncomeData | null, cf: FullCashflowData | null): BeneishYearInputs {
  return {
    receivables: bal?.netReceivables ?? 0, revenue: inc?.revenue ?? 0, grossProfit: inc?.grossProfit ?? 0,
    currentAssets: bal?.totalCurrentAssets ?? 0, ppe: bal?.propertyPlantEquipmentNet ?? 0, totalAssets: bal?.totalAssets ?? 0,
    depreciation: inc?.depreciationAndAmortization ?? 0, sga: inc?.sellingGeneralAndAdministrativeExpenses ?? 0,
    currentLiabilities: bal?.totalCurrentLiabilities ?? 0, longTermDebt: bal?.longTermDebt ?? 0,
    netIncome: inc?.netIncome ?? 0, operatingCashFlow: cf?.operatingCashFlow ?? 0,
  };
}

function resolve(ov: Overridable<BKey>, d: BeneishYearInputs): BeneishYearInputs {
  const out = {} as BeneishYearInputs;
  (Object.keys(d) as BKey[]).forEach(k => { out[k] = ov.getValue(k, d[k]); });
  return out;
}

export default function BeneishTab({ symbol, curr, balCurrent, balPrior, incCurrent, incPrior, cfCurrent, cfPrior }: AnalysisTabProps) {
  const curOv = useOverridable<BKey>("BeneishTab.curOv");
  const priorOv = useOverridable<BKey>("BeneishTab.priorOv");
  const curInputs = resolve(curOv, buildDefaults(balCurrent, incCurrent, cfCurrent));
  const priorInputs = resolve(priorOv, buildDefaults(balPrior, incPrior, cfPrior));
  const result = useMemo(() => beneishMScore(curInputs, priorInputs), [curInputs, priorInputs]);
  const hasLiveData = !!(balCurrent && balPrior && incCurrent && incPrior && cfCurrent && cfPrior);

  const components: Array<{ label: string; formula: string; val: number }> = [
    { label: "DSRI", formula: "(Receivables/Sales)ₜ / (Receivables/Sales)ₜ₋₁ — days-sales-in-receivables index", val: result.dsri },
    { label: "GMI", formula: "Gross Marginₜ₋₁ / Gross Marginₜ — gross margin index", val: result.gmi },
    { label: "AQI", formula: "[1 − (Current Assets + PP&E)/Total Assets]ₜ / same ratioₜ₋₁ — asset quality index", val: result.aqi },
    { label: "SGI", formula: "Salesₜ / Salesₜ₋₁ — sales growth index", val: result.sgi },
    { label: "DEPI", formula: "Depreciation Rateₜ₋₁ / Depreciation Rateₜ — depreciation index", val: result.depi },
    { label: "SGAI", formula: "(SG&A/Sales)ₜ / (SG&A/Sales)ₜ₋₁ — SG&A expense index", val: result.sgai },
    { label: "TATA", formula: "(Net Income − Operating Cash Flow) / Total Assets — total accruals to total assets", val: result.tata },
    { label: "LVGI", formula: "[(Current Liab. + LT Debt)/Total Assets]ₜ / same ratioₜ₋₁ — leverage index", val: result.lvgi },
  ];

  const handleExport = () => {
    exportWorkbook(`${symbol}_beneish_mscore.xlsx`, [
      {
        name: "M-Score",
        rows: [
          ["M-Score", result.mScore],
          ["Flagged (> -1.78)", result.flagged ? "YES" : "NO"],
          [],
          ["Component", "Value"],
          ...components.map(c => [c.label, c.val]),
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
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">BENEISH M-SCORE {hasLiveData ? "(REAL FILED DATA)" : "(MANUAL ENTRY)"}</span>
          <OverrideStatusBadge count={curOv.overrideCount + priorOv.overrideCount} onResetAll={() => { curOv.resetAll(); priorOv.resetAll(); }} />
        </div>
        <FormulaTooltip formula="−4.84 + 0.92·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI">
          <span className={`font-terminal text-3xl font-bold ${result.flagged ? "text-[hsl(0,80%,55%)]" : "text-[hsl(142,71%,55%)]"}`}>
            {result.mScore.toFixed(3)}
          </span>
        </FormulaTooltip>
        <div className="font-terminal text-[9px] mt-1 text-muted-foreground">
          {result.flagged ? "ABOVE −1.78 THRESHOLD — Possible earnings manipulation" : "BELOW −1.78 THRESHOLD — Low manipulation risk"}
        </div>
        <div className="mt-3 grid grid-cols-4 md:grid-cols-8 gap-1 font-terminal text-[7px] text-muted-foreground">
          {components.map(c => (
            <div key={c.label} className="border border-border/50 p-1.5 text-center">
              <FormulaTooltip formula={c.formula}>{c.label}</FormulaTooltip>
              <div className="text-foreground font-bold">{c.val.toFixed(2)}</div>
            </div>
          ))}
        </div>
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
        <p>M = −4.84 + 0.92·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI</p>
        <p>Beneish's published threshold flags an M-Score above −1.78 as more likely to be an earnings manipulator (1999 study).</p>
      </div>
    </div>
  );
}
