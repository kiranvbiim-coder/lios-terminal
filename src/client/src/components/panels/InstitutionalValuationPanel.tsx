import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Calculator, Database, Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import { useFundamentals, useQuote, useQuoteStatic } from "@/lib/useFinance";
import { useLseFinancials } from "@/lib/useLse";
import { useIndicatorDetail } from "@/lib/useEconomics";
import { useDamodaranIndustryLookup } from "@/lib/useDamodaran";
import { getCurrencySymbol } from "@/lib/finance";
import { computeWacc, syntheticCreditRating, type TerminalValueMethod } from "@/lib/valuationModels";
import {
  DEFAULT_DCF_SCENARIOS,
  applyDcfScenario,
  assessDcfModelSuitability,
  reconcileInstitutionalDcf,
  runDcfScenarios,
  runInstitutionalDcf,
  runProbabilisticDcf,
  type DcfCashFlowMode,
  type DcfDiscountTiming,
  type DcfProbabilisticResult,
  type DcfScenarioKey,
  type DcfYearAssumption,
  type InstitutionalDcfInput,
} from "@/lib/institutionalDcf";
import type { FullBalanceSheetData, FullCashflowData, FullIncomeData } from "./valuation/types";
import ValuationPanel from "./ValuationPanel";
import InstitutionalDcfDiagnosticsPanel from "./valuation/InstitutionalDcfDiagnosticsPanel";

interface Props { symbol: string; }

type WorkspaceSection = "dcf" | "advanced";
type CostCapitalMethod = "long-treasury-capm" | "damodaran-industry" | "manual";

const YEARS = 10;
const MODEL_DEFAULTS = {
  revenueGrowthPct: 8,
  ebitdaMarginPct: 20,
  daPctRevenue: 3,
  taxRatePct: 25,
  capexPctRevenue: 4,
  nwcInvestmentPctRevenue: 1,
};

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const parseOverride = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function parseLatest<T>(reports: Array<{ fiscal_year: string; data: string }> | undefined): T | null {
  if (!reports?.length) return null;
  const latest = [...reports].sort((a, b) => b.fiscal_year.localeCompare(a.fiscal_year))[0];
  try { return JSON.parse(latest.data) as T; } catch { return null; }
}

function parseLatestTwo<T>(reports: Array<{ fiscal_year: string; data: string }> | undefined): [T | null, T | null] {
  if (!reports?.length) return [null, null];
  const sorted = [...reports].sort((a, b) => b.fiscal_year.localeCompare(a.fiscal_year));
  const parse = (row?: { data: string }) => {
    if (!row) return null;
    try { return JSON.parse(row.data) as T; } catch { return null; }
  };
  return [parse(sorted[0]), parse(sorted[1])];
}

