import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuote, useQuoteStatic, useFundamentals, useOHLCV } from "@/lib/useFinance";
import { apiRequest } from "@/lib/queryClient";
import { useLseFinancials } from "@/lib/useLse";
import { getCurrencySymbol, formatPrice } from "@/lib/finance";
import { Building2, Layers, RefreshCw, Download, Calculator, Percent, X, Gauge } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import {
  altmanZScore, piotroskiFScore, olsRegression,
  type AltmanZResult, type AltmanZInputs,
  type PiotroskiResult, type PiotroskiYearInputs,
} from "@/lib/quantModels";
import { EditableValue, OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { ExportButton } from "@/components/panels/ExportButton";
import { exportWorkbook } from "@/lib/exportXlsx";
import { useOverridable } from "@/lib/useOverridable";
import { useRiskFreeRate } from "@/lib/useEconomics";
import { useFamaFrench3, useCarhart4, useFamaFrench5 } from "@/lib/useFamaFrench";
import { CustomLineItemBuilder, type RefOption } from "@/components/panels/CustomLineItemBuilder";
import { useCustomLineItems, evaluateCustomItem, builtinRef, customRef } from "@/lib/customLineItems";
import {
  computeWacc, unleverBeta, leverBeta, computeNetDebt, terminalValue, fcfeFromFcff, evToEquityBridge, runLboModel, applyCarryWaterfall,
  syntheticCreditRating, factorCostOfEquity,
  type TerminalValueMethod, type LboTranche,
} from "@/lib/valuationModels";
import { type ValuationMethodResult } from "@/lib/valuationEngines";
import { buildTwoStageDcfSobolExpression } from "@/lib/globalSearchModels";
import { useDamodaranIndustryLookup } from "@/lib/useDamodaran";
import { useAudience } from "@/lib/audience";
import ChallengeAssumption from "@/components/quant/ChallengeAssumption";
import type { FullBalanceSheetData, FullIncomeData, FullCashflowData } from "./valuation/types";
import RatiosTab from "./valuation/RatiosTab";
import DDMTab, { type DDMResultSummary } from "./valuation/DDMTab";
import BeneishTab from "./valuation/BeneishTab";
import OhlsonTab from "./valuation/OhlsonTab";
import EarningsQualityTab from "./valuation/EarningsQualityTab";
import CompsTab from "./valuation/CompsTab";
import ResidualIncomeTab from "./valuation/ResidualIncomeTab";
import EvaTab from "./valuation/EvaTab";
import ReverseDcfTab from "./valuation/ReverseDcfTab";
import ModelAgreementTab from "./valuation/ModelAgreementTab";
import AssetValueTab from "./valuation/AssetValueTab";
import { buildCompanyFinancialObservations } from "@/lib/financeObservations";
import { buildFinancialAnalyticalContext, contextMetric } from "@shared/financialAnalyticalContext";
import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";
import {
  SnapshotProvenanceStatus,
  sourceBindingForSnapshot,
  resolveProvenanceStatus,
  type SourceSnapshot,
} from "./SourceBoundValuationPortfolio";
import { buildFinancialAnalysis, type FinancialMetric, type FinancialStatementBundle } from "@shared/financialAnalysis";
import { buildEstimateIntelligence, estimateIntelligenceDisplayValue } from "@/lib/EstimateIntelligenceAdapter";

type BalanceSheetData = FullBalanceSheetData;
type IncomeData = FullIncomeData;
interface RatiosData { grossProfitMargin: number; assetTurnover: number }
type CashflowData = FullCashflowData;
interface FinancialSnapshotView extends SourceSnapshot {
  publishedAt: string | null;
  retrievedAt: string;
  lineage: Record<string, unknown>;
  payload: { periods: Array<{ fiscalYear: string; period: string; periodEnd: string; segments: Record<string, number>; geographies: Record<string, number> }> };
}
interface EstimateSnapshotView extends SourceSnapshot {
  publishedAt: string | null;
  retrievedAt: string;
  lineage?: Record<string, unknown>;
  payload: {
    observations: Array<{
      symbol?: string;
      metric: string;
      fiscalPeriod: string;
      periodEnd: string | null;
      contributor: string;
      value: number;
      low: number | null;
      high: number | null;
      currency: string | null;
      unit: string;
      publishedAt: string;
      availableAt: string;
      sourceUrl: string | null;
    }>;
    actuals?: Array<{
      metric: string;
      fiscalPeriod: string;
      periodEnd: string | null;
      value: number;
      reportedAt: string;
      availableAt: string;
      unit?: string;
      currency?: string | null;
      sourceReference?: string | null;
      status?: "live" | "filed" | "estimate" | "derived" | "manual" | "imported" | "missing" | "stale" | "conflict" | "not-applicable";
    }>;
  };
}


type MarketSnapshotView = SourceSnapshot & {
  payload: { symbol: string; bars: Array<{ date: string; close: number }> };
};
function parseLatestTwoYears<T>(reports: { fiscal_year: string; data: string }[] | undefined): [T | null, T | null] {
  if (!reports?.length) return [null, null];
  const sorted = [...reports].sort((a, b) => b.fiscal_year.localeCompare(a.fiscal_year));
  const parse = (r?: { data: string }) => { try { return r ? (JSON.parse(r.data) as T) : null; } catch { return null; } };
  return [parse(sorted[0]), parse(sorted[1])];
}

interface Props { symbol: string; }

// ── Types ────────────────────────────────────────────────────────
interface YearRow {
  revenueGrowth: number;   // %
  ebitdaMargin: number;    // %
  daPercent: number;       // D&A as % of revenue
  taxRate: number;         // %
  capexPercent: number;    // CapEx as % of revenue
  nwcChangePercent: number;// Change in NWC as % of revenue (positive = cash outflow)
}

interface WACCInputs {
  riskFreeRate: number;   // %
  erp: number;            // Equity Risk Premium %
  beta: number;
  costOfDebt: number;     // % pre-tax
  debtWeight: number;     // % of total capital
  taxRate: number;        // % for debt shield
  sizePremium: number;        // % small-cap build-up add-on
  countryRiskPremium: number; // % sovereign/political risk add-on
  industryPremium: number;    // % sector-specific add-on
}

const YEARS = 10;

const DEFAULT_YEAR_ROW: YearRow = {
  revenueGrowth: 12, ebitdaMargin: 22, daPercent: 4,
  taxRate: 25, capexPercent: 5, nwcChangePercent: 1.5,
};

const DEFAULT_WACC: WACCInputs = {
  riskFreeRate: 4.2, erp: 5.5, beta: 1.1,
  costOfDebt: 6.5, debtWeight: 25, taxRate: 25,
  sizePremium: 0, countryRiskPremium: 0, industryPremium: 0,
};

// ── Format helpers ────────────────────────────────────────────────
function fB(n: number, curr: string) {
  const absN = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (absN >= 1e12) return `${sign}${curr}${(absN / 1e12).toFixed(2)}T`;
  if (absN >= 1e9)  return `${sign}${curr}${(absN / 1e9).toFixed(2)}B`;
  if (absN >= 1e6)  return `${sign}${curr}${(absN / 1e6).toFixed(1)}M`;
  return `${sign}${curr}${absN.toFixed(0)}`;
}

function formatSharedMetric(metric: FinancialMetric | undefined, curr: string) {
  if (!metric || metric.value === null) return "—";
  if (metric.unit === "percent") return `${(metric.value * 100).toFixed(1)}%`;
  if (metric.unit === "ratio") return `${metric.value.toFixed(2)}x`;
  if (metric.unit === "days") return `${metric.value.toFixed(0)}d`;
  if (metric.unit === "turnover") return `${metric.value.toFixed(2)}x`;
  return fB(metric.value, curr);
}

// ── Piotroski year editor -- 9 raw inputs (7 monetary, in millions for
// typing convenience, + 2 unitless ratios), reused for the current and
// prior fiscal year so both can be typed in when filed data is missing. ──
type OverridableOf<K extends string> = ReturnType<typeof useOverridable<K>>;

const PIOTROSKI_MONEY_FIELDS: Array<{ key: keyof PiotroskiYearInputs; label: string }> = [
  { key: "netIncome", label: "NET INCOME" },
  { key: "totalAssets", label: "TOTAL ASSETS" },
  { key: "operatingCashFlow", label: "OPERATING CASH FLOW" },
  { key: "longTermDebt", label: "LONG-TERM DEBT" },
  { key: "totalCurrentAssets", label: "TOTAL CURRENT ASSETS" },
  { key: "totalCurrentLiabilities", label: "TOTAL CURRENT LIABILITIES" },
  { key: "netCommonStockIssuance", label: "NET STOCK ISSUANCE" },
];
const PIOTROSKI_RATIO_FIELDS: Array<{ key: keyof PiotroskiYearInputs; label: string }> = [
  { key: "grossProfitMargin", label: "GROSS PROFIT MARGIN" },
  { key: "assetTurnover", label: "ASSET TURNOVER" },
];

function PiotroskiYearEditor({ ov, inputs, curr }: {
  ov: OverridableOf<keyof PiotroskiYearInputs>; inputs: PiotroskiYearInputs; curr: string;
}) {
  return (
    <div>
      {PIOTROSKI_MONEY_FIELDS.map(f => (
        <EditableValue
          key={f.key} variant="field" label={f.label} decimals={1} suffix="M" prefix={curr}
          value={inputs[f.key] / 1e6}
          isOverridden={ov.isOverridden(f.key)}
          onReset={() => ov.resetOverride(f.key)}
          onChange={v => ov.setOverride(f.key, v * 1e6)}
        />
      ))}
      {PIOTROSKI_RATIO_FIELDS.map(f => (
        <EditableValue
          key={f.key} variant="field" label={f.label} decimals={4}
          value={inputs[f.key]}
          isOverridden={ov.isOverridden(f.key)}
          onReset={() => ov.resetOverride(f.key)}
          onChange={v => ov.setOverride(f.key, v)}
        />
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────
function ValuationPanel({ symbol }: Props) {
  const terminal = useTerminalArtifactContext();
  const initializedSymbol = useRef(symbol);
  const isInternal = useAudience() === "internal";
  const { data: quote, isLoading } = useQuote(symbol);
  const { data: quoteStatic } = useQuoteStatic(symbol);
  // Live fallback for market cap/P/E/EPS -- the static reference catalog and
  // the plain quote both only cover a small hand-curated symbol list, so
  // every valuation number downstream (DCF revenue base, share count,
  // Altman Z-score, comps) was silently falling back to a fake $50B market
  // cap assumption for the vast majority of the 57k-ticker universe.
  const { data: fundamentals } = useFundamentals(symbol);
  const { data: balanceReports } = useLseFinancials(symbol, "balance");
  const { data: incomeReports } = useLseFinancials(symbol, "income");
  const { data: ratiosReports } = useLseFinancials(symbol, "ratios");
  const { data: cashflowReports } = useLseFinancials(symbol, "cashflow");
  const { data: financeOverrides = [] } = useQuery<FinancialMetricObservation[]>({
    queryKey: ["/api/finance/metric-overrides", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/finance/metric-overrides?symbol=${encodeURIComponent(symbol)}`)).json() as Promise<FinancialMetricObservation[]>,
    staleTime: 30_000,
    retry: false,
  });
  const financialAsOf = useMemo(() => new Date().toISOString(), [symbol]);
  const { data: financialSnapshot } = useQuery<FinancialSnapshotView>({
    queryKey: ["/api/data-snapshots/financials/as-of", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/data-snapshots/financials/${encodeURIComponent(symbol)}/as-of?asOf=${encodeURIComponent(financialAsOf)}`)).json() as Promise<FinancialSnapshotView>,
    enabled: Boolean(symbol),
    retry: false,
    staleTime: 60_000,
  });
  const { data: estimateSnapshot } = useQuery<EstimateSnapshotView>({
    queryKey: ["/api/alternative-data/estimates/as-of", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/alternative-data/estimates/${encodeURIComponent(symbol)}/as-of?asOf=${encodeURIComponent(financialAsOf)}`)).json() as Promise<EstimateSnapshotView>,
    enabled: Boolean(symbol),
    retry: false,
    staleTime: 60_000,
  });
  const { data: marketSnapshot } = useQuery<MarketSnapshotView>({
    queryKey: ["/api/data-snapshots/markets/as-of", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/data-snapshots/markets/${encodeURIComponent(symbol)}/as-of?asOf=${encodeURIComponent(financialAsOf)}`)).json() as Promise<MarketSnapshotView>,
    enabled: Boolean(symbol),
    retry: false,
    staleTime: 60_000,
  });
  const queryClient = useQueryClient();
  const [useLatestSnapshot, setUseLatestSnapshot] = useState(true);
  const captureSnapshots = useMutation({
    mutationFn: async () => {
      const requests = [
        apiRequest("POST", `/api/data-snapshots/financials/${encodeURIComponent(symbol)}`, {}),
        apiRequest("POST", `/api/data-snapshots/markets/${encodeURIComponent(symbol)}`, { range: "5Y" }),
        apiRequest("POST", `/api/alternative-data/estimates/${encodeURIComponent(symbol)}/capture`, {}),
      ];
      const results = await Promise.allSettled(requests);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length === results.length) throw new Error("No valuation dataset snapshot could be captured.");
      return results;
    },
    onSuccess: async () => {
      setUseLatestSnapshot(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/data-snapshots/financials/as-of", symbol] }),
        queryClient.invalidateQueries({ queryKey: ["/api/data-snapshots/markets/as-of", symbol] }),
        queryClient.invalidateQueries({ queryKey: ["/api/alternative-data/estimates/as-of", symbol] }),
      ]);
    },
  });
  const [showAllProviderData, setShowAllProviderData] = useTerminalArtifactState("ValuationPanel.showAllProviderData", false);
  const valuationSnapshotRefs = [
    financialSnapshot ? { ...financialSnapshot, entityKey: "financial" } : null,
    marketSnapshot ? { ...marketSnapshot, entityKey: "market" } : null,
  ].filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot));
  const estimateSnapshotRef = estimateSnapshot ? { ...estimateSnapshot, entityKey: "estimates" } as SourceSnapshot : null;
  const allValuationSnapshotRefs = [...valuationSnapshotRefs, ...(estimateSnapshotRef ? [estimateSnapshotRef] : [])];
  const universalContext = useMemo(() => {
    const providerObservations = buildCompanyFinancialObservations({ incomeReports, balanceReports, cashflowReports });
    return buildFinancialAnalyticalContext({ symbol, observations: [...providerObservations, ...financeOverrides], metricIds: ["revenue", "ebitda", "fcf", "netDebt", "enterpriseValue", "evEbitda"] });
  }, [balanceReports, cashflowReports, financeOverrides, incomeReports, symbol]);
  const canonicalValue = (metricId: string, fallback: number): number => {
    const value = contextMetric(universalContext, metricId)?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  // Parsed early (rather than alongside the other statements below) because
  // the WACC/DCF section needs real net debt before it can build the worksheet,
  // and the synthetic-rating cost-of-debt and EVA tabs need real income/
  // balance-sheet figures before the WACC builder / EVA tab render below.
  const [balCurrent, balPrior] = parseLatestTwoYears<BalanceSheetData>(balanceReports);
  const [incCurrent, incPrior] = parseLatestTwoYears<IncomeData>(incomeReports);
  const [ratCurrent, ratPrior] = parseLatestTwoYears<RatiosData>(ratiosReports);
  const [cfCurrent, cfPrior] = parseLatestTwoYears<CashflowData>(cashflowReports);
  const [activeTab, setActiveTab] = useTerminalArtifactState<"fcf_worksheet" | "lbo" | "dupont" | "ratios" | "ddm" | "beneish" | "ohlson" | "comps" | "earnings_quality" |
    "residual_income" | "eva" | "reverse_dcf" | "asset_value" | "model_agreement" | "provider_data" | "estimate_intelligence">("ValuationPanel.activeTab", "fcf_worksheet");

  // Per-year editable rows for Years 1–10
  const [rows, setRows] = useTerminalArtifactState<YearRow[]>("ValuationPanel.rows", () => Array(YEARS).fill(null).map(() => ({ ...DEFAULT_YEAR_ROW })));

  // Custom FCF adjustment lines -- real models almost always need bespoke
  // lines the fixed 6 assumption rows don't cover (stock-based comp
  // addback, one-time restructuring charge, a segment revenue breakdown).
  // Each is evaluated per year, referencing that year's own assumption
  // inputs or computed outputs (or another custom line), and its total is
  // added straight into that year's Free Cash Flow -- see the `worksheet`
  // useMemo below and client/src/lib/customLineItems.ts.
  const dcfCustomItems = useCustomLineItems("ValuationPanel.dcfCustomItems");
  const dcfAvailableRefs: RefOption[] = [
    { ref: builtinRef("revenueGrowth"), label: "Revenue Growth %" },
    { ref: builtinRef("ebitdaMargin"), label: "EBITDA Margin %" },
    { ref: builtinRef("daPercent"), label: "D&A % of Revenue" },
    { ref: builtinRef("taxRate"), label: "Tax Rate %" },
    { ref: builtinRef("capexPercent"), label: "CapEx % of Revenue" },
    { ref: builtinRef("nwcChangePercent"), label: "ΔNWC % of Revenue" },
    { ref: builtinRef("revenue"), label: "Revenue" },
    { ref: builtinRef("ebitda"), label: "EBITDA" },
    { ref: builtinRef("da"), label: "D&A" },
    { ref: builtinRef("ebit"), label: "EBIT" },
    { ref: builtinRef("nopat"), label: "NOPAT" },
    { ref: builtinRef("capex"), label: "CapEx" },
    { ref: builtinRef("nwcChange"), label: "ΔNWC" },
    { ref: builtinRef("fcf"), label: "Free Cash Flow (pre-adjustment)" },
    ...dcfCustomItems.items.map(it => ({ ref: customRef(it.id), label: it.label })),
  ];
  // WACC builder -- overridable: starts from sensible defaults, tracks which
  // fields the user has actually typed in, and can switch to fully observed
  // factor/rating alternatives when their underlying data is present.
  const waccOv = useOverridable<keyof WACCInputs>("ValuationPanel.waccOv");
  const [equityCostMethod, setEquityCostMethod] = useTerminalArtifactState<"capm" | "ff3" | "carhart4" | "ff5">("ValuationPanel.equityCostMethod", "capm");
  const [debtCostMethod, setDebtCostMethod] = useTerminalArtifactState<"manual" | "synthetic">("ValuationPanel.debtCostMethod", "manual");
  const liveRiskFreeRate = useRiskFreeRate();
  const riskFreeRateBaseline = liveRiskFreeRate.isLive && liveRiskFreeRate.ratePercent !== null
    ? liveRiskFreeRate.ratePercent
    : DEFAULT_WACC.riskFreeRate;

  // Match actual daily stock returns to the official Fama-French 3-factor
  // observations. No factor premium is invented: until at least 10 matching
  // trading days exist, the factor alternative remains unavailable.
  const { data: factorPriceSeries } = useOHLCV(symbol, "2Y", "1d");
  const factorBars = factorPriceSeries?.bars ?? [];
  const factorStart = factorBars[0]?.date ?? "";
  const factorEnd = factorBars[factorBars.length - 1]?.date ?? "";
  const { data: factorRows = [] } = useFamaFrench3(factorStart, factorEnd);
  const { data: carhartRows = [] } = useCarhart4(factorStart, factorEnd);
  const { data: factor5Rows = [] } = useFamaFrench5(factorStart, factorEnd);
  const factorModels = useMemo(() => {
    type Row = { date: string; RF: number; MktRF: number; SMB: number; HML: number; Mom?: number; RMW?: number; CMA?: number };
    const build = (rows: Row[], keys: Array<keyof Row>) => {
      const byDate = new Map(rows.map(row => [row.date, row]));
      const matched = factorBars.slice(1).flatMap((bar, index) => {
        const previous = factorBars[index].close;
        if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(bar.close)) return [];
        const row = byDate.get(bar.date);
        if (!row) return [];
        const factors = keys.map(key => row[key]);
        return factors.every(value => typeof value === "number" && Number.isFinite(value)) && Number.isFinite(row.RF)
          ? [{ excessReturn: ((bar.close - previous) / previous) * 100 - row.RF, factors: factors as number[] }]
          : [];
      });
      if (matched.length < 10) return null;
      const regression = olsRegression(
        matched.map(item => item.excessReturn),
        keys.map((_, index) => matched.map(item => item.factors[index])),
      );
      const annualizedPremia = keys.map((_, index) =>
        matched.reduce((sum, item) => sum + item.factors[index], 0) / matched.length * 252,
      );
      const rf = waccOv.getValue("riskFreeRate", riskFreeRateBaseline);
      const result = factorCostOfEquity({ riskFreeRate: rf, factorLoadings: regression.betas, factorPremia: annualizedPremia });
      return { ...result, observations: matched.length, rSquared: regression.rSquared };
    };
    return {
      ff3: build(factorRows, ["MktRF", "SMB", "HML"]),
      carhart4: build(carhartRows, ["MktRF", "SMB", "HML", "Mom"]),
      ff5: build(factor5Rows, ["MktRF", "SMB", "HML", "RMW", "CMA"]),
    };
  }, [factorBars, factorRows, carhartRows, factor5Rows, riskFreeRateBaseline, waccOv.getValue]);
  const selectedFactorResult = equityCostMethod === "capm" ? null : factorModels[equityCostMethod];

  const manualCostOfDebt = waccOv.getValue("costOfDebt", DEFAULT_WACC.costOfDebt);
  const syntheticCoverage = useMemo(() => {
    if (!incCurrent || !Number.isFinite(incCurrent.interestExpense) || incCurrent.interestExpense === 0) return null;
    const coverage = incCurrent.ebit / Math.abs(incCurrent.interestExpense);
    return Number.isFinite(coverage) ? coverage : null;
  }, [incCurrent]);
  const syntheticRating = useMemo(() => syntheticCoverage === null
    ? null
    : syntheticCreditRating(syntheticCoverage, waccOv.getValue("riskFreeRate", riskFreeRateBaseline)), [riskFreeRateBaseline, syntheticCoverage, waccOv.getValue]);
  const selectedCostOfDebt = debtCostMethod === "synthetic" && syntheticRating
    ? syntheticRating.costOfDebt
    : manualCostOfDebt;
  const waccInputs: WACCInputs = {
    riskFreeRate: waccOv.getValue("riskFreeRate", riskFreeRateBaseline),
    erp: waccOv.getValue("erp", DEFAULT_WACC.erp),
    beta: waccOv.getValue("beta", DEFAULT_WACC.beta),
    costOfDebt: selectedCostOfDebt,
    debtWeight: waccOv.getValue("debtWeight", DEFAULT_WACC.debtWeight),
    taxRate: waccOv.getValue("taxRate", DEFAULT_WACC.taxRate),
    sizePremium: waccOv.getValue("sizePremium", DEFAULT_WACC.sizePremium),
    countryRiskPremium: waccOv.getValue("countryRiskPremium", DEFAULT_WACC.countryRiskPremium),
    industryPremium: waccOv.getValue("industryPremium", DEFAULT_WACC.industryPremium),
  };

  // Damodaran industry beta lookup -- a manual trigger (button, not
  // fetch-on-keystroke) since the industry name has to match well enough
  // for the server's fuzzy lookup, and firing a request per keystroke
  // against an unmatched partial name would just be noise.
  const [industryQuery, setIndustryQuery] = useTerminalArtifactState("ValuationPanel.industryQuery", "");
  const [industryLookupArmed, setIndustryLookupArmed] = useTerminalArtifactState("ValuationPanel.industryLookupArmed", false);
  const damodaranLookup = useDamodaranIndustryLookup(industryQuery, industryLookupArmed);

  // Terminal-value assumptions shared by the DCF worksheet and advanced tabs.
  const [termGrowth, setTermGrowth] = useTerminalArtifactState("ValuationPanel.termGrowth", 2.5);
  const [tvMethod, setTvMethod] = useTerminalArtifactState<TerminalValueMethod>("ValuationPanel.tvMethod", "gordon");
  const [exitMultiple, setExitMultiple] = useTerminalArtifactState("ValuationPanel.exitMultiple", 10);
  const [hybridWeight, setHybridWeight] = useTerminalArtifactState("ValuationPanel.hybridWeight", 50);
  const [fadeStartGrowth, setFadeStartGrowth] = useTerminalArtifactState("ValuationPanel.fadeStartGrowth", 12);
  const [fadeYears, setFadeYears] = useTerminalArtifactState("ValuationPanel.fadeYears", 5);

  // Cash flow basis -- FCFF discounts at WACC and needs the full EV->equity
  // bridge below; FCFE discounts at cost of equity and already nets out debt
  // financing flows, so it lands on equity value directly.
  const [cashFlowMode, setCashFlowMode] = useTerminalArtifactState<"fcff" | "fcfe">("ValuationPanel.cashFlowMode", "fcff");
  const [fcfeNetBorrowingPct, setFcfeNetBorrowingPct] = useTerminalArtifactState("ValuationPanel.fcfeNetBorrowingPct", 0);
  // Capital structure
  const [netDebtOverride, setNetDebtOverride] = useTerminalArtifactState("ValuationPanel.netDebtOverride", "");
  const [sharesOverride, setSharesOverride] = useTerminalArtifactState("ValuationPanel.sharesOverride", "");

  // Y0 Revenue
  const [y0RevOverride, setY0RevOverride] = useTerminalArtifactState("ValuationPanel.y0RevOverride", "");


  // EV -> equity bridge adjustments beyond net debt -- no live data source for
  // these yet, so they're manual-entry (default 0) like the rest of this
  // panel's overridable fields rather than a fabricated number.
  const bridgeOv = useOverridable<"preferredEquity" | "minorityInterest" | "pensionLiabilities" | "leaseAdjustments" | "nonOperatingAssets" | "jointVentureStakes">("ValuationPanel.bridgeOv");
  const bridgeInputs = {
    preferredEquity: bridgeOv.getValue("preferredEquity", 0),
    minorityInterest: bridgeOv.getValue("minorityInterest", 0),
    pensionLiabilities: bridgeOv.getValue("pensionLiabilities", 0),
    leaseAdjustments: bridgeOv.getValue("leaseAdjustments", 0),
    nonOperatingAssets: bridgeOv.getValue("nonOperatingAssets", 0),
    jointVentureStakes: bridgeOv.getValue("jointVentureStakes", 0),
  };

  useEffect(() => {
    if (terminal && initializedSymbol.current === symbol) return;
    initializedSymbol.current = symbol;
    setY0RevOverride("");
    setNetDebtOverride("");
    setSharesOverride("");
    setUseLatestSnapshot(true);
    setEquityCostMethod("capm");
    setDebtCostMethod("manual");
    setDdmSummary(null);
    setResidualIncomeValue(null);
    setEvaValue(null);
    setAssetValue(null);
    setCompsMethods([]);
  }, [symbol]);

  const curr = getCurrencySymbol(symbol);
  const spot = quote?.price ?? 100;

  const marketCap = quoteStatic?.marketCap ?? quote?.marketCap ?? fundamentals?.marketCap ?? undefined;
  const pe = quote?.pe ?? fundamentals?.trailingPE ?? null;
  const eps = quote?.eps ?? fundamentals?.trailingEps ?? null;

  const defaultBaseRevenue = useMemo(() => {
    const canonicalRevenue = contextMetric(universalContext, "revenue")?.value;
    if (typeof canonicalRevenue === "number" && Number.isFinite(canonicalRevenue) && canonicalRevenue > 0) return canonicalRevenue;
    if (quote?.revenue) return quote.revenue;
    if (fundamentals?.totalRevenue) return fundamentals.totalRevenue;
    const cap = marketCap ?? 50_000_000_000;
    const ps = pe ? Math.max(1, pe / 6) : 4;
    return cap / ps;
  }, [fundamentals, marketCap, pe, quote, universalContext]);

  const baseRevenue = useMemo(() => {
    const ov = parseFloat(y0RevOverride);
    return !isNaN(ov) && ov > 0 ? ov * 1e9 : defaultBaseRevenue;
  }, [y0RevOverride, defaultBaseRevenue]);

  const sharesOut = useMemo(() => {
    const ov = parseFloat(sharesOverride);
    if (!isNaN(ov) && ov > 0) return ov * 1e6;
    return (marketCap ?? 50_000_000_000) / spot;
  }, [marketCap, spot, sharesOverride]);

  // Computed WACC + cost of equity from builder
  const waccResult = useMemo(() => {
    const base = computeWacc(waccInputs);
    const selectedCostOfEquity = equityCostMethod !== "capm" && selectedFactorResult
      ? selectedFactorResult.costOfEquity
      : base.costOfEquity;
    const equityWeight = 100 - waccInputs.debtWeight;
    const wacc = (selectedCostOfEquity * equityWeight + base.costOfDebtAfterTax * waccInputs.debtWeight) / 100;
    return { ...base, costOfEquity: selectedCostOfEquity, wacc };
  }, [equityCostMethod, selectedFactorResult, waccInputs]);
  const computedWACC = waccResult.wacc;
  const costOfEquity = waccResult.costOfEquity;

  // Real net debt from the filed balance sheet (short-term + long-term debt
  // less cash) when available; falls back to the old market-cap heuristic
  // only when there's no filed balance sheet to draw from.
  const realNetDebt = useMemo(() => {
    const canonicalNetDebt = contextMetric(universalContext, "netDebt")?.value;
    if (typeof canonicalNetDebt === "number" && Number.isFinite(canonicalNetDebt)) return canonicalNetDebt;
    if (!balCurrent) return null;
    return computeNetDebt(balCurrent.shortTermDebt, balCurrent.longTermDebt, balCurrent.cashAndCashEquivalents);
  }, [balCurrent, universalContext]);

  const statementAnalysis = useMemo(() => {
    const byPeriod = new Map<string, FinancialStatementBundle>();
    const mergeReports = (reports: typeof incomeReports | undefined, statement: "income" | "balance" | "cashflow") => {
      for (const report of reports ?? []) {
        const key = `${report.fiscal_year}:${report.period}`;
        let parsed: Record<string, number> = {};
        try { parsed = JSON.parse(report.data); } catch { parsed = {}; }
        const existing = byPeriod.get(key) ?? { fiscalYear: report.fiscal_year, period: report.period, periodEnd: report.date, currency: report.reported_currency, source: report.data_source };
        byPeriod.set(key, { ...existing, [statement]: parsed });
      }
    };
    mergeReports(incomeReports, "income");
    mergeReports(balanceReports, "balance");
    mergeReports(cashflowReports, "cashflow");
    return buildFinancialAnalysis(Array.from(byPeriod.values()).slice(0, 5));
  }, [incomeReports, balanceReports, cashflowReports]);
  const latestStatementMetrics = statementAnalysis[0]?.metrics ?? [];
  const statementMetricByKey = (key: string) => latestStatementMetrics.find((metric) => metric.key === key);
  // Real invested capital for value-driver/EVA methods. No market-cap or
  // heuristic substitute is used: without a filed equity/debt/cash bridge,
  // those methods report insufficient data rather than a fabricated ROIC.
  const currentInvestedCapital = useMemo(() => {
    if (!balCurrent) return null;
    const value = balCurrent.shortTermDebt + balCurrent.longTermDebt
      + balCurrent.totalStockholdersEquity - balCurrent.cashAndCashEquivalents;
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [balCurrent]);
  const currentFiledTaxRate = useMemo(() => {
    if (!incCurrent || !Number.isFinite(incCurrent.incomeBeforeTax) || incCurrent.incomeBeforeTax === 0) return null;
    const rate = incCurrent.incomeTaxExpense / incCurrent.incomeBeforeTax;
    return Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : null;
  }, [incCurrent]);
  const currentNopat = incCurrent
    ? incCurrent.ebit * (1 - (currentFiledTaxRate ?? waccInputs.taxRate / 100))
    : null;


  // ── FCF Worksheet Model ───────────────────────────────────────────
  // Extracted so "Challenge This Assumption" (Consultant Copilot, reframed)
  // can recompute the exact same worksheet at a shifted revenue-growth
  // assumption -- the "quant engine tests the alternatives" half of that
  // mechanism, reusing this real calculation rather than a parallel one.
  // growthDeltaPp=0 reproduces the unmodified worksheet below.
  const computeDcfWorksheet = useCallback((growthDeltaPp: number) => {
    const isFcfe = cashFlowMode === "fcfe";
    const discountPct = isFcfe ? costOfEquity : computedWACC;
    const discount = discountPct / 100;

    const ndOv = parseFloat(netDebtOverride);
    const netDebt = !isNaN(ndOv) ? ndOv * 1e9 : (realNetDebt ?? (marketCap ?? 50_000_000_000) * 0.15);

    let revenue = baseRevenue;
    let sumPvFcf = 0;
    let runningNetDebt = netDebt; // only advances in FCFE mode
    const projections = [];

    for (let i = 0; i < YEARS; i++) {
      const row = rows[i];
      const revenueGrowth = row.revenueGrowth + growthDeltaPp;
      revenue = revenue * (1 + revenueGrowth / 100);
      const ebitda    = revenue * row.ebitdaMargin / 100;
      const da        = revenue * row.daPercent / 100;
      const ebit      = ebitda - da;
      const nopat     = ebit * (1 - row.taxRate / 100);
      const capex     = revenue * row.capexPercent / 100;
      const nwcChange = revenue * row.nwcChangePercent / 100;
      const fcfBeforeAdjustments = nopat + da - capex - nwcChange;

      // Custom adjustment lines (SBC addback, one-time charges, etc.) --
      // each evaluated against THIS year's own assumption inputs/computed
      // outputs, then summed straight into Free Cash Flow.
      const yearValues: Record<string, number> = {
        revenueGrowth, ebitdaMargin: row.ebitdaMargin, daPercent: row.daPercent,
        taxRate: row.taxRate, capexPercent: row.capexPercent, nwcChangePercent: row.nwcChangePercent,
        revenue, ebitda, da, ebit, nopat, capex, nwcChange, fcf: fcfBeforeAdjustments,
      };
      const getYearBuiltin = (key: string, _periodIdx: number): number | null => (key in yearValues ? yearValues[key] : null);
      const adjustmentTotal = dcfCustomItems.items.reduce(
        (sum, item) => sum + (evaluateCustomItem(item, i, getYearBuiltin, dcfCustomItems.items) ?? 0),
        0,
      );
      const fcff = fcfBeforeAdjustments + adjustmentTotal;

      // FCFE = FCFF - after-tax interest on net debt + net new borrowing.
      // Interest is charged on the running net-debt balance (starting from
      // the real/override figure above), and net borrowing is a % of
      // revenue the user sets -- 0% means debt stays flat in dollar terms
      // while the business grows, i.e. leverage drifts down over the hold.
      let fcf = fcff;
      if (isFcfe) {
        const interestExpense = runningNetDebt * (waccInputs.costOfDebt / 100);
        const netBorrowing = revenue * (fcfeNetBorrowingPct / 100);
        fcf = fcfeFromFcff(fcff, interestExpense, waccInputs.taxRate, netBorrowing);
        runningNetDebt += netBorrowing;
      }

      const t         = i + 1;
      const pv        = fcf / Math.pow(1 + discount, t);
      sumPvFcf += pv;

      projections.push({ year: `Y${t}`, revenue, ebitda, da, ebit, nopat, capex, nwcChange, fcfBeforeAdjustments, adjustmentTotal, fcff, fcf, pv, cumPv: sumPvFcf });
    }

    const lastFcf    = projections[YEARS - 1].fcf;
    const lastEbitda  = projections[YEARS - 1].ebitda;
    const tv = terminalValue({
      method: tvMethod, lastFcf, lastEbitda, discountRate: discountPct,
      terminalGrowth: termGrowth, exitMultiple, hybridWeight,
      lastNopat: projections[YEARS - 1].nopat,
      roic: currentInvestedCapital && currentInvestedCapital > 0
        ? (projections[YEARS - 1].nopat / currentInvestedCapital) * 100
        : 0,
      fadeStartGrowth, fadeYears,
    });
    const pvTv = tv / Math.pow(1 + discount, YEARS);
    const ev = sumPvFcf + pvTv; // enterprise value (FCFF) or equity value (FCFE)
    // EV -> equity bridge. In FCFE mode net debt is already netted out of
    // the cash flows themselves, so it's excluded here to avoid double
    // counting -- the other claims (preferred equity, minority interest,
    // pension, leases) still apply either way since the simplified FCFE
    // build-up above doesn't model them.
    const bridge = evToEquityBridge({
      enterpriseValue: ev,
      netDebt: isFcfe ? 0 : netDebt,
      ...bridgeInputs,
    });

    const equityValue   = bridge.equityValue;
    const intrinsicPS   = sharesOut > 0 ? equityValue / sharesOut : spot;
    const upside        = ((intrinsicPS - spot) / spot) * 100;
    const tvPct         = ev > 0 ? (pvTv / ev) * 100 : 0;

    return { projections, sumPvFcf, tv, pvTv, ev, netDebt, equityValue, intrinsicPS, upside, tvPct };
  }, [
    rows, baseRevenue, computedWACC, costOfEquity, termGrowth, marketCap, sharesOut, spot, netDebtOverride,
    dcfCustomItems.items, cashFlowMode, fcfeNetBorrowingPct, waccInputs.costOfDebt, waccInputs.taxRate,
    currentInvestedCapital, fadeStartGrowth, fadeYears, tvMethod, exitMultiple, hybridWeight, realNetDebt, bridgeInputs,
  ]);

  const worksheet = useMemo(() => computeDcfWorksheet(0), [computeDcfWorksheet]);
  // Estimate intelligence is deliberately downstream of the existing
  // worksheet. Its model-derived comparison inputs are created only when a
  // filed fiscal year and reporting currency identify the scenario period;
  // otherwise estimates remain informational and the manual worksheet is
  // untouched.
  const estimateScenarioInputs = useMemo(() => {
    const latestIncomeReport = [...(incomeReports ?? [])].sort((left, right) => right.fiscal_year.localeCompare(left.fiscal_year))[0];
    const baseYear = Number.parseInt(latestIncomeReport?.fiscal_year ?? "", 10);
    const scenarioCurrency = latestIncomeReport?.reported_currency?.trim().toUpperCase() || null;
    if (!Number.isFinite(baseYear) || !scenarioCurrency) return [];
    return worksheet.projections.flatMap((projection, index) => {
      const fiscalPeriod = `FY${baseYear + index + 1}`;
      const common = {
        fiscalPeriod,
        currency: scenarioCurrency,
        status: "derived" as const,
        sourceReference: `model://valuation/${symbol}/dcf`,
      };
      return [
        { ...common, metric: "revenue", value: projection.revenue, unit: "currency" },
        { ...common, metric: "ebitda", value: projection.ebitda, unit: "currency" },
        { ...common, metric: "ebit", value: projection.ebit, unit: "currency" },
        { ...common, metric: "fcf", value: projection.fcf, unit: "currency" },
      ];
    });
  }, [incomeReports, symbol, worksheet.projections]);
  const estimateIntelligence = useMemo(() => buildEstimateIntelligence({
    symbol,
    snapshot: estimateSnapshot,
    scenarioInputs: estimateScenarioInputs,
  }), [estimateScenarioInputs, estimateSnapshot, symbol]);

  // "Challenge This Assumption" (Consultant Copilot, reframed, internal-only)
  // -- steps Year-1's revenue growth down by 5pp/10pp and recomputes the
  // real worksheet at each, per the roadmap's own example ("revenue grows
  // 15%... what happens at 10%/5%"). AI (ChallengeAssumption.tsx) only ever
  // sees these three already-computed results, never the raw model.
  const growthChallengeResults = useMemo(() => {
    const baseGrowth = rows[0]?.revenueGrowth ?? DEFAULT_YEAR_ROW.revenueGrowth;
    return [0, -5, -10].map((deltaPp) => {
      const w = computeDcfWorksheet(deltaPp);
      return {
        testedValue: `${(baseGrowth + deltaPp).toFixed(1)}%`,
        outputLabel: "Intrinsic Value / Share",
        outputValue: `${curr}${formatPrice(w.intrinsicPS)} (${w.upside >= 0 ? "+" : ""}${w.upside.toFixed(1)}%)`,
      };
    });
  }, [rows, computeDcfWorksheet, curr]);

  // ── Sensitivity: discount rate × Term Growth → intrinsic price ───────────
  const sensitivityGrid = useMemo(() => {
    const isFcfe = cashFlowMode === "fcfe";
    const baseDiscount = isFcfe ? costOfEquity : computedWACC;
    const discSteps = [baseDiscount - 2, baseDiscount - 1, baseDiscount, baseDiscount + 1, baseDiscount + 2];
    const tgSteps   = [termGrowth - 1, termGrowth - 0.5, termGrowth, termGrowth + 0.5, termGrowth + 1];
    const ndOv = parseFloat(netDebtOverride);
    const netDebt = !isNaN(ndOv) ? ndOv * 1e9 : (realNetDebt ?? (marketCap ?? 50_000_000_000) * 0.15);

    return {
      waccSteps: discSteps,
      tgSteps,
      grid: tgSteps.map(tg =>
        discSteps.map(dc => {
          const d = dc / 100;
          let rev = baseRevenue;
          let spv = 0;
          let runningNetDebt = netDebt;
          let lastFcf = 0;
          let lastEbitda = 0;
          let lastNopat = 0;
          for (let i = 0; i < YEARS; i++) {
            rev = rev * (1 + rows[i].revenueGrowth / 100);
            const ebitda = rev * rows[i].ebitdaMargin / 100;
            const da     = rev * rows[i].daPercent / 100;
            const nopat  = (ebitda - da) * (1 - rows[i].taxRate / 100);
            const fcff   = nopat + da - rev * rows[i].capexPercent / 100 - rev * rows[i].nwcChangePercent / 100;
            let fcf = fcff;
            if (isFcfe) {
              const interestExpense = runningNetDebt * (waccInputs.costOfDebt / 100);
              const netBorrowing = rev * (fcfeNetBorrowingPct / 100);
              fcf = fcfeFromFcff(fcff, interestExpense, waccInputs.taxRate, netBorrowing);
              runningNetDebt += netBorrowing;
            }
            spv += fcf / Math.pow(1 + d, i + 1);
            lastFcf = fcf;
            lastEbitda = ebitda;
            lastNopat = nopat;
          }
          const tvLocal = terminalValue({
            method: tvMethod, lastFcf, lastEbitda, discountRate: dc,
            terminalGrowth: tg, exitMultiple, hybridWeight,
            lastNopat,
            roic: currentInvestedCapital && currentInvestedCapital > 0 ? (lastNopat / currentInvestedCapital) * 100 : 0,
            fadeStartGrowth, fadeYears,
          });
          const ev = spv + tvLocal / Math.pow(1 + d, YEARS);
          const bridge = evToEquityBridge({ enterpriseValue: ev, netDebt: isFcfe ? 0 : netDebt, ...bridgeInputs });
          const val = sharesOut > 0 ? bridge.equityValue / sharesOut : spot;
          return { wacc: dc, tg, val: Math.max(0, val) };
        })
      ),
    };
  }, [
    computedWACC, costOfEquity, termGrowth, baseRevenue, rows, netDebtOverride, marketCap, sharesOut, spot,
    cashFlowMode, fcfeNetBorrowingPct, waccInputs.costOfDebt, waccInputs.taxRate, currentInvestedCapital,
    fadeStartGrowth, fadeYears, tvMethod, exitMultiple, hybridWeight, realNetDebt, bridgeInputs,
  ]);

  // ── Global sensitivity (Sobol) -- real closed-form 2-stage DCF value,
  // parameterized by growth/WACC/terminal-growth with the real FCF0 base
  // and forecast-year horizon substituted in as literals, run through the
  // live /api/quant/optimization/sensitivity-analysis route (real Saltelli
  // sampling + SALib Sobol decomposition). This is a deliberate
  // single-growth-rate simplification of the full multi-year worksheet
  // above -- the right level of detail for a 3-parameter global variance
  // study, not a replacement for it. ──────────────────────────────────
  const dcfSobolInputs = useMemo(() => {
    const g1 = rows[0]?.revenueGrowth ?? DEFAULT_YEAR_ROW.revenueGrowth;
    const y1Fcf = worksheet.projections[0]?.fcf ?? 0;
    const backoutDenom = 1 + g1 / 100;
    const fcf0 = Math.abs(backoutDenom) > 0.01 ? y1Fcf / backoutDenom : y1Fcf;

    const avgGrowth = rows.reduce((s, r) => s + r.revenueGrowth, 0) / rows.length / 100;
    const baseDiscount = (cashFlowMode === "fcfe" ? costOfEquity : computedWACC) / 100;
    const baseTg = termGrowth / 100;

    const growthRange: [number, number] = [avgGrowth - 0.08, avgGrowth + 0.08];
    const tgRange: [number, number] = [Math.max(0, baseTg - 0.01), baseTg + 0.01];
    // WACC's low end must always clear terminal growth's high end with a
    // real margin, or the Gordon-growth term blows up for a sampled
    // combination near wacc≈tg regardless of how the ranges were centered.
    const waccLo = Math.max(baseDiscount - 0.02, tgRange[1] + 0.015);
    const waccRange: [number, number] = [waccLo, Math.max(baseDiscount + 0.02, waccLo + 0.02)];

    return {
      fcf0, forecastYears: YEARS, growthRange, waccRange, tgRange,
      expression: buildTwoStageDcfSobolExpression(fcf0, YEARS),
    };
  }, [rows, worksheet.projections, cashFlowMode, costOfEquity, computedWACC, termGrowth]);

  const dcfSensitivity = useMutation({
    mutationFn: async (body: { expression: string; paramRanges: [number, number][] }) => (
      await apiRequest("POST", "/api/quant/optimization/sensitivity-analysis", {
        expression: body.expression,
        paramNames: ["growth", "wacc", "termGrowth"],
        paramRanges: body.paramRanges,
        nSamples: 1024,
      })
    ).json() as Promise<{
      paramNames: string[]; firstOrder: number[]; firstOrderConf: number[]; totalOrder: number[]; totalOrderConf: number[];
    }>,
  });
  const dcfSobolInputsKey = JSON.stringify(dcfSobolInputs);
  const dcfSensitivityReset = dcfSensitivity.reset;
  useEffect(() => { dcfSensitivityReset(); }, [dcfSobolInputsKey, dcfSensitivityReset]);

  // Cross-check: the local one-at-a-time swings already on screen (the
  // WACC x TERM GROWTH grid above, and the growth "Challenge This
  // Assumption" ladder below) should broadly agree on which factor moves
  // price the most with the Sobol global ranking -- computed directly from
  // the same real worksheet functions, not re-derived independently.
  const localSwingCheck = useMemo(() => {
    const baseDiscount = cashFlowMode === "fcfe" ? costOfEquity : computedWACC;
    let tgIdx = 0;
    sensitivityGrid.tgSteps.forEach((v, i) => {
      if (Math.abs(v - termGrowth) < Math.abs(sensitivityGrid.tgSteps[tgIdx] - termGrowth)) tgIdx = i;
    });
    const waccRow = sensitivityGrid.grid[tgIdx].map((c) => c.val);
    const waccSwing = Math.max(...waccRow) - Math.min(...waccRow);

    let waccColIdx = 0;
    sensitivityGrid.waccSteps.forEach((v, i) => {
      if (Math.abs(v - baseDiscount) < Math.abs(sensitivityGrid.waccSteps[waccColIdx] - baseDiscount)) waccColIdx = i;
    });
    const tgCol = sensitivityGrid.grid.map((row) => row[waccColIdx].val);
    const tgSwing = Math.max(...tgCol) - Math.min(...tgCol);

    const growthSwing = Math.abs(computeDcfWorksheet(-10).intrinsicPS - computeDcfWorksheet(0).intrinsicPS);

    return { waccSwing, tgSwing, growthSwing };
  }, [sensitivityGrid, termGrowth, cashFlowMode, costOfEquity, computedWACC, computeDcfWorksheet]);

  // ── LBO (simple) ──────────────────────────────────────────────────
  const [entryMult, setEntryMult] = useTerminalArtifactState("ValuationPanel.entryMult", 12);
  const [exitMult, setExitMult] = useTerminalArtifactState("ValuationPanel.exitMult", 12);

  // Debt tranches -- real LBOs almost never have one flat debt assumption:
  // senior secured, term loan B, mezzanine/PIK each carry different
  // leverage and interest, and pay down in seniority order (most senior
  // first) as the deal sweeps FCF. Defaults to a single tranche that
  // reproduces the original flat 5.0x @ 7.0% assumption exactly.
  const [tranches, setTranches] = useTerminalArtifactState<LboTranche[]>("ValuationPanel.tranches", [
    { id: "senior", label: "SENIOR DEBT", leverageMult: 5.0, interestRate: 7.0 },
  ]);
  const addTranche = useCallback(() => {
    setTranches(prev => [...prev, { id: `tranche_${Date.now()}`, label: `TRANCHE ${prev.length + 1}`, leverageMult: 1.5, interestRate: 11.0 }]);
  }, []);
  const removeTranche = useCallback((id: string) => {
    setTranches(prev => (prev.length > 1 ? prev.filter(t => t.id !== id) : prev));
  }, []);
  const updateTranche = useCallback((id: string, patch: Partial<LboTranche>) => {
    setTranches(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Capex as % of EBITDA -- the old model had no explicit capex input, just
  // an implicit 25% baked into a flat "75% of EBITDA converts to FCF"
  // shortcut. Defaulting to 25 here reproduces that exact prior behavior;
  // making it explicit and editable is the point of unifying onto the
  // shared engine (also used by the M&A desk's LBO modeler).
  const [lboCapexPct, setLboCapexPct] = useTerminalArtifactState("ValuationPanel.lboCapexPct", 25);
  // If true, any free cash flow left over once every debt tranche is fully
  // repaid is distributed to the sponsor immediately as an interim dividend
  // recap instead of sitting as balance-sheet cash until exit -- this is
  // what creates a real multi-period cash-flow stream for the IRR solver
  // (and for the GP/LP waterfall below) rather than a single entry/exit pair.
  const [lboRecap, setLboRecap] = useTerminalArtifactState("ValuationPanel.lboRecap", false);
  const [carryHurdle, setCarryHurdle] = useTerminalArtifactState("ValuationPanel.carryHurdle", 8);
  const [carryPct, setCarryPct] = useTerminalArtifactState("ValuationPanel.carryPct", 20);

  const lboModel = useMemo(() => {
    const entryEbitda = baseRevenue * (rows[0].ebitdaMargin / 100);
    const result = runLboModel({
      entryEbitda, entryMultiple: entryMult, exitMultiple: exitMult,
      ebitdaGrowthRate: rows[0].revenueGrowth, capexPctOfEbitda: lboCapexPct,
      holdYears: 5, tranches, distributeExcessCashAsRecap: lboRecap,
    });
    return {
      entryEV: result.entryEV, entryDebt: result.entryDebt, sponsorEntry: result.sponsorEntryEquity,
      exitEV: result.exitEV, debt: result.exitDebt, sponsorExit: result.sponsorExitEquity,
      accumulatedCash: result.accumulatedCash, sponsorCashFlows: result.sponsorCashFlows,
      totalSponsorProceeds: result.totalSponsorProceeds,
      moic: result.moic, irr: result.irr, trancheBalancesRemaining: result.trancheBalancesRemaining,
    };
  }, [baseRevenue, rows, entryMult, exitMult, lboCapexPct, tranches, lboRecap]);

  // GP/LP carry waterfall on the same LBO cash-flow stream -- return of
  // capital, preferred return (hurdle), 100% GP catch-up, then the
  // remaining split. Real fund economics on top of the sponsor-level result.
  const carryModel = useMemo(() => (
    applyCarryWaterfall({
      lpCapital: lboModel.sponsorEntry,
      sponsorCashFlows: lboModel.sponsorCashFlows,
      hurdleRatePct: carryHurdle,
      carryPct,
    })
  ), [lboModel.sponsorEntry, lboModel.sponsorCashFlows, carryHurdle, carryPct]);

  // Real filed income/ratios/cash-flow figures, latest two fiscal years
  // (LSE financial_reports, SEC-sourced) -- parsed earlier alongside
  // balCurrent/balPrior since the WACC builder's synthetic-rating cost of
  // debt and EVA tab both need them before this point too. Both the
  // auto-computed models below AND the manual-entry defaults for DuPont/
  // Altman/Piotroski draw from the same real numbers.
  const dupontOv = useOverridable<"netIncome" | "revenue" | "totalAssets" | "totalEquity">("ValuationPanel.dupontOv");
  const dupontDefaults = {
    netIncome: canonicalValue("netIncome", incCurrent?.netIncome ?? (baseRevenue * (rows[0].ebitdaMargin / 100) * 0.62)),
    revenue: canonicalValue("revenue", incCurrent?.revenue ?? baseRevenue),
    totalAssets: canonicalValue("totalAssets", balCurrent?.totalAssets ?? (marketCap ?? 50_000_000_000) * 1.2),
    totalEquity: canonicalValue("totalEquity", balCurrent
      ? balCurrent.totalAssets - balCurrent.totalLiabilities
      : ((marketCap ?? 50_000_000_000) * 1.2) / (pe ? Math.min(3.5, Math.max(1.2, pe / 12)) : 1.7)),
  };
  const dupontInputs = {
    netIncome: dupontOv.getValue("netIncome", dupontDefaults.netIncome),
    revenue: dupontOv.getValue("revenue", dupontDefaults.revenue),
    totalAssets: dupontOv.getValue("totalAssets", dupontDefaults.totalAssets),
    totalEquity: dupontOv.getValue("totalEquity", dupontDefaults.totalEquity),
  };
  const dupontModel = useMemo(() => {
    const npm = dupontInputs.revenue > 0 ? dupontInputs.netIncome / dupontInputs.revenue : 0;
    const ato = dupontInputs.totalAssets > 0 ? dupontInputs.revenue / dupontInputs.totalAssets : 0;
    const lm  = dupontInputs.totalEquity > 0 ? dupontInputs.totalAssets / dupontInputs.totalEquity : 0;
    return { npm, ato, lm, roe: npm * ato * lm };
  }, [dupontInputs.netIncome, dupontInputs.revenue, dupontInputs.totalAssets, dupontInputs.totalEquity]);

  // ── Altman Z-Score + Piotroski F-Score -- overridable: seeded from real
  // filed figures (LSE financial_reports, SEC-sourced) when available, but
  // every raw input is click-to-edit so a ticker with no filed data (or a
  // hypothetical scenario) can still be scored by typing the numbers in. ──
  const altmanOv = useOverridable<keyof AltmanZInputs>("ValuationPanel.altmanOv");
  const altmanDefaults: AltmanZInputs = {
    totalCurrentAssets: canonicalValue("currentAssets", balCurrent?.totalCurrentAssets ?? 0),
    totalCurrentLiabilities: canonicalValue("currentLiabilities", balCurrent?.totalCurrentLiabilities ?? 0),
    totalAssets: canonicalValue("totalAssets", balCurrent?.totalAssets ?? 0),
    retainedEarnings: canonicalValue("retainedEarnings", balCurrent?.retainedEarnings ?? 0),
    ebit: canonicalValue("ebit", incCurrent?.ebit ?? 0),
    marketCapitalization: canonicalValue("marketCap", marketCap ?? 0),
    totalLiabilities: canonicalValue("totalLiabilities", balCurrent?.totalLiabilities ?? 0),
    revenue: canonicalValue("revenue", incCurrent?.revenue ?? 0),
  };
  const altmanInputs: AltmanZInputs = {
    totalCurrentAssets: altmanOv.getValue("totalCurrentAssets", altmanDefaults.totalCurrentAssets),
    totalCurrentLiabilities: altmanOv.getValue("totalCurrentLiabilities", altmanDefaults.totalCurrentLiabilities),
    totalAssets: altmanOv.getValue("totalAssets", altmanDefaults.totalAssets),
    retainedEarnings: altmanOv.getValue("retainedEarnings", altmanDefaults.retainedEarnings),
    ebit: altmanOv.getValue("ebit", altmanDefaults.ebit),
    marketCapitalization: altmanOv.getValue("marketCapitalization", altmanDefaults.marketCapitalization),
    totalLiabilities: altmanOv.getValue("totalLiabilities", altmanDefaults.totalLiabilities),
    revenue: altmanOv.getValue("revenue", altmanDefaults.revenue),
  };
  const altmanResult: AltmanZResult = altmanZScore(altmanInputs);
  const altmanHasLiveData = !!(balCurrent && incCurrent && marketCap);

  const piotroskiCurOv = useOverridable<keyof PiotroskiYearInputs>("ValuationPanel.piotroskiCurOv");
  const piotroskiPriorOv = useOverridable<keyof PiotroskiYearInputs>("ValuationPanel.piotroskiPriorOv");
  const piotroskiCurDefaults: PiotroskiYearInputs = {
    netIncome: incCurrent?.netIncome ?? 0, totalAssets: balCurrent?.totalAssets ?? 0,
    operatingCashFlow: cfCurrent?.operatingCashFlow ?? 0, longTermDebt: balCurrent?.longTermDebt ?? 0,
    totalCurrentAssets: balCurrent?.totalCurrentAssets ?? 0, totalCurrentLiabilities: balCurrent?.totalCurrentLiabilities ?? 0,
    grossProfitMargin: ratCurrent?.grossProfitMargin ?? 0, assetTurnover: ratCurrent?.assetTurnover ?? 0,
    netCommonStockIssuance: cfCurrent?.netCommonStockIssuance ?? 0,
  };
  const piotroskiPriorDefaults: PiotroskiYearInputs = {
    netIncome: incPrior?.netIncome ?? 0, totalAssets: balPrior?.totalAssets ?? 0,
    operatingCashFlow: cfPrior?.operatingCashFlow ?? 0, longTermDebt: balPrior?.longTermDebt ?? 0,
    totalCurrentAssets: balPrior?.totalCurrentAssets ?? 0, totalCurrentLiabilities: balPrior?.totalCurrentLiabilities ?? 0,
    grossProfitMargin: ratPrior?.grossProfitMargin ?? 0, assetTurnover: ratPrior?.assetTurnover ?? 0,
    netCommonStockIssuance: cfPrior?.netCommonStockIssuance ?? 0,
  };
  const resolvePiotroskiInputs = (ov: OverridableOf<keyof PiotroskiYearInputs>, d: PiotroskiYearInputs): PiotroskiYearInputs => ({
    netIncome: ov.getValue("netIncome", d.netIncome),
    totalAssets: ov.getValue("totalAssets", d.totalAssets),
    operatingCashFlow: ov.getValue("operatingCashFlow", d.operatingCashFlow),
    longTermDebt: ov.getValue("longTermDebt", d.longTermDebt),
    totalCurrentAssets: ov.getValue("totalCurrentAssets", d.totalCurrentAssets),
    totalCurrentLiabilities: ov.getValue("totalCurrentLiabilities", d.totalCurrentLiabilities),
    grossProfitMargin: ov.getValue("grossProfitMargin", d.grossProfitMargin),
    assetTurnover: ov.getValue("assetTurnover", d.assetTurnover),
    netCommonStockIssuance: ov.getValue("netCommonStockIssuance", d.netCommonStockIssuance),
  });
  const piotroskiCurInputs = resolvePiotroskiInputs(piotroskiCurOv, piotroskiCurDefaults);
  const piotroskiPriorInputs = resolvePiotroskiInputs(piotroskiPriorOv, piotroskiPriorDefaults);
  const piotroskiResult: PiotroskiResult = piotroskiFScore(piotroskiCurInputs, piotroskiPriorInputs);
  const piotroskiHasLiveData = !!(balCurrent && balPrior && incCurrent && incPrior && ratCurrent && ratPrior && cfCurrent && cfPrior);

  // Advanced method outputs are kept in the parent so Model Agreement remains
  // honest when a source tab is unmounted. A method is added only after its
  // own component computes a finite value from the current symbol's inputs.
  const [ddmSummary, setDdmSummary] = useState<DDMResultSummary | null>(null);
  const [residualIncomeValue, setResidualIncomeValue] = useState<number | null>(null);
  const [evaValue, setEvaValue] = useState<number | null>(null);
  const [assetValue, setAssetValue] = useState<number | null>(null);
  const [compsMethods, setCompsMethods] = useState<ValuationMethodResult[]>([]);
  const onDdmResult = useCallback((value: DDMResultSummary | null) => setDdmSummary(value), []);
  const onResidualIncomeResult = useCallback((value: number | null) => setResidualIncomeValue(value), []);
  const onEvaResult = useCallback((value: number | null) => setEvaValue(value), []);
  const onAssetValueResult = useCallback((value: number | null) => setAssetValue(value), []);
  const onCompsMethodsChange = useCallback((value: ValuationMethodResult[]) => setCompsMethods(value), []);
  const modelAgreementMethods = useMemo<ValuationMethodResult[]>(() => {
    const methods: ValuationMethodResult[] = [{
      method: "dcf", label: "DCF / FCF WORKSHEET", enterpriseValue: worksheet.ev,
      equityValue: worksheet.equityValue, valuePerShare: worksheet.intrinsicPS,
      confidence: "high", notes: "Current worksheet assumptions and bridge.",
    }];
    if (ddmSummary?.twoStageValuePerShare && Number.isFinite(ddmSummary.twoStageValuePerShare) && sharesOut > 0) {
      methods.push({
        method: "ddm", label: "2-STAGE DDM", enterpriseValue: null,
        equityValue: ddmSummary.twoStageValuePerShare * sharesOut,
        valuePerShare: ddmSummary.twoStageValuePerShare, confidence: "medium",
        notes: ddmSummary.isFiled
          ? "Filed trailing dividend plus editable DDM assumptions."
          : "Analyst-entered dividend plus editable DDM assumptions.",
      });
    }
    if (residualIncomeValue != null && Number.isFinite(residualIncomeValue) && residualIncomeValue > 0) {
      methods.push({
        method: "residual_income", label: "RESIDUAL INCOME", enterpriseValue: null,
        equityValue: residualIncomeValue, valuePerShare: sharesOut > 0 ? residualIncomeValue / sharesOut : null,
        confidence: "medium", notes: "Filed book value plus forecast residual income.",
      });
    }
    if (evaValue != null && Number.isFinite(evaValue) && evaValue > 0) {
      methods.push({
        method: "eva", label: "EVA", enterpriseValue: null,
        equityValue: evaValue, valuePerShare: sharesOut > 0 ? evaValue / sharesOut : null,
        confidence: "medium", notes: "Filed invested capital and DCF worksheet NOPAT path.",
      });
    }
    if (assetValue != null && Number.isFinite(assetValue) && assetValue > 0) {
      methods.push({
        method: "asset_value", label: "LIQUIDATION VALUE", enterpriseValue: null,
        equityValue: assetValue, valuePerShare: sharesOut > 0 ? assetValue / sharesOut : null,
        confidence: "low", notes: "Filed assets with explicit user-editable recovery assumptions.",
      });
    }
    return [...methods, ...compsMethods.filter(m => m.equityValue != null && m.equityValue > 0)];
  }, [assetValue, compsMethods, ddmSummary, evaValue, residualIncomeValue, sharesOut, worksheet]);
  const resetWorksheet = useCallback(() => {
    setRows(Array(YEARS).fill(null).map(() => ({ ...DEFAULT_YEAR_ROW })));
  }, []);

  const updateRow = useCallback((i: number, key: keyof YearRow, val: number) => {
    setRows(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: val };
      return next;
    });
  }, []);

  /** Apply a single value to ALL years for a given key */
  const applyAllYears = useCallback((key: keyof YearRow, val: number) => {
    setRows(prev => prev.map(r => ({ ...r, [key]: val })));
  }, []);

  if (isLoading) {
    return (
      <div className="h-full p-4 space-y-4 bg-[#050505] flex flex-col justify-center animate-pulse">
        <Skeleton className="h-8 w-1/3 bg-border" />
        <Skeleton className="h-64 w-full bg-border" />
      </div>
    );
  }

  const runDcfSensitivity = () => {
    dcfSensitivity.mutate({
      expression: dcfSobolInputs.expression,
      paramRanges: [dcfSobolInputs.growthRange, dcfSobolInputs.waccRange, dcfSobolInputs.tgRange],
    });
  };

  const tabs = [
    { id: "fcf_worksheet" as const, label: "DCF / FCF WORKSHEET" },
    { id: "lbo" as const, label: "LBO MODEL" },
    { id: "dupont" as const, label: "DUPONT & INSOLVENCY" },
    { id: "ratios" as const, label: "RATIO ANALYSIS" },
    { id: "ddm" as const, label: "DDM" },
    { id: "beneish" as const, label: "BENEISH M-SCORE" },
    { id: "ohlson" as const, label: "OHLSON O-SCORE" },
    { id: "comps" as const, label: "COMPS" },
    { id: "earnings_quality" as const, label: "EARNINGS QUALITY" },
    { id: "residual_income" as const, label: "RESIDUAL INCOME" },
    { id: "eva" as const, label: "EVA" },
    { id: "reverse_dcf" as const, label: "REVERSE DCF" },
    { id: "asset_value" as const, label: "ASSET VALUE" },
    { id: "model_agreement" as const, label: "MODEL AGREEMENT" },
    { id: "provider_data" as const, label: "SEGMENTS / ESTIMATES" },
    { id: "estimate_intelligence" as const, label: "ESTIMATE INTELLIGENCE" },
  ];

  const latestSnapshotPeriod = financialSnapshot?.payload.periods.at(-1);
  const segmentRows = [
    ...Object.entries(latestSnapshotPeriod?.segments ?? {}).map(([name, value]) => ({ kind: "PRODUCT", name, value })),
    ...Object.entries(latestSnapshotPeriod?.geographies ?? {}).map(([name, value]) => ({ kind: "GEOGRAPHY", name, value })),
  ];
  const estimateRows = estimateSnapshot?.payload.observations ?? [];
  const dcfSnapshotStatus = resolveProvenanceStatus({
    entities: ["financial", "market"],
    snapshots: valuationSnapshotRefs,
    manualOverride: !useLatestSnapshot || Boolean(y0RevOverride || netDebtOverride || sharesOverride) || rows.some((row, index) => Object.keys(DEFAULT_YEAR_ROW).some((key) => row[key as keyof YearRow] !== DEFAULT_YEAR_ROW[key as keyof YearRow])),
  });
  const dcfSourceBindings = allValuationSnapshotRefs.map((snapshot) => sourceBindingForSnapshot(snapshot, `valuation.${snapshot.entityKey}`, snapshot.entityKey === "market" ? "market_series" : snapshot.entityKey === "estimates" ? "estimates" : "financial_statements"));
  const forecastDriversSourceDerived = false;
  const uptxt = worksheet.upside > 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]";

  const handleExport = () => {
    if (activeTab === "fcf_worksheet") {
      exportWorkbook(`${symbol}_dcf_worksheet.xlsx`, [
        {
          name: "Summary",
          rows: [
            ["Metric", "Value"],
            ["Cash Flow Basis", cashFlowMode.toUpperCase()],
            ["Terminal Value Method", tvMethod],
            ["Intrinsic Value / Share", worksheet.intrinsicPS],
            ["Upside / Downside %", worksheet.upside],
            [cashFlowMode === "fcfe" ? "Equity Value" : "Enterprise Value", worksheet.ev],
            ["PV of FCFs", worksheet.sumPvFcf],
            ["Terminal Value", worksheet.pvTv],
            ["TV % of Total", worksheet.tvPct],
            [cashFlowMode === "fcfe" ? "Cost of Equity %" : "WACC %", cashFlowMode === "fcfe" ? costOfEquity : computedWACC],
            ["Terminal Growth Rate %", termGrowth],
            ["Exit Multiple (x EBITDA)", exitMultiple],
            ["Base Revenue (Y0)", baseRevenue],
            ["Net Debt", worksheet.netDebt],
            ["Preferred Equity", bridgeInputs.preferredEquity],
            ["Minority Interest", bridgeInputs.minorityInterest],
            ["Pension Liabilities", bridgeInputs.pensionLiabilities],
            ["Lease Adjustments", bridgeInputs.leaseAdjustments],
            ["Non-Operating Assets", bridgeInputs.nonOperatingAssets],
            ["JV Stakes", bridgeInputs.jointVentureStakes],
            ["Shares Outstanding", sharesOut],
            ["Provenance Status", dcfSnapshotStatus.label],
            ["Source Snapshot IDs", dcfSourceBindings.map((binding) => binding.snapshot.id).join(", ") || "NONE"],
            ["Source Providers / Hashes", dcfSourceBindings.map((binding) => `${binding.provider}:${binding.snapshot.contentHash}`).join(", ") || "NONE"],
            ["Forecast Drivers Source-Derived", forecastDriversSourceDerived ? "YES" : "NO — MANUAL ASSUMPTIONS"],
          ],
        },
        {
          name: "10-Year Worksheet",
          rows: [
            ["Line Item", ...rows.map((_, i) => `Y${i + 1}`)],
            ["Revenue Growth %", ...rows.map(r => r.revenueGrowth)],
            ["EBITDA Margin %", ...rows.map(r => r.ebitdaMargin)],
            ["D&A % of Revenue", ...rows.map(r => r.daPercent)],
            ["Effective Tax Rate %", ...rows.map(r => r.taxRate)],
            ["CapEx % of Revenue", ...rows.map(r => r.capexPercent)],
            ["ΔNWC % of Revenue", ...rows.map(r => r.nwcChangePercent)],
            [],
            ["Revenue", ...worksheet.projections.map(p => p.revenue)],
            ["EBITDA", ...worksheet.projections.map(p => p.ebitda)],
            ["D&A", ...worksheet.projections.map(p => p.da)],
            ["EBIT", ...worksheet.projections.map(p => p.ebit)],
            ["NOPAT", ...worksheet.projections.map(p => p.nopat)],
            ["CapEx", ...worksheet.projections.map(p => p.capex)],
            ["ΔNWC", ...worksheet.projections.map(p => p.nwcChange)],
            ["Free Cash Flow (pre-adjustment)", ...worksheet.projections.map(p => p.fcfBeforeAdjustments)],
            ...dcfCustomItems.items.map(item => [
              item.label,
              ...worksheet.projections.map((_, i) => {
                if (item.kind === "manual") return item.values[i] ?? 0;
                const p = worksheet.projections[i];
                const yearValues: Record<string, number> = {
                  revenueGrowth: rows[i].revenueGrowth, ebitdaMargin: rows[i].ebitdaMargin, daPercent: rows[i].daPercent,
                  taxRate: rows[i].taxRate, capexPercent: rows[i].capexPercent, nwcChangePercent: rows[i].nwcChangePercent,
                  revenue: p.revenue, ebitda: p.ebitda, da: p.da, ebit: p.ebit, nopat: p.nopat,
                  capex: p.capex, nwcChange: p.nwcChange, fcf: p.fcfBeforeAdjustments,
                };
                return evaluateCustomItem(item, i, (key: string) => (key in yearValues ? yearValues[key] : null), dcfCustomItems.items) ?? 0;
              }),
            ]),
            ["Free Cash Flow", ...worksheet.projections.map(p => p.fcf)],
          ],
        },
        {
          name: "WACC Builder",
          rows: [
            ["Input", "Value"],
            ["Risk-Free Rate %", waccInputs.riskFreeRate],
            ["Equity Risk Premium %", waccInputs.erp],
            ["Beta (Levered)", waccInputs.beta],
            ["Cost of Debt %", waccInputs.costOfDebt],
            ["Debt / Capital %", waccInputs.debtWeight],
            ["Corp Tax Rate %", waccInputs.taxRate],
            ["Computed WACC %", computedWACC],
          ],
        },
      ]);
    } else if (activeTab === "lbo") {
      exportWorkbook(`${symbol}_lbo_model.xlsx`, [
        {
          name: "LBO Model",
          rows: [
            ["Metric", "Value"],
            ["Entry EV", lboModel.entryEV],
            ["Entry Debt", lboModel.entryDebt],
            ["Sponsor Equity In", lboModel.sponsorEntry],
            ["Exit EV", lboModel.exitEV],
            ["Debt Remaining", lboModel.debt],
            ["Accumulated Cash", lboModel.accumulatedCash],
            ["Sponsor Equity Out", lboModel.sponsorExit],
            ["Total Sponsor Proceeds", lboModel.totalSponsorProceeds],
            ["MOIC", lboModel.moic],
            ["IRR (5-Year, real cash-flow solve) %", lboModel.irr ?? "N/A"],
            [],
            ["Entry Multiple (x EBITDA)", entryMult],
            ["Exit Multiple (x EBITDA)", exitMult],
            ["Excess Cash Distributed As Recap", lboRecap ? "Yes" : "No"],
            [],
            ["Debt Tranche", "Leverage (x EBITDA)", "Interest Rate %", "Balance Remaining"],
            ...tranches.map((t, i) => [t.label, t.leverageMult, t.interestRate, lboModel.trancheBalancesRemaining[i]]),
            [],
            ["GP/LP Waterfall", "Value"],
            ["Preferred Return (Hurdle) %", carryHurdle],
            ["GP Carry %", carryPct],
            ["Return of Capital", carryModel.returnOfCapital],
            ["Preferred Return Paid", carryModel.preferredProfitPaid],
            ["GP Catch-up Paid", carryModel.catchupPaid],
            ["GP Carry Total", carryModel.gpCarryTotal],
            ["LP Net MOIC", carryModel.lpNetMoic],
            ["LP Net IRR %", carryModel.lpNetIrr ?? "N/A"],
          ],
        },
      ]);
    } else if (activeTab === "dupont") {
      exportWorkbook(`${symbol}_dupont_insolvency.xlsx`, [
        {
          name: "DuPont",
          rows: [
            ["Metric", "Value"],
            ["ROE %", dupontModel.roe * 100],
            ["Net Profit Margin %", dupontModel.npm * 100],
            ["Asset Turnover", dupontModel.ato],
            ["Leverage Multiplier", dupontModel.lm],
            [],
            ["Net Income", dupontInputs.netIncome],
            ["Revenue", dupontInputs.revenue],
            ["Total Assets", dupontInputs.totalAssets],
            ["Total Equity", dupontInputs.totalEquity],
          ],
        },
        {
          name: "Altman Z-Score",
          rows: [
            ["Metric", "Value"],
            ["Z-Score", altmanResult.zScore],
            ["Zone", altmanResult.zone],
            ["X1", altmanResult.x1], ["X2", altmanResult.x2], ["X3", altmanResult.x3],
            ["X4", altmanResult.x4], ["X5", altmanResult.x5],
            [],
            ["Total Current Assets", altmanInputs.totalCurrentAssets],
            ["Total Current Liabilities", altmanInputs.totalCurrentLiabilities],
            ["Total Assets", altmanInputs.totalAssets],
            ["Retained Earnings", altmanInputs.retainedEarnings],
            ["EBIT", altmanInputs.ebit],
            ["Market Cap", altmanInputs.marketCapitalization],
            ["Total Liabilities", altmanInputs.totalLiabilities],
            ["Revenue", altmanInputs.revenue],
          ],
        },
        {
          name: "Piotroski F-Score",
          rows: [
            ["Score", `${piotroskiResult.score}/9`],
            [],
            ["Criterion", "Passed"],
            ...piotroskiResult.criteria.map(c => [c.label, c.passed ? "YES" : "NO"]),
            [],
            ["Line Item", "Current Year", "Prior Year"],
            ["Net Income", piotroskiCurInputs.netIncome, piotroskiPriorInputs.netIncome],
            ["Total Assets", piotroskiCurInputs.totalAssets, piotroskiPriorInputs.totalAssets],
            ["Operating Cash Flow", piotroskiCurInputs.operatingCashFlow, piotroskiPriorInputs.operatingCashFlow],
            ["Long-Term Debt", piotroskiCurInputs.longTermDebt, piotroskiPriorInputs.longTermDebt],
            ["Total Current Assets", piotroskiCurInputs.totalCurrentAssets, piotroskiPriorInputs.totalCurrentAssets],
            ["Total Current Liabilities", piotroskiCurInputs.totalCurrentLiabilities, piotroskiPriorInputs.totalCurrentLiabilities],
            ["Gross Profit Margin", piotroskiCurInputs.grossProfitMargin, piotroskiPriorInputs.grossProfitMargin],
            ["Asset Turnover", piotroskiCurInputs.assetTurnover, piotroskiPriorInputs.assetTurnover],
            ["Net Common Stock Issuance", piotroskiCurInputs.netCommonStockIssuance, piotroskiPriorInputs.netCommonStockIssuance],
          ],
        },
      ]);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Building2 className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">CORPORATE VALUATION</span>
        <span className="font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{symbol}</span>
        {quote && (
          <span className="font-terminal text-[10px] text-muted-foreground">
            {curr}{formatPrice(spot)}
          </span>
        )}
        <span className={`font-terminal text-[7px] border px-1.5 py-0.5 ${universalContext.trust.conflictCount ? "text-rose-300 border-rose-500/30" : "text-cyan-300 border-cyan-500/30"}`}>UNIVERSAL DATA · {universalContext.trust.weightedCoveragePct}% · {universalContext.trust.conflictCount ? "CONFLICT" : "TRACEABLE"}</span>
        <div className="flex items-center gap-0.5 ml-2 border border-border">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1 font-terminal text-[8px] tracking-wider transition-all ${
                activeTab === t.id
                  ? "bg-[hsl(38,95%,50%)] text-black font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >{t.label}</button>
          ))}
        </div>
        {(activeTab === "fcf_worksheet" || activeTab === "lbo" || activeTab === "dupont") && (

          <div className="ml-auto">
            <ExportButton onExport={handleExport} />
          </div>
        )}
        <span className={`font-terminal text-[8px] text-muted-foreground/60 tracking-widest ${activeTab === "fcf_worksheet" || activeTab === "lbo" || activeTab === "dupont" ? "" : "ml-auto"}`}>VAL</span>
      </div>
      <div className="shrink-0 border-b border-border bg-[#060606] px-3 py-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => captureSnapshots.mutate()}
          disabled={captureSnapshots.isPending}
          data-testid="valuation-capture-snapshots"
          className="border border-cyan-500/40 px-2 py-1 font-terminal text-[7px] tracking-widest text-cyan-300 disabled:opacity-40"
        >
          {captureSnapshots.isPending ? "CAPTURING…" : "CAPTURE DATASET SNAPSHOT"}
        </button>
        <button
          onClick={() => setUseLatestSnapshot(true)}
          data-testid="valuation-use-latest-snapshot"
          className={`border px-2 py-1 font-terminal text-[7px] tracking-widest ${useLatestSnapshot ? "border-emerald-500/50 text-emerald-300" : "border-border text-muted-foreground"}`}
        >
          USE LATEST SNAPSHOT
        </button>
        {captureSnapshots.error && <span className="font-mono text-[7px] text-rose-300">{(captureSnapshots.error as Error).message}</span>}
        <div className="min-w-[320px] flex-1">
          <SnapshotProvenanceStatus
            status={dcfSnapshotStatus}
            snapshots={allValuationSnapshotRefs}
            warning={!forecastDriversSourceDerived ? "FORECAST DRIVERS NOT SOURCE-DERIVED — MANUAL ASSUMPTIONS ARE PRESERVED." : undefined}
          >
            <span className="text-muted-foreground">DCF INPUTS {dcfSourceBindings.length ? dcfSourceBindings.map((binding) => binding.snapshot.id.slice(0, 8)).join(" / ") : "NONE"}</span>
          </SnapshotProvenanceStatus>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
           TAB 1: FCF WORKSHEET
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === "fcf_worksheet" && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* ── KPI summary strip ─── */}
          <div className="shrink-0 grid grid-cols-7 border-b border-border bg-[#060606]">
            {[
              { label: "INTRINSIC VALUE / SHARE",   formula: cashFlowMode === "fcfe" ? "Equity Value / Shares Outstanding" : "(Enterprise Value − Net Debt ± Bridge Adjustments) / Shares Outstanding", val: `${curr}${formatPrice(worksheet.intrinsicPS)}`, cls: uptxt },
              { label: "UPSIDE / DOWNSIDE",          formula: "(Intrinsic Value/Share − Spot Price) / Spot Price", val: `${worksheet.upside > 0 ? "+" : ""}${worksheet.upside.toFixed(1)}%`, cls: uptxt },
              { label: cashFlowMode === "fcfe" ? "EQUITY VALUE" : "ENTERPRISE VALUE", formula: `Σ PV(${cashFlowMode === "fcfe" ? "FCFE" : "FCFF"}, Y1–Y10) + PV(Terminal Value)`, val: fB(worksheet.ev, curr), cls: "" },
              { label: `PV OF ${cashFlowMode === "fcfe" ? "FCFE" : "FCFF"}s`, formula: `Σ [CFₜ / (1 + ${cashFlowMode === "fcfe" ? "Ke" : "WACC"})ᵗ] for t = 1..10`, val: fB(worksheet.sumPvFcf, curr), cls: "" },
              { label: "TERMINAL VALUE",             formula: tvMethod === "gordon" ? "Terminal CF × (1+g) / (r − g), discounted to present" : tvMethod === "exitMultiple" ? "Terminal EBITDA × Exit Multiple, discounted to present" : "Blend of Gordon Growth and Exit Multiple, discounted to present", val: fB(worksheet.pvTv, curr), cls: "" },
              { label: `TV % OF ${cashFlowMode === "fcfe" ? "EQUITY VALUE" : "EV"}`, formula: "PV(Terminal Value) / Total Value", val: `${worksheet.tvPct.toFixed(1)}%`, cls: worksheet.tvPct > 75 ? "text-[hsl(20,90%,55%)]" : "" },
              { label: cashFlowMode === "fcfe" ? "COST OF EQUITY" : "WACC", formula: cashFlowMode === "fcfe" ? "Rf + β×ERP + Size + Country + Industry Premiums" : "(Ke × Equity Weight) + (Kd × (1 − Tax Rate) × Debt Weight)", val: `${(cashFlowMode === "fcfe" ? costOfEquity : computedWACC).toFixed(2)}%`, cls: "" },
            ].map(k => (
              <div key={k.label} className="p-2 border-r border-border last:border-r-0 text-center">
                <FormulaTooltip formula={k.formula} className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-0.5">{k.label}</FormulaTooltip>
                <div className={`font-terminal text-[11px] font-bold tabular-nums ${k.cls || "text-foreground"}`}>{k.val}</div>
              </div>
            ))}
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* ── Left: Editable worksheet table ── */}
            <div className="flex-1 overflow-auto scrollbar-thin">
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-[#060606] sticky top-0 z-20">
                <Calculator className="w-3 h-3 text-[hsl(38,95%,55%)]" />
                <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">10-YEAR FCF PROJECTION WORKSHEET — CLICK ANY CELL TO EDIT</span>
                <div className="ml-auto flex items-center border border-border/60 text-[8px] font-terminal tracking-widest overflow-hidden">
                  <button
                    onClick={() => setCashFlowMode("fcff")}
                    title="Unlevered free cash flow, discounted at WACC, bridged to equity value via net debt"
                    className={`px-2 py-0.5 transition-colors ${cashFlowMode === "fcff" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    FCFF
                  </button>
                  <button
                    onClick={() => setCashFlowMode("fcfe")}
                    title="Levered free cash flow to equity, discounted at cost of equity"
                    className={`px-2 py-0.5 transition-colors border-l border-border/60 ${cashFlowMode === "fcfe" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    FCFE
                  </button>
                </div>
                <button
                  onClick={resetWorksheet}
                  className="flex items-center gap-1 px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="w-2.5 h-2.5" /> RESET
                </button>
              </div>
              {cashFlowMode === "fcfe" && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-[hsl(38,95%,50%)/5%]">
                  <span className="font-terminal text-[8px] text-muted-foreground">NET BORROWING (% OF REVENUE, ANNUAL)</span>
                  <EditableValue variant="field" value={fcfeNetBorrowingPct} decimals={1} suffix="%" onChange={setFcfeNetBorrowingPct} />
                  <span className="font-terminal text-[7px] text-muted-foreground/60">Interest on net debt charged at the WACC builder's cost-of-debt input.</span>
                </div>
              )}

              <div className="px-3 py-2 border-b border-border/50">
                <CustomLineItemBuilder
                  availableRefs={dcfAvailableRefs}
                  periodLabels={Array.from({ length: YEARS }, (_, i) => `Y${i + 1}`)}
                  onAddManual={(label, values) => dcfCustomItems.addManual(label, values)}
                  onAddFormula={dcfCustomItems.addFormula}
                />
              </div>

              {latestStatementMetrics.length > 0 && (
                <div className="px-3 py-2 border-b border-border/50 bg-[#070707]">
                  <div className="font-terminal text-[7px] tracking-widest text-muted-foreground mb-1.5">
                    FILED BASELINE FROM SHARED STATEMENT ANALYTICS — {statementAnalysis[0]?.fiscalYear}
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {[
                      "revenueGrowth",
                      "ebitdaMargin",
                      "roic",
                      "netDebtToEbitda",
                      "fcfConversion",
                      "cashConversionCycle",
                    ].map((key) => {
                      const metric = statementMetricByKey(key);
                      return (
                        <div key={key} className="border border-border/60 bg-[#050505] px-2 py-1.5">
                          <div className="font-terminal text-[7px] text-muted-foreground uppercase truncate" title={metric?.trace.formula}>{metric?.label ?? key}</div>
                          <div className="font-terminal text-[10px] font-bold tabular-nums text-foreground">{formatSharedMetric(metric, curr)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <table className="w-full border-collapse text-[9px]">
                <thead className="sticky top-[2rem] z-10 bg-[#070707]">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 font-terminal text-[8px] text-muted-foreground tracking-wider w-40 bg-[#070707]">LINE ITEM</th>
                    {Array(YEARS).fill(0).map((_, i) => (
                      <th key={i} className="px-1 py-2 font-terminal text-[8px] text-[hsl(38,95%,55%)] tracking-wider text-center min-w-[80px]">
                        Y{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* ── INPUTS section ─────── */}
                  <tr className="bg-[#0a0a0a]">
                    <td colSpan={YEARS + 1} className="px-3 py-1 font-terminal text-[7px] text-muted-foreground/70 tracking-widest border-y border-border/50">
                      INPUTS — EDITABLE PER YEAR (click cell to edit · hover row header to bulk-fill all years)
                    </td>
                  </tr>
                  {/* Revenue Growth */}
                  <tr className="border-b border-border/40 hover:bg-white/[2%] group">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground whitespace-nowrap">
                      <button
                        onClick={() => {
                          const v = parseFloat(window.prompt("Apply to ALL years — Revenue Growth %:", String(rows[0].revenueGrowth)) ?? "");
                          if (!isNaN(v)) applyAllYears("revenueGrowth", v);
                        }}
                        className="hover:text-[hsl(38,95%,55%)] transition-colors text-left w-full"
                        title="Click to fill all years"
                      >
                        REVENUE GROWTH %
                      </button>
                    </td>
                    {rows.map((r, i) => (
                      <td key={i} className="px-0.5 py-1">
                        <EditableValue value={r.revenueGrowth} decimals={1} suffix="%" onChange={v => updateRow(i, "revenueGrowth", v)} highlight />
                      </td>
                    ))}
                  </tr>
                  {/* EBITDA Margin */}
                  <tr className="border-b border-border/40 hover:bg-white/[2%]">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground whitespace-nowrap">
                      <button onClick={() => { const v = parseFloat(window.prompt("EBITDA Margin % (all years):", String(rows[0].ebitdaMargin)) ?? ""); if (!isNaN(v)) applyAllYears("ebitdaMargin", v); }} className="hover:text-[hsl(38,95%,55%)] transition-colors text-left w-full">
                        EBITDA MARGIN %
                      </button>
                    </td>
                    {rows.map((r, i) => <td key={i} className="px-0.5 py-1"><EditableValue value={r.ebitdaMargin} decimals={1} suffix="%" onChange={v => updateRow(i, "ebitdaMargin", v)} /></td>)}
                  </tr>
                  {/* D&A */}
                  <tr className="border-b border-border/40 hover:bg-white/[2%]">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground whitespace-nowrap">
                      <button onClick={() => { const v = parseFloat(window.prompt("D&A % of Revenue (all years):", String(rows[0].daPercent)) ?? ""); if (!isNaN(v)) applyAllYears("daPercent", v); }} className="hover:text-[hsl(38,95%,55%)] transition-colors text-left w-full">
                        D&A % OF REVENUE
                      </button>
                    </td>
                    {rows.map((r, i) => <td key={i} className="px-0.5 py-1"><EditableValue value={r.daPercent} decimals={1} suffix="%" onChange={v => updateRow(i, "daPercent", v)} /></td>)}
                  </tr>
                  {/* Tax Rate */}
                  <tr className="border-b border-border/40 hover:bg-white/[2%]">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground whitespace-nowrap">
                      <button onClick={() => { const v = parseFloat(window.prompt("Tax Rate % (all years):", String(rows[0].taxRate)) ?? ""); if (!isNaN(v)) applyAllYears("taxRate", v); }} className="hover:text-[hsl(38,95%,55%)] transition-colors text-left w-full">
                        EFFECTIVE TAX RATE %
                      </button>
                    </td>
                    {rows.map((r, i) => <td key={i} className="px-0.5 py-1"><EditableValue value={r.taxRate} decimals={1} suffix="%" onChange={v => updateRow(i, "taxRate", v)} /></td>)}
                  </tr>
                  {/* CapEx */}
                  <tr className="border-b border-border/40 hover:bg-white/[2%]">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground whitespace-nowrap">
                      <button onClick={() => { const v = parseFloat(window.prompt("CapEx % of Revenue (all years):", String(rows[0].capexPercent)) ?? ""); if (!isNaN(v)) applyAllYears("capexPercent", v); }} className="hover:text-[hsl(38,95%,55%)] transition-colors text-left w-full">
                        CAPEX % OF REVENUE
                      </button>
                    </td>
                    {rows.map((r, i) => <td key={i} className="px-0.5 py-1"><EditableValue value={r.capexPercent} decimals={1} suffix="%" onChange={v => updateRow(i, "capexPercent", v)} /></td>)}
                  </tr>
                  {/* NWC Change */}
                  <tr className="border-b border-border/40 hover:bg-white/[2%]">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground whitespace-nowrap">
                      <button onClick={() => { const v = parseFloat(window.prompt("ΔNWC % of Revenue (all years):", String(rows[0].nwcChangePercent)) ?? ""); if (!isNaN(v)) applyAllYears("nwcChangePercent", v); }} className="hover:text-[hsl(38,95%,55%)] transition-colors text-left w-full">
                        ΔNWC % OF REVENUE
                      </button>
                    </td>
                    {rows.map((r, i) => <td key={i} className="px-0.5 py-1"><EditableValue value={r.nwcChangePercent} decimals={1} suffix="%" onChange={v => updateRow(i, "nwcChangePercent", v)} /></td>)}
                  </tr>

                  {/* ── COMPUTED OUTPUTS section ── */}
                  <tr className="bg-[#0a0a0a]">
                    <td colSpan={YEARS + 1} className="px-3 py-1 font-terminal text-[7px] text-muted-foreground/70 tracking-widest border-y border-border/50">
                      COMPUTED OUTPUTS — AUTO-CALCULATED FROM INPUTS ABOVE
                    </td>
                  </tr>

                  {/* Revenue */}
                  <tr className="border-b border-border/40 bg-[#080808]">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-foreground font-bold">REVENUE</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center text-foreground">{fB(p.revenue, curr)}</td>
                    ))}
                  </tr>
                  {/* EBITDA */}
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground pl-6">EBITDA</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center text-muted-foreground">{fB(p.ebitda, curr)}</td>
                    ))}
                  </tr>
                  {/* D&A */}
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground pl-6">- D&A</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center text-muted-foreground">({fB(p.da, curr)})</td>
                    ))}
                  </tr>
                  {/* EBIT */}
                  <tr className="border-b border-border/40 bg-[#080808]">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-foreground">EBIT</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center">{fB(p.ebit, curr)}</td>
                    ))}
                  </tr>
                  {/* NOPAT */}
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground pl-6">NOPAT (after tax)</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center text-muted-foreground">{fB(p.nopat, curr)}</td>
                    ))}
                  </tr>
                  {/* CapEx */}
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground pl-6">- CapEx</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center text-muted-foreground">({fB(p.capex, curr)})</td>
                    ))}
                  </tr>
                  {/* ΔNWC */}
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground pl-6">- ΔNWC</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center text-muted-foreground">({fB(p.nwcChange, curr)})</td>
                    ))}
                  </tr>
                  {/* Custom FCF adjustments -- SBC addback, one-time charges,
                      a bespoke segment line, etc. Each row sums straight
                      into Free Cash Flow below. */}
                  {dcfCustomItems.items.map(item => (
                    <tr key={item.id} className="border-b border-border/40 group">
                      <td className="px-3 py-1.5 font-terminal text-[9px] text-muted-foreground pl-6">
                        <span className="inline-flex items-center gap-1.5">
                          {item.label}
                          <span className="text-[7px] text-muted-foreground/50">{item.kind === "formula" ? "ƒ" : "✎"}</span>
                          <button onClick={() => dcfCustomItems.remove(item.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-opacity">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      </td>
                      {worksheet.projections.map((p, i) => {
                        const yearValues: Record<string, number> = {
                          revenueGrowth: rows[i].revenueGrowth, ebitdaMargin: rows[i].ebitdaMargin, daPercent: rows[i].daPercent,
                          taxRate: rows[i].taxRate, capexPercent: rows[i].capexPercent, nwcChangePercent: rows[i].nwcChangePercent,
                          revenue: p.revenue, ebitda: p.ebitda, da: p.da, ebit: p.ebit, nopat: p.nopat,
                          capex: p.capex, nwcChange: p.nwcChange, fcf: p.fcfBeforeAdjustments,
                        };
                        const getYearBuiltin = (key: string): number | null => (key in yearValues ? yearValues[key] : null);
                        const raw = evaluateCustomItem(item, i, getYearBuiltin, dcfCustomItems.items);
                        return (
                          <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center text-muted-foreground">
                            {item.kind === "manual" ? (
                              <EditableValue value={(item.values[i] ?? 0) / 1e6} decimals={1} suffix="M" prefix={curr} onChange={v => dcfCustomItems.updateValue(item.id, i, v * 1e6)} />
                            ) : (
                              fB(raw ?? 0, curr)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* FCF */}
                  <tr className="border-b-2 border-[hsl(38,95%,50%)/40%] bg-[hsl(38,95%,50%)/5%]">
                    <td className="px-3 py-2 font-terminal text-[10px] text-[hsl(38,95%,55%)] font-bold">FREE CASH FLOW</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className={`px-1 py-2 font-terminal text-[10px] tabular-nums text-center font-bold ${p.fcf >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                        {fB(p.fcf, curr)}
                      </td>
                    ))}
                  </tr>
                  {/* PV of FCF */}
                  <tr className="border-b border-border/40">
                    <td className="px-3 py-1.5 font-terminal text-[9px] text-[hsl(38,95%,55%)]">PV OF FCF @{computedWACC.toFixed(1)}%</td>
                    {worksheet.projections.map((p, i) => (
                      <td key={i} className="px-1 py-1.5 font-terminal text-[9px] tabular-nums text-center text-[hsl(38,95%,55%)] font-bold">{fB(p.pv, curr)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Right panel: WACC builder + bridge ── */}
            <div className="w-72 shrink-0 border-l border-border bg-[#060606] overflow-y-auto scrollbar-thin flex flex-col">

              {/* Base revenue */}
              <div className="p-3 border-b border-border space-y-2">
                <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">BASE REVENUE (Y0)</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number" placeholder={`Default: ${(defaultBaseRevenue / 1e9).toFixed(2)}`}
                    value={y0RevOverride}
                    onChange={e => setY0RevOverride(e.target.value)}
                    className="flex-1 px-2 py-1.5 font-terminal text-[10px] bg-[#0c0c0c] border border-border text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
                  />
                  <span className="font-terminal text-[9px] text-muted-foreground">B</span>
                </div>
                <div className="font-terminal text-[8px] text-[hsl(38,95%,55%)]">Using: {curr}{(baseRevenue / 1e9).toFixed(2)}B</div>
              </div>

              {/* WACC Builder */}
              <div className="p-3 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Calculator className="w-3 h-3 text-[hsl(38,95%,55%)]" />
                    <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">WACC BUILDER</span>
                  </div>
                  <OverrideStatusBadge count={waccOv.overrideCount} onResetAll={waccOv.resetAll} />
                </div>
                <div className="grid grid-cols-2 gap-1 mb-2">
                  <div>
                    <div className="font-terminal text-[7px] text-muted-foreground/60 mb-1">EQUITY COST MODEL</div>
                    <div className="flex border border-border/60 text-[7px] font-terminal tracking-widest">
                      <button type="button" onClick={() => setEquityCostMethod("capm")} className={`flex-1 px-1 py-0.5 ${equityCostMethod === "capm" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>CAPM</button>
                      <button type="button" disabled={!factorModels.ff3} onClick={() => setEquityCostMethod("ff3")} className={`flex-1 px-1 py-0.5 border-l border-border/60 ${equityCostMethod === "ff3" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground"} disabled:opacity-40`}>FF3</button>
                      <button type="button" disabled={!factorModels.carhart4} onClick={() => setEquityCostMethod("carhart4")} className={`flex-1 px-1 py-0.5 border-l border-border/60 ${equityCostMethod === "carhart4" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground"} disabled:opacity-40`}>C4</button>
                      <button type="button" disabled={!factorModels.ff5} onClick={() => setEquityCostMethod("ff5")} className={`flex-1 px-1 py-0.5 border-l border-border/60 ${equityCostMethod === "ff5" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground"} disabled:opacity-40`}>FF5</button>
                    </div>
                  </div>
                  <div>
                    <div className="font-terminal text-[7px] text-muted-foreground/60 mb-1">DEBT COST MODEL</div>
                    <div className="flex border border-border/60 text-[7px] font-terminal tracking-widest">
                      <button type="button" onClick={() => setDebtCostMethod("manual")} className={`flex-1 px-1 py-0.5 ${debtCostMethod === "manual" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>MANUAL</button>
                      <button type="button" disabled={!syntheticRating} onClick={() => setDebtCostMethod("synthetic")} className={`flex-1 px-1 py-0.5 border-l border-border/60 ${debtCostMethod === "synthetic" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground"} disabled:opacity-40`}>SYNTHETIC</button>
                    </div>
                  </div>
                </div>
                <EditableValue variant="field" label={liveRiskFreeRate.isLive ? "RISK-FREE RATE (LIVE 3MO T-BILL)" : "RISK-FREE RATE"} value={waccInputs.riskFreeRate} suffix="%" isOverridden={waccOv.isOverridden("riskFreeRate")} onReset={() => waccOv.resetOverride("riskFreeRate")} onChange={v => waccOv.setOverride("riskFreeRate", v)} />
                <EditableValue variant="field" label="EQUITY RISK PREMIUM" value={waccInputs.erp}          suffix="%" isOverridden={waccOv.isOverridden("erp")} onReset={() => waccOv.resetOverride("erp")} onChange={v => waccOv.setOverride("erp", v)} />
                <EditableValue variant="field" label="BETA (LEVERED)"      value={waccInputs.beta}         suffix="x" decimals={2} isOverridden={waccOv.isOverridden("beta")} onReset={() => waccOv.resetOverride("beta")} onChange={v => waccOv.setOverride("beta", v)} />
                <div className="flex justify-between font-terminal text-[7px] text-muted-foreground/60 -mt-1 mb-1">
                  <FormulaTooltip formula="Hamada: βU = βL / (1 + (1 − Tax Rate) × D/E) -- the asset beta with leverage stripped out, for comparing against peers on a like-for-like basis" className="">UNLEVERED (ASSET) BETA</FormulaTooltip>
                  <span className="tabular-nums">{unleverBeta(waccInputs.beta, waccInputs.debtWeight / Math.max(1, 100 - waccInputs.debtWeight), waccInputs.taxRate).toFixed(2)}x</span>
                </div>
                <div className="flex items-center gap-1 mb-2">
                  <input
                    type="text"
                    value={industryQuery}
                    onChange={(e) => { setIndustryQuery(e.target.value); setIndustryLookupArmed(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") setIndustryLookupArmed(true); }}
                    placeholder="Industry (e.g. Software, Bank)..."
                    className="flex-1 bg-[#0d0d0d] border border-border text-[9px] font-terminal px-1.5 py-1 text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-[hsl(38,95%,50%)]"
                  />
                  <button
                    type="button"
                    onClick={() => setIndustryLookupArmed(true)}
                    disabled={!industryQuery.trim() || damodaranLookup.isFetching}
                    className="font-terminal text-[8px] uppercase tracking-widest px-2 py-1 border border-border text-muted-foreground hover:text-[hsl(38,95%,55%)] hover:border-[hsl(38,95%,50%)] disabled:opacity-40"
                  >
                    {damodaranLookup.isFetching ? "..." : "Damodaran β"}
                  </button>
                </div>
                {industryLookupArmed && !damodaranLookup.isFetching && (
                  damodaranLookup.data ? (
                    <div className="flex items-center justify-between mb-2 p-1.5 bg-[hsl(186,80%,50%)/8%] border border-[hsl(186,80%,50%)/30%]">
                      <FormulaTooltip formula="Real industry unlevered beta from Aswath Damodaran's NYU Stern dataset, re-levered with this deal's current D/E and tax rate (Hamada)" className="font-terminal text-[8px] text-[hsl(186,80%,60%)]">
                        {damodaranLookup.data.industry} (βU {damodaranLookup.data.unleveredBeta?.toFixed(2) ?? "—"}x)
                      </FormulaTooltip>
                      <button
                        type="button"
                        onClick={() => {
                          const unlevered = damodaranLookup.data?.unleveredBeta;
                          if (unlevered == null) return;
                          const de = waccInputs.debtWeight / Math.max(1, 100 - waccInputs.debtWeight);
                          const relevered = leverBeta(unlevered, de, waccInputs.taxRate);
                          waccOv.setOverride("beta", Number(relevered.toFixed(3)));
                        }}
                        className="font-terminal text-[8px] uppercase tracking-widest px-1.5 py-0.5 border border-[hsl(186,80%,50%)/50%] text-[hsl(186,80%,60%)] hover:bg-[hsl(186,80%,50%)/15%]"
                      >
                        Apply
                      </button>
                    </div>
                  ) : (
                    <div className="font-terminal text-[8px] text-muted-foreground/60 mb-2">No matching Damodaran industry found.</div>
                  )
                )}
                <EditableValue variant="field" label="MANUAL COST OF DEBT" value={manualCostOfDebt} suffix="%" isOverridden={waccOv.isOverridden("costOfDebt")} onReset={() => waccOv.resetOverride("costOfDebt")} onChange={v => waccOv.setOverride("costOfDebt", v)} />
                <EditableValue variant="field" label="DEBT / CAPITAL"      value={waccInputs.debtWeight}   suffix="%" isOverridden={waccOv.isOverridden("debtWeight")} onReset={() => waccOv.resetOverride("debtWeight")} onChange={v => waccOv.setOverride("debtWeight", v)} />
                <EditableValue variant="field" label="CORP TAX RATE"       value={waccInputs.taxRate}      suffix="%" isOverridden={waccOv.isOverridden("taxRate")} onReset={() => waccOv.resetOverride("taxRate")} onChange={v => waccOv.setOverride("taxRate", v)} />
                <EditableValue variant="field" label="SIZE PREMIUM"        value={waccInputs.sizePremium}        suffix="%" isOverridden={waccOv.isOverridden("sizePremium")} onReset={() => waccOv.resetOverride("sizePremium")} onChange={v => waccOv.setOverride("sizePremium", v)} />
                <EditableValue variant="field" label="COUNTRY RISK PREMIUM" value={waccInputs.countryRiskPremium} suffix="%" isOverridden={waccOv.isOverridden("countryRiskPremium")} onReset={() => waccOv.resetOverride("countryRiskPremium")} onChange={v => waccOv.setOverride("countryRiskPremium", v)} />
                <EditableValue variant="field" label="INDUSTRY PREMIUM"    value={waccInputs.industryPremium}    suffix="%" isOverridden={waccOv.isOverridden("industryPremium")} onReset={() => waccOv.resetOverride("industryPremium")} onChange={v => waccOv.setOverride("industryPremium", v)} />
                <div className="font-terminal text-[7px] text-muted-foreground/70 mt-1 space-y-0.5">
                  {debtCostMethod === "synthetic" && syntheticRating ? (
                    <div className="text-[hsl(186,80%,60%)]">Synthetic {syntheticRating.rating}: EBIT / interest = {syntheticRating.interestCoverage.toFixed(2)}x; risk-free + indicative spread {syntheticRating.spreadPct.toFixed(2)}% = {syntheticRating.costOfDebt.toFixed(2)}%.</div>
                  ) : debtCostMethod === "synthetic" ? (
                    <div className="text-[hsl(20,90%,60%)]">Synthetic rating unavailable: filed EBIT and non-zero interest expense are required. Manual cost of debt remains active.</div>
                  ) : null}
                  {equityCostMethod !== "capm" && selectedFactorResult ? (
                    <div className="text-[hsl(186,80%,60%)]">
                      {equityCostMethod === "ff3" ? "FF3" : equityCostMethod === "carhart4" ? "Carhart 4" : "FF5"} Ke = {selectedFactorResult.costOfEquity.toFixed(2)}% from {selectedFactorResult.observations} matched trading days (annualized observed premia; R² {selectedFactorResult.rSquared.toFixed(3)}).
                    </div>
                  ) : equityCostMethod !== "capm" ? (
                    <div className="text-[hsl(20,90%,60%)]">Selected factor model unavailable: at least 10 overlapping real stock/factor observations are required. CAPM remains active.</div>
                  ) : null}
                </div>
                <div className="mt-2 p-2 bg-[hsl(38,95%,50%)/10%] border border-[hsl(38,95%,50%)/40%] flex items-center justify-between">
                  <FormulaTooltip formula="(Ke × Equity Weight) + (Kd × (1 − Tax Rate) × Debt Weight), where Ke = Rf + β×ERP + Size + Country Risk + Industry Premiums" className="font-terminal text-[9px] text-muted-foreground">
                    {cashFlowMode === "fcfe" ? "COST OF EQUITY (Ke) — DISCOUNT RATE" : "COMPUTED WACC"}
                  </FormulaTooltip>
                  <span className="font-terminal text-[13px] font-bold text-[hsl(38,95%,55%)]">{(cashFlowMode === "fcfe" ? costOfEquity : computedWACC).toFixed(2)}%</span>
                </div>
                <div className="font-terminal text-[7px] text-muted-foreground/60 mt-1">
                  Ke = {costOfEquity.toFixed(2)}% · Kd(AT) = {(waccInputs.costOfDebt * (1 - waccInputs.taxRate / 100)).toFixed(2)}% {cashFlowMode === "fcff" && `· WACC = ${computedWACC.toFixed(2)}%`}
                </div>
              </div>

              {/* Terminal Value inputs */}
              <div className="p-3 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">TERMINAL VALUE</span>
                  <div className="flex border border-border/60 text-[7px] font-terminal tracking-widest overflow-hidden">
                    <button onClick={() => setTvMethod("gordon")} className={`px-1.5 py-0.5 ${tvMethod === "gordon" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>GORDON</button>
                    <button onClick={() => setTvMethod("exitMultiple")} className={`px-1.5 py-0.5 border-l border-border/60 ${tvMethod === "exitMultiple" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>EXIT MULT.</button>
                    <button onClick={() => setTvMethod("hybrid")} className={`px-1.5 py-0.5 border-l border-border/60 ${tvMethod === "hybrid" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>HYBRID</button>
                    <button onClick={() => setTvMethod("valueDriver")} className={`px-1.5 py-0.5 border-l border-border/60 ${tvMethod === "valueDriver" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>VALUE DRIVER</button>
                    <button onClick={() => setTvMethod("fadeToMaturity")} className={`px-1.5 py-0.5 border-l border-border/60 ${tvMethod === "fadeToMaturity" ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>FADE</button>
                  </div>
                </div>
                {tvMethod !== "exitMultiple" && (
                  <EditableValue variant="field" label="TERMINAL GROWTH RATE" value={termGrowth} suffix="%" decimals={1} onChange={v => setTermGrowth(Math.min(v, (cashFlowMode === "fcfe" ? costOfEquity : computedWACC) - 0.5))} />
                )}
                {tvMethod !== "gordon" && (
                  <EditableValue variant="field" label="EXIT MULTIPLE (x EBITDA)" value={exitMultiple} suffix="x" decimals={1} onChange={setExitMultiple} />
                )}
                {tvMethod === "hybrid" && (
                  <EditableValue variant="field" label="GORDON WEIGHT" value={hybridWeight} suffix="%" decimals={0} onChange={v => setHybridWeight(Math.max(0, Math.min(100, v)))} />
                )}
                {tvMethod === "fadeToMaturity" && (
                  <div className="grid grid-cols-2 gap-x-3">
                    <EditableValue variant="field" label="FADE START GROWTH" value={fadeStartGrowth} suffix="%" decimals={1} onChange={v => setFadeStartGrowth(v)} />
                    <EditableValue variant="field" label="FADE YEARS (H-MODEL)" value={fadeYears} decimals={0} onChange={v => setFadeYears(Math.max(0, v))} />
                  </div>
                )}
                {tvMethod === "valueDriver" && (
                  <div className="font-terminal text-[7px] text-muted-foreground/70 mt-1">
                    Value-driver TV uses final worksheet NOPAT and ROIC = final worksheet NOPAT ÷ filed invested capital ({currentInvestedCapital ? `${(worksheet.projections[YEARS - 1].nopat / currentInvestedCapital * 100).toFixed(1)}%` : "unavailable"}). It returns zero until a valid filed capital base is available.
                  </div>
                )}
                <div className="font-terminal text-[8px] text-muted-foreground mt-1 space-y-0.5">
                  <div className="flex justify-between">
                    <span>Terminal {cashFlowMode === "fcfe" ? "FCFE" : "FCF"}</span>
                    <span className="tabular-nums">{fB(worksheet.tv, curr)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>PV of Terminal Value</span>
                    <span className="text-[hsl(38,95%,55%)] tabular-nums">{fB(worksheet.pvTv, curr)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>TV % of {cashFlowMode === "fcfe" ? "Equity Value" : "EV"}</span>
                    <span className={`tabular-nums ${worksheet.tvPct > 75 ? "text-[hsl(20,90%,55%)]" : ""}`}>{worksheet.tvPct.toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {/* Bridge: EV → Equity → Per Share */}
              <div className="p-3 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">{cashFlowMode === "fcfe" ? "EQUITY VALUE → PER SHARE" : "EV → EQUITY BRIDGE"}</span>
                  <OverrideStatusBadge count={bridgeOv.overrideCount} onResetAll={bridgeOv.resetAll} />
                </div>
                <div className="space-y-1 font-terminal text-[9px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{cashFlowMode === "fcfe" ? "Equity Value (direct)" : "Enterprise Value"}</span>
                    <span className="tabular-nums">{fB(worksheet.ev, curr)}</span>
                  </div>
                  {cashFlowMode === "fcff" && (
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground flex-1">Net Debt (−)</span>
                      <input
                        type="number" placeholder={realNetDebt != null ? `Filed: ${(realNetDebt / 1e9).toFixed(2)}` : "Default 15% mktcap"} value={netDebtOverride}
                        onChange={e => setNetDebtOverride(e.target.value)}
                        className="w-20 bg-[#0c0c0c] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] text-right"
                      />
                      <span className="text-muted-foreground text-[8px]">B</span>
                    </div>
                  )}
                  <EditableValue variant="field" label="Preferred Equity (−)" value={bridgeInputs.preferredEquity / 1e9} decimals={2} suffix="B" prefix={curr} isOverridden={bridgeOv.isOverridden("preferredEquity")} onReset={() => bridgeOv.resetOverride("preferredEquity")} onChange={v => bridgeOv.setOverride("preferredEquity", v * 1e9)} />
                  <EditableValue variant="field" label="Minority Interest (−)" value={bridgeInputs.minorityInterest / 1e9} decimals={2} suffix="B" prefix={curr} isOverridden={bridgeOv.isOverridden("minorityInterest")} onReset={() => bridgeOv.resetOverride("minorityInterest")} onChange={v => bridgeOv.setOverride("minorityInterest", v * 1e9)} />
                  <EditableValue variant="field" label="Pension Liabilities (−)" value={bridgeInputs.pensionLiabilities / 1e9} decimals={2} suffix="B" prefix={curr} isOverridden={bridgeOv.isOverridden("pensionLiabilities")} onReset={() => bridgeOv.resetOverride("pensionLiabilities")} onChange={v => bridgeOv.setOverride("pensionLiabilities", v * 1e9)} />
                  <EditableValue variant="field" label="Lease Adjustments (−)" value={bridgeInputs.leaseAdjustments / 1e9} decimals={2} suffix="B" prefix={curr} isOverridden={bridgeOv.isOverridden("leaseAdjustments")} onReset={() => bridgeOv.resetOverride("leaseAdjustments")} onChange={v => bridgeOv.setOverride("leaseAdjustments", v * 1e9)} />
                  <EditableValue variant="field" label="Non-Operating Assets (+)" value={bridgeInputs.nonOperatingAssets / 1e9} decimals={2} suffix="B" prefix={curr} isOverridden={bridgeOv.isOverridden("nonOperatingAssets")} onReset={() => bridgeOv.resetOverride("nonOperatingAssets")} onChange={v => bridgeOv.setOverride("nonOperatingAssets", v * 1e9)} />
                  <EditableValue variant="field" label="JV Stakes (+)" value={bridgeInputs.jointVentureStakes / 1e9} decimals={2} suffix="B" prefix={curr} isOverridden={bridgeOv.isOverridden("jointVentureStakes")} onReset={() => bridgeOv.resetOverride("jointVentureStakes")} onChange={v => bridgeOv.setOverride("jointVentureStakes", v * 1e9)} />
                  <div className="flex justify-between border-t border-border pt-1 mt-1">
                    <span className="text-muted-foreground">Equity Value</span>
                    <span className="tabular-nums">{fB(worksheet.equityValue, curr)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground flex-1">Shares Out (M) (÷)</span>
                    <input
                      type="number" placeholder={`${(sharesOut / 1e6).toFixed(0)}`} value={sharesOverride}
                      onChange={e => setSharesOverride(e.target.value)}
                      className="w-20 bg-[#0c0c0c] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] text-right"
                    />
                    <span className="text-muted-foreground text-[8px]">M</span>
                  </div>
                  <div className="flex justify-between border-t-2 border-[hsl(38,95%,50%)/40%] pt-1.5 mt-1">
                    <span className="font-bold text-foreground">INTRINSIC VALUE / SHARE</span>
                    <span className={`font-bold text-base tabular-nums ${uptxt}`}>{curr}{formatPrice(worksheet.intrinsicPS)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MARKET PRICE</span>
                    <span className="tabular-nums">{curr}{formatPrice(spot)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MARGIN OF SAFETY</span>
                    <span className={`tabular-nums font-bold ${uptxt}`}>{worksheet.upside > 0 ? "+" : ""}{worksheet.upside.toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {/* Sensitivity table */}
              <div className="p-3">
                <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-1.5">
                  SENSITIVITY: {cashFlowMode === "fcfe" ? "Ke" : "WACC"} × TERM GROWTH → INTRINSIC PRICE
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[8px] font-terminal">
                    <thead>
                      <tr>
                        <th className="py-0.5 px-1 text-muted-foreground text-left">TG\{cashFlowMode === "fcfe" ? "Ke" : "WACC"}</th>
                        {sensitivityGrid.waccSteps.map(w => (
                          <th key={w} className="py-0.5 px-1 text-center text-[hsl(38,95%,55%)]">{w.toFixed(1)}%</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sensitivityGrid.grid.map((row, ri) => (
                        <tr key={ri}>
                          <td className="py-0.5 px-1 text-[hsl(142,71%,55%)]">{sensitivityGrid.tgSteps[ri].toFixed(1)}%</td>
                          {row.map((cell, ci) => {
                            const isBase =
                              Math.abs(cell.wacc - computedWACC) < 0.1 &&
                              Math.abs(cell.tg - termGrowth) < 0.1;
                            const vs = cell.val > spot;
                            return (
                              <td key={ci} className={`py-0.5 px-1 text-center tabular-nums ${
                                isBase ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)] font-bold ring-1 ring-inset ring-[hsl(38,95%,50%)/40%]" :
                                vs ? "text-[hsl(142,71%,50%)]" : "text-[hsl(0,80%,55%)]"
                              }`}>
                                {curr}{cell.val.toFixed(0)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Global sensitivity (Sobol) -- real Saltelli/SALib variance
                  decomposition over a closed-form 2-stage DCF, cross-checked
                  against the local WACC x TG grid + growth ladder above. */}
              <div className="p-3 border-t border-border/40">
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5 text-amber-500" />
                    <span className="font-terminal text-[8px] tracking-widest text-muted-foreground uppercase font-bold">GLOBAL SENSITIVITY (SOBOL)</span>
                  </div>
                  <button
                    onClick={runDcfSensitivity}
                    disabled={dcfSensitivity.isPending}
                    className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-[hsl(38,95%,55%)] border border-amber-500/30 transition-colors font-terminal text-[8px] tracking-widest disabled:opacity-40"
                  >
                    <Gauge className="w-2.5 h-2.5" /> {dcfSensitivity.isPending ? "RUNNING…" : "RUN GLOBAL SENSITIVITY"}
                  </button>
                </div>
                <p className="font-terminal text-[7.5px] text-muted-foreground leading-relaxed mb-2">
                  Real Sobol variance decomposition (Saltelli sampling, SALib) over a closed-form 2-stage DCF built from this worksheet's real Year-1 FCF base ({curr}{formatPrice(dcfSobolInputs.fcf0)}) and {YEARS}-year horizon -- growth sampled {(dcfSobolInputs.growthRange[0] * 100).toFixed(1)}% to {(dcfSobolInputs.growthRange[1] * 100).toFixed(1)}%, {cashFlowMode === "fcfe" ? "Ke" : "WACC"} {(dcfSobolInputs.waccRange[0] * 100).toFixed(1)}% to {(dcfSobolInputs.waccRange[1] * 100).toFixed(1)}%, terminal growth {(dcfSobolInputs.tgRange[0] * 100).toFixed(1)}% to {(dcfSobolInputs.tgRange[1] * 100).toFixed(1)}%. Ranks which input drives the most variance in intrinsic value -- not a point estimate.
                </p>

                {dcfSensitivity.isError && (
                  <div className="mb-2 px-2 py-1 border border-rose-500/40 bg-rose-500/5 font-terminal text-[7.5px] text-rose-400">
                    {(dcfSensitivity.error as Error).message}
                  </div>
                )}

                {!dcfSensitivity.data ? (
                  <div className="text-[8px] font-terminal text-muted-foreground/50 italic py-2">
                    {dcfSensitivity.isPending ? "Sampling the DCF's parameter space…" : 'Click "RUN GLOBAL SENSITIVITY" to compute real Sobol indices.'}
                  </div>
                ) : (() => {
                  const data = dcfSensitivity.data;
                  const factorLabels: Record<string, string> = {
                    growth: "REVENUE GROWTH",
                    wacc: cashFlowMode === "fcfe" ? "COST OF EQUITY (Ke)" : "WACC",
                    termGrowth: "TERMINAL GROWTH",
                  };
                  const ranked = data.paramNames
                    .map((name, i) => ({ name, first: data.firstOrder[i], total: data.totalOrder[i] }))
                    .sort((a, b) => b.total - a.total);
                  const sobolTop = ranked[0].name;
                  const localTop = localSwingCheck.growthSwing >= localSwingCheck.waccSwing && localSwingCheck.growthSwing >= localSwingCheck.tgSwing
                    ? "growth"
                    : localSwingCheck.waccSwing >= localSwingCheck.tgSwing ? "wacc" : "termGrowth";
                  return (
                    <div className="space-y-1.5">
                      {ranked.map((row, rank) => (
                        <div key={row.name} className="flex items-center gap-2 font-terminal text-[8px]">
                          <span className={`w-4 text-center font-bold ${rank === 0 ? "text-amber-500" : "text-muted-foreground"}`}>#{rank + 1}</span>
                          <span className="w-32 text-muted-foreground">{factorLabels[row.name]}</span>
                          <div className="flex-1 h-2.5 bg-border/20 relative overflow-hidden">
                            <div className="h-full bg-[hsl(38,95%,50%)]" style={{ width: `${Math.max(0, Math.min(100, row.total * 100))}%` }} />
                          </div>
                          <span className="w-28 text-right tabular-nums text-foreground">S1={row.first.toFixed(2)} ST={row.total.toFixed(2)}</span>
                        </div>
                      ))}
                      <p className="text-[7.5px] font-terminal text-muted-foreground leading-normal italic pt-1">
                        {sobolTop === localTop
                          ? `Cross-check: agrees with the local sensitivity above -- both rank ${factorLabels[sobolTop]} as the biggest driver of intrinsic value.`
                          : `Cross-check: the local one-at-a-time grid/ladder's biggest swing was ${factorLabels[localTop]}, but the global Sobol study ranks ${factorLabels[sobolTop]} highest -- likely because the local grid's step sizes aren't proportional to each parameter's realistic range, while Sobol samples the full specified range for each.`}
                      </p>
                    </div>
                  );
                })()}
              </div>

              {isInternal && (
                <div className="p-3">
                  <ChallengeAssumption
                    assumptionLabel="Revenue growth rate"
                    assumptionValue={`${(rows[0]?.revenueGrowth ?? DEFAULT_YEAR_ROW.revenueGrowth).toFixed(1)}%`}
                    results={growthChallengeResults}
                  />
                </div>
              )}

            </div>
          </div>

          {/* FCF Chart */}
          <div className="shrink-0 border-t border-border h-28 bg-[#060606] px-4 pt-1">
            <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-0.5">FCF TREND</div>
            <ResponsiveContainer width="100%" height={88}>
              <LineChart data={worksheet.projections} margin={{ top: 4, right: 8, bottom: 4, left: 48 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,10%)" vertical={false} />
                <XAxis dataKey="year" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={v => fB(v, curr)} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => [fB(v, curr)]} contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                <ReferenceLine y={0} stroke="hsl(0,0%,20%)" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="fcf" stroke="hsl(38,95%,55%)" strokeWidth={1.5} dot={{ r: 2, fill: "hsl(38,95%,55%)" }} name="FCF" />
                <Line type="monotone" dataKey="pv" stroke="hsl(186,80%,55%)" strokeWidth={1.2} dot={false} strokeDasharray="4 2" name="PV FCF" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
           TAB 2: LBO
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === "lbo" && (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
            {/* LBO Summary Cards */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "ENTRY EV",          formula: "Y5 EBITDA basis reversed to Y0 × Entry Multiple", val: fB(lboModel.entryEV, curr), cls: "" },
                { label: "SPONSOR EQUITY IN", formula: "Entry EV − Entry Debt (Σ tranche leverage × EBITDA)", val: fB(lboModel.sponsorEntry, curr), cls: "" },
                { label: "EXIT EV",            formula: "Year-5 EBITDA × Exit Multiple", val: fB(lboModel.exitEV, curr), cls: "" },
                { label: "DEBT REMAINING",    formula: "Entry Debt − 5yr FCF sweep (EBITDA − Σ tranche interest − Capex), paid down in seniority order", val: fB(lboModel.debt, curr), cls: "text-[hsl(0,80%,55%)]" },
                { label: "ACCUM. CASH", formula: lboRecap ? "0 -- excess FCF is distributed as an interim recap each year instead of retained" : "Free cash flow left over each year once every tranche is fully repaid, retained on the balance sheet until exit", val: fB(lboModel.accumulatedCash, curr), cls: lboModel.accumulatedCash > 0 ? "text-[hsl(200,90%,60%)]" : "" },
                { label: "SPONSOR EQUITY OUT",formula: "Exit EV − Debt Remaining + Accumulated Cash", val: fB(lboModel.sponsorExit, curr), cls: "text-[hsl(142,71%,55%)]" },
                { label: "MOIC",               formula: "Total Sponsor Proceeds (interim recaps + exit) / Sponsor Equity In", val: `${lboModel.moic.toFixed(2)}x`, cls: lboModel.moic >= 2 ? "text-[hsl(142,71%,55%)]" : "" },
                { label: "IRR (5-YEAR)",       formula: "Newton-Raphson/bisection solve on the real per-year sponsor cash-flow stream (entry outflow, any interim recap, exit proceeds)", val: lboModel.irr === null ? "N/A" : `${lboModel.irr.toFixed(1)}%`, cls: lboModel.irr !== null && lboModel.irr >= 15 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(20,90%,55%)]" },
                { label: "HURDLE (>15%)",      formula: "IRR ≥ 15% sponsor hurdle rate", val: lboModel.irr !== null && lboModel.irr >= 15 ? "✅ PASS" : "❌ FAIL", cls: lboModel.irr !== null && lboModel.irr >= 15 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,55%)]" },
              ].map(c => (
                <div key={c.label} className="bg-[#080808] border border-border p-3">
                  <FormulaTooltip formula={c.formula} className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{c.label}</FormulaTooltip>
                  <div className={`font-terminal text-base font-bold tabular-nums ${c.cls || "text-foreground"}`}>{c.val}</div>
                </div>
              ))}
            </div>
            <div className="font-terminal text-[8px] text-muted-foreground border border-border p-2.5 leading-relaxed">
              LBO model holds the company for 5 years. Debt paydown is driven by annual FCF (EBITDA − interest across all tranches − Capex), swept to the most senior tranche first. Free cash flow left over once every tranche is fully repaid is {lboRecap ? "distributed to the sponsor immediately as an interim dividend recap" : "retained as balance-sheet cash and added to exit equity"} — toggle this in LBO Assumptions. IRR is solved on the real per-year sponsor cash-flow stream, not a CAGR shortcut. Sponsor IRR threshold: 15%.
            </div>

            {/* GP/LP Carry Waterfall */}
            <div className="border border-border bg-[#080808]">
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">GP / LP CARRY WATERFALL</span>
                <span className="font-terminal text-[7px] text-muted-foreground/60">RETURN OF CAPITAL → {carryHurdle}% PREFERRED → 100% GP CATCH-UP → {(100 - carryPct)}/{carryPct} SPLIT</span>
              </div>
              <div className="grid grid-cols-6 gap-3 p-3">
                {[
                  { label: "RETURN OF CAPITAL", val: fB(carryModel.returnOfCapital, curr), cls: "" },
                  { label: "PREFERRED PAID",     val: fB(carryModel.preferredProfitPaid, curr), cls: "" },
                  { label: "GP CATCH-UP",        val: fB(carryModel.catchupPaid, curr), cls: "" },
                  { label: "GP CARRY TOTAL",      val: fB(carryModel.gpCarryTotal, curr), cls: "text-[hsl(38,95%,55%)]" },
                  { label: "LP NET MOIC",         val: `${carryModel.lpNetMoic.toFixed(2)}x`, cls: "text-[hsl(142,71%,55%)]" },
                  { label: "LP NET IRR",          val: carryModel.lpNetIrr === null ? "N/A" : `${carryModel.lpNetIrr.toFixed(1)}%`, cls: "text-[hsl(142,71%,55%)]" },
                ].map(c => (
                  <div key={c.label}>
                    <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{c.label}</div>
                    <div className={`font-terminal text-sm font-bold tabular-nums ${c.cls || "text-foreground"}`}>{c.val}</div>
                  </div>
                ))}
              </div>
              <div className="px-3 pb-3 font-terminal text-[7px] text-muted-foreground/60 leading-relaxed">
                GP carry lands at {carryModel.gpCarryPctOfTotalProfit.toFixed(1)}% of total profit above capital returned (with a full 100% catch-up, this always equals the {carryPct}% carry rate exactly, regardless of hurdle). Simplification: waterfall is applied to aggregate distributions, then the LP's share is allocated back across years pro-rata to each year's share of total cash — standard for a single-deal LBO, not a full deal-by-deal fund waterfall.
              </div>
            </div>
          </div>
          {/* LBO Inputs */}
          <div className="w-72 shrink-0 border-l border-border bg-[#060606] p-4 space-y-3 overflow-y-auto scrollbar-thin">
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">LBO ASSUMPTIONS</div>
            {[
              { label: "ENTRY MULTIPLE (x EBITDA)", val: entryMult, set: setEntryMult },
              { label: "EXIT MULTIPLE (x EBITDA)",  val: exitMult,  set: setExitMult  },
            ].map(f => (
              <EditableValue variant="field" key={f.label} label={f.label} value={f.val} decimals={1} suffix="x" onChange={f.set} />
            ))}
            <EditableValue variant="field" label="CAPEX (% OF EBITDA)" value={lboCapexPct} decimals={1} suffix="%" onChange={setLboCapexPct} />

            <label className="flex items-center justify-between pt-1 cursor-pointer">
              <span className="font-terminal text-[8px] text-muted-foreground">DISTRIBUTE EXCESS CASH AS RECAP</span>
              <input type="checkbox" checked={lboRecap} onChange={e => setLboRecap(e.target.checked)} className="accent-[hsl(38,95%,50%)]" />
            </label>

            <div className="pt-2 border-t border-border/40 space-y-2">
              <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">GP / LP WATERFALL</span>
              <EditableValue variant="field" label="PREFERRED RETURN (HURDLE)" value={carryHurdle} decimals={1} suffix="%" onChange={setCarryHurdle} />
              <EditableValue variant="field" label="GP CARRY" value={carryPct} decimals={1} suffix="%" onChange={setCarryPct} />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">DEBT TRANCHES (SENIORITY ORDER)</span>
              <button onClick={addTranche} className="font-terminal text-[7px] px-1.5 py-0.5 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">+ TRANCHE</button>
            </div>
            {tranches.map((t, i) => (
              <div key={t.id} className="border border-border/40 p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)] tracking-widest">{i === 0 ? "MOST SENIOR" : `RANK ${i + 1}`}</span>
                  {tranches.length > 1 && (
                    <button onClick={() => removeTranche(t.id)} className="text-muted-foreground hover:text-[hsl(0,80%,60%)]"><X className="w-2.5 h-2.5" /></button>
                  )}
                </div>
                <div className="flex items-center justify-between py-1">
                  <input
                    value={t.label}
                    onChange={e => updateTranche(t.id, { label: e.target.value.toUpperCase() })}
                    className="bg-transparent border-b border-border/40 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)/50%] w-32"
                  />
                </div>
                <EditableValue variant="field" label="LEVERAGE (x EBITDA)" value={t.leverageMult} decimals={2} suffix="x" onChange={v => updateTranche(t.id, { leverageMult: v })} />
                <EditableValue variant="field" label="INTEREST RATE" value={t.interestRate} decimals={2} suffix="%" onChange={v => updateTranche(t.id, { interestRate: v })} />
              </div>
            ))}
            <div className="flex items-center justify-between pt-1 border-t border-border/40">
              <span className="font-terminal text-[8px] text-muted-foreground">TOTAL LEVERAGE</span>
              <span className="font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{tranches.reduce((s, t) => s + t.leverageMult, 0).toFixed(2)}x</span>
            </div>

            <div className="font-terminal text-[7px] text-muted-foreground/60 pt-2 leading-relaxed">
              Uses Y1 EBITDA margin & growth from FCF Worksheet. FCF sweep pays down tranches in the order listed above (most senior first).
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
           TAB 3: DUPONT & INSOLVENCY
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === "dupont" && (
        <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-6">
          {/* DuPont Tree */}
          <div>
            <div className="font-terminal text-[9px] tracking-widest text-muted-foreground mb-2">3-STAGE DUPONT DECOMPOSITION — ROE</div>
            <div className="bg-[#080808] border border-border p-4 space-y-4">
              <div className="flex flex-col items-center p-3 bg-[hsl(38,95%,50%)/10%] border border-[hsl(38,95%,50%)/30%] max-w-xs mx-auto text-center">
                <FormulaTooltip formula="Net Profit Margin × Asset Turnover × Leverage Multiplier" className="font-terminal text-[8px] text-muted-foreground tracking-widest">RETURN ON EQUITY (ROE)</FormulaTooltip>
                <span className="font-terminal text-2xl font-bold text-[hsl(38,95%,55%)]">{(dupontModel.roe * 100).toFixed(2)}%</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "NET PROFIT MARGIN", val: `${(dupontModel.npm * 100).toFixed(2)}%`, desc: "Net Income / Sales" },
                  { label: "ASSET TURNOVER",    val: `${dupontModel.ato.toFixed(3)}x`,         desc: "Sales / Total Assets" },
                  { label: "LEVERAGE MULT.",    val: `${dupontModel.lm.toFixed(2)}x`,           desc: "Assets / Equity" },
                ].map(n => (
                  <div key={n.label} className="bg-[#050505] border border-border p-3 text-center">
                    <span className="font-terminal text-[8px] text-muted-foreground block tracking-wider mb-1">{n.label}</span>
                    <span className="font-terminal text-lg font-bold">{n.val}</span>
                    <p className="font-terminal text-[7px] text-muted-foreground mt-1">{n.desc}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">RAW INPUTS — CLICK ANY VALUE TO EDIT</span>
                  <OverrideStatusBadge count={dupontOv.overrideCount} onResetAll={dupontOv.resetAll} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 border-t border-border/30">
                  {([
                    { key: "netIncome", label: "NET INCOME" },
                    { key: "revenue", label: "REVENUE" },
                    { key: "totalAssets", label: "TOTAL ASSETS" },
                    { key: "totalEquity", label: "TOTAL EQUITY" },
                  ] as const).map(f => (
                    <EditableValue
                      key={f.key} variant="field" label={f.label} decimals={1} suffix="M" prefix={curr}
                      value={dupontInputs[f.key] / 1e6}
                      isOverridden={dupontOv.isOverridden(f.key)}
                      onReset={() => dupontOv.resetOverride(f.key)}
                      onChange={v => dupontOv.setOverride(f.key, v * 1e6)}
                    />
                  ))}
                </div>
                {!incCurrent && !balCurrent && (
                  <p className="font-terminal text-[7px] text-muted-foreground mt-1">No filed data found for {symbol} — showing an illustrative estimate. Type your own figures above for a real DuPont breakdown.</p>
                )}
              </div>
            </div>
          </div>
          {/* Altman Z-Score + Piotroski F-Score -- seeded from real filed
              balance-sheet/income/cash-flow figures when LSE has them, but
              every raw input below is click-to-edit either way. */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#080808] border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">ALTMAN Z-SCORE {altmanHasLiveData ? "(REAL FILED DATA)" : "(MANUAL ENTRY)"}</span>
                <OverrideStatusBadge count={altmanOv.overrideCount} onResetAll={altmanOv.resetAll} />
              </div>
              <FormulaTooltip formula="1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5">
                <span className={`font-terminal text-3xl font-bold ${altmanResult.zone === "safe" ? "text-[hsl(142,71%,55%)]" : altmanResult.zone === "grey" ? "text-[hsl(38,95%,55%)]" : "text-[hsl(0,80%,55%)]"}`}>
                  {altmanResult.zScore.toFixed(3)}
                </span>
              </FormulaTooltip>
              <div className="font-terminal text-[9px] mt-1 text-muted-foreground">
                {altmanResult.zone === "safe" ? "SAFE ZONE — Low bankruptcy risk" :
                 altmanResult.zone === "grey" ? "GREY ZONE — Moderate risk" :
                 "DISTRESS ZONE — Elevated bankruptcy risk"}
              </div>
              <div className="mt-3 grid grid-cols-5 gap-1 font-terminal text-[7px] text-muted-foreground">
                {([
                  { label: "X1", formula: "(Current Assets − Current Liabilities) / Total Assets", val: altmanResult.x1 },
                  { label: "X2", formula: "Retained Earnings / Total Assets", val: altmanResult.x2 },
                  { label: "X3", formula: "EBIT / Total Assets", val: altmanResult.x3 },
                  { label: "X4", formula: "Market Cap / Total Liabilities", val: altmanResult.x4 },
                  { label: "X5", formula: "Revenue / Total Assets", val: altmanResult.x5 },
                ]).map(x => (
                  <div key={x.label} className="border border-border/50 p-1.5 text-center">
                    <FormulaTooltip formula={x.formula}>{x.label}</FormulaTooltip>
                    <div className="text-foreground font-bold">{x.val.toFixed(2)}</div>
                  </div>
                ))}
              </div>
              {!altmanHasLiveData && (
                <p className="font-terminal text-[7px] text-muted-foreground mt-2">No filed data found for {symbol} — inputs default to 0. Type the raw figures below to compute a real score.</p>
              )}
              <div className="mt-3 border-t border-border/30 max-h-56 overflow-y-auto scrollbar-thin">
                {([
                  { key: "totalCurrentAssets", label: "TOTAL CURRENT ASSETS" },
                  { key: "totalCurrentLiabilities", label: "TOTAL CURRENT LIABILITIES" },
                  { key: "totalAssets", label: "TOTAL ASSETS" },
                  { key: "retainedEarnings", label: "RETAINED EARNINGS" },
                  { key: "ebit", label: "EBIT" },
                  { key: "marketCapitalization", label: "MARKET CAP" },
                  { key: "totalLiabilities", label: "TOTAL LIABILITIES" },
                  { key: "revenue", label: "REVENUE" },
                ] as const).map(f => (
                  <EditableValue
                    key={f.key} variant="field" label={f.label} decimals={1} suffix="M" prefix={curr}
                    value={altmanInputs[f.key] / 1e6}
                    isOverridden={altmanOv.isOverridden(f.key)}
                    onReset={() => altmanOv.resetOverride(f.key)}
                    onChange={v => altmanOv.setOverride(f.key, v * 1e6)}
                  />
                ))}
              </div>
            </div>
            <div className="bg-[#080808] border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">PIOTROSKI F-SCORE {piotroskiHasLiveData ? "(REAL, YoY)" : "(MANUAL ENTRY)"}</span>
                <OverrideStatusBadge count={piotroskiCurOv.overrideCount + piotroskiPriorOv.overrideCount} onResetAll={() => { piotroskiCurOv.resetAll(); piotroskiPriorOv.resetAll(); }} />
              </div>
              <FormulaTooltip formula="Count of 9 YoY criteria passed (profitability, leverage/liquidity, operating efficiency)">
                <span className={`font-terminal text-3xl font-bold ${piotroskiResult.score >= 7 ? "text-[hsl(142,71%,55%)]" : piotroskiResult.score >= 4 ? "text-[hsl(38,95%,55%)]" : "text-[hsl(0,80%,55%)]"}`}>
                  {piotroskiResult.score}/9
                </span>
              </FormulaTooltip>
              <div className="mt-2 space-y-0.5 font-terminal text-[7.5px] text-muted-foreground max-h-24 overflow-y-auto scrollbar-thin">
                {piotroskiResult.criteria.map((c) => (
                  <div key={c.label} className="flex items-center gap-1.5">
                    <span className={c.passed ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,55%)]"}>{c.passed ? "✓" : "✗"}</span>
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
              {!piotroskiHasLiveData && (
                <p className="font-terminal text-[7px] text-muted-foreground mt-2">Needs 2 years of filed balance/income/ratios/cash-flow data — not fully available for {symbol}. Type the raw figures below to compute a real score.</p>
              )}
              <div className="mt-3 border-t border-border/30 max-h-56 overflow-y-auto scrollbar-thin grid grid-cols-2 gap-x-3">
                <div>
                  <div className="font-terminal text-[7px] tracking-widest text-muted-foreground py-1">CURRENT YEAR</div>
                  <PiotroskiYearEditor ov={piotroskiCurOv} inputs={piotroskiCurInputs} curr={curr} />
                </div>
                <div>
                  <div className="font-terminal text-[7px] tracking-widest text-muted-foreground py-1">PRIOR YEAR</div>
                  <PiotroskiYearEditor ov={piotroskiPriorOv} inputs={piotroskiPriorInputs} curr={curr} />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-[#080808] border border-border p-4 font-terminal text-[9px] text-muted-foreground space-y-1.5">
            <div className="text-foreground font-bold mb-2 tracking-widest">MODEL NOTES</div>
            <p>DCF projects 10 years of free cash flow using your per-year inputs. FCF = NOPAT + D&A − CapEx − ΔNWC.</p>
            <p>Terminal value uses the selected Gordon, exit-multiple, hybrid, value-driver, or H-model fade method. Growth must remain below the discount rate.</p>
            <p>DuPont, Altman Z-Score and Piotroski F-Score are seeded from real filed balance-sheet/income/cash-flow figures via LSE's financial_reports (SEC-sourced) when available. Every raw input is click-to-edit — type your own figures for a scenario, or for tickers with no filed data.</p>
          </div>
        </div>
      )}

      {activeTab === "ratios" && (
        <RatiosTab
          symbol={symbol} curr={curr} price={spot} eps={eps} marketCap={marketCap ?? null}
          balCurrent={balCurrent} balPrior={balPrior} incCurrent={incCurrent} incPrior={incPrior}
          cfCurrent={cfCurrent} cfPrior={cfPrior}
          incomeReportsFull={incomeReports} balanceReportsFull={balanceReports}
          computedWaccPct={computedWACC}
        />
      )}
      {activeTab === "ddm" && (
        <DDMTab
          symbol={symbol} curr={curr} price={spot} eps={eps} marketCap={marketCap ?? null}
          balCurrent={balCurrent} balPrior={balPrior} incCurrent={incCurrent} incPrior={incPrior}
          cfCurrent={cfCurrent} cfPrior={cfPrior} onResult={onDdmResult}
        />
      )}
      {activeTab === "beneish" && (
        <BeneishTab
          symbol={symbol} curr={curr} price={spot} eps={eps} marketCap={marketCap ?? null}
          balCurrent={balCurrent} balPrior={balPrior} incCurrent={incCurrent} incPrior={incPrior}
          cfCurrent={cfCurrent} cfPrior={cfPrior}
        />
      )}
      {activeTab === "ohlson" && (
        <OhlsonTab
          symbol={symbol} curr={curr} price={spot} eps={eps} marketCap={marketCap ?? null}
          balCurrent={balCurrent} balPrior={balPrior} incCurrent={incCurrent} incPrior={incPrior}
          cfCurrent={cfCurrent} cfPrior={cfPrior}
        />
      )}
      {activeTab === "comps" && (
        <CompsTab
          symbol={symbol} curr={curr} price={spot} eps={eps} marketCap={marketCap ?? null}
          balCurrent={balCurrent} balPrior={balPrior} incCurrent={incCurrent} incPrior={incPrior}
          cfCurrent={cfCurrent} cfPrior={cfPrior}
          externalMethods={modelAgreementMethods.filter(m => !m.method.startsWith("comps_"))}
          onMethodsChange={onCompsMethodsChange}
        />
      )}
      {activeTab === "earnings_quality" && (
        <EarningsQualityTab
          symbol={symbol} curr={curr} price={spot} eps={eps} marketCap={marketCap ?? null}
          balCurrent={balCurrent} balPrior={balPrior} incCurrent={incCurrent} incPrior={incPrior}
          cfCurrent={cfCurrent} cfPrior={cfPrior}
          incomeReportsFull={incomeReports} balanceReportsFull={balanceReports}
        />
      )}
      {activeTab === "residual_income" && (
        <ResidualIncomeTab
          symbol={symbol} curr={curr} price={spot} sharesOut={sharesOut}
          costOfEquity={costOfEquity} termGrowth={termGrowth}
          bookValueOfEquity={balCurrent?.totalStockholdersEquity ?? null}
          forecastNetIncome={worksheet.projections.map(p => p.nopat)}
          onResult={onResidualIncomeResult}
        />
      )}
      {activeTab === "eva" && (
        <EvaTab
          symbol={symbol} curr={curr} price={spot} sharesOut={sharesOut}
          computedWACC={computedWACC} termGrowth={termGrowth}
          currentNopat={currentNopat} currentInvestedCapital={currentInvestedCapital}
          forecastNopat={worksheet.projections.map(p => p.nopat)}
          forecastCapex={worksheet.projections.map(p => p.capex)}
          forecastDa={worksheet.projections.map(p => p.da)}
          forecastNwcChange={worksheet.projections.map(p => p.nwcChange)}
          netDebt={worksheet.netDebt} bridgeInputs={bridgeInputs}
          onResult={onEvaResult}
        />
      )}
      {activeTab === "reverse_dcf" && (
        <ReverseDcfTab
          symbol={symbol} curr={curr}
          currentMarketEV={(marketCap ?? 0) + (realNetDebt ?? 0)}
          marketEquityValue={marketCap ?? 0}
          netDebt={realNetDebt ?? 0}
          computedWACC={computedWACC} termGrowth={termGrowth}
          fcfForecast={worksheet.projections.map(p => p.fcf)}
          baseRevenueStartingPoint={baseRevenue}
          revenueGrowthStartingPoint={rows[0].revenueGrowth}
          ebitMarginStartingPoint={rows[0].ebitdaMargin - rows[0].daPercent}
          taxRateStartingPoint={rows[0].taxRate}
          daPercentStartingPoint={rows[0].daPercent}
          capexPercentStartingPoint={rows[0].capexPercent}
          nwcChangePercentStartingPoint={rows[0].nwcChangePercent}
          forecastYears={YEARS}
        />
      )}
      {activeTab === "asset_value" && (
        <AssetValueTab
          symbol={symbol} curr={curr} price={spot} sharesOut={sharesOut}
          balanceSheet={balCurrent} onResult={onAssetValueResult}
        />
      )}
      {activeTab === "model_agreement" && (
        <ModelAgreementTab symbol={symbol} curr={curr} price={spot} sharesOut={sharesOut} methods={modelAgreementMethods} />
      )}
      {activeTab === "estimate_intelligence" && (
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin" data-testid="estimate-intelligence-panel" aria-label="Estimate intelligence">
          <div className="mb-3 border-b border-border pb-3">
            <div className="font-terminal text-[9px] tracking-widest text-foreground">ESTIMATE INTELLIGENCE</div>
            <div className="mt-1 font-mono text-[7px] leading-4 text-muted-foreground">
              Vintage-aware estimates from the existing point-in-time snapshot. Revisions, dispersion, surprises and model divergence are shown only when the source inputs resolve.
            </div>
            {estimateIntelligence.sourceProvider && (
              <div className="mt-1 font-mono text-[7px] text-muted-foreground" data-testid="estimate-intelligence-provenance">
                PROVIDER {estimateIntelligence.sourceProvider} · RETRIEVED {estimateIntelligence.retrievedAt?.slice(0, 10) ?? "UNAVAILABLE"} · STATUS SNAPSHOT
              </div>
            )}
          </div>
          {estimateIntelligence.aggregateMessage && (
            <div className="mb-3 border border-[hsl(38,95%,50%)/40%] bg-[hsl(38,95%,50%)/5%] p-3 font-mono text-[8px] text-[hsl(38,95%,65%)]" data-testid="estimate-intelligence-aggregate-note">
              {estimateIntelligence.aggregateMessage}
            </div>
          )}
          {estimateIntelligence.links.length === 0 ? (
            <div className="border border-border/70 p-4 font-mono text-[8px] text-muted-foreground" data-testid="estimate-intelligence-empty">
              NO CONTRIBUTOR ESTIMATE VINTAGES ARE AVAILABLE. Aggregate target/recommendation fields, when present, remain separate and are not converted into contributor rows.
            </div>
          ) : (
            <div className="space-y-3">
              {estimateIntelligence.links.map(({ group, linked, reason }) => (
                <section key={`${group.key.metric}:${group.key.fiscalPeriod}:${group.key.unit}:${group.key.currency ?? ""}`} className="border border-border/70" data-testid="estimate-intelligence-group">
                  <div className="border-b border-border/70 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-terminal text-[9px] tracking-widest">{group.key.metric.toUpperCase()}</span>
                      <span className="font-mono text-[8px] text-emerald-300">{group.key.fiscalPeriod}</span>
                      <span className="font-mono text-[8px] text-muted-foreground">{group.key.unit} · {group.key.currency ?? "CURRENCY UNAVAILABLE"}</span>
                      <span className={`ml-auto font-terminal text-[7px] tracking-widest ${linked ? "text-emerald-300" : "text-muted-foreground"}`} data-testid="estimate-intelligence-link-status">
                        {linked ? "LINKED TO DCF SCENARIO" : "NOT LINKED"}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[7px] text-muted-foreground">{reason} · MANUAL DCF ASSUMPTIONS PRESERVED.</div>
                  </div>
                  <div className="p-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_90px_90px_80px_100px] gap-2 border-b border-border/50 px-1 py-1 font-mono text-[7px] text-muted-foreground">
                      <span>PROVIDER / CONTRIBUTOR</span><span>VINTAGE</span><span className="text-right">ESTIMATE</span><span>REVISION</span><span>STATUS / SOURCE</span>
                    </div>
                    {group.latest.map((observation) => (
                      <div key={`${observation.provider}:${observation.contributor}:${observation.vintageAt}`} className="grid grid-cols-[minmax(0,1fr)_90px_90px_80px_100px] gap-2 px-1 py-1 font-mono text-[8px]">
                        <span className="truncate" title={`${observation.provider} · ${observation.contributor}`}>{observation.provider} · {observation.contributor}</span>
                        <span className="text-muted-foreground">{observation.vintageAt.slice(0, 10)}</span>
                        <span className="text-right tabular-nums">{estimateIntelligenceDisplayValue(observation.estimateValue, observation.unit, curr)}</span>
                        <span className={observation.revisionDirection === "up" ? "text-emerald-300" : observation.revisionDirection === "down" ? "text-red-300" : "text-muted-foreground"}>
                          {observation.revisionPct == null ? "—" : `${observation.revisionPct > 0 ? "+" : ""}${observation.revisionPct.toFixed(2)}%`}
                        </span>
                        <span className="truncate text-muted-foreground" title={`${observation.status} · ${observation.sourceReference}`}>{observation.status} · {observation.sourceReference}</span>
                      </div>
                    ))}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/50 pt-2 font-mono text-[8px] text-muted-foreground">
                      {group.revisionMomentum !== null && <span>REVISION MOMENTUM <strong className="text-foreground">{group.revisionMomentum.toFixed(2)}%</strong> · SOURCE {group.latest[0]?.provider ?? "UNAVAILABLE"} · STATUS DERIVED</span>}
                      {group.dispersion && <span>DISPERSION <strong className="text-foreground">{group.dispersion.dispersionPct == null ? "—" : `${group.dispersion.dispersionPct.toFixed(2)}%`}</strong> · {group.dispersion.contributorCount} CONTRIBUTORS · PERIOD {group.key.fiscalPeriod} · UNIT {group.key.unit}</span>}
                      {group.internalDivergence && <span>ESTIMATE VS INTERNAL <strong className="text-foreground">{estimateIntelligenceDisplayValue(group.internalDivergence.difference, group.key.unit, curr)}</strong> ({group.internalDivergence.differencePct == null ? "—" : `${group.internalDivergence.differencePct.toFixed(2)}%`}) · SOURCE {group.internalDivergence.sourceReference ?? "MODEL"} · STATUS {group.internalDivergence.status}</span>}
                      {group.actual?.surprise !== null && group.actual?.surprise !== undefined && <span>ACTUAL SURPRISE <strong className="text-foreground">{estimateIntelligenceDisplayValue(group.actual.surprise, group.key.unit, curr)}</strong> ({group.actual.surprisePct == null ? "—" : `${group.actual.surprisePct.toFixed(2)}%`}) · SOURCE {group.actual.sourceReference ?? "UNAVAILABLE"} · AS OF {group.actual.reportedAt.slice(0, 10)} · STATUS {group.actual.status}</span>}
                      {group.contributorAccuracy.filter((accuracy) => accuracy.resolvedCount > 0).map((accuracy) => (
                        <span key={`${accuracy.provider}:${accuracy.contributor}`}>ACCURACY {accuracy.contributor} <strong className="text-foreground">{accuracy.accuracyPct == null ? "—" : `${accuracy.accuracyPct.toFixed(2)}%`}</strong> · PROVIDER {accuracy.provider} · PERIOD {accuracy.fiscalPeriod} · STATUS DERIVED</span>
                      ))}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      {activeTab === "provider_data" && (
        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
          <div className="mb-3 border-b border-border pb-3">
            <div className="font-terminal text-[9px] tracking-widest text-foreground">PROVIDER DATA — SEGMENTS &amp; ESTIMATES</div>
            <div className="mt-1 font-mono text-[7px] leading-4 text-muted-foreground">Snapshot-backed views only; values are not blended into the valuation model. Expand to inspect more rows.</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="border border-border/70">
              <div className="border-b border-border/70 px-3 py-2">
                <div className="font-terminal text-[8px] tracking-widest">REVENUE SEGMENTATION</div>
                {latestSnapshotPeriod && <div className="mt-1 font-mono text-[7px] text-muted-foreground">FMP · {latestSnapshotPeriod.period === "FY" ? "FY" : latestSnapshotPeriod.period} {latestSnapshotPeriod.fiscalYear} · AS OF {financialSnapshot?.retrievedAt.slice(0, 10)}</div>}
              </div>
              {segmentRows.length === 0 ? <div className="p-3 font-mono text-[8px] text-muted-foreground">NO FMP SEGMENT SNAPSHOT AVAILABLE.</div> : <div className="p-2">
                <div className="grid grid-cols-[80px_minmax(0,1fr)_100px] gap-2 border-b border-border/50 px-1 py-1 font-mono text-[7px] text-muted-foreground"><span>TYPE</span><span>SEGMENT</span><span className="text-right">REVENUE</span></div>
                {segmentRows.slice(0, showAllProviderData ? 100 : 20).map((row) => <div key={`${row.kind}:${row.name}`} className="grid grid-cols-[80px_minmax(0,1fr)_100px] gap-2 px-1 py-1 font-mono text-[8px]"><span className="text-emerald-300">{row.kind}</span><span className="truncate" title={row.name}>{row.name}</span><span className="text-right tabular-nums">{fB(row.value, curr)}</span></div>)}
                {segmentRows.length > 20 && <button onClick={() => setShowAllProviderData((value) => !value)} className="mt-2 border border-border px-2 py-1 font-terminal text-[7px] text-muted-foreground">{showAllProviderData ? "SHOW FEWER" : `SHOW ALL (${Math.min(segmentRows.length, 100)})`}</button>}
              </div>}
            </section>
            <section className="border border-border/70">
              <div className="border-b border-border/70 px-3 py-2">
                <div className="font-terminal text-[8px] tracking-widest">ANALYST ESTIMATES</div>
                {estimateSnapshot && <div className="mt-1 font-mono text-[7px] text-muted-foreground">{estimateSnapshot.provider} · AS OF {estimateSnapshot.retrievedAt.slice(0, 10)} · PUBLISHED {estimateSnapshot.publishedAt?.slice(0, 10) ?? "UNAVAILABLE"}</div>}
              </div>
              {estimateRows.length === 0 ? <div className="p-3 font-mono text-[8px] text-muted-foreground">NO FMP ESTIMATE SNAPSHOT AVAILABLE. CAPTURE ONE IN DATA FABRIC.</div> : <div className="p-2">
                <div className="grid grid-cols-[70px_minmax(0,1fr)_90px] gap-2 border-b border-border/50 px-1 py-1 font-mono text-[7px] text-muted-foreground"><span>PERIOD</span><span>METRIC / SOURCE</span><span className="text-right">VALUE</span></div>
                {estimateRows.slice(0, showAllProviderData ? 100 : 20).map((row, index) => <div key={`${row.metric}:${row.periodEnd}:${index}`} className="grid grid-cols-[70px_minmax(0,1fr)_90px] gap-2 px-1 py-1 font-mono text-[8px]"><span className="text-emerald-300">{row.fiscalPeriod}</span><span className="truncate" title={`${row.contributor} · ${row.metric}`}>{row.metric} · {row.contributor}</span><span className="text-right tabular-nums">{row.unit === "per_share" ? `${curr}${formatPrice(row.value)}` : fB(row.value, curr)}</span></div>)}
                {estimateRows.length > 20 && <button onClick={() => setShowAllProviderData((value) => !value)} className="mt-2 border border-border px-2 py-1 font-terminal text-[7px] text-muted-foreground">{showAllProviderData ? "SHOW FEWER" : `SHOW ALL (${Math.min(estimateRows.length, 100)})`}</button>}
              </div>}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
export default memo(ValuationPanel);
