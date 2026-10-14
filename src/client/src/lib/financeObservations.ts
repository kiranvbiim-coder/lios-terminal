import type { LseCompanyProfile, LseFinancialReport, LseStockFundamentals, LseDividend } from "./useLse";
import type { FinancialMetricObservation, FinancialMetricStatus } from "@shared/financialMetricRegistry";
import { enrichCanonicalFinancialObservations } from "@shared/institutionalFinancialResolver";

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

function parseReport(report: LseFinancialReport | undefined): Record<string, number> {
  if (!report) return {};
  try {
    const parsed = JSON.parse(report.data) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => finite(entry[1])));
  } catch { return {}; }
}

function reportStatus(report: LseFinancialReport | undefined): FinancialMetricStatus {
  if (!report) return "missing";
  if (report.joinConflict) return "conflict";
  return "filed";
}

function observation(metricId: string, value: unknown, input: Partial<FinancialMetricObservation> = {}): FinancialMetricObservation | null {
  if (!finite(value)) return null;
  return { metricId, value, status: input.status ?? "filed", ...input };
}

function firstFinite(row: Record<string, number>, ...keys: string[]): number | null {
  for (const key of keys) if (finite(row[key])) return row[key];
  return null;
}

function reportMeta(report: LseFinancialReport | undefined): Partial<FinancialMetricObservation> {
  return report ? {
    status: reportStatus(report),
    period: `${report.fiscal_year}${report.period && report.period !== "FY" ? ` ${report.period}` : ""}`,
    asOf: report.date,
    publishedAt: report.filing_date ?? undefined,
    source: report.data_source ?? "Filed financial statement",
    currency: report.reported_currency,
    note: report.joinConflict ? `Provider conflict with ${report.joinConflict.publicProvider}` : undefined,
  } : {};
}

const GROWTH_LINKS: ReadonlyArray<readonly [string, string]> = [
  ["revenue", "revenueGrowth"], ["ebitda", "ebitdaGrowth"], ["ebit", "ebitGrowth"], ["epsDiluted", "epsGrowth"], ["fcf", "fcfGrowth"],
];

function appendHistoricalGrowth(observations: FinancialMetricObservation[]): void {
  for (const [metricId, growthId] of GROWTH_LINKS) {
    const series = observations
      .filter(item => item.metricId === metricId && finite(item.value) && item.period)
      .sort((a, b) => (b.period ?? "").localeCompare(a.period ?? "") || (b.asOf ?? "").localeCompare(a.asOf ?? ""));
    const latest = series[0];
    const prior = series.find(item => item.period !== latest?.period);
    if (!latest || !prior || !finite(latest.value) || !finite(prior.value) || prior.value === 0) continue;
    if (observations.some(item => item.metricId === growthId && item.period === latest.period)) continue;
    observations.push({
      metricId: growthId,
      value: (latest.value - prior.value) / Math.abs(prior.value),
      status: "derived",
      period: latest.period,
      asOf: latest.asOf,
      publishedAt: latest.publishedAt,
      source: "LiOS historical period growth",
      currency: latest.currency,
      note: `${metricId} growth calculated from ${prior.period} to ${latest.period}.`,
    });
  }
}

