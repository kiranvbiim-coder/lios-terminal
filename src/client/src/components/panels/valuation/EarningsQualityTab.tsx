import { useMemo, useState } from "react";
import { useOverridable, type Overridable } from "@/lib/useOverridable";
import { OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { ExportMenuButton } from "@/components/panels/ExportMenuButton";
import { exportWorkbook, type ExportSheet } from "@/lib/exportXlsx";
import { exportPdfReport } from "@/lib/exportPdf";
import { MoneyFieldGrid } from "./FieldGrid";
import {
  sloanAccrualRatio, cashEarningsQuality, revenueQuality, earningsPersistenceProxy, financialDistressComposite,
  altmanZScore, piotroskiFScore, beneishMScore, ohlsonOScore, detectRedFlags, mertonDistanceToDefault, type RedFlagPeriod,
} from "@/lib/quantModels";
import { realizedVolatilityPct } from "@/lib/optionsModels";
import { useOHLCV } from "@/lib/useFinance";
import { useRiskFreeRate } from "@/lib/useEconomics";
import ModelConsensus, { type ConsensusMethod } from "@/components/quant/ModelConsensus";
import type { AnalysisTabProps, FullBalanceSheetData, FullIncomeData, FullCashflowData } from "./types";
import { AdvancedReceiptFooter, runAdvancedModel, type AdvancedReceipt } from "@/lib/advancedValuationCredit";

// Balance-sheet fields needed in BOTH years for the ratios below.
type BalKey = "currentAssets" | "cash" | "currentLiabilities" | "shortTermDebt" | "totalAssets" | "netReceivables";
// Current-year-only P&L/cash-flow fields.
type CurOnlyKey = "depreciationAndAmortization" | "operatingCashFlow" | "netIncome" | "revenue";
type CurKey = BalKey | CurOnlyKey;

const BAL_FIELDS: Array<{ key: BalKey; label: string }> = [
  { key: "currentAssets", label: "TOTAL CURRENT ASSETS" },
  { key: "cash", label: "CASH & EQUIVALENTS" },
  { key: "currentLiabilities", label: "TOTAL CURRENT LIABILITIES" },
  { key: "shortTermDebt", label: "SHORT-TERM DEBT" },
  { key: "totalAssets", label: "TOTAL ASSETS" },
  { key: "netReceivables", label: "NET RECEIVABLES" },
];
const CUR_ONLY_FIELDS: Array<{ key: CurOnlyKey; label: string }> = [
  { key: "depreciationAndAmortization", label: "DEPRECIATION & AMORT." },
  { key: "operatingCashFlow", label: "OPERATING CASH FLOW" },
  { key: "netIncome", label: "NET INCOME" },
  { key: "revenue", label: "REVENUE" },
];

function buildBalDefaults(bal: FullBalanceSheetData | null): Record<BalKey, number> {
  return {
    currentAssets: bal?.totalCurrentAssets ?? 0, cash: bal?.cashAndCashEquivalents ?? 0,
    currentLiabilities: bal?.totalCurrentLiabilities ?? 0, shortTermDebt: bal?.shortTermDebt ?? 0,
    totalAssets: bal?.totalAssets ?? 0, netReceivables: bal?.netReceivables ?? 0,
  };
}
function buildCurDefaults(bal: FullBalanceSheetData | null, inc: FullIncomeData | null, cf: FullCashflowData | null): Record<CurKey, number> {
  return {
    ...buildBalDefaults(bal),
    depreciationAndAmortization: inc?.depreciationAndAmortization ?? 0,
    operatingCashFlow: cf?.operatingCashFlow ?? 0,
    netIncome: inc?.netIncome ?? 0,
    revenue: inc?.revenue ?? 0,
  };
}

function resolve<K extends string>(ov: Overridable<K>, d: Record<K, number>): Record<K, number> {
  const out = {} as Record<K, number>;
  (Object.keys(d) as K[]).forEach(k => { out[k] = ov.getValue(k, d[k]); });
  return out;
}

// Reference Altman/Piotroski/Beneish/Ohlson scores feeding the composite --
// computed straight from filed data (not overridable here; each has its own
// dedicated tab for adjusting raw inputs). grossProfitMargin/assetTurnover
// are derived locally since the ratios feed (LSE's precomputed grossProfitMargin/
// assetTurnover) isn't part of this shared AnalysisTabProps shape.
function computeReferenceScores(p: AnalysisTabProps) {
  const gpm = (inc: FullIncomeData | null) => (inc && inc.revenue !== 0 ? inc.grossProfit / inc.revenue : 0);
  const ato = (bal: FullBalanceSheetData | null, inc: FullIncomeData | null) => (bal && inc && bal.totalAssets !== 0 ? inc.revenue / bal.totalAssets : 0);

  const altman = altmanZScore({
    totalCurrentAssets: p.balCurrent?.totalCurrentAssets ?? 0, totalCurrentLiabilities: p.balCurrent?.totalCurrentLiabilities ?? 0,
    totalAssets: p.balCurrent?.totalAssets ?? 0, retainedEarnings: p.balCurrent?.retainedEarnings ?? 0,
    ebit: p.incCurrent?.ebit ?? 0, marketCapitalization: p.marketCap ?? 0,
    totalLiabilities: p.balCurrent?.totalLiabilities ?? 0, revenue: p.incCurrent?.revenue ?? 0,
  });
  const piotroski = piotroskiFScore(
    {
      netIncome: p.incCurrent?.netIncome ?? 0, totalAssets: p.balCurrent?.totalAssets ?? 0,
      operatingCashFlow: p.cfCurrent?.operatingCashFlow ?? 0, longTermDebt: p.balCurrent?.longTermDebt ?? 0,
      totalCurrentAssets: p.balCurrent?.totalCurrentAssets ?? 0, totalCurrentLiabilities: p.balCurrent?.totalCurrentLiabilities ?? 0,
      grossProfitMargin: gpm(p.incCurrent), assetTurnover: ato(p.balCurrent, p.incCurrent),
      netCommonStockIssuance: p.cfCurrent?.netCommonStockIssuance ?? 0,
    },
    {
      netIncome: p.incPrior?.netIncome ?? 0, totalAssets: p.balPrior?.totalAssets ?? 0,
      operatingCashFlow: p.cfPrior?.operatingCashFlow ?? 0, longTermDebt: p.balPrior?.longTermDebt ?? 0,
      totalCurrentAssets: p.balPrior?.totalCurrentAssets ?? 0, totalCurrentLiabilities: p.balPrior?.totalCurrentLiabilities ?? 0,
      grossProfitMargin: gpm(p.incPrior), assetTurnover: ato(p.balPrior, p.incPrior),
      netCommonStockIssuance: p.cfPrior?.netCommonStockIssuance ?? 0,
    },
  );
  const beneish = beneishMScore(
    {
      receivables: p.balCurrent?.netReceivables ?? 0, revenue: p.incCurrent?.revenue ?? 0, grossProfit: p.incCurrent?.grossProfit ?? 0,
      currentAssets: p.balCurrent?.totalCurrentAssets ?? 0, ppe: p.balCurrent?.propertyPlantEquipmentNet ?? 0, totalAssets: p.balCurrent?.totalAssets ?? 0,
      depreciation: p.incCurrent?.depreciationAndAmortization ?? 0, sga: p.incCurrent?.sellingGeneralAndAdministrativeExpenses ?? 0,
      currentLiabilities: p.balCurrent?.totalCurrentLiabilities ?? 0, longTermDebt: p.balCurrent?.longTermDebt ?? 0,
      netIncome: p.incCurrent?.netIncome ?? 0, operatingCashFlow: p.cfCurrent?.operatingCashFlow ?? 0,
    },
    {
      receivables: p.balPrior?.netReceivables ?? 0, revenue: p.incPrior?.revenue ?? 0, grossProfit: p.incPrior?.grossProfit ?? 0,
      currentAssets: p.balPrior?.totalCurrentAssets ?? 0, ppe: p.balPrior?.propertyPlantEquipmentNet ?? 0, totalAssets: p.balPrior?.totalAssets ?? 0,
      depreciation: p.incPrior?.depreciationAndAmortization ?? 0, sga: p.incPrior?.sellingGeneralAndAdministrativeExpenses ?? 0,
      currentLiabilities: p.balPrior?.totalCurrentLiabilities ?? 0, longTermDebt: p.balPrior?.longTermDebt ?? 0,
      netIncome: p.incPrior?.netIncome ?? 0, operatingCashFlow: p.cfPrior?.operatingCashFlow ?? 0,
    },
  );
  const ohlson = ohlsonOScore(
    {
      totalAssets: p.balCurrent?.totalAssets ?? 0, totalLiabilities: p.balCurrent?.totalLiabilities ?? 0,
      currentAssets: p.balCurrent?.totalCurrentAssets ?? 0, currentLiabilities: p.balCurrent?.totalCurrentLiabilities ?? 0,
      netIncome: p.incCurrent?.netIncome ?? 0, fundsFromOperations: p.cfCurrent?.operatingCashFlow ?? 0,
    },
    {
      totalAssets: p.balPrior?.totalAssets ?? 0, totalLiabilities: p.balPrior?.totalLiabilities ?? 0,
      currentAssets: p.balPrior?.totalCurrentAssets ?? 0, currentLiabilities: p.balPrior?.totalCurrentLiabilities ?? 0,
      netIncome: p.incPrior?.netIncome ?? 0, fundsFromOperations: p.cfPrior?.operatingCashFlow ?? 0,
    },
  );
  return { altman, piotroski, beneish, ohlson };
}

export default function EarningsQualityTab(props: AnalysisTabProps) {
  const { symbol, curr, marketCap, balCurrent, balPrior, incCurrent, incPrior, cfCurrent, incomeReportsFull, balanceReportsFull } = props;
  const curOv = useOverridable<CurKey>("EarningsQualityTab.curOv");
  const priorOv = useOverridable<BalKey>("EarningsQualityTab.priorOv");
  const [advancedMerton, setAdvancedMerton] = useState<{ assetValue: number; assetVolPct: number; distanceToDefault: number; riskNeutralDefaultProbabilityPct: number; equityRepricingError: number; volatilityRepricingErrorPct: number; receipt: AdvancedReceipt } | null>(null);
  const [mertonError, setMertonError] = useState<string | null>(null);
  const [mertonRunning, setMertonRunning] = useState(false);

  // Merton/KMV needs equity volatility (from the actual price series, not
  // filed statements) and a live risk-free rate -- neither is otherwise
  // fetched by this tab, since every other model here reads purely off
  // financial-statement fields.
  const { data: ohlcvSeries } = useOHLCV(symbol, "1Y");
  const riskFreeRate = useRiskFreeRate();

  const curInputs = resolve(curOv, buildCurDefaults(balCurrent, incCurrent, cfCurrent));
  const priorInputs = resolve(priorOv, buildBalDefaults(balPrior));

  const sloan = useMemo(() => sloanAccrualRatio({
    currentAssets: curInputs.currentAssets, currentAssetsPrior: priorInputs.currentAssets,
    cash: curInputs.cash, cashPrior: priorInputs.cash,
    currentLiabilities: curInputs.currentLiabilities, currentLiabilitiesPrior: priorInputs.currentLiabilities,
    shortTermDebt: curInputs.shortTermDebt, shortTermDebtPrior: priorInputs.shortTermDebt,
    depreciationAndAmortization: curInputs.depreciationAndAmortization,
    totalAssets: curInputs.totalAssets, totalAssetsPrior: priorInputs.totalAssets,
  }), [curInputs, priorInputs]);

  const cashEQ = useMemo(() => cashEarningsQuality({ operatingCashFlow: curInputs.operatingCashFlow, netIncome: curInputs.netIncome }), [curInputs]);
  const revQuality = useMemo(() => revenueQuality({ revenue: curInputs.revenue, netReceivables: curInputs.netReceivables, netReceivablesPrior: priorInputs.netReceivables }), [curInputs, priorInputs]);
  const persistence = useMemo(() => earningsPersistenceProxy({ netIncome: curInputs.netIncome, accruals: sloan.accruals }), [curInputs, sloan]);

  const reference = useMemo(() => computeReferenceScores(props), [props]);
  const composite = useMemo(() => financialDistressComposite({
    altmanZone: reference.altman.zone, ohlsonProbability: reference.ohlson.probability,
    piotroskiScore: reference.piotroski.score, beneishFlagged: reference.beneish.flagged,
  }), [reference]);

  // Multi-year trend-based red flags -- merges the income and balance report
  // histories by (fiscal year, period) since detectRedFlags needs both
  // statements' fields together per period, but they're fetched separately.
  const redFlagPeriods = useMemo((): RedFlagPeriod[] => {
    const inc = incomeReportsFull ?? [];
    const bal = balanceReportsFull ?? [];
    return inc.map((incRep) => {
      const balRep = bal.find((b) => b.fiscal_year === incRep.fiscal_year && b.period === incRep.period);
      let incData: Record<string, number> = {};
      let balData: Record<string, number> = {};
      try { incData = JSON.parse(incRep.data); } catch { /* leave empty on parse failure */ }
      try { if (balRep) balData = JSON.parse(balRep.data); } catch { /* leave empty on parse failure */ }
      return {
        revenue: incData.revenue, grossProfit: incData.grossProfit, costOfRevenue: incData.costOfRevenue,
        netReceivables: balData.netReceivables, inventory: balData.inventory,
        totalLiabilities: balData.totalLiabilities, totalStockholdersEquity: balData.totalStockholdersEquity,
        totalCurrentAssets: balData.totalCurrentAssets, totalCurrentLiabilities: balData.totalCurrentLiabilities,
      };
    });
  }, [incomeReportsFull, balanceReportsFull]);
  const redFlags = useMemo(() => detectRedFlags(redFlagPeriods), [redFlagPeriods]);
  const triggeredFlagCount = redFlags.filter((f) => f.triggered).length;

  const hasLiveData = !!(balCurrent && balPrior && incCurrent && cfCurrent);

  const riskColor = composite.label === "high risk" ? "text-[hsl(0,80%,55%)]" : composite.label === "moderate risk" ? "text-[hsl(38,95%,55%)]" : "text-[hsl(142,71%,55%)]";

  // Merton/KMV -- the first market-implied signal alongside four
  // statement-based ones. Default point per KMV
  // convention: current liabilities + 0.5 * long-term debt.
  const merton = useMemo(() => {
    const closes = (ohlcvSeries?.bars ?? []).map((b) => b.close);
    const equityVolPct = realizedVolatilityPct(closes);
    if (!marketCap || !balCurrent || equityVolPct === null || riskFreeRate.ratePercent === null) return null;
    const defaultPoint = balCurrent.totalCurrentLiabilities + 0.5 * balCurrent.longTermDebt;
    if (defaultPoint <= 0) return null;
    return mertonDistanceToDefault({
      marketCap,
      equityVolatility: equityVolPct / 100,
      defaultPoint,
      riskFreeRate: riskFreeRate.ratePercent / 100,
    });
  }, [ohlcvSeries, marketCap, balCurrent, riskFreeRate.ratePercent]);
  const mertonParameters = useMemo(() => {
    const closes = (ohlcvSeries?.bars ?? []).map((bar) => bar.close);
    const equityVolPct = realizedVolatilityPct(closes);
    const debtFaceValue = balCurrent ? balCurrent.totalCurrentLiabilities + 0.5 * balCurrent.longTermDebt : 0;
    return marketCap && equityVolPct !== null && riskFreeRate.ratePercent !== null && debtFaceValue > 0
      ? { equityValue: marketCap, equityVolPct, debtFaceValue, riskFreeRatePct: riskFreeRate.ratePercent, maturityYears: 1 } : null;
  }, [ohlcvSeries, marketCap, balCurrent, riskFreeRate.ratePercent]);

  async function runCanonicalMerton() {
    if (!mertonParameters) return;
    setMertonRunning(true); setMertonError(null);
    try { setAdvancedMerton(await runAdvancedModel("credit/merton", mertonParameters)); }
    catch (error) { setMertonError(error instanceof Error ? error.message : "Merton structural-model run failed."); }
    finally { setMertonRunning(false); }
  }

  // Pair the statement-based scores below with Merton/KMV's market-implied
  // signal, shown side by side instead of
  // pre-blended, so a reader can see WHICH model disagrees rather than
  // only the composite's already-collapsed number.
  const consensusMethods: ConsensusMethod[] = useMemo(() => [
    {
      name: "Altman Z-Score", value: reference.altman.zScore.toFixed(2), verdict: reference.altman.zone,
      tone: reference.altman.zone === "safe" ? "good" : reference.altman.zone === "grey" ? "warn" : "bad",
      detail: "Bankruptcy risk from filed balance-sheet ratios",
    },
    {
      name: "Piotroski F-Score", value: `${reference.piotroski.score}/9`,
      verdict: reference.piotroski.score >= 7 ? "strong" : reference.piotroski.score >= 4 ? "moderate" : "weak",
      tone: reference.piotroski.score >= 7 ? "good" : reference.piotroski.score >= 4 ? "warn" : "bad",
      detail: "Fundamental strength, 9-point checklist",
    },
    {
      name: "Beneish M-Score", value: reference.beneish.mScore.toFixed(2), verdict: reference.beneish.flagged ? "flagged" : "clean",
      tone: reference.beneish.flagged ? "bad" : "good",
      detail: "Earnings-manipulation likelihood",
    },
    {
      name: "Ohlson O-Score", value: `${(reference.ohlson.probability * 100).toFixed(1)}%`, verdict: reference.ohlson.risk,
      tone: reference.ohlson.risk === "low" ? "good" : reference.ohlson.risk === "moderate" ? "warn" : "bad",
      detail: "Bankruptcy probability",
    },
    ...(advancedMerton ? [{
      name: "Merton/KMV DD", value: advancedMerton.distanceToDefault.toFixed(2),
      verdict: advancedMerton.distanceToDefault >= 4 ? "safe" : advancedMerton.distanceToDefault >= 2 ? "elevated" : "distressed",
      tone: (advancedMerton.distanceToDefault >= 4 ? "good" : advancedMerton.distanceToDefault >= 2 ? "warn" : "bad") as ConsensusMethod["tone"],
      detail: `Canonical receipted structural model · ${advancedMerton.riskNeutralDefaultProbabilityPct.toFixed(2)}% risk-neutral PD`,
    }] : merton && merton.converged ? [{
      name: "Merton/KMV DD", value: merton.distanceToDefault.toFixed(2),
      verdict: merton.distanceToDefault >= 4 ? "safe" : merton.distanceToDefault >= 2 ? "elevated" : "distressed",
      tone: (merton.distanceToDefault >= 4 ? "good" : merton.distanceToDefault >= 2 ? "warn" : "bad") as ConsensusMethod["tone"],
      detail: `Legacy client solver · ${(merton.probabilityOfDefaultNormal * 100).toFixed(2)}% theoretical PD; run canonical model to reconcile`,
    }] : []),
  ], [reference, merton, advancedMerton]);

  const exportSheets: ExportSheet[] = [
    {
      name: "Earnings Quality",
      rows: [
        ["Metric", "Value", "Label"],
        ["Sloan Accrual Ratio", sloan.accrualRatio, sloan.flagged ? "FLAGGED (>10%)" : "OK"],
        ["Cash Earnings Quality (CFO/NI)", cashEQ.ratio, cashEQ.quality],
        ["Revenue Quality (cash conversion)", revQuality.cashConversionRatio, revQuality.quality],
        ["Earnings Persistence (proxy)", persistence.persistenceScore, persistence.label],
        [],
        ["Composite Financial Distress Score (0-100)", composite.score, composite.label],
        ...composite.components.map(c => [c.label, c.contribution]),
      ],
    },
    {
      name: "Reference Scores",
      rows: [
        ["Model", "Value"],
        ["Altman Z-Score", reference.altman.zScore], ["Altman Zone", reference.altman.zone],
        ["Piotroski F-Score", `${reference.piotroski.score}/9`],
        ["Beneish M-Score", reference.beneish.mScore], ["Beneish Flagged", reference.beneish.flagged ? "YES" : "NO"],
        ["Ohlson P(bankruptcy)", reference.ohlson.probability],
      ],
    },
    {
      name: "Red Flags",
      rows: [
        ["Flag", "Triggered", "Detail"],
        ...redFlags.map((f) => [f.label, f.triggered ? "YES" : "no", f.detail]),
      ],
    },
    {
      name: "Raw Inputs",
      rows: [
        ["Line Item", "Current Year", "Prior Year"],
        ...BAL_FIELDS.map(f => [f.label, curInputs[f.key], priorInputs[f.key]]),
        ...CUR_ONLY_FIELDS.map(f => [f.label, curInputs[f.key], ""]),
      ],
    },
  ];
  const handleExportXlsx = () => exportWorkbook(`${symbol}_earnings_quality.xlsx`, exportSheets);
  const handleExportPdf = () => exportPdfReport(`${symbol}_earnings_quality.pdf`, `${symbol} — Earnings Quality`, exportSheets);

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      <div className="flex justify-end">
        <ExportMenuButton onExportXlsx={handleExportXlsx} onExportPdf={handleExportPdf} />
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">EARNINGS QUALITY {hasLiveData ? "(REAL FILED DATA)" : "(MANUAL ENTRY)"}</span>
          <OverrideStatusBadge count={curOv.overrideCount + priorOv.overrideCount} onResetAll={() => { curOv.resetAll(); priorOv.resetAll(); }} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
          <div className="border border-border/50 p-2">
            <FormulaTooltip formula="[(ΔCurrentAssets − ΔCash) − (ΔCurrentLiabilities − ΔShortTermDebt) − D&A] / Average Total Assets">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">SLOAN ACCRUAL RATIO</div>
            </FormulaTooltip>
            <div className={`font-terminal text-lg font-bold ${sloan.flagged ? "text-[hsl(0,80%,55%)]" : "text-[hsl(142,71%,55%)]"}`}>{(sloan.accrualRatio * 100).toFixed(1)}%</div>
            <div className="font-terminal text-[7px] text-muted-foreground">{sloan.flagged ? "FLAGGED (|ratio| > 10%)" : "within normal range"}</div>
          </div>
          <div className="border border-border/50 p-2">
            <FormulaTooltip formula="Operating Cash Flow / Net Income">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">CASH EARNINGS QUALITY</div>
            </FormulaTooltip>
            <div className="font-terminal text-lg font-bold text-foreground">{Number.isFinite(cashEQ.ratio) ? cashEQ.ratio.toFixed(2) + "x" : "N/A"}</div>
            <div className="font-terminal text-[7px] text-muted-foreground uppercase">{cashEQ.quality}</div>
          </div>
          <div className="border border-border/50 p-2">
            <FormulaTooltip formula="(Revenue − ΔNet Receivables) / Revenue">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">REVENUE QUALITY</div>
            </FormulaTooltip>
            <div className="font-terminal text-lg font-bold text-foreground">{(revQuality.cashConversionRatio * 100).toFixed(1)}%</div>
            <div className="font-terminal text-[7px] text-muted-foreground uppercase">{revQuality.quality}</div>
          </div>
          <div className="border border-border/50 p-2">
            <FormulaTooltip formula="1 − |Accruals / Net Income| — single-period proxy, see model notes">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">EARNINGS PERSISTENCE</div>
            </FormulaTooltip>
            <div className="font-terminal text-lg font-bold text-foreground">{(persistence.persistenceScore * 100).toFixed(0)}%</div>
            <div className="font-terminal text-[7px] text-muted-foreground uppercase">{persistence.label}</div>
          </div>
        </div>

        {!hasLiveData && (
          <p className="font-terminal text-[7px] text-muted-foreground mt-2">Needs 2 years of filed balance/income/cash-flow data — not fully available for {symbol}. Type the raw figures below to compute real ratios.</p>
        )}

        <div className="mt-3 border-t border-border/30 grid grid-cols-2 gap-x-3">
          <div>
            <div className="font-terminal text-[7px] tracking-widest text-muted-foreground py-1">CURRENT YEAR</div>
            <MoneyFieldGrid ov={curOv} values={curInputs} fields={[...BAL_FIELDS, ...CUR_ONLY_FIELDS]} curr={curr} />
          </div>
          <div>
            <div className="font-terminal text-[7px] tracking-widest text-muted-foreground py-1">PRIOR YEAR</div>
            <MoneyFieldGrid ov={priorOv} values={priorInputs} fields={BAL_FIELDS} curr={curr} />
          </div>
        </div>
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">COMPOSITE FINANCIAL DISTRESS INDICATOR</span>
        </div>
        <FormulaTooltip formula="30%·Altman zone + 30%·Ohlson P(bankruptcy) + 20%·(1 − Piotroski/9) + 20%·Beneish flag">
          <span className={`font-terminal text-3xl font-bold ${riskColor}`}>{composite.score.toFixed(0)} / 100</span>
        </FormulaTooltip>
        <div className={`font-terminal text-[9px] mt-1 uppercase ${riskColor}`}>{composite.label}</div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-1 font-terminal text-[7px] text-muted-foreground">
          {composite.components.map(c => (
            <div key={c.label} className="border border-border/50 p-1.5 text-center">
              <div>{c.label}</div>
              <div className="text-foreground font-bold">{c.contribution.toFixed(1)}</div>
            </div>
          ))}
        </div>
      </div>

      <ModelConsensus
        title="Model Consensus — Financial Distress"
        question={`Do these four independent bankruptcy/distress models agree on ${symbol}'s financial health?`}
        methods={consensusMethods}
      />
      <div className="border border-border bg-[#080808] p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-terminal text-[9px] tracking-widest text-[hsl(38,95%,55%)]">CANONICAL MERTON STRUCTURAL CREDIT MODEL</span><button type="button" disabled={!mertonParameters || mertonRunning} onClick={runCanonicalMerton} className="border border-[hsl(38,95%,50%)] px-2 py-1 font-terminal text-[8px] text-[hsl(38,95%,55%)] disabled:opacity-40">{mertonRunning ? "RUNNING…" : "RUN RECEIPTED MODEL"}</button></div>
        <div className="font-terminal text-[7px] text-muted-foreground">Formal units: money (equity value, debt face value); percent (equity volatility, risk-free rate); years (maturity). Market/company values are classified MANUAL until an immutable provider snapshot is bound.</div>
        {!mertonParameters ? <div className="font-terminal text-[8px] text-amber-400">Unavailable: requires market capitalization, one-year OHLCV for volatility, a risk-free rate, and current/long-term debt.</div> : null}
        {mertonError ? <div className="font-terminal text-[8px] text-red-400">{mertonError}</div> : null}
        {advancedMerton ? <><div className="font-terminal text-[8px] text-muted-foreground">Canonical DD <b className="text-foreground">{advancedMerton.distanceToDefault.toFixed(2)}</b>; risk-neutral PD <b className="text-foreground">{advancedMerton.riskNeutralDefaultProbabilityPct.toFixed(2)}%</b>; legacy DD {merton?.distanceToDefault.toFixed(2) ?? "unavailable"}; equity repricing error {advancedMerton.equityRepricingError.toExponential(2)}.</div><AdvancedReceiptFooter receipt={advancedMerton.receipt} /></> : null}
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">RED FLAG DETECTION — TREND-BASED, FROM FILED MULTI-YEAR HISTORY</span>
          <span className={`font-terminal text-[9px] font-bold ${triggeredFlagCount > 0 ? "text-[hsl(0,80%,55%)]" : "text-[hsl(142,71%,55%)]"}`}>
            {triggeredFlagCount} / {redFlags.length} TRIGGERED
          </span>
        </div>
        {redFlagPeriods.length < 3 ? (
          <p className="font-terminal text-[8px] text-muted-foreground">Needs 3 years of filed history for the trend checks — not fully available for {symbol}.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {redFlags.map((f) => (
              <div key={f.key} className={`border p-2 flex items-start gap-2 ${f.triggered ? "border-[hsl(0,80%,55%)]/40 bg-[hsl(0,80%,50%)]/5" : "border-border/40"}`}>
                <span className={`font-terminal text-[10px] mt-0.5 ${f.triggered ? "text-[hsl(0,80%,55%)]" : "text-[hsl(142,71%,55%)]"}`}>{f.triggered ? "⚠" : "✓"}</span>
                <div>
                  <div className={`font-terminal text-[8px] font-bold ${f.triggered ? "text-foreground" : "text-muted-foreground"}`}>{f.label}</div>
                  <div className="font-terminal text-[7px] text-muted-foreground">{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="font-terminal text-[7px] text-muted-foreground/60 mt-2">
          Auditor Qualification and Accounting Policy Changes aren't included — both need real filing text (audit opinion language, footnote diffs), which isn't available from the current data sources.
        </p>
      </div>

      <div className="bg-[#080808] border border-border p-4 font-terminal text-[9px] text-muted-foreground space-y-1">
        <div className="text-foreground font-bold mb-1 tracking-widest">MODEL NOTES</div>
        <p>Sloan Accrual Ratio (1996): |ratio| above ~10% signals earnings skewed toward accruals rather than cash. Cash Earnings Quality is the standard CFO/NI ratio. Revenue Quality measures cash conversion of reported revenue via the change in net receivables. Earnings Persistence here is a single-period proxy grounded in the same accrual decomposition — a true multi-year persistence coefficient needs a time series, not two years for one company.</p>
        <p>The composite score is an explicit, documented weighting of the four models above (Altman/Ohlson/Piotroski/Beneish) — a judgment call, not itself an academically validated model. Reference scores here use straight filed-data defaults; adjust raw inputs on each model's own tab for a scenario override.</p>
        <p>Merton/KMV Distance-to-Default (shown in the Model Consensus panel above when a full year of price history and a live risk-free rate are available) is market-implied rather than statement-based — it reads the company's own share price and volatility, not its filings, so it's a genuinely independent check against the four models above. Its probability-of-default figure is the textbook normal-CDF value only, explicitly labeled as a theoretical lower bound: Moody's actual KMV methodology maps distance-to-default to realized default rates using a proprietary empirical calibration that runs materially higher than the normal-CDF at the same distance, because real asset returns have fatter tails than the model assumes. That proprietary mapping isn't public data, so it isn't reproduced here.</p>
      </div>
    </div>
  );
}