function fmtMoney(value: number | null, currency: string) {
  if (!finite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${currency}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${currency}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${currency}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${currency}${abs.toFixed(2)}`;
}

function fmtPct(value: number | null, digits = 1) {
  return finite(value) ? `${value.toFixed(digits)}%` : "—";
}

function statusClass(status: "ok" | "watch" | "critical") {
  if (status === "critical") return "text-red-400 border-red-500/35 bg-red-500/5";
  if (status === "watch") return "text-amber-300 border-amber-500/35 bg-amber-500/5";
  return "text-emerald-400 border-emerald-500/25 bg-emerald-500/5";
}

function provenanceChip(label: string, kind: "source" | "derived" | "manual" | "model") {
  const cls = kind === "source"
    ? "text-cyan-300 border-cyan-500/30"
    : kind === "derived"
      ? "text-emerald-300 border-emerald-500/30"
      : kind === "manual"
        ? "text-amber-300 border-amber-500/30"
        : "text-violet-300 border-violet-500/30";
  return <span className={`border px-1.5 py-0.5 text-[7px] tracking-widest ${cls}`}>{label}</span>;
}

function NumInput({ value, onChange, suffix, width = "w-20" }: { value: number; onChange: (value: number) => void; suffix?: string; width?: string }) {
  return (
    <label className="inline-flex items-center gap-1">
      <input
        type="number"
        step="any"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className={`${width} bg-[#080808] border border-border/70 px-1.5 py-1 text-right font-terminal text-[9px] tabular-nums focus:outline-none focus:border-amber-500/60`}
      />
      {suffix ? <span className="text-[7px] text-muted-foreground">{suffix}</span> : null}
    </label>
  );
}

export default function InstitutionalValuationPanel({ symbol }: Props) {
  const [section, setSection] = useState<WorkspaceSection>("dcf");
  const { data: quote } = useQuote(symbol);
  const { data: quoteStatic } = useQuoteStatic(symbol);
  const { data: fundamentals } = useFundamentals(symbol);
  const { data: incomeReports } = useLseFinancials(symbol, "income");
  const { data: balanceReports } = useLseFinancials(symbol, "balance");
  const { data: cashflowReports } = useLseFinancials(symbol, "cashflow");
  const longTreasury = useIndicatorDetail("DGS20", { points: 2 });
  const tBillReference = useIndicatorDetail("DGS3MO", { points: 2 });
  const industryLookup = useDamodaranIndustryLookup(fundamentals?.industry ?? "", Boolean(fundamentals?.industry));

  const [incCurrent, incPrior] = parseLatestTwo<FullIncomeData>(incomeReports);
  const [balCurrent, balPrior] = parseLatestTwo<FullBalanceSheetData>(balanceReports);
  const cfCurrent = parseLatest<FullCashflowData>(cashflowReports);

  const currency = getCurrencySymbol(symbol);
  const spot = finite(quote?.price) && quote!.price > 0 ? quote!.price : null;
  const marketCap = quoteStatic?.marketCap ?? quote?.marketCap ?? fundamentals?.marketCap ?? null;
  const observedRevenue = finite(incCurrent?.revenue) && incCurrent!.revenue > 0
    ? incCurrent!.revenue
    : (finite(fundamentals?.totalRevenue) && fundamentals!.totalRevenue! > 0 ? fundamentals!.totalRevenue! : null);
  const observedShares = finite(fundamentals?.sharesOutstanding) && fundamentals!.sharesOutstanding! > 0
    ? fundamentals!.sharesOutstanding!
    : (finite(marketCap) && finite(spot) && spot > 0 ? marketCap / spot : null);
  const observedNetDebt = balCurrent
    ? balCurrent.shortTermDebt + balCurrent.longTermDebt - balCurrent.cashAndCashEquivalents
    : null;
  const observedInvestedCapital = balCurrent
    ? balCurrent.shortTermDebt + balCurrent.longTermDebt + balCurrent.totalStockholdersEquity - balCurrent.cashAndCashEquivalents
    : null;
  const filedTaxRatePct = incCurrent && incCurrent.incomeBeforeTax !== 0
    ? clamp((incCurrent.incomeTaxExpense / incCurrent.incomeBeforeTax) * 100, 0, 60)
    : null;
  const observedNopat = incCurrent
    ? incCurrent.ebit * (1 - (filedTaxRatePct ?? MODEL_DEFAULTS.taxRatePct) / 100)
    : null;
  const currentEbitda = incCurrent ? incCurrent.ebit + incCurrent.depreciationAndAmortization : null;
  const currentEbitdaMarginPct = finite(currentEbitda) && finite(observedRevenue) && observedRevenue > 0 ? (currentEbitda / observedRevenue) * 100 : null;
  const currentDaPct = incCurrent && finite(observedRevenue) && observedRevenue > 0
    ? (incCurrent.depreciationAndAmortization / observedRevenue) * 100
    : null;
  const currentCapexPct = cfCurrent && finite(observedRevenue) && observedRevenue > 0
    ? (Math.abs(cfCurrent.capitalExpenditure) / observedRevenue) * 100
    : null;
  const currentRevenueGrowthPct = finite(fundamentals?.revenueGrowth) ? fundamentals!.revenueGrowth! * 100 : null;
  const currentNwc = balCurrent ? balCurrent.netReceivables + balCurrent.inventory - balCurrent.accountPayables : null;
  const priorNwc = balPrior ? balPrior.netReceivables + balPrior.inventory - balPrior.accountPayables : null;
  const currentNwcInvestmentPct = finite(currentNwc) && finite(priorNwc) && finite(observedRevenue) && observedRevenue > 0
    ? ((currentNwc - priorNwc) / observedRevenue) * 100
    : null;

  const dso = balCurrent && incCurrent && finite(incCurrent.revenue) && incCurrent.revenue > 0
    ? (balCurrent.netReceivables / incCurrent.revenue) * 365
    : null;
  const dio = balCurrent && incCurrent && finite(incCurrent.costOfRevenue) && incCurrent.costOfRevenue > 0
    ? (balCurrent.inventory / incCurrent.costOfRevenue) * 365
    : null;
  const dpo = balCurrent && incCurrent && finite(incCurrent.costOfRevenue) && incCurrent.costOfRevenue > 0
    ? (balCurrent.accountPayables / incCurrent.costOfRevenue) * 365
    : null;

  const seedAssumption = useMemo(() => ({
    revenueGrowthPct: finite(currentRevenueGrowthPct) ? clamp(currentRevenueGrowthPct, -20, 30) : MODEL_DEFAULTS.revenueGrowthPct,
    ebitdaMarginPct: finite(currentEbitdaMarginPct) ? clamp(currentEbitdaMarginPct, -20, 70) : MODEL_DEFAULTS.ebitdaMarginPct,
    daPctRevenue: finite(currentDaPct) ? clamp(currentDaPct, 0, 25) : MODEL_DEFAULTS.daPctRevenue,
    taxRatePct: finite(filedTaxRatePct) ? filedTaxRatePct : MODEL_DEFAULTS.taxRatePct,
    capexPctRevenue: finite(currentCapexPct) ? clamp(currentCapexPct, 0, 40) : MODEL_DEFAULTS.capexPctRevenue,
    nwcInvestmentPctRevenue: finite(currentNwcInvestmentPct) ? clamp(currentNwcInvestmentPct, -15, 20) : MODEL_DEFAULTS.nwcInvestmentPctRevenue,
  }), [currentCapexPct, currentDaPct, currentEbitdaMarginPct, currentNwcInvestmentPct, currentRevenueGrowthPct, filedTaxRatePct]);

  const makeSeedYears = () => Array.from({ length: YEARS }, (_, index): DcfYearAssumption => {
    const growthFade = index / Math.max(1, YEARS - 1);
    const matureGrowth = 3;
    return {
      revenueGrowthPct: seedAssumption.revenueGrowthPct + (matureGrowth - seedAssumption.revenueGrowthPct) * growthFade,
      ebitdaMarginPct: seedAssumption.ebitdaMarginPct,
      daPctRevenue: seedAssumption.daPctRevenue,
      taxRatePct: seedAssumption.taxRatePct,
      capexPctRevenue: seedAssumption.capexPctRevenue,
      nwcInvestmentPctRevenue: seedAssumption.nwcInvestmentPctRevenue,
      otherInvestmentPctRevenue: 0,
      netBorrowing: 0,
      costOfDebtPct: 6,
    };
  });

  const [years, setYears] = useState<DcfYearAssumption[]>(makeSeedYears);
  const [cashFlowMode, setCashFlowMode] = useState<DcfCashFlowMode>("fcff");
  const [discountTiming, setDiscountTiming] = useState<DcfDiscountTiming>("mid-year");
  const [stubFractionYears, setStubFractionYears] = useState(0.5);
  const [terminalMethod, setTerminalMethod] = useState<TerminalValueMethod>("gordon");
  const [terminalGrowthPct, setTerminalGrowthPct] = useState(2.5);
  const [exitMultiple, setExitMultiple] = useState(10);
  const [terminalFadeYears, setTerminalFadeYears] = useState(5);
  const [activeScenario, setActiveScenario] = useState<DcfScenarioKey>("base");
  const [costCapitalMethod, setCostCapitalMethod] = useState<CostCapitalMethod>("long-treasury-capm");
  const [manualRiskFreePct, setManualRiskFreePct] = useState(4.5);
  const [erpPct, setErpPct] = useState(5.0);
  const [manualBeta, setManualBeta] = useState(1.0);
  const [manualCostDebtPct, setManualCostDebtPct] = useState(6.0);
  const [terminalWaccSpreadPct, setTerminalWaccSpreadPct] = useState(-0.25);
  const [baseRevenueOverride, setBaseRevenueOverride] = useState("");
  const [sharesOverride, setSharesOverride] = useState("");
  const [netDebtOverride, setNetDebtOverride] = useState("");
  const [investedCapitalOverride, setInvestedCapitalOverride] = useState("");
  const [dilutionPct, setDilutionPct] = useState(0);
  const [bridge, setBridge] = useState({
    preferredEquity: 0,
    minorityInterest: 0,
    pensionLiabilities: 0,
    leaseLiabilities: 0,
    convertibleClaims: 0,
    optionWarrantValue: 0,
    excessCash: 0,
    marketableSecurities: 0,
    nonOperatingAssets: 0,
    jointVentureStakes: 0,
  });
  const [probabilistic, setProbabilistic] = useState<DcfProbabilisticResult | null>(null);
  const initializedSymbol = useRef<string | null>(null);

  useEffect(() => {
    if (initializedSymbol.current === symbol) return;
    initializedSymbol.current = symbol;
    setYears(makeSeedYears());
    setBaseRevenueOverride("");
    setSharesOverride("");
    setNetDebtOverride("");
    setInvestedCapitalOverride("");
    setDilutionPct(0);
    setActiveScenario("base");
    setProbabilistic(null);
  // seedAssumption intentionally participates only when the symbol changes;
  // subsequent provider refreshes must not silently overwrite analyst edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const sourceRfPct = longTreasury.data?.quote.isLive && finite(longTreasury.data.quote.value)
    ? longTreasury.data.quote.value
    : null;
  const betaSource = finite(fundamentals?.beta) ? fundamentals!.beta! : manualBeta;
  const debtWeightSource = balCurrent && finite(marketCap) && marketCap > 0
    ? clamp(((balCurrent.shortTermDebt + balCurrent.longTermDebt) / (marketCap + balCurrent.shortTermDebt + balCurrent.longTermDebt)) * 100, 0, 90)
    : 20;
  const syntheticCoverage = incCurrent && incCurrent.interestExpense !== 0
    ? incCurrent.ebit / Math.abs(incCurrent.interestExpense)
    : null;
  const syntheticRating = finite(syntheticCoverage)
    ? syntheticCreditRating(syntheticCoverage, sourceRfPct ?? manualRiskFreePct)
    : null;
  const selectedCostDebtPct = syntheticRating?.costOfDebt ?? manualCostDebtPct;
  const selectedRiskFreePct = costCapitalMethod === "long-treasury-capm" && finite(sourceRfPct) ? sourceRfPct : manualRiskFreePct;
  const capm = computeWacc({
    riskFreeRate: selectedRiskFreePct,
    erp: erpPct,
    beta: betaSource,
    costOfDebt: selectedCostDebtPct,
    debtWeight: debtWeightSource,
    taxRate: seedAssumption.taxRatePct,
  });
  const industryBenchmark = industryLookup.data;
  const currentWaccPct = costCapitalMethod === "damodaran-industry" && finite(industryBenchmark?.wacc)
    ? industryBenchmark!.wacc!
    : capm.wacc;
  const currentCostOfEquityPct = costCapitalMethod === "damodaran-industry" && finite(industryBenchmark?.costOfEquityPct)
    ? industryBenchmark!.costOfEquityPct!
    : capm.costOfEquity;
  const terminalWaccPct = Math.max(terminalGrowthPct + 0.75, currentWaccPct + terminalWaccSpreadPct);
  const terminalCostEquityPct = Math.max(terminalGrowthPct + 1, currentCostOfEquityPct + terminalWaccSpreadPct);

  const baseRevenue = (parseOverride(baseRevenueOverride) ?? (finite(observedRevenue) ? observedRevenue / 1e9 : null));
  const baseRevenueAbsolute = finite(baseRevenue) ? baseRevenue * 1e9 : null;
  const basicSharesM = parseOverride(sharesOverride) ?? (finite(observedShares) ? observedShares / 1e6 : null);
  const basicShares = finite(basicSharesM) ? basicSharesM * 1e6 : null;
  const dilutedShares = finite(basicShares) ? basicShares * (1 + dilutionPct / 100) : null;
  const netDebtB = parseOverride(netDebtOverride) ?? (finite(observedNetDebt) ? observedNetDebt / 1e9 : null);
  const netDebt = finite(netDebtB) ? netDebtB * 1e9 : null;
  const investedCapitalB = parseOverride(investedCapitalOverride) ?? (finite(observedInvestedCapital) ? observedInvestedCapital / 1e9 : null);
  const investedCapital = finite(investedCapitalB) ? investedCapitalB * 1e9 : null;

  const baseInput: InstitutionalDcfInput = useMemo(() => ({
    baseRevenue: baseRevenueAbsolute,
    basicShares,
    dilutedShares,
    spotPrice: spot,
    startingInvestedCapital: investedCapital,
    startingNetDebt: netDebt,
    startingNopat: observedNopat,
    cashFlowMode,
    years: years.map(year => ({ ...year, costOfDebtPct: selectedCostDebtPct })),
    discount: {
      currentWaccPct,
      terminalWaccPct,
      currentCostOfEquityPct,
      terminalCostOfEquityPct: terminalCostEquityPct,
      maturityFadeYears: 7,
      timing: discountTiming,
      stubFractionYears,
    },
    terminal: {
      method: terminalMethod,
      growthPct: terminalGrowthPct,
      exitMultiple,
      hybridWeightPct: 50,
      fadeStartGrowthPct: years[years.length - 1]?.revenueGrowthPct ?? terminalGrowthPct,
      fadeYears: terminalFadeYears,
    },
    bridge: {
      netDebt,
      ...bridge,
    },
    riskFreeRatePct: selectedRiskFreePct,
    sourceAsOf: incomeReports?.[0]?.date ?? null,
  }), [baseRevenueAbsolute, basicShares, bridge, cashFlowMode, currentCostOfEquityPct, currentWaccPct, dilutedShares, discountTiming, exitMultiple, incomeReports, investedCapital, netDebt, observedNopat, selectedCostDebtPct, selectedRiskFreePct, spot, stubFractionYears, terminalCostEquityPct, terminalFadeYears, terminalGrowthPct, terminalMethod, terminalWaccPct, years]);

  const selectedInput = activeScenario === "base"
    ? baseInput
    : activeScenario === "custom"
      ? baseInput
      : applyDcfScenario(baseInput, DEFAULT_DCF_SCENARIOS[activeScenario]);
  const result = useMemo(() => runInstitutionalDcf(selectedInput), [selectedInput]);
  const scenarioResults = useMemo(() => runDcfScenarios(baseInput), [baseInput]);
  const reconciliation = useMemo(() => reconcileInstitutionalDcf(selectedInput), [selectedInput]);
  const suitability = useMemo(() => assessDcfModelSuitability(fundamentals?.sector, fundamentals?.industry, observedRevenue, incCurrent?.ebit), [fundamentals?.industry, fundamentals?.sector, incCurrent?.ebit, observedRevenue]);

  const updateYear = (index: number, key: keyof DcfYearAssumption, value: number) => {
    setYears(current => current.map((year, yearIndex) => yearIndex === index ? { ...year, [key]: value } : year));
    setActiveScenario("base");
    setProbabilistic(null);
  };

  const fadeGrowthToMaturity = () => {
    setYears(current => current.map((year, index) => {
      const alpha = index / Math.max(1, current.length - 1);
      return { ...year, revenueGrowthPct: current[0].revenueGrowthPct + (terminalGrowthPct - current[0].revenueGrowthPct) * alpha };
    }));
    setActiveScenario("base");
  };

  const resetForecast = () => {
    setYears(makeSeedYears());
    setActiveScenario("base");
    setProbabilistic(null);
  };

  const runProbability = () => {
    const correlationMatrix = [
      [1, 0.45, 0.10, -0.25, 0.25],
      [0.45, 1, 0.10, -0.20, 0.20],
      [0.10, 0.10, 1, 0.10, 0.05],
      [-0.25, -0.20, 0.10, 1, -0.15],
      [0.25, 0.20, 0.05, -0.15, 1],
    ];
    setProbabilistic(runProbabilisticDcf(selectedInput, {
      runs: 2_000,
      seed: 424242,
      growthShockPctPoints: { low: -3, mode: 0, high: 3 },
      marginShockPctPoints: { low: -2, mode: 0, high: 2 },
      capexShockPctPoints: { low: -0.75, mode: 0, high: 0.75 },
      waccShockPctPoints: { low: -1, mode: 0, high: 1.25 },
      terminalGrowthShockPctPoints: { low: -0.6, mode: 0, high: 0.5 },
      correlationMatrix,
    }));
  };

  if (section === "advanced") {
    return (
      <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
        <div className="shrink-0 flex items-center justify-between border-b border-border/60 bg-[#090909] px-3 py-1.5">
          <div className="font-terminal text-[9px] tracking-widest text-muted-foreground">ADVANCED VALUATION MODELS · EXISTING DEEP DESK</div>
          <button onClick={() => setSection("dcf")} className="font-terminal text-[8px] border border-amber-500/40 px-2 py-1 text-amber-300">← INSTITUTIONAL DCF</button>
        </div>
        <div className="flex-1 min-h-0"><ValuationPanel symbol={symbol} /></div>
      </div>
    );
  }

  const readinessColor = result.status === "ready" ? "text-emerald-400" : result.status === "partial" ? "text-amber-300" : "text-red-400";

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground font-terminal scrollbar-thin">
      <div className="sticky top-0 z-20 border-b border-border/70 bg-[#070707]/95 backdrop-blur px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-[10px] tracking-[0.18em] font-bold"><Calculator className="w-3.5 h-3.5 text-amber-400" /> INSTITUTIONAL DCF / FCF WORKBENCH <span className="text-cyan-300">{symbol}</span></div>
            <div className="mt-1 text-[7px] text-muted-foreground tracking-widest">SOURCE → NORMALIZATION → ASSUMPTIONS → CASH FLOW → TERMINAL VALUE → BRIDGE → SCENARIO → DIAGNOSTICS</div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-[8px] tracking-widest ${readinessColor}`}>{result.status.toUpperCase()}</span>
            <button onClick={() => setSection("advanced")} className="border border-border px-2 py-1 text-[8px] text-muted-foreground hover:text-foreground">ADVANCED MODELS</button>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3 pb-20">
        <section className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.85fr] gap-3">
          <div className="border border-border/70 bg-[#080808]">
            <div className="px-3 py-2 border-b border-border/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><Database className="w-3.5 h-3.5 text-cyan-300" /><span className="text-[9px] tracking-widest">SOURCE READINESS & INPUT PROVENANCE</span></div>
              <div className="flex gap-1">{provenanceChip("SOURCE DATA", "source")}{provenanceChip("DERIVED", "derived")}{provenanceChip("ANALYST", "manual")}{provenanceChip("MODEL", "model")}</div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border/30">
              <div className="bg-[#080808] p-2.5"><div className="text-[7px] text-muted-foreground">BASE REVENUE</div><div className="text-[12px] mt-1">{fmtMoney(baseRevenueAbsolute, currency)}</div><div className="mt-1">{baseRevenueOverride ? provenanceChip("ANALYST", "manual") : observedRevenue ? provenanceChip("FILED/PROVIDER", "source") : provenanceChip("MISSING", "manual")}</div></div>
              <div className="bg-[#080808] p-2.5"><div className="text-[7px] text-muted-foreground">DILUTED SHARES</div><div className="text-[12px] mt-1">{finite(dilutedShares) ? `${(dilutedShares / 1e6).toFixed(1)}M` : "—"}</div><div className="mt-1">{sharesOverride ? provenanceChip("ANALYST", "manual") : fundamentals?.sharesOutstanding ? provenanceChip("PROVIDER", "source") : observedShares ? provenanceChip("MKT CAP ÷ PRICE", "derived") : provenanceChip("MISSING", "manual")}</div></div>
              <div className="bg-[#080808] p-2.5"><div className="text-[7px] text-muted-foreground">NET DEBT</div><div className="text-[12px] mt-1">{fmtMoney(netDebt, currency)}</div><div className="mt-1">{netDebtOverride ? provenanceChip("ANALYST", "manual") : observedNetDebt !== null ? provenanceChip("FILED", "source") : provenanceChip("MISSING", "manual")}</div></div>
              <div className="bg-[#080808] p-2.5"><div className="text-[7px] text-muted-foreground">INVESTED CAPITAL</div><div className="text-[12px] mt-1">{fmtMoney(investedCapital, currency)}</div><div className="mt-1">{investedCapitalOverride ? provenanceChip("ANALYST", "manual") : observedInvestedCapital !== null ? provenanceChip("FILED/DERIVED", "derived") : provenanceChip("MISSING", "manual")}</div></div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 p-2.5 border-t border-border/60 text-[8px]">
              <label>Revenue Y0 (B)<input value={baseRevenueOverride} onChange={e => setBaseRevenueOverride(e.target.value)} placeholder={finite(observedRevenue) ? (observedRevenue / 1e9).toFixed(2) : "REQUIRED"} className="mt-1 w-full bg-black border border-border p-1.5" /></label>
              <label>Basic shares (M)<input value={sharesOverride} onChange={e => setSharesOverride(e.target.value)} placeholder={finite(observedShares) ? (observedShares / 1e6).toFixed(1) : "REQUIRED"} className="mt-1 w-full bg-black border border-border p-1.5" /></label>
              <label>Net debt (B)<input value={netDebtOverride} onChange={e => setNetDebtOverride(e.target.value)} placeholder={finite(observedNetDebt) ? (observedNetDebt / 1e9).toFixed(2) : "REQUIRED"} className="mt-1 w-full bg-black border border-border p-1.5" /></label>
              <label>Invested capital (B)<input value={investedCapitalOverride} onChange={e => setInvestedCapitalOverride(e.target.value)} placeholder={finite(observedInvestedCapital) ? (observedInvestedCapital / 1e9).toFixed(2) : "VALUE DRIVER OPTIONAL"} className="mt-1 w-full bg-black border border-border p-1.5" /></label>
            </div>
            {result.blockingIssues.length ? <div className="border-t border-red-500/20 bg-red-500/5 px-3 py-2 text-[8px] text-red-300 space-y-1">{result.blockingIssues.map(issue => <div key={issue}>• {issue}</div>)}</div> : null}
          </div>

          <div className="border border-border/70 bg-[#080808]">
            <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /><span className="text-[9px] tracking-widest">MODEL SUITABILITY</span></div>
            <div className="p-3 space-y-2">
              <div className="flex items-end justify-between"><div><div className="text-[7px] text-muted-foreground">SUITABILITY</div><div className={`text-[15px] mt-1 ${suitability.suitability === "high" ? "text-emerald-400" : suitability.suitability === "medium" ? "text-amber-300" : "text-red-400"}`}>{suitability.suitability.toUpperCase()}</div></div><div className="text-right"><div className="text-[7px] text-muted-foreground">PRIMARY</div><div className="text-[10px] text-cyan-300 mt-1">{suitability.primaryMethod}</div></div></div>
              {suitability.reasons.map(reason => <div key={reason} className="text-[8px] text-muted-foreground leading-relaxed">{reason}</div>)}
              <div className="text-[7px] text-muted-foreground">COMPANIONS · {suitability.companionMethods.join(" · ")}</div>
            </div>
          </div>
        </section>

        <section className="border border-border/70 bg-[#080808]">
          <div className="px-3 py-2 border-b border-border/60 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Gauge className="w-3.5 h-3.5 text-amber-400" /><span className="text-[9px] tracking-widest">COST OF CAPITAL & DISCOUNT TIMING</span></div>
            <div className="flex gap-1">
              {(["long-treasury-capm", "damodaran-industry", "manual"] as CostCapitalMethod[]).map(method => <button key={method} onClick={() => setCostCapitalMethod(method)} className={`px-2 py-1 border text-[7px] ${costCapitalMethod === method ? "border-amber-500/60 text-amber-300 bg-amber-500/10" : "border-border text-muted-foreground"}`}>{method === "long-treasury-capm" ? "20Y TREASURY + CAPM" : method === "damodaran-industry" ? "DAMODARAN INDUSTRY" : "MANUAL"}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-px bg-border/30 text-[8px]">
            <div className="bg-[#080808] p-2"><div className="text-muted-foreground text-[7px]">20Y TREASURY</div><div className="text-cyan-300 text-[11px] mt-1">{fmtPct(sourceRfPct, 2)}</div><div className="text-[6.5px] text-muted-foreground mt-1">FRED DGS20 · {longTreasury.data?.quote.asOf ?? "unavailable"}</div></div>
            <div className="bg-[#080808] p-2"><div className="text-muted-foreground text-[7px]">3M REFERENCE</div><div className="text-[11px] mt-1">{fmtPct(tBillReference.data?.quote.value ?? null, 2)}</div><div className="text-[6.5px] text-muted-foreground mt-1">REFERENCE ONLY · NOT DEFAULT DCF Rf</div></div>
            <div className="bg-[#080808] p-2"><div className="text-muted-foreground text-[7px]">ERP</div><NumInput value={erpPct} onChange={setErpPct} suffix="%" /><div className="text-[6.5px] text-amber-300 mt-1">ANALYST / POLICY INPUT</div></div>
            <div className="bg-[#080808] p-2"><div className="text-muted-foreground text-[7px]">BETA</div><NumInput value={betaSource} onChange={setManualBeta} suffix="x" /><div className="text-[6.5px] text-cyan-300 mt-1">{fundamentals?.beta ? "PROVIDER" : "ANALYST"}</div></div>
            <div className="bg-[#080808] p-2"><div className="text-muted-foreground text-[7px]">COST OF DEBT</div><NumInput value={selectedCostDebtPct} onChange={setManualCostDebtPct} suffix="%" /><div className="text-[6.5px] text-cyan-300 mt-1">{syntheticRating ? `SYNTHETIC ${syntheticRating.rating}` : "ANALYST"}</div></div>
            <div className="bg-[#080808] p-2"><div className="text-muted-foreground text-[7px]">CURRENT WACC</div><div className="text-[12px] text-amber-300 mt-1">{fmtPct(currentWaccPct, 2)}</div><div className="text-[6.5px] text-muted-foreground mt-1">{costCapitalMethod === "damodaran-industry" ? industryBenchmark?.industry ?? "BENCHMARK UNAVAILABLE" : "COMPUTED"}</div></div>
            <div className="bg-[#080808] p-2"><div className="text-muted-foreground text-[7px]">TERMINAL WACC</div><div className="text-[12px] mt-1">{fmtPct(terminalWaccPct, 2)}</div><NumInput value={terminalWaccSpreadPct} onChange={setTerminalWaccSpreadPct} suffix="pp" width="w-14" /></div>
            <div className="bg-[#080808] p-2"><div className="text-muted-foreground text-[7px]">DISCOUNT TIMING</div><select value={discountTiming} onChange={e => setDiscountTiming(e.target.value as DcfDiscountTiming)} className="mt-1 bg-black border border-border p-1 text-[8px] w-full"><option value="mid-year">MID-YEAR</option><option value="year-end">YEAR-END</option><option value="stub">ACTUAL/STUB</option></select>{discountTiming === "stub" ? <NumInput value={stubFractionYears} onChange={value => setStubFractionYears(clamp(value, 0.01, 1))} suffix="yr" width="w-12" /> : null}</div>
          </div>
          {costCapitalMethod === "manual" ? <div className="border-t border-border/50 p-2 flex items-center gap-3 text-[8px]"><span>MANUAL RISK-FREE</span><NumInput value={manualRiskFreePct} onChange={setManualRiskFreePct} suffix="%" /><span className="text-muted-foreground">Manual mode is an analyst assumption; the 20Y and 3M source references remain visible for comparison.</span></div> : null}
        </section>

        <section className="border border-border/70 bg-[#080808] overflow-x-auto">
          <div className="px-3 py-2 border-b border-border/60 flex flex-wrap items-center justify-between gap-2 sticky left-0 bg-[#080808]">
            <div><div className="text-[9px] tracking-widest">10-YEAR OPERATING / REINVESTMENT FORECAST</div><div className="text-[7px] text-muted-foreground mt-1">Growth is checked against reinvestment × return on new capital. Invested capital rolls forward; terminal ROIC no longer divides terminal NOPAT by today's capital base.</div></div>
            <div className="flex gap-1"><button onClick={fadeGrowthToMaturity} className="border border-cyan-500/35 text-cyan-300 px-2 py-1 text-[7px]">FADE GROWTH → TERMINAL</button><button onClick={resetForecast} className="border border-border px-2 py-1 text-[7px] text-muted-foreground flex items-center gap-1"><RefreshCw className="w-3 h-3" /> RESET SOURCE SEED</button></div>
          </div>
          <table className="w-full min-w-[1180px] text-[8px] tabular-nums">
            <thead className="text-muted-foreground"><tr className="border-b border-border/60"><th className="text-left p-2">YEAR</th><th>REV GROWTH</th><th>EBITDA MGN</th><th>D&A / REV</th><th>CASH TAX</th><th>CAPEX / REV</th><th>ΔNWC / REV</th><th>NET BORROWING</th><th>FCF</th><th>ROIC</th><th>RONIC</th><th>SUPPORTED G</th><th>DISC RATE</th><th>PV FCF</th></tr></thead>
            <tbody>
              {years.map((year, index) => {
                const projection = result.projections[index];
                return <tr key={index} className="border-b border-border/35 hover:bg-white/[0.015]"><td className="p-2 text-amber-300">Y{index + 1}</td><td><NumInput value={year.revenueGrowthPct} onChange={v => updateYear(index, "revenueGrowthPct", v)} suffix="%" width="w-16" /></td><td><NumInput value={year.ebitdaMarginPct} onChange={v => updateYear(index, "ebitdaMarginPct", v)} suffix="%" width="w-16" /></td><td><NumInput value={year.daPctRevenue} onChange={v => updateYear(index, "daPctRevenue", v)} suffix="%" width="w-16" /></td><td><NumInput value={year.taxRatePct} onChange={v => updateYear(index, "taxRatePct", v)} suffix="%" width="w-16" /></td><td><NumInput value={year.capexPctRevenue} onChange={v => updateYear(index, "capexPctRevenue", v)} suffix="%" width="w-16" /></td><td><NumInput value={year.nwcInvestmentPctRevenue} onChange={v => updateYear(index, "nwcInvestmentPctRevenue", v)} suffix="%" width="w-16" /></td><td>{cashFlowMode === "fcfe" ? <NumInput value={(year.netBorrowing ?? 0) / 1e9} onChange={v => updateYear(index, "netBorrowing", v * 1e9)} suffix="B" width="w-16" /> : <span className="text-muted-foreground">—</span>}</td><td className="text-emerald-400 text-center">{projection ? fmtMoney(projection.selectedCashFlow, currency) : "—"}</td><td className="text-center">{projection ? fmtPct(projection.roicPct) : "—"}</td><td className="text-center">{projection ? fmtPct(projection.ronicPct) : "—"}</td><td className="text-center text-cyan-300">{projection ? fmtPct(projection.supportedGrowthPct) : "—"}</td><td className="text-center">{projection ? fmtPct(projection.discountRatePct, 2) : "—"}</td><td className="text-center">{projection ? fmtMoney(projection.pvCashFlow, currency) : "—"}</td></tr>;
              })}
            </tbody>
          </table>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-3">
          <div className="border border-border/70 bg-[#080808]">
            <div className="px-3 py-2 border-b border-border/60 flex flex-wrap items-center justify-between gap-2"><span className="text-[9px] tracking-widest">DCF / FCF RESULT & CONTINUING VALUE</span><div className="flex gap-1">{(["fcff", "fcfe"] as DcfCashFlowMode[]).map(mode => <button key={mode} onClick={() => { setCashFlowMode(mode); if (mode === "fcfe" && terminalMethod === "valueDriver") setTerminalMethod("gordon"); }} className={`px-2 py-1 border text-[7px] ${cashFlowMode === mode ? "border-amber-500/60 text-amber-300" : "border-border text-muted-foreground"}`}>{mode.toUpperCase()}</button>)}</div></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border/30">
              <div className="bg-[#080808] p-3"><div className="text-[7px] text-muted-foreground">PV EXPLICIT FCF</div><div className="text-[13px] mt-1">{fmtMoney(result.pvExplicitCashFlows, currency)}</div></div>
              <div className="bg-[#080808] p-3"><div className="text-[7px] text-muted-foreground">TERMINAL VALUE</div><div className="text-[13px] mt-1">{fmtMoney(result.terminalValue, currency)}</div><div className="text-[7px] text-muted-foreground mt-1">PV {fmtMoney(result.pvTerminalValue, currency)}</div></div>
              <div className="bg-[#080808] p-3"><div className="text-[7px] text-muted-foreground">EQUITY VALUE</div><div className="text-[13px] mt-1">{fmtMoney(result.equityValue, currency)}</div></div>
              <div className="bg-[#080808] p-3"><div className="text-[7px] text-muted-foreground">INTRINSIC / SHARE</div><div className={`text-[18px] mt-1 ${finite(result.upsidePct) && result.upsidePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{finite(result.valuePerShare) ? `${currency}${result.valuePerShare.toFixed(2)}` : "—"}</div><div className="text-[8px] mt-1">{fmtPct(result.upsidePct)} vs {finite(spot) ? `${currency}${spot.toFixed(2)}` : "—"}</div></div>
            </div>
            <div className="p-3 border-t border-border/60 grid grid-cols-1 md:grid-cols-3 gap-2 text-[8px]">
              <label>Terminal method<select value={terminalMethod} onChange={e => setTerminalMethod(e.target.value as TerminalValueMethod)} className="mt-1 w-full bg-black border border-border p-1.5"><option value="gordon">GORDON GROWTH</option><option value="exitMultiple">EXIT MULTIPLE</option><option value="hybrid">HYBRID</option>{cashFlowMode === "fcff" ? <option value="valueDriver">VALUE DRIVER (RONIC)</option> : null}<option value="fadeToMaturity">FADE / H-MODEL</option></select></label>
              <label>Terminal growth<NumInput value={terminalGrowthPct} onChange={setTerminalGrowthPct} suffix="%" /></label>
              <label>Exit EV/EBITDA<NumInput value={exitMultiple} onChange={setExitMultiple} suffix="x" /></label>
            </div>
          </div>

          <div className="border border-border/70 bg-[#080808]">
            <div className="px-3 py-2 border-b border-border/60 text-[9px] tracking-widest">EV → COMMON EQUITY / DILUTION BRIDGE</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 text-[8px]">
              <label>Future dilution<NumInput value={dilutionPct} onChange={setDilutionPct} suffix="%" /></label>
              {Object.entries(bridge).map(([key, value]) => <label key={key} className="capitalize">{key.replace(/([A-Z])/g, " $1")} (B)<NumInput value={value / 1e9} onChange={next => setBridge(current => ({ ...current, [key]: next * 1e9 }))} suffix="B" /></label>)}
            </div>
            <div className="border-t border-border/60 px-3 py-2 text-[7px] text-muted-foreground leading-relaxed">Options/warrants and convertible claims are modeled as explicit claims. Diluted shares are separate so the model does not silently double-count dilution. Leave a claim at zero when no source/analyst value exists.</div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-3">
          <div className="border border-border/70 bg-[#080808]">
            <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between"><div className="flex items-center gap-2"><BarChart3 className="w-3.5 h-3.5 text-cyan-300" /><span className="text-[9px] tracking-widest">BEAR / BASE / BULL SCENARIOS</span></div><div className="flex gap-1">{(["bear", "base", "bull"] as DcfScenarioKey[]).map(key => <button key={key} onClick={() => setActiveScenario(key)} className={`px-2 py-1 border text-[7px] ${activeScenario === key ? "border-amber-500/60 text-amber-300 bg-amber-500/10" : "border-border text-muted-foreground"}`}>{key.toUpperCase()}</button>)}</div></div>
            <div className="grid grid-cols-3 gap-px bg-border/30">
              {scenarioResults.map(({ scenario, result: scenarioResult }) => <button key={scenario.key} onClick={() => setActiveScenario(scenario.key)} className="bg-[#080808] p-3 text-left hover:bg-white/[0.02]"><div className="text-[8px] tracking-widest text-muted-foreground">{scenario.label}</div><div className="text-[16px] mt-1">{finite(scenarioResult.valuePerShare) ? `${currency}${scenarioResult.valuePerShare.toFixed(2)}` : "—"}</div><div className="text-[7px] text-muted-foreground mt-1">{scenario.description}</div></button>)}
            </div>
          </div>

          <div className="border border-border/70 bg-[#080808]">
            <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between"><span className="text-[9px] tracking-widest">PROBABILISTIC DCF</span><button onClick={runProbability} className="border border-violet-500/40 text-violet-300 px-2 py-1 text-[7px]">RUN 2,000 SEEDED PATHS</button></div>
            <div className="grid grid-cols-3 gap-px bg-border/30">
              <div className="bg-[#080808] p-3"><div className="text-[7px] text-muted-foreground">P10</div><div className="text-[13px] text-red-300 mt-1">{finite(probabilistic?.p10) ? `${currency}${probabilistic!.p10!.toFixed(2)}` : "—"}</div></div>
              <div className="bg-[#080808] p-3"><div className="text-[7px] text-muted-foreground">MEDIAN</div><div className="text-[13px] text-amber-300 mt-1">{finite(probabilistic?.median) ? `${currency}${probabilistic!.median!.toFixed(2)}` : "—"}</div></div>
              <div className="bg-[#080808] p-3"><div className="text-[7px] text-muted-foreground">P90</div><div className="text-[13px] text-emerald-300 mt-1">{finite(probabilistic?.p90) ? `${currency}${probabilistic!.p90!.toFixed(2)}` : "—"}</div></div>
            </div>
            <div className="px-3 py-2 text-[7px] text-muted-foreground">Seed 424242 · triangular shocks · explicit correlation matrix · deterministic rerun. Probability above spot: <span className="text-foreground">{fmtPct(probabilistic?.probabilityAboveSpotPct ?? null)}</span></div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-3">
          <div className="border border-border/70 bg-[#080808]">
            <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /><span className="text-[9px] tracking-widest">DCF HEALTH CHECK</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-3">{result.health.map(item => <div key={item.id} className={`border p-2.5 ${statusClass(item.severity)}`}><div className="text-[7px] tracking-widest">{item.label}</div><div className="text-[13px] mt-1">{item.value}</div><div className="text-[7px] mt-1 opacity-75 leading-relaxed">{item.detail}</div></div>)}</div>
            {result.warnings.length ? <div className="border-t border-amber-500/20 px-3 py-2 text-[7px] text-amber-300">{result.warnings.join(" · ")}</div> : null}
          </div>

          <div className="border border-border/70 bg-[#080808]">
            <div className="px-3 py-2 border-b border-border/60 text-[9px] tracking-widest">MODEL RECONCILIATION</div>
            <div className="p-3 space-y-2 text-[8px]"><div className="flex justify-between"><span className="text-muted-foreground">FCFF implied common equity</span><span>{fmtMoney(reconciliation.fcffEquityValue, currency)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">FCFE implied common equity</span><span>{fmtMoney(reconciliation.fcfeEquityValue, currency)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">FCFF ↔ FCFE delta</span><span className={finite(reconciliation.fcffVsFcfeDeltaPct) && Math.abs(reconciliation.fcffVsFcfeDeltaPct) < 5 ? "text-emerald-400" : "text-amber-300"}>{fmtPct(reconciliation.fcffVsFcfeDeltaPct, 2)}</span></div><div className="border-t border-border/50 pt-2 flex justify-between"><span className="text-muted-foreground">EVA implied enterprise value</span><span>{fmtMoney(reconciliation.evaEnterpriseValue, currency)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">DCF ↔ EVA delta</span><span>{fmtPct(reconciliation.dcfVsEvaDeltaPct, 2)}</span></div><div className="text-[7px] text-muted-foreground leading-relaxed">Reconciliation is a diagnostic, not a forced equality. Differences expose inconsistent leverage, discount-rate, terminal or invested-capital assumptions.</div></div>
          </div>
        </section>

        <InstitutionalDcfDiagnosticsPanel input={selectedInput} currency={currency} />

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="border border-border/70 bg-[#080808] p-3"><div className="text-[9px] tracking-widest mb-2">WORKING-CAPITAL DRIVERS</div><div className="grid grid-cols-3 gap-2"><div><div className="text-[7px] text-muted-foreground">DSO</div><div className="text-[12px]">{finite(dso) ? `${dso.toFixed(1)}d` : "—"}</div></div><div><div className="text-[7px] text-muted-foreground">DIO</div><div className="text-[12px]">{finite(dio) ? `${dio.toFixed(1)}d` : "—"}</div></div><div><div className="text-[7px] text-muted-foreground">DPO</div><div className="text-[12px]">{finite(dpo) ? `${dpo.toFixed(1)}d` : "—"}</div></div></div><div className="text-[7px] text-muted-foreground mt-2">Filed-day metrics are evidence for the ΔNWC forecast. Missing days are not inferred.</div></div>
          <div className="border border-border/70 bg-[#080808] p-3"><div className="text-[9px] tracking-widest mb-2">PP&E / REINVESTMENT</div><div className="flex justify-between text-[8px]"><span className="text-muted-foreground">Opening PP&E</span><span>{fmtMoney(balCurrent?.propertyPlantEquipmentNet ?? null, currency)}</span></div><div className="flex justify-between text-[8px] mt-1"><span className="text-muted-foreground">Filed CapEx</span><span>{fmtMoney(cfCurrent ? Math.abs(cfCurrent.capitalExpenditure) : null, currency)}</span></div><div className="flex justify-between text-[8px] mt-1"><span className="text-muted-foreground">Filed D&A</span><span>{fmtMoney(incCurrent?.depreciationAndAmortization ?? null, currency)}</span></div><div className="text-[7px] text-muted-foreground mt-2">The DCF rolls invested capital using CapEx − D&A + ΔNWC + other investment. Growth is not treated independently from reinvestment.</div></div>
          <div className="border border-border/70 bg-[#080808] p-3"><div className="text-[9px] tracking-widest mb-2">SPECIAL ADJUSTMENTS READINESS</div><div className="space-y-1 text-[8px]"><div className="flex justify-between"><span className="text-muted-foreground">NOL / cash-tax schedule</span><span className="text-amber-300">ANALYST TAX RATE UNTIL BOUND</span></div><div className="flex justify-between"><span className="text-muted-foreground">R&D capitalization</span><span className="text-amber-300">SOURCE FIELD NOT BOUND</span></div><div className="flex justify-between"><span className="text-muted-foreground">SBC / RSU / options</span><span className="text-cyan-300">DILUTION + CLAIM INPUTS AVAILABLE</span></div><div className="flex justify-between"><span className="text-muted-foreground">Convertibles</span><span className="text-cyan-300">EXPLICIT CLAIM INPUT AVAILABLE</span></div></div><div className="text-[7px] text-muted-foreground mt-2">Unavailable specialist inputs remain unavailable; the workstation does not synthesize them.</div></div>
        </section>

        <div className="border border-border/70 bg-[#080808] px-3 py-2 flex items-start gap-2 text-[7px] text-muted-foreground leading-relaxed"><AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" /><div><span className="text-foreground">MODEL GOVERNANCE.</span> Forecast assumptions are analyst/model inputs, not historical facts. Source-derived revenue, shares, net debt, invested capital, Treasury references and filed operating metrics are visibly separated. The default DCF never invents market cap, revenue, shares or a debt bridge when source data are missing.</div></div>
      </div>
    </div>
  );
}
