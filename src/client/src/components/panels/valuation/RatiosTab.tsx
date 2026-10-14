import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOverridable } from "@/lib/useOverridable";
import { EditableValue, OverrideStatusBadge } from "@/components/panels/EditableValue";
import { FormulaTooltip } from "@/components/panels/FormulaTooltip";
import { ExportButton } from "@/components/panels/ExportButton";
import { exportWorkbook } from "@/lib/exportXlsx";
import { MoneyFieldGrid } from "./FieldGrid";
import type { AnalysisTabProps } from "./types";
import { Plus, X } from "lucide-react";
import { CustomLineItemBuilder, type RefOption } from "@/components/panels/CustomLineItemBuilder";
import { useCustomLineItems, evaluateCustomItem, builtinRef, customRef } from "@/lib/customLineItems";
import { computeValueCreationMetrics } from "@/lib/valuationEngines";
import { normalizeFinancialMetric, NORMALIZATION_LIBRARY, type FinancialNormalizationPolicy, type NormalizationAdjustmentKind } from "@shared/financialNormalization";
import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";

type RatioKey =
  | "cash" | "receivables" | "inventory" | "currentAssets" | "currentLiabilities"
  | "totalAssets" | "totalLiabilities" | "totalEquity" | "payables" | "ppe"
  | "shortTermDebt" | "longTermDebt"
  | "revenue" | "cogs" | "grossProfit" | "operatingIncome" | "netIncome" | "interestExpense"
  | "depreciationAndAmortization" | "incomeTaxExpense" | "incomeBeforeTax"
  | "operatingCashFlow" | "capitalExpenditure";

const FIELDS: Array<{ key: RatioKey; label: string }> = [
  { key: "cash", label: "CASH & EQUIVALENTS" },
  { key: "receivables", label: "ACCOUNTS RECEIVABLE" },
  { key: "inventory", label: "INVENTORY" },
  { key: "payables", label: "ACCOUNTS PAYABLE" },
  { key: "ppe", label: "PROPERTY, PLANT & EQUIPMENT" },
  { key: "currentAssets", label: "TOTAL CURRENT ASSETS" },
  { key: "currentLiabilities", label: "TOTAL CURRENT LIABILITIES" },
  { key: "totalAssets", label: "TOTAL ASSETS" },
  { key: "totalLiabilities", label: "TOTAL LIABILITIES" },
  { key: "totalEquity", label: "TOTAL EQUITY" },
  { key: "shortTermDebt", label: "SHORT-TERM DEBT" },
  { key: "longTermDebt", label: "LONG-TERM DEBT" },
  { key: "revenue", label: "REVENUE" },
  { key: "cogs", label: "COST OF REVENUE" },
  { key: "grossProfit", label: "GROSS PROFIT" },
  { key: "operatingIncome", label: "OPERATING INCOME (EBIT)" },
  { key: "depreciationAndAmortization", label: "DEPRECIATION & AMORTIZATION" },
  { key: "netIncome", label: "NET INCOME" },
  { key: "interestExpense", label: "INTEREST EXPENSE" },
  { key: "incomeTaxExpense", label: "INCOME TAX EXPENSE" },
  { key: "incomeBeforeTax", label: "INCOME BEFORE TAX" },
  { key: "operatingCashFlow", label: "OPERATING CASH FLOW" },
  { key: "capitalExpenditure", label: "CAPITAL EXPENDITURE" },
];

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const mult = (n: number) => `${n.toFixed(2)}x`;
const pctOrDash = (n: number | null) => (n === null ? "—" : pct(n));
const moneyOrDash = (n: number | null, curr: string) => (n === null ? "—" : `${curr}${(n / 1e6).toFixed(1)}M`);

// normalizeFinancialMetric() re-injects its normalized figure back into the
// financial-observation pipeline under the same metricId (see
// normalizedObservation() in shared/financialNormalization.ts), so an
// adjustment's metricId must be one of the canonical metrics this tab
// already has a real filed observation for -- not a NORMALIZATION_LIBRARY
// entry itself. NORMALIZATION_LIBRARY (add-back reason, suggested kind) is
// used below to pick the adjustment's label/kind; this list picks *what
// line item* that reason is adjusting.
const NORMALIZATION_TARGET_METRICS: Array<{ id: string; label: string }> = [
  { id: "revenue", label: "Revenue" },
  { id: "operatingIncome", label: "Operating Income (EBIT)" },
  { id: "ebitda", label: "EBITDA" },
  { id: "netIncome", label: "Net Income" },
];

