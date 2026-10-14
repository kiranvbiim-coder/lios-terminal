import type { LseCompanyProfile, LseDividend, LseFinancialReport, LseStockFundamentals } from "./useLse";
import type { FinancialMetricDefinition, FinancialMetricObservation, FinancialMetricStatus, FinancialMetricUnit } from "@shared/financialMetricRegistry";
import { FINANCIAL_METRICS } from "@shared/financialMetricRegistry";
import { resolveMetricIntelligence, type MetricObservationInput, type ResolvedMetricIntelligence } from "@shared/metricIntelligence";

export type MetricExplorerGroup = "CORE" | "EXTENDED" | "PROVIDER" | "DERIVED";

export interface MetricExplorerInput {
  profile?: LseCompanyProfile | null;
  fundamentals?: LseStockFundamentals | null;
  incomeReports?: LseFinancialReport[];
  balanceReports?: LseFinancialReport[];
  cashflowReports?: LseFinancialReport[];
  dividends?: LseDividend[];
}

export interface MetricExplorerProviderRow {
  id: string;
  key: string;
  label: string;
  group: "PROVIDER";
  value: unknown;
  unit?: string;
  period?: string;
  asOf?: string;
  provider: string;
  source: string;
  status: FinancialMetricStatus;
  raw: Record<string, unknown>;
}

export interface MetricExplorerCanonicalRow {
  id: string;
  label: string;
  group: Exclude<MetricExplorerGroup, "PROVIDER">;
  category: string;
  unit: FinancialMetricUnit;
  resolved: ResolvedMetricIntelligence;
}
export type MetricExplorerRow = MetricExplorerCanonicalRow | MetricExplorerProviderRow;

export interface MetricExplorerModel {
  observations: MetricObservationInput[];
  canonical: MetricExplorerCanonicalRow[];
  provider: MetricExplorerProviderRow[];
  latestPeriod?: string;
}
const CORE_IDS: Record<string, true> = {
  price: true, marketCap: true, revenue: true, grossProfit: true, operatingIncome: true, netIncome: true, epsDiluted: true,
  cash: true, totalAssets: true, totalLiabilities: true, totalEquity: true, cfo: true, capex: true, fcf: true,
};

