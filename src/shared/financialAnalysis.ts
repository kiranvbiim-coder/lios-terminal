export interface FinancialStatementBundle {
  fiscalYear: string;
  period?: string;
  periodEnd?: string;
  currency?: string;
  income?: Record<string, number>;
  balance?: Record<string, number>;
  cashflow?: Record<string, number>;
  source?: string | null;
}

export type FinancialMetricUnit = "currency" | "percent" | "ratio" | "days" | "turnover";

export interface FinancialMetricInput {
  key: string;
  label: string;
  value: number;
}

export interface FinancialMetricTrace {
  formula: string;
  inputs: FinancialMetricInput[];
}

export interface FinancialMetric {
  key: string;
  label: string;
  value: number | null;
  unit: FinancialMetricUnit;
  trace: FinancialMetricTrace;
  interpretation?: "positive" | "negative" | "neutral";
}

export interface FinancialAnalysisPeriod {
  fiscalYear: string;
  period?: string;
  metrics: FinancialMetric[];
}

export interface PeerMetricObservation {
  symbol: string;
  value: number | null;
}

export interface PeerMetricSummary {
  count: number;
  mean: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
  targetValue: number | null;
  targetRank: number | null;
  targetPercentile: number | null;
  targetPremiumDiscountToMedian: number | null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pick(row: Record<string, number> | undefined, key: string): number | null {
  const value = row?.[key];
  return finite(value) ? value : null;
}

function firstFinite(...values: Array<number | null | undefined>): number | null {
  for (const value of values) if (finite(value)) return value;
  return null;
}

function safeDiv(numerator: number | null, denominator: number | null): number | null {
  if (!finite(numerator) || !finite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function avg(a: number | null, b: number | null): number | null {
  if (finite(a) && finite(b)) return (a + b) / 2;
  return firstFinite(a, b);
}

function metric(
  key: string,
  label: string,
  value: number | null,
  unit: FinancialMetricUnit,
  formula: string,
  inputs: FinancialMetricInput[],
  interpretation?: FinancialMetric["interpretation"],
): FinancialMetric {
  return { key, label, value: finite(value) ? value : null, unit, trace: { formula, inputs }, interpretation };
}

function input(key: string, label: string, value: number | null): FinancialMetricInput[] {
  return finite(value) ? [{ key, label, value }] : [];
}

function inputs(...items: Array<[string, string, number | null]>): FinancialMetricInput[] {
  return items.flatMap(([key, label, value]) => input(key, label, value));
}

function totalDebt(balance: Record<string, number> | undefined): number | null {
  const shortTermDebt = pick(balance, "shortTermDebt") ?? 0;
  const longTermDebt = pick(balance, "longTermDebt") ?? 0;
  const total = shortTermDebt + longTermDebt;
  return total === 0 && !finite(pick(balance, "shortTermDebt")) && !finite(pick(balance, "longTermDebt")) ? null : total;
}

function capexOutflow(cashflow: Record<string, number> | undefined): number | null {
  const capex = firstFinite(pick(cashflow, "capitalExpenditure"), pick(cashflow, "investmentsInPropertyPlantAndEquipment"));
  return finite(capex) ? Math.abs(capex) : null;
}

function freeCashFlow(cashflow: Record<string, number> | undefined): number | null {
  const direct = pick(cashflow, "freeCashFlow");
  if (finite(direct)) return direct;
  const cfo = pick(cashflow, "netCashProvidedByOperatingActivities");
  const capex = capexOutflow(cashflow);
  return finite(cfo) && finite(capex) ? cfo - capex : null;
}

/**
 * Minimal structural shape of a filed-statement report row -- matches
 * LseFinancialReport (client/src/lib/useLse.ts, server/lseData.ts) without
 * requiring shared/ to depend on either module's concrete type.
 */
export interface RawStatementReport {
  fiscal_year: string;
  period: string;
  date: string;
  reported_currency: string;
  data: string;
  data_source?: string | null;
}

/**
 * Merges income/balance/cashflow report rows for the same fiscal
 * period into single FinancialStatementBundle entries, sorted
 * newest-first. buildFinancialAnalysis() below reads periods[index + 1]
 * as "the prior year", so it requires descending order by periodEnd --
 * callers that build the byPeriod map from provider data (which arrives
 * oldest-first; see buildFinancialDatasetPayload's periodEnd sort in
 * server/pointInTimeDatasetStore.ts) must not skip this sort, or [0]
 * silently becomes the oldest available period instead of the latest.
 */
export function mergeFinancialStatementReports(reports: {
  income?: RawStatementReport[];
  balance?: RawStatementReport[];
  cashflow?: RawStatementReport[];
}, limit?: number): FinancialStatementBundle[] {
  const byPeriod = new Map<string, FinancialStatementBundle>();
  const mergeInto = (rows: RawStatementReport[] | undefined, statement: "income" | "balance" | "cashflow") => {
    for (const report of rows ?? []) {
      const key = `${report.fiscal_year}:${report.period}`;
      let parsed: Record<string, number> = {};
      try { parsed = JSON.parse(report.data); } catch { parsed = {}; }
      const existing = byPeriod.get(key) ?? {
        fiscalYear: report.fiscal_year, period: report.period, periodEnd: report.date,
        currency: report.reported_currency, source: report.data_source,
      };
      byPeriod.set(key, { ...existing, [statement]: parsed });
    }
  };
  mergeInto(reports.income, "income");
  mergeInto(reports.balance, "balance");
  mergeInto(reports.cashflow, "cashflow");
  const sorted = Array.from(byPeriod.values()).sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""));
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

export function buildFinancialAnalysis(periods: FinancialStatementBundle[]): FinancialAnalysisPeriod[] {
  return periods.map((period, index) => {
    const prior = periods[index + 1];
    const income = period.income;
    const balance = period.balance;
    const cashflow = period.cashflow;
    const priorIncome = prior?.income;
    const priorBalance = prior?.balance;

    const revenue = pick(income, "revenue");
    const priorRevenue = pick(priorIncome, "revenue");
    const grossProfit = pick(income, "grossProfit");
    const ebitda = pick(income, "ebitda");
    const ebit = firstFinite(pick(income, "ebit"), pick(income, "operatingIncome"));
    const operatingIncome = pick(income, "operatingIncome");
    const netIncome = pick(income, "netIncome");
    const interestExpenseAbs = finite(pick(income, "interestExpense")) ? Math.abs(pick(income, "interestExpense") as number) : null;
    const costOfRevenueAbs = finite(pick(income, "costOfRevenue")) ? Math.abs(pick(income, "costOfRevenue") as number) : null;

    const assets = pick(balance, "totalAssets");
    const equity = pick(balance, "totalStockholdersEquity");
    const cash = pick(balance, "cashAndCashEquivalents") ?? 0;
    const debt = totalDebt(balance);
    const investedCapital = finite(debt) || finite(equity) ? (debt ?? 0) + (equity ?? 0) - cash : null;
    const priorDebt = totalDebt(priorBalance);
    const priorCash = pick(priorBalance, "cashAndCashEquivalents") ?? 0;
    const priorInvestedCapital = finite(priorDebt) || finite(pick(priorBalance, "totalStockholdersEquity"))
      ? (priorDebt ?? 0) + (pick(priorBalance, "totalStockholdersEquity") ?? 0) - priorCash
      : null;
    const avgAssets = avg(assets, pick(priorBalance, "totalAssets"));
    const avgEquity = avg(equity, pick(priorBalance, "totalStockholdersEquity"));
    const avgInvestedCapital = avg(investedCapital, priorInvestedCapital);
    const avgReceivables = avg(pick(balance, "netReceivables"), pick(priorBalance, "netReceivables"));
    const avgInventory = avg(pick(balance, "inventory"), pick(priorBalance, "inventory"));
    const avgPayables = avg(pick(balance, "accountPayables"), pick(priorBalance, "accountPayables"));

    const cfo = pick(cashflow, "netCashProvidedByOperatingActivities");
    const capex = capexOutflow(cashflow);
    const fcf = freeCashFlow(cashflow);
    const netDebt = finite(debt) ? debt - cash : null;

    const revenueGrowth = safeDiv(finite(revenue) && finite(priorRevenue) ? revenue - priorRevenue : null, Math.abs(priorRevenue ?? 0));
    const dso = safeDiv(avgReceivables, revenue);
    const dio = safeDiv(avgInventory, costOfRevenueAbs);
    const dpo = safeDiv(avgPayables, costOfRevenueAbs);
    const dsoDays = finite(dso) ? dso * 365 : null;
    const dioDays = finite(dio) ? dio * 365 : null;
    const dpoDays = finite(dpo) ? dpo * 365 : null;

    const metrics: FinancialMetric[] = [
      metric("revenueGrowth", "Revenue growth", revenueGrowth, "percent", "(Revenue - Prior revenue) / |Prior revenue|", inputs(["revenue", "Revenue", revenue], ["priorRevenue", "Prior revenue", priorRevenue]), "positive"),
      metric("grossMargin", "Gross margin", safeDiv(grossProfit, revenue), "percent", "Gross profit / Revenue", inputs(["grossProfit", "Gross profit", grossProfit], ["revenue", "Revenue", revenue]), "positive"),
      metric("ebitdaMargin", "EBITDA margin", safeDiv(ebitda, revenue), "percent", "EBITDA / Revenue", inputs(["ebitda", "EBITDA", ebitda], ["revenue", "Revenue", revenue]), "positive"),
      metric("ebitMargin", "EBIT margin", safeDiv(ebit, revenue), "percent", "EBIT / Revenue", inputs(["ebit", "EBIT or operating income", ebit], ["revenue", "Revenue", revenue]), "positive"),
      metric("netMargin", "Net margin", safeDiv(netIncome, revenue), "percent", "Net income / Revenue", inputs(["netIncome", "Net income", netIncome], ["revenue", "Revenue", revenue]), "positive"),
      metric("roa", "ROA", safeDiv(netIncome, avgAssets), "percent", "Net income / Average assets", inputs(["netIncome", "Net income", netIncome], ["avgAssets", "Average assets", avgAssets]), "positive"),
      metric("roe", "ROE", safeDiv(netIncome, avgEquity), "percent", "Net income / Average equity", inputs(["netIncome", "Net income", netIncome], ["avgEquity", "Average equity", avgEquity]), "positive"),
      metric("roic", "ROIC", safeDiv(operatingIncome, avgInvestedCapital), "percent", "Operating income / Average invested capital", inputs(["operatingIncome", "Operating income", operatingIncome], ["avgInvestedCapital", "Average invested capital", avgInvestedCapital]), "positive"),
      metric("investedCapital", "Invested capital", investedCapital, "currency", "Short-term debt + Long-term debt + Equity - Cash", inputs(["shortTermDebt", "Short-term debt", pick(balance, "shortTermDebt")], ["longTermDebt", "Long-term debt", pick(balance, "longTermDebt")], ["equity", "Equity", equity], ["cash", "Cash", cash]), "neutral"),
      metric("assetTurnover", "Asset turnover", safeDiv(revenue, avgAssets), "turnover", "Revenue / Average assets", inputs(["revenue", "Revenue", revenue], ["avgAssets", "Average assets", avgAssets]), "positive"),
      metric("netDebt", "Net debt", netDebt, "currency", "Short-term debt + Long-term debt - Cash", inputs(["totalDebt", "Total debt", debt], ["cash", "Cash", cash]), "negative"),
      metric("netDebtToEbitda", "Net debt / EBITDA", safeDiv(netDebt, ebitda), "ratio", "Net debt / EBITDA", inputs(["netDebt", "Net debt", netDebt], ["ebitda", "EBITDA", ebitda]), "negative"),
      metric("interestCoverage", "Interest coverage", safeDiv(ebit, interestExpenseAbs), "ratio", "EBIT / |Interest expense|", inputs(["ebit", "EBIT", ebit], ["interestExpense", "Interest expense", interestExpenseAbs]), "positive"),
      metric("fcf", "Free cash flow", fcf, "currency", "Reported free cash flow, else CFO - capital expenditure", inputs(["cfo", "Cash from operations", cfo], ["capex", "Capital expenditure outflow", capex], ["reportedFcf", "Reported FCF", pick(cashflow, "freeCashFlow")]), "positive"),
      metric("fcfConversion", "FCF conversion", safeDiv(fcf, netIncome), "ratio", "Free cash flow / Net income", inputs(["fcf", "Free cash flow", fcf], ["netIncome", "Net income", netIncome]), "positive"),
      metric("cfoToNetIncome", "CFO / Net income", safeDiv(cfo, netIncome), "ratio", "Cash from operations / Net income", inputs(["cfo", "Cash from operations", cfo], ["netIncome", "Net income", netIncome]), "positive"),
      metric("accrualRatio", "Accrual ratio", safeDiv(finite(netIncome) && finite(cfo) ? netIncome - cfo : null, avgAssets), "percent", "(Net income - CFO) / Average assets", inputs(["netIncome", "Net income", netIncome], ["cfo", "Cash from operations", cfo], ["avgAssets", "Average assets", avgAssets]), "negative"),
      metric("receivableDays", "Receivable days", dsoDays, "days", "Average receivables / Revenue × 365", inputs(["avgReceivables", "Average receivables", avgReceivables], ["revenue", "Revenue", revenue]), "negative"),
      metric("inventoryDays", "Inventory days", dioDays, "days", "Average inventory / Cost of revenue × 365", inputs(["avgInventory", "Average inventory", avgInventory], ["costOfRevenue", "Cost of revenue", costOfRevenueAbs]), "negative"),
      metric("payableDays", "Payable days", dpoDays, "days", "Average payables / Cost of revenue × 365", inputs(["avgPayables", "Average payables", avgPayables], ["costOfRevenue", "Cost of revenue", costOfRevenueAbs]), "neutral"),
      metric("cashConversionCycle", "Cash conversion cycle", finite(dsoDays) && finite(dioDays) && finite(dpoDays) ? dsoDays + dioDays - dpoDays : null, "days", "Receivable days + Inventory days - Payable days", inputs(["receivableDays", "Receivable days", dsoDays], ["inventoryDays", "Inventory days", dioDays], ["payableDays", "Payable days", dpoDays]), "negative"),
    ];

    return { fiscalYear: period.fiscalYear, period: period.period, metrics };
  });
}

function sorted(values: number[]): number[] {
  return values.slice().sort((a, b) => a - b);
}

function percentileSorted(values: number[], p: number): number | null {
  if (!values.length) return null;
  const idx = (p / 100) * (values.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return values[lo];
  return values[lo] + (values[hi] - values[lo]) * (idx - lo);
}

export function summarizePeerMetric(observations: PeerMetricObservation[], targetSymbol: string, higherIsBetter = true): PeerMetricSummary {
  const clean = observations.filter((row): row is { symbol: string; value: number } => finite(row.value));
  const values = sorted(clean.map((row) => row.value));
  const target = clean.find((row) => row.symbol.toUpperCase() === targetSymbol.toUpperCase())?.value ?? null;
  const ordered = clean.slice().sort((a, b) => higherIsBetter ? b.value - a.value : a.value - b.value);
  const targetIndex = target === null ? -1 : ordered.findIndex((row) => row.symbol.toUpperCase() === targetSymbol.toUpperCase());
  const median = percentileSorted(values, 50);
  return {
    count: clean.length,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    median,
    q1: percentileSorted(values, 25),
    q3: percentileSorted(values, 75),
    min: values[0] ?? null,
    max: values.at(-1) ?? null,
    targetValue: target,
    targetRank: targetIndex >= 0 ? targetIndex + 1 : null,
    targetPercentile: targetIndex >= 0 && clean.length > 1 ? (1 - targetIndex / (clean.length - 1)) * 100 : targetIndex === 0 ? 100 : null,
    targetPremiumDiscountToMedian: finite(target) && finite(median) && median !== 0 ? (target - median) / Math.abs(median) : null,
  };
}

export function getMetricValue(metrics: FinancialMetric[], key: string): number | null {
  return metrics.find((metric) => metric.key === key)?.value ?? null;
}