export default function RatiosTab({ symbol, curr, balCurrent, balPrior, incCurrent, incPrior, cfCurrent, incomeReportsFull, balanceReportsFull, computedWaccPct }: AnalysisTabProps & { computedWaccPct?: number }) {
  const ov = useOverridable<RatioKey>();
  const defaults: Record<RatioKey, number> = {
    cash: balCurrent?.cashAndCashEquivalents ?? 0,
    receivables: balCurrent?.netReceivables ?? 0,
    inventory: balCurrent?.inventory ?? 0,
    payables: balCurrent?.accountPayables ?? 0,
    ppe: balCurrent?.propertyPlantEquipmentNet ?? 0,
    currentAssets: balCurrent?.totalCurrentAssets ?? 0,
    currentLiabilities: balCurrent?.totalCurrentLiabilities ?? 0,
    totalAssets: balCurrent?.totalAssets ?? 0,
    totalLiabilities: balCurrent?.totalLiabilities ?? 0,
    totalEquity: balCurrent?.totalStockholdersEquity ?? 0,
    shortTermDebt: balCurrent?.shortTermDebt ?? 0,
    longTermDebt: balCurrent?.longTermDebt ?? 0,
    revenue: incCurrent?.revenue ?? 0,
    cogs: incCurrent?.costOfRevenue ?? 0,
    grossProfit: incCurrent?.grossProfit ?? 0,
    operatingIncome: incCurrent?.operatingIncome ?? 0,
    depreciationAndAmortization: incCurrent?.depreciationAndAmortization ?? 0,
    netIncome: incCurrent?.netIncome ?? 0,
    interestExpense: incCurrent?.interestExpense ?? 0,
    incomeTaxExpense: incCurrent?.incomeTaxExpense ?? 0,
    incomeBeforeTax: incCurrent?.incomeBeforeTax ?? 0,
    operatingCashFlow: cfCurrent?.operatingCashFlow ?? 0,
    capitalExpenditure: cfCurrent?.capitalExpenditure ?? 0,
  };
  const v = Object.fromEntries(FIELDS.map(f => [f.key, ov.getValue(f.key, defaults[f.key])])) as Record<RatioKey, number>;
  const hasLiveData = !!(balCurrent && incCurrent);

  // Normalization -- tenant-scoped, server-persisted analyst adjustment
  // policy for this symbol (add-backs, exclusions, reclassifications) on
  // top of the filed figures above. See shared/financialNormalization.ts;
  // this is its first real (non-test) caller.
  const queryClient = useQueryClient();
  const { data: normalizationPolicies = [] } = useQuery<FinancialNormalizationPolicy[]>({
    queryKey: ["/api/finance/normalization-policies", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/finance/normalization-policies?symbol=${encodeURIComponent(symbol)}`)).json() as Promise<FinancialNormalizationPolicy[]>,
    staleTime: 30_000,
    retry: false,
  });
  const normalizationPolicy = normalizationPolicies[0] ?? null;
  // Adjustments and their reported baseline are matched by period; default
  // to the latest filed fiscal year so a freshly-added adjustment lines up
  // with the reported figures already shown above without extra typing.
  const normalizationPeriod = incomeReportsFull?.[0]?.fiscal_year ? `FY${incomeReportsFull[0].fiscal_year}` : "CURRENT";
  const normalizationEbitda = v.operatingIncome + v.depreciationAndAmortization;
  const normalizationObservations: FinancialMetricObservation[] = useMemo(() => ([
    { metricId: "revenue", value: v.revenue, status: hasLiveData ? "filed" : "manual", period: normalizationPeriod, currency: curr, source: "Ratios tab raw inputs" },
    { metricId: "operatingIncome", value: v.operatingIncome, status: hasLiveData ? "filed" : "manual", period: normalizationPeriod, currency: curr, source: "Ratios tab raw inputs" },
    { metricId: "ebitda", value: normalizationEbitda, status: hasLiveData ? "filed" : "manual", period: normalizationPeriod, currency: curr, source: "Ratios tab raw inputs" },
    { metricId: "netIncome", value: v.netIncome, status: hasLiveData ? "filed" : "manual", period: normalizationPeriod, currency: curr, source: "Ratios tab raw inputs" },
  ]), [v.revenue, v.operatingIncome, v.netIncome, normalizationEbitda, hasLiveData, normalizationPeriod, curr]);
  const normalizationResults = useMemo(() => {
    if (!normalizationPolicy || normalizationPolicy.adjustments.length === 0) return [];
    const metricIds = normalizationPolicy.adjustments.map(a => a.metricId).filter((id, idx, arr) => arr.indexOf(id) === idx);
    return metricIds.map(metricId => normalizeFinancialMetric(metricId, normalizationPeriod, normalizationObservations, normalizationPolicy));
  }, [normalizationPolicy, normalizationObservations, normalizationPeriod]);

  const upsertNormalizationMut = useMutation({
    mutationFn: async (adjustment: { label: string; metricId: string; kind: NormalizationAdjustmentKind; amount: number; period: string; rationale?: string }) => {
      const existingAdjustments = (normalizationPolicy?.adjustments ?? []).map(a => ({ id: a.id, label: a.label, metricId: a.metricId, kind: a.kind, amount: a.amount, period: a.period, rationale: a.rationale, source: a.source }));
      const res = await apiRequest("POST", "/api/finance/normalization-policies", {
        symbol, label: normalizationPolicy?.label ?? `${symbol} Normalization Policy`, adjustments: [...existingAdjustments, adjustment],
      });
      return res.json() as Promise<FinancialNormalizationPolicy>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finance/normalization-policies", symbol] }),
  });
  const deleteNormalizationAdjustmentMut = useMutation({
    mutationFn: async (adjustmentId: string) => {
      if (!normalizationPolicy) return;
      await apiRequest("DELETE", `/api/finance/normalization-policies/${normalizationPolicy.id}/adjustments/${adjustmentId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finance/normalization-policies", symbol] }),
  });

  const [normFormOpen, setNormFormOpen] = useState(false);
  const [normTargetMetric, setNormTargetMetric] = useState(NORMALIZATION_TARGET_METRICS[1].id);
  const [normTypeId, setNormTypeId] = useState(NORMALIZATION_LIBRARY[0].id);
  const [normKind, setNormKind] = useState<NormalizationAdjustmentKind>(NORMALIZATION_LIBRARY[0].suggestedKind);
  const [normAmount, setNormAmount] = useState(0);
  const [normPeriod, setNormPeriod] = useState(normalizationPeriod);
  const [normRationale, setNormRationale] = useState("");
  const submitNormalizationAdjustment = () => {
    const type = NORMALIZATION_LIBRARY.find(t => t.id === normTypeId);
    if (!type || !Number.isFinite(normAmount)) return;
    upsertNormalizationMut.mutate({
      label: type.label, metricId: normTargetMetric, kind: normKind, amount: normAmount,
      period: (normPeriod.trim() || normalizationPeriod), rationale: normRationale.trim() || undefined,
    });
    setNormAmount(0);
    setNormRationale("");
    setNormFormOpen(false);
  };

  // Custom particulars (raw inputs the built-in 14 don't cover) and custom
  // ratios (any combination of built-ins + particulars via +,-,x,/) --
  // every company's statement is structured differently, so a fixed ratio
  // set can never cover every analyst's need (a lender wants FFO/Total Debt,
  // a bank analyst wants Net Interest Margin). See client/src/lib/customLineItems.ts.
  const customParticulars = useCustomLineItems();
  const customRatios = useCustomLineItems();
  const allCustomItems = useMemo(
    () => [...customParticulars.items, ...customRatios.items],
    [customParticulars.items, customRatios.items],
  );
  const getBuiltinValue = (key: string): number | null => (key in v ? v[key as RatioKey] : null);
  const [ratioFormat, setRatioFormat] = useState<Record<string, "ratio" | "percent">>({});

  const particularRefs: RefOption[] = useMemo(
    () => [
      ...FIELDS.map(f => ({ ref: builtinRef(f.key), label: f.label })),
      ...customParticulars.items.map(it => ({ ref: customRef(it.id), label: it.label })),
    ],
    [customParticulars.items],
  );
  const ratioRefs: RefOption[] = useMemo(
    () => [...particularRefs, ...customRatios.items.map(it => ({ ref: customRef(it.id), label: it.label }))],
    [particularRefs, customRatios.items],
  );

  const valueCreation = useMemo(() => computeValueCreationMetrics({
    revenue: v.revenue, operatingIncome: v.operatingIncome, incomeBeforeTax: v.incomeBeforeTax, incomeTaxExpense: v.incomeTaxExpense,
    totalDebt: v.shortTermDebt + v.longTermDebt, totalEquity: v.totalEquity, cash: v.cash,
    currentAssets: v.currentAssets, currentLiabilities: v.currentLiabilities,
    depreciationAndAmortization: v.depreciationAndAmortization, capitalExpenditure: v.capitalExpenditure,
    prior: (incPrior && balPrior) ? {
      revenue: incPrior.revenue, operatingIncome: incPrior.operatingIncome, incomeBeforeTax: incPrior.incomeBeforeTax, incomeTaxExpense: incPrior.incomeTaxExpense,
      totalDebt: balPrior.shortTermDebt + balPrior.longTermDebt, totalEquity: balPrior.totalStockholdersEquity, cash: balPrior.cashAndCashEquivalents,
      currentAssets: balPrior.totalCurrentAssets, currentLiabilities: balPrior.totalCurrentLiabilities,
    } : null,
    wacc: computedWaccPct !== undefined ? computedWaccPct / 100 : undefined,
  }), [v, incPrior, balPrior, computedWaccPct]);
  const hasPriorData = !!(incPrior && balPrior);

  const r = useMemo(() => {
    const ebitda = v.operatingIncome + v.depreciationAndAmortization;
    const totalDebt = v.shortTermDebt + v.longTermDebt;
    const netDebt = totalDebt - v.cash;
    const { nopat, investedCapital } = valueCreation;
    const capitalEmployed = v.totalAssets - v.currentLiabilities;
    const netWorkingCapital = v.currentAssets - v.currentLiabilities;
    const receivablesTurnover = v.receivables > 0 ? v.revenue / v.receivables : 0;
    const inventoryTurnover = v.inventory > 0 ? v.cogs / v.inventory : 0;
    const payablesTurnover = v.payables > 0 ? v.cogs / v.payables : 0;
    const dso = receivablesTurnover > 0 ? 365 / receivablesTurnover : 0;
    const dio = inventoryTurnover > 0 ? 365 / inventoryTurnover : 0;
    const dpo = payablesTurnover > 0 ? 365 / payablesTurnover : 0;
    return {
      currentRatio: v.currentLiabilities > 0 ? v.currentAssets / v.currentLiabilities : 0,
      quickRatio: v.currentLiabilities > 0 ? (v.currentAssets - v.inventory) / v.currentLiabilities : 0,
      cashRatio: v.currentLiabilities > 0 ? v.cash / v.currentLiabilities : 0,
      grossMargin: v.revenue > 0 ? v.grossProfit / v.revenue : 0,
      operatingMargin: v.revenue > 0 ? v.operatingIncome / v.revenue : 0,
      ebitdaMargin: v.revenue > 0 ? ebitda / v.revenue : 0,
      netMargin: v.revenue > 0 ? v.netIncome / v.revenue : 0,
      roa: v.totalAssets > 0 ? v.netIncome / v.totalAssets : 0,
      roe: v.totalEquity > 0 ? v.netIncome / v.totalEquity : 0,
      roic: investedCapital > 0 ? nopat / investedCapital : 0,
      roce: capitalEmployed > 0 ? v.operatingIncome / capitalEmployed : 0,
      croic: investedCapital > 0 ? (v.operatingCashFlow + v.capitalExpenditure) / investedCapital : 0,
      rona: (v.ppe + netWorkingCapital) > 0 ? v.netIncome / (v.ppe + netWorkingCapital) : 0,
      debtToEquity: v.totalEquity > 0 ? v.totalLiabilities / v.totalEquity : 0,
      debtToAssets: v.totalAssets > 0 ? v.totalLiabilities / v.totalAssets : 0,
      debtToCapital: (totalDebt + v.totalEquity) > 0 ? totalDebt / (totalDebt + v.totalEquity) : 0,
      netDebtToEbitda: ebitda > 0 ? netDebt / ebitda : 0,
      interestCoverage: v.interestExpense > 0 ? v.operatingIncome / v.interestExpense : 0,
      assetTurnover: v.totalAssets > 0 ? v.revenue / v.totalAssets : 0,
      receivablesTurnover,
      inventoryTurnover,
      payablesTurnover,
      cashConversionCycle: dio + dso - dpo,
    };
  }, [v, valueCreation]);


  // Multi-year CAGR -- needs more than the current+prior period RatiosTab
  // otherwise works with, so it reads the full report history separately
  // rather than the single-period `v` above.
  const cagr = useMemo(() => {
    function parseSeries(reports: typeof incomeReportsFull, key: string): number[] {
      return (reports ?? []).map((rep) => {
        try { return (JSON.parse(rep.data) as Record<string, number>)[key] ?? null; } catch { return null; }
      }).filter((x): x is number => x !== null);
    }
    function cagrAt(series: number[], yearsBack: number): number | null {
      const latest = series[0];
      const past = series[yearsBack];
      if (latest === undefined || past === undefined || past <= 0 || latest <= 0) return null;
      return Math.pow(latest / past, 1 / yearsBack) - 1;
    }
    const metrics: Array<{ label: string; series: number[] }> = [
      { label: "Revenue", series: parseSeries(incomeReportsFull, "revenue") },
      { label: "EBITDA", series: parseSeries(incomeReportsFull, "ebitda") },
      { label: "EBIT", series: parseSeries(incomeReportsFull, "ebit") },
      { label: "EPS (Diluted)", series: parseSeries(incomeReportsFull, "epsDiluted") },
      { label: "Book Value", series: parseSeries(balanceReportsFull, "totalStockholdersEquity") },
    ];
    return metrics.map((m) => ({
      label: m.label,
      y3: cagrAt(m.series, 3),
      y5: cagrAt(m.series, 5),
      y10: cagrAt(m.series, 10),
    }));
  }, [incomeReportsFull, balanceReportsFull]);
  const hasCagrData = cagr.some((row) => row.y3 !== null || row.y5 !== null || row.y10 !== null);

  const groups: Array<{ title: string; rows: Array<{ label: string; formula: string; val: string }> }> = [
    { title: "LIQUIDITY", rows: [
      { label: "Current Ratio", formula: "Current Assets / Current Liabilities", val: mult(r.currentRatio) },
      { label: "Quick Ratio", formula: "(Current Assets − Inventory) / Current Liabilities", val: mult(r.quickRatio) },
      { label: "Cash Ratio", formula: "Cash & Equivalents / Current Liabilities", val: mult(r.cashRatio) },
    ] },
    { title: "PROFITABILITY", rows: [
      { label: "Gross Margin", formula: "Gross Profit / Revenue", val: pct(r.grossMargin) },
      { label: "Operating Margin", formula: "Operating Income / Revenue", val: pct(r.operatingMargin) },
      { label: "EBITDA Margin", formula: "(Operating Income + D&A) / Revenue", val: pct(r.ebitdaMargin) },
      { label: "Net Margin", formula: "Net Income / Revenue", val: pct(r.netMargin) },
    ] },
    { title: "RETURNS", rows: [
      { label: "Return on Assets", formula: "Net Income / Total Assets", val: pct(r.roa) },
      { label: "Return on Equity", formula: "Net Income / Total Equity", val: pct(r.roe) },
      { label: "ROIC", formula: "NOPAT / (Total Debt + Total Equity − Cash), NOPAT = Operating Income × (1 − effective tax rate)", val: pct(r.roic) },
      { label: "ROCE", formula: "Operating Income / (Total Assets − Current Liabilities)", val: pct(r.roce) },
      { label: "CROIC", formula: "(Operating Cash Flow + CapEx) / (Total Debt + Total Equity − Cash)", val: pct(r.croic) },
      { label: "RONA", formula: "Net Income / (PP&E + Net Working Capital)", val: pct(r.rona) },
    ] },
    { title: "LEVERAGE", rows: [
      { label: "Debt / Equity", formula: "Total Liabilities / Total Equity", val: mult(r.debtToEquity) },
      { label: "Debt / Assets", formula: "Total Liabilities / Total Assets", val: mult(r.debtToAssets) },
      { label: "Debt / Capital", formula: "(ST Debt + LT Debt) / (ST Debt + LT Debt + Total Equity)", val: pct(r.debtToCapital) },
      { label: "Net Debt / EBITDA", formula: "(ST Debt + LT Debt − Cash) / (Operating Income + D&A)", val: mult(r.netDebtToEbitda) },
      { label: "Interest Coverage", formula: "Operating Income / Interest Expense", val: mult(r.interestCoverage) },
    ] },
    { title: "EFFICIENCY", rows: [
      { label: "Asset Turnover", formula: "Revenue / Total Assets", val: mult(r.assetTurnover) },
      { label: "Receivables Turnover", formula: "Revenue / Accounts Receivable", val: mult(r.receivablesTurnover) },
      { label: "Inventory Turnover", formula: "Cost of Revenue / Inventory", val: mult(r.inventoryTurnover) },
      { label: "Payables Turnover", formula: "Cost of Revenue / Accounts Payable", val: mult(r.payablesTurnover) },
      { label: "Cash Conversion Cycle", formula: "Days Inventory + Days Receivables − Days Payables", val: `${r.cashConversionCycle.toFixed(0)}d` },
    ] },
    { title: "VALUE CREATION", rows: [
      { label: "Economic Profit (EVA)", formula: "NOPAT − WACC × Invested Capital" + (computedWaccPct === undefined ? " (WACC not supplied)" : ""), val: moneyOrDash(valueCreation.economicProfit, curr) },
      { label: "Incremental ROIC", formula: "ΔNOPAT / ΔInvested Capital (return earned on capital added since the prior period)", val: pctOrDash(valueCreation.incrementalRoic) },
      { label: "Operating Leverage", formula: "%Δ Operating Income / %Δ Revenue (degree of operating leverage)", val: valueCreation.operatingLeverage === null ? "—" : mult(valueCreation.operatingLeverage) },
      { label: "Incremental Margin", formula: "Δ Operating Income / Δ Revenue", val: pctOrDash(valueCreation.incrementalMargin) },
      { label: "Reinvestment Rate", formula: "(Net CapEx + ΔNon-cash Working Capital) / NOPAT", val: pctOrDash(valueCreation.reinvestmentRate) },
      { label: "Sustainable Growth Rate", formula: "ROIC × Reinvestment Rate", val: pctOrDash(valueCreation.sustainableGrowth) },
    ] },
  ];

  const handleExport = () => {
    exportWorkbook(`${symbol}_ratio_analysis.xlsx`, [
      {
        name: "Ratios",
        rows: [
          ["Category", "Ratio", "Formula", "Value"],
          ...groups.flatMap(g => g.rows.map(row => [g.title, row.label, row.formula, row.val])),
          ...customRatios.items.map(it => [
            "CUSTOM",
            it.label,
            it.kind === "formula" ? "custom formula" : "manual entry",
            evaluateCustomItem(it, 0, getBuiltinValue, allCustomItems) ?? "",
          ]),
        ],
      },
      {
        name: "Raw Inputs",
        rows: [
          ["Line Item", "Value"],
          ...FIELDS.map(f => [f.label, v[f.key]]),
          ...customParticulars.items.map(it => [it.label, evaluateCustomItem(it, 0, getBuiltinValue, allCustomItems) ?? ""]),
        ],
      },
      {
        name: "Growth (CAGR)",
        rows: [
          ["Metric", "3Y CAGR", "5Y CAGR", "10Y CAGR"],
          ...cagr.map(row => [row.label, row.y3 !== null ? pct(row.y3) : "—", row.y5 !== null ? pct(row.y5) : "—", row.y10 !== null ? pct(row.y10) : "—"]),
        ],
      },
    ]);
  };

  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      <div className="flex justify-end">
        <ExportButton onExport={handleExport} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {groups.map(g => (
          <div key={g.title} className="bg-[#080808] border border-border p-3">
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">{g.title}</div>
            <div className="space-y-1.5">
              {g.rows.map(row => (
                <div key={row.label} className="flex items-center justify-between">
                  <FormulaTooltip formula={row.formula} className="font-terminal text-[8px] text-muted-foreground">{row.label}</FormulaTooltip>
                  <span className="font-terminal text-[10px] font-bold text-foreground">{row.val}</span>
                </div>
              ))}
            </div>
            {g.title === "VALUE CREATION" && !hasPriorData && (
              <p className="font-terminal text-[7px] text-muted-foreground/60 mt-2">No filed prior-period statement for {symbol} — incremental/growth metrics need two periods.</p>
            )}
          </div>
        ))}
        <div className="bg-[#080808] border border-[hsl(38,95%,50%)/30%] p-3">
          <div className="font-terminal text-[8px] tracking-widest text-[hsl(38,95%,55%)] mb-2">CUSTOM RATIOS</div>
          <div className="space-y-1.5 mb-2">
            {customRatios.items.map(item => {
              const raw = evaluateCustomItem(item, 0, getBuiltinValue, allCustomItems);
              const fmt = ratioFormat[item.id] ?? "ratio";
              const display = raw === null ? "—" : fmt === "percent" ? pct(raw) : mult(raw);
              return (
                <div key={item.id} className="flex items-center justify-between group">
                  <span className="font-terminal text-[8px] text-muted-foreground truncate">{item.label}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setRatioFormat(prev => ({ ...prev, [item.id]: fmt === "percent" ? "ratio" : "percent" }))}
                      className="font-terminal text-[7px] text-muted-foreground/60 hover:text-[hsl(38,95%,55%)] opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Toggle x / % display"
                    >
                      {fmt === "percent" ? "%" : "x"}
                    </button>
                    <span className="font-terminal text-[10px] font-bold text-foreground">{display}</span>
                    <button onClick={() => customRatios.remove(item.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-opacity">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <CustomLineItemBuilder
            availableRefs={ratioRefs}
            periodLabels={["Value"]}
            manualInMillions={false}
            onAddManual={(label, values) => customRatios.addManual(label, values)}
            onAddFormula={customRatios.addFormula}
          />
        </div>
        <div className="bg-[#080808] border border-[hsl(38,95%,50%)/30%] p-3 col-span-2">
          <div className="flex items-center justify-between mb-2">
            <div className="font-terminal text-[8px] tracking-widest text-[hsl(38,95%,55%)]">NORMALIZATION</div>
            <span className="font-terminal text-[7px] text-muted-foreground">{normalizationPeriod}</span>
          </div>
          {normalizationResults.length === 0 ? (
            <p className="font-terminal text-[7px] text-muted-foreground mb-2">
              No normalization adjustments yet for {symbol} — add one below (e.g. add back stock-based compensation, exclude a one-time litigation charge) to see reported vs. normalized figures.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
              {normalizationResults.map(result => {
                const target = NORMALIZATION_TARGET_METRICS.find(m => m.id === result.metricId);
                const delta = (result.reportedValue !== null && result.normalizedValue !== null) ? result.normalizedValue - result.reportedValue : null;
                const deltaLabel = delta === null ? "—" : `${delta > 0 ? "+" : ""}${moneyOrDash(delta, curr)}`;
                return (
                  <div key={result.metricId} className="border-b border-border/20 pb-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-terminal text-[8px] text-muted-foreground">{target?.label ?? result.metricId}</span>
                      <span className="font-terminal text-[7px] text-muted-foreground/60">{result.adjustments.length} adj.</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-terminal text-[7px] text-muted-foreground">Reported</span>
                      <span className="font-terminal text-[9px] text-foreground">{moneyOrDash(result.reportedValue, curr)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">Normalized</span>
                      <span className="font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{moneyOrDash(result.normalizedValue, curr)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-terminal text-[7px] text-muted-foreground/60">Δ</span>
                      <span className={`font-terminal text-[8px] ${delta !== null && delta < 0 ? "text-[hsl(0,80%,60%)]" : "text-[hsl(142,71%,55%)]"}`}>{deltaLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {normalizationPolicy && normalizationPolicy.adjustments.length > 0 && (
            <div className="space-y-1 mb-2">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground/60">ADJUSTMENT LINEAGE</div>
              {normalizationPolicy.adjustments.map(adj => (
                <div key={adj.id} className="flex items-center justify-between group">
                  <span className="font-terminal text-[7px] text-muted-foreground truncate" title={adj.rationale}>
                    {adj.label} · {NORMALIZATION_TARGET_METRICS.find(m => m.id === adj.metricId)?.label ?? adj.metricId} · {adj.kind.toUpperCase()} · {adj.period}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="font-terminal text-[8px] font-bold text-foreground">{moneyOrDash(adj.amount, curr)}</span>
                    <button onClick={() => deleteNormalizationAdjustmentMut.mutate(adj.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-opacity">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {!normFormOpen ? (
            <button
              onClick={() => setNormFormOpen(true)}
              className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] transition-colors"
            >
              <Plus className="w-3 h-3" /> ADD ADJUSTMENT
            </button>
          ) : (
            <div className="space-y-1.5 border border-border/40 p-2">
              <div className="grid grid-cols-2 gap-1.5">
                <select value={normTargetMetric} onChange={e => setNormTargetMetric(e.target.value)} className="bg-[#0c0c0c] border border-border px-1.5 py-1 text-foreground font-terminal text-[8px] focus:outline-none">
                  {NORMALIZATION_TARGET_METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <select
                  value={normTypeId}
                  onChange={e => {
                    const next = e.target.value;
                    setNormTypeId(next);
                    const type = NORMALIZATION_LIBRARY.find(t => t.id === next);
                    if (type) setNormKind(type.suggestedKind);
                  }}
                  className="bg-[#0c0c0c] border border-border px-1.5 py-1 text-foreground font-terminal text-[8px] focus:outline-none"
                >
                  {NORMALIZATION_LIBRARY.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <select value={normKind} onChange={e => setNormKind(e.target.value as NormalizationAdjustmentKind)} className="bg-[#0c0c0c] border border-border px-1.5 py-1 text-[hsl(38,95%,55%)] font-bold font-terminal text-[8px] focus:outline-none">
                  <option value="add-back">ADD-BACK</option>
                  <option value="subtract">SUBTRACT</option>
                  <option value="reclassify">RECLASSIFY</option>
                  <option value="exclude">EXCLUDE</option>
                  <option value="replace">REPLACE</option>
                </select>
                <input
                  value={normPeriod} onChange={e => setNormPeriod(e.target.value)} placeholder={normalizationPeriod}
                  className="bg-transparent border border-border px-1.5 py-1 text-foreground font-terminal text-[8px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="font-terminal text-[7px] text-muted-foreground">AMOUNT</span>
                <EditableValue variant="field" decimals={1} prefix={curr} suffix="M" value={normAmount / 1e6} onChange={val => setNormAmount(val * 1e6)} />
              </div>
              <input
                value={normRationale} onChange={e => setNormRationale(e.target.value)} placeholder="Rationale (optional)"
                className="w-full bg-transparent border border-border px-1.5 py-1 text-foreground font-terminal text-[8px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
              />
              <div className="flex items-center gap-2 pt-0.5">
                <button onClick={submitNormalizationAdjustment} disabled={upsertNormalizationMut.isPending} className="px-2 py-1 bg-[hsl(38,95%,50%)] text-black font-bold font-terminal text-[8px] hover:bg-[hsl(38,95%,45%)] disabled:opacity-50">
                  {upsertNormalizationMut.isPending ? "SAVING…" : "ADD"}
                </button>
                <button onClick={() => setNormFormOpen(false)} className="px-2 py-1 border border-border text-muted-foreground font-terminal text-[8px] hover:text-foreground">CANCEL</button>
              </div>
              {upsertNormalizationMut.isError && <p className="font-terminal text-[7px] text-[hsl(0,80%,60%)]">Could not save the adjustment. Try again.</p>}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#080808] border border-border p-3">
        <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">GROWTH (CAGR) — FROM FILED MULTI-YEAR HISTORY</div>
        {!hasCagrData ? (
          <p className="font-terminal text-[8px] text-muted-foreground">Not enough filed annual history for {symbol} to compute a multi-year CAGR.</p>
        ) : (
          <table className="w-full font-terminal text-[9px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border/40">
                <th className="text-left py-1">METRIC</th>
                <th className="text-right py-1">3Y CAGR</th>
                <th className="text-right py-1">5Y CAGR</th>
                <th className="text-right py-1">10Y CAGR</th>
              </tr>
            </thead>
            <tbody>
              {cagr.map(row => (
                <tr key={row.label} className="border-b border-border/20 last:border-b-0">
                  <td className="py-1.5 text-muted-foreground">{row.label}</td>
                  <td className="py-1.5 text-right font-bold text-foreground tabular-nums">{row.y3 !== null ? pct(row.y3) : "—"}</td>
                  <td className="py-1.5 text-right font-bold text-foreground tabular-nums">{row.y5 !== null ? pct(row.y5) : "—"}</td>
                  <td className="py-1.5 text-right font-bold text-foreground tabular-nums">{row.y10 !== null ? pct(row.y10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="font-terminal text-[7px] text-muted-foreground/60 mt-2">
          Dividend CAGR isn't computed here — dividend history isn't currently wired into this tab (it's fetched separately for the Company Fundamentals panel).
        </p>
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">RAW INPUTS — CLICK ANY VALUE TO EDIT</span>
          <OverrideStatusBadge count={ov.overrideCount} onResetAll={ov.resetAll} />
        </div>
        {!hasLiveData && (
          <p className="font-terminal text-[7px] text-muted-foreground mb-2">No filed data found for {symbol} — inputs default to 0. Type the raw figures below to compute real ratios.</p>
        )}
        <div className="grid grid-cols-2 gap-x-4 mb-2">
          <MoneyFieldGrid ov={ov} values={v} fields={FIELDS} curr={curr} />
          {customParticulars.items.map(item => (
            <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-border/30 group">
              <span className="font-terminal text-[9px] text-muted-foreground">
                {item.label} <span className="text-[7px] text-muted-foreground/50">{item.kind === "formula" ? "ƒ" : "✎"}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <button onClick={() => customParticulars.remove(item.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-opacity">
                  <X className="w-2.5 h-2.5" />
                </button>
                {item.kind === "manual" ? (
                  <EditableValue
                    variant="field" decimals={1} prefix={curr} suffix="M"
                    value={(item.values[0] ?? 0) / 1e6}
                    onChange={val => customParticulars.updateValue(item.id, 0, val * 1e6)}
                  />
                ) : (
                  <span className="font-terminal text-[10px] font-bold tabular-nums text-foreground">
                    {(() => {
                      const raw = evaluateCustomItem(item, 0, getBuiltinValue, allCustomItems);
                      return raw === null ? "—" : `${curr}${(raw / 1e6).toFixed(1)}M`;
                    })()}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
        <CustomLineItemBuilder
          availableRefs={particularRefs}
          periodLabels={["Value"]}
          onAddManual={(label, values) => customParticulars.addManual(label, values)}
          onAddFormula={customParticulars.addFormula}
        />
      </div>
    </div>
  );
}