const INCOME_MAP: Record<string, string[]> = {
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

const BALANCE_MAP: Record<string, string[]> = {
  cash: ["cashAndCashEquivalents", "cashAndShortTermInvestments"],
  shortTermInvestments: ["shortTermInvestments"], nonOperatingInvestments: ["longTermInvestments", "nonOperatingInvestments"],
  shortTermDebt: ["shortTermDebt"], longTermDebt: ["longTermDebt"], leaseLiabilities: ["leaseLiabilities", "operatingLeaseLiabilities"],
  preferredStock: ["preferredStock", "preferredStockTotalEquity"], minorityInterest: ["minorityInterest", "nonControllingInterest"],
  unfundedPension: ["unfundedPension", "pensionLiability"], receivables: ["netReceivables", "accountsReceivable"],
  inventory: ["inventory"], payables: ["accountPayables", "accountsPayable"], currentAssets: ["totalCurrentAssets"],
  currentLiabilities: ["totalCurrentLiabilities"], totalAssets: ["totalAssets"], totalLiabilities: ["totalLiabilities"],
  totalEquity: ["totalStockholdersEquity", "totalEquity"], tangibleBookValue: ["tangibleBookValue"],
  ppe: ["propertyPlantEquipmentNet"], goodwill: ["goodwill"], intangibles: ["intangibleAssets"],
  workingCapital: ["workingCapital"], investedCapital: ["investedCapital"], capitalEmployed: ["capitalEmployed"],
};

const CASHFLOW_MAP: Record<string, string[]> = {
  cfo: ["netCashProvidedByOperatingActivities", "operatingCashFlow"],
  capex: ["capitalExpenditure", "investmentsInPropertyPlantAndEquipment"], fcf: ["freeCashFlow"],
  stockBasedCompensation: ["stockBasedCompensation"], dividendsPaid: ["commonDividendsPaid", "dividendsPaid"],
  shareRepurchases: ["commonStockRepurchased", "shareRepurchases"], buybacks: ["commonStockRepurchased", "shareRepurchases"],
  acquisitions: ["acquisitionsNet", "acquisitions"],
};
const PROFILE_CONTEXT: Record<string, true> = {
  symbol: true, company_name: true, name: true, exchange: true, currency: true, country: true, sector: true, industry: true, ceo: true, description: true,
  website: true, full_time_employees: true, address: true, city: true, state: true, ipo_date: true, image_url_dark: true,
};
const PROFILE_MAP: Record<string, string[]> = {
  price: ["price", "current_price"], marketCap: ["market_cap"], dividendPerShare: ["last_dividend"],
};
const FUNDAMENTALS_MAP: Record<string, string[]> = {
  price: ["current_price"], marketCap: ["market_cap"], pe: ["pe_ratio"], dividendYield: ["dividend_yield"],
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRecord(data: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function latestReport(reports: LseFinancialReport[]): LseFinancialReport | undefined {
  return [...reports].sort((a, b) => `${b.date}:${b.fiscal_year}:${b.period}`.localeCompare(`${a.date}:${a.fiscal_year}:${a.period}`))[0];
}

function reportPeriod(report: LseFinancialReport): string {
  return `${report.fiscal_year}${report.period && report.period !== "FY" ? ` ${report.period}` : ""}`;
}

function reportStatus(report: LseFinancialReport): FinancialMetricStatus {
  if (report.joinConflict) return "conflict";
  if (report.status?.freshness === "manual") return "imported";
  if (report.status?.freshness === "current") return "live";
  return "filed";
}

function sourceForReport(report: LseFinancialReport): string {
  return report.data_source ?? report.status?.provider ?? "LSE financial reports";
}

function reportObservationMeta(report: LseFinancialReport): Partial<FinancialMetricObservation> & { provider: string; sourceReference: string } {
  const provider = sourceForReport(report);
  return {
    status: reportStatus(report), period: reportPeriod(report), asOf: report.date,
    publishedAt: report.filing_date ?? undefined, source: provider, provider,
    sourceReference: `${provider}:${report.symbol}:${report.report_type}:${report.fiscal_year}:${report.period}`,
    currency: report.reported_currency,
  };
}

function firstValue(record: Record<string, unknown>, keys: string[]): { key: string; value: unknown } | null {
  for (const key of keys) if (finite(record[key])) return { key, value: record[key] };
  return null;
}

function sourceRaw(report: LseFinancialReport, field: string, value: unknown): Record<string, unknown> {
  return { symbol: report.symbol, reportType: report.report_type, fiscalYear: report.fiscal_year, period: report.period, date: report.date, field, value };
}

export function buildMetricExplorerModel(input: MetricExplorerInput): MetricExplorerModel {
  const observations: MetricObservationInput[] = [];
  const providerRows = new Map<string, MetricExplorerProviderRow>();
  const pushRaw = (row: MetricExplorerProviderRow) => {
    const previous = providerRows.get(row.id);
    if (!previous || `${row.asOf ?? ""}` > `${previous.asOf ?? ""}`) providerRows.set(row.id, row);
  };
  const pushObservation = (metricId: string, value: unknown, meta: Partial<MetricObservationInput>, raw: Record<string, unknown>) => {
    if (!finite(value)) return;
    observations.push({ metricId, value, kind: "direct/provider", raw, ...meta });
  };

  const profile = input.profile;
  const fundamentals = input.fundamentals;
  const incomeReports = input.incomeReports ?? [];
  const balanceReports = input.balanceReports ?? [];
  const cashflowReports = input.cashflowReports ?? [];
  const allReports = [...incomeReports, ...balanceReports, ...cashflowReports];
  const latest = latestReport(allReports);
  const latestPeriod = latest ? reportPeriod(latest) : undefined;

  const addObject = (scope: "profile" | "fundamentals", object: Record<string, unknown> | null | undefined, mappings: Record<string, string[]>) => {
    if (!object) return;
    const source = scope === "profile" ? "LSE company profile" : "LSE stock fundamentals";
    const provider = "London Strategic Edge";
    for (const [metricId, keys] of Object.entries(mappings)) {
      const picked = firstValue(object, keys);
      if (picked) pushObservation(metricId, picked.value, { status: "live", period: "CURRENT", source, provider, currency: typeof object.currency === "string" ? object.currency : profile?.currency, sourceReference: `lse:${scope}:${metricId}` }, { scope, field: picked.key, value: picked.value });
    }
    for (const [key, value] of Object.entries(object)) {
      if (PROFILE_CONTEXT[key] || Object.values(mappings).some(keys => keys.includes(key))) continue;
      pushRaw({ id: `${scope}.${key}`, key, label: `${scope}.${key}`, group: "PROVIDER", value, provider, source, status: "live", period: "CURRENT", raw: { scope, field: key, value } });
    }
  };
  addObject("profile", profile as unknown as Record<string, unknown> | null | undefined, PROFILE_MAP);
  addObject("fundamentals", fundamentals as unknown as Record<string, unknown> | null | undefined, FUNDAMENTALS_MAP);

  const addReports = (reports: LseFinancialReport[], mappings: Record<string, string[]>) => {
    for (const report of reports) {
      const parsed = parseRecord(report.data);
      const meta = reportObservationMeta(report);
      for (const [metricId, keys] of Object.entries(mappings)) {
        const picked = firstValue(parsed, keys);
        if (picked) pushObservation(metricId, picked.value, meta, sourceRaw(report, picked.key, picked.value));
      }
      const mappedKeys = new Set(Object.values(mappings).flat());
      for (const [key, value] of Object.entries(parsed)) {
        if (mappedKeys.has(key)) continue;
        pushRaw({ id: `${report.report_type}.${key}`, key, label: `${report.report_type}.${key}`, group: "PROVIDER", value, provider: sourceForReport(report), source: sourceForReport(report), status: reportStatus(report), period: reportPeriod(report), asOf: report.date, raw: sourceRaw(report, key, value) });
      }
    }
  };
  addReports(incomeReports, INCOME_MAP);
  addReports(balanceReports, BALANCE_MAP);
  addReports(cashflowReports, CASHFLOW_MAP);

  const dividend = [...(input.dividends ?? [])].sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
  if (dividend) {
    pushObservation("dividendPerShare", dividend.dividend_amount, { status: "filed", period: dividend.frequency ?? "LATEST", asOf: dividend.effective_date, source: "LSE dividend history", provider: "London Strategic Edge", currency: dividend.currency, sourceReference: `lse:dividends:${dividend.symbol}:${dividend.effective_date}` }, { scope: "dividends", field: "dividend_amount", value: dividend.dividend_amount });
    for (const [key, value] of Object.entries(dividend)) {
      if (key === "symbol" || key === "dividend_amount") continue;
      pushRaw({ id: `dividends.${key}`, key, label: `dividends.${key}`, group: "PROVIDER", value, provider: "London Strategic Edge", source: "LSE dividend history", status: "filed", period: dividend.frequency ?? "LATEST", asOf: dividend.effective_date, raw: { scope: "dividends", field: key, value } });
    }
  }

  const canonical = FINANCIAL_METRICS.map((definition: FinancialMetricDefinition): MetricExplorerCanonicalRow => {
    const resolved = resolveMetricIntelligence(definition.id, observations, { currency: profile?.currency });
    // The registry always resolves a known definition; retain a defensive missing result for future registry changes.
    const fallback = resolved ?? resolveMetricIntelligence(definition.id, [], {})!;
    const group: Exclude<MetricExplorerGroup, "PROVIDER"> = definition.formula || definition.dependencies?.length ? "DERIVED" : CORE_IDS[definition.id] ? "CORE" : "EXTENDED";
    return { id: definition.id, label: definition.label, group, category: definition.category, unit: definition.unit, resolved: fallback };
  });

  return { observations, canonical, provider: [...providerRows.values()].sort((a, b) => a.id.localeCompare(b.id)), latestPeriod };
}

export function metricExplorerExplanation(resolved: ResolvedMetricIntelligence): string | undefined {
  if (resolved.conflicts.length) return resolved.conflicts.map(conflict => conflict.reason).join("; ");
  if (resolved.missingDependencies.length) return `Missing dependencies: ${resolved.missingDependencies.join(", ")}`;
  if (resolved.optionalMissingDependencies.length) return `Optional dependencies unavailable: ${resolved.optionalMissingDependencies.join(", ")}`;
  if (resolved.comparabilityNotes.length) return resolved.comparabilityNotes.join("; ");
  return resolved.formula;
}

export function formatMetricExplorerValue(value: unknown, unit?: FinancialMetricUnit | string, currency = "$"): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (unit === "percent" || unit === "yield") return `${(value * 100).toFixed(2)}%`;
    if (unit === "multiple" || unit === "ratio" || unit === "turnover") return `${value.toFixed(2)}x`;
    if (unit === "days") return `${value.toFixed(1)}d`;
    if (unit === "price" || unit === "currency-per-share") return `${currency}${value.toFixed(2)}`;
    if (Math.abs(value) >= 1e9) return `${currency}${(value / 1e9).toFixed(2)}B`;
    if (Math.abs(value) >= 1e6) return `${currency}${(value / 1e6).toFixed(2)}M`;
    return value.toLocaleString();
  }
  return String(value);
}