export function buildCompanyFinancialObservations(input: {
  profile?: LseCompanyProfile | null;
  fundamentals?: LseStockFundamentals | null;
  incomeReports?: LseFinancialReport[];
  balanceReports?: LseFinancialReport[];
  cashflowReports?: LseFinancialReport[];
  dividends?: LseDividend[];
}): FinancialMetricObservation[] {
  const result: FinancialMetricObservation[] = [];
  const push = (item: FinancialMetricObservation | null) => { if (item) result.push(item); };
  const profile = input.profile;
  const fundamentals = input.fundamentals;
  const incomeReports = input.incomeReports ?? [];
  const balanceReports = input.balanceReports ?? [];
  const cashflowReports = input.cashflowReports ?? [];

  const marketMeta: Partial<FinancialMetricObservation> = { status: "live", source: "Market/company provider", currency: profile?.currency ?? undefined, period: "CURRENT", asOf: new Date().toISOString() };
  push(observation("price", profile?.price ?? fundamentals?.current_price, marketMeta));
  push(observation("marketCap", profile?.market_cap ?? fundamentals?.market_cap, marketMeta));
  push(observation("pe", fundamentals?.pe_ratio, { ...marketMeta, source: "Provider reported P/E" }));
  push(observation("dividendYield", fundamentals?.dividend_yield, { ...marketMeta, source: "Provider reported dividend yield" }));

  const incomeMap: Record<string, string[]> = {
    revenue: ["revenue"], costOfRevenue: ["costOfRevenue"], grossProfit: ["grossProfit"],
    sga: ["sellingGeneralAndAdministrativeExpenses", "sellingGeneralAndAdministrative"],
    rd: ["researchAndDevelopmentExpenses", "researchAndDevelopment"],
    stockBasedCompensation: ["stockBasedCompensation"], restructuringCharges: ["restructuringCharges"],
    ebitda: ["ebitda"], adjustedEbitda: ["adjustedEbitda"], ebita: ["ebita"],
    ebit: ["ebit", "operatingIncome"], operatingIncome: ["operatingIncome", "ebit"],
    interestExpense: ["interestExpense"], incomeBeforeTax: ["incomeBeforeTax"], incomeTaxExpense: ["incomeTaxExpense"],
    netIncome: ["netIncome"], epsBasic: ["eps", "epsBasic"], epsDiluted: ["epsDiluted"],
    depreciationAndAmortization: ["depreciationAndAmortization"],
  };
  for (const report of incomeReports) {
    const income = parseReport(report);
    const incomeMeta = reportMeta(report);
    for (const [metricId, keys] of Object.entries(incomeMap)) push(observation(metricId, firstFinite(income, ...keys), incomeMeta));
  }

  const balanceMap: Record<string, string[]> = {
    cash: ["cashAndCashEquivalents", "cashAndShortTermInvestments"], shortTermInvestments: ["shortTermInvestments"],
    nonOperatingInvestments: ["longTermInvestments", "nonOperatingInvestments"], shortTermDebt: ["shortTermDebt"],
    longTermDebt: ["longTermDebt"], leaseLiabilities: ["leaseLiabilities", "operatingLeaseLiabilities"],
    preferredStock: ["preferredStock", "preferredStockTotalEquity"], minorityInterest: ["minorityInterest", "nonControllingInterest"],
    unfundedPension: ["unfundedPension", "pensionLiability"], receivables: ["netReceivables", "accountsReceivable"],
    inventory: ["inventory"], payables: ["accountPayables", "accountsPayable"], currentAssets: ["totalCurrentAssets"],
    currentLiabilities: ["totalCurrentLiabilities"], totalAssets: ["totalAssets"], totalLiabilities: ["totalLiabilities"],
    totalEquity: ["totalStockholdersEquity", "totalEquity"], tangibleBookValue: ["tangibleBookValue"],
    ppe: ["propertyPlantEquipmentNet"], goodwill: ["goodwill"], intangibles: ["intangibleAssets"],
    workingCapital: ["workingCapital"], investedCapital: ["investedCapital"], capitalEmployed: ["capitalEmployed"],
  };
  for (const report of balanceReports) {
    const balance = parseReport(report);
    const balanceMeta = reportMeta(report);
    for (const [metricId, keys] of Object.entries(balanceMap)) push(observation(metricId, firstFinite(balance, ...keys), balanceMeta));
  }

  const cashflowMap: Record<string, string[]> = {
    cfo: ["netCashProvidedByOperatingActivities", "operatingCashFlow"], capex: ["capitalExpenditure", "investmentsInPropertyPlantAndEquipment"],
    fcf: ["freeCashFlow"], stockBasedCompensation: ["stockBasedCompensation"], dividendsPaid: ["commonDividendsPaid", "dividendsPaid"],
    shareRepurchases: ["commonStockRepurchased", "shareRepurchases"], buybacks: ["commonStockRepurchased", "shareRepurchases"],
    acquisitions: ["acquisitionsNet", "acquisitions"],
  };
  for (const report of cashflowReports) {
    const cashflow = parseReport(report);
    const cashflowMeta = reportMeta(report);
    for (const [metricId, keys] of Object.entries(cashflowMap)) push(observation(metricId, firstFinite(cashflow, ...keys), cashflowMeta));
  }

  const dividend = input.dividends?.[0];
  if (dividend) push(observation("dividendPerShare", dividend.dividend_amount, {
    status: "filed", source: "Dividend history", currency: dividend.currency, asOf: dividend.effective_date, period: dividend.frequency ?? "LATEST",
  }));

  if (finite(profile?.market_cap) && finite(profile?.price) && profile!.price! !== 0) {
    push(observation("dilutedShares", profile!.market_cap! / profile!.price!, { ...marketMeta, status: "derived", source: "Market cap / price approximation", note: "Approximation; replace with filed diluted shares when available." }));
  }

  // Historical reports unlock deterministic growth metrics without inventing
  // estimates; each growth value preserves the latest period's provenance.
  appendHistoricalGrowth(result);
  return enrichCanonicalFinancialObservations(result);
}

export function latestStatementPeriod(reports?: LseFinancialReport[]): string | undefined {
  const report = reports?.[0];
  return report ? `${report.fiscal_year}${report.period && report.period !== "FY" ? ` ${report.period}` : ""}` : undefined;
}
