import {
  CANONICAL_FIELDS,
  type StatementType,
} from "./financialFields";
import {
  getFinancialMetricDefinition,
  resolveFinancialMetric,
  type FinancialMetricObservation,
  type FinancialMetricStatus,
  type FinancialMetricUnit,
} from "./financialMetricRegistry";
import type { DataStatus } from "./dataStatus";

/** Structural report shape shared by provider and client report rows. */
export interface FinancialStatementReportInput {
  fiscal_year: string;
  period: string;
  date: string;
  reported_currency: string;
  data: string;
  filing_date?: string | null;
  data_source?: string | null;
  status?: DataStatus;
  joinConflict?: {
    publicProvider: string;
    differingFields: string[];
  };
}

export interface StatementFieldResolution {
  key: string;
  metricId: string;
  value: number;
  status: FinancialMetricStatus;
  unit: FinancialMetricUnit;
  source?: string;
  currency?: string;
  conflict: boolean;
}

export interface ResolvedFinancialStatementReport extends FinancialStatementReportInput {
  normalized: {
    period: string;
    currency?: string;
    fieldSources: Record<string, StatementFieldResolution>;
    missingFields: string[];
    conflictFields: string[];
    importedFields: string[];
  };
}

/**
 * Provider field names are the display/report contract; registry IDs are the
 * analytical contract. This is the single bridge used when statements need
 * to consume observations rather than bypassing the normalized layer.
 */
export const STATEMENT_FIELD_METRIC_IDS: Record<StatementType, Readonly<Record<string, string>>> = {
  balance: {
    cashAndCashEquivalents: "cash",
    shortTermInvestments: "shortTermInvestments",
    netReceivables: "receivables",
    inventory: "inventory",
    totalCurrentAssets: "currentAssets",
    propertyPlantEquipmentNet: "ppe",
    goodwill: "goodwill",
    intangibleAssets: "intangibles",
    longTermInvestments: "nonOperatingInvestments",
    totalAssets: "totalAssets",
    accountPayables: "payables",
    shortTermDebt: "shortTermDebt",
    totalCurrentLiabilities: "currentLiabilities",
    longTermDebt: "longTermDebt",
    totalLiabilities: "totalLiabilities",
    totalStockholdersEquity: "totalEquity",
  },
  income: {
    revenue: "revenue",
    costOfRevenue: "costOfRevenue",
    grossProfit: "grossProfit",
    researchAndDevelopmentExpenses: "rd",
    sellingGeneralAndAdministrativeExpenses: "sga",
    operatingIncome: "operatingIncome",
    interestExpense: "interestExpense",
    incomeBeforeTax: "incomeBeforeTax",
    incomeTaxExpense: "incomeTaxExpense",
    netIncome: "netIncome",
    eps: "epsBasic",
    epsDiluted: "epsDiluted",
    weightedAverageShsOut: "sharesOutstanding",
    weightedAverageShsOutDil: "dilutedShares",
    ebitda: "ebitda",
    ebit: "ebit",
    depreciationAndAmortization: "depreciationAndAmortization",
  },
  cashflow: {
    netIncome: "netIncome",
    depreciationAndAmortization: "depreciationAndAmortization",
    stockBasedCompensation: "stockBasedCompensation",
    netCashProvidedByOperatingActivities: "cfo",
    investmentsInPropertyPlantAndEquipment: "capex",
    acquisitionsNet: "acquisitions",
    commonStockRepurchased: "shareRepurchases",
    commonDividendsPaid: "dividendsPaid",
    capitalExpenditure: "capex",
    freeCashFlow: "fcf",
  },
};

const DIRECT_STATUSES = new Set<FinancialMetricStatus>(["live", "filed", "estimate", "conflict"]);
const IMPORT_STATUSES = new Set<FinancialMetricStatus>(["imported", "manual"]);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Canonicalizes common annual and quarterly period spellings for joins. */
export function normalizeFinancialStatementPeriod(value?: string): string | undefined {
  const text = value?.trim().toUpperCase().replace(/\s+/g, " ");
  if (!text) return undefined;
  const yearFirst = text.match(/^(\d{4})\s*(FY|Q[1-4])$/);
  if (yearFirst) return `${yearFirst[1]} ${yearFirst[2]}`;
  const prefixFirst = text.match(/^(FY|Q[1-4])\s*(\d{4})$/);
  if (prefixFirst) return `${prefixFirst[2]} ${prefixFirst[1]}`;
  const bareYear = text.match(/^(\d{4})$/);
  return bareYear ? `${bareYear[1]} FY` : text;
}

function periodParts(period: string): { fiscalYear: string; period: string } | null {
  const normalized = normalizeFinancialStatementPeriod(period);
  const match = normalized?.match(/^(\d{4}) (FY|Q[1-4])$/);
  return match ? { fiscalYear: match[1], period: match[2] } : null;
}

function parseReportData(data: string): Record<string, number> {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => finite(value))) as Record<string, number>;
  } catch {
    return {};
  }
}

function sourceMatchesReport(observation: FinancialMetricObservation, report: FinancialStatementReportInput): boolean {
  return observation.asOf === report.date || Boolean(report.data_source && observation.source === report.data_source);
}

function candidatesForField(
  metricId: string,
  rawValue: number | undefined,
  report: FinancialStatementReportInput,
  observations: readonly FinancialMetricObservation[],
  normalizedPeriod: string,
): FinancialMetricObservation[] {
  const rawCandidate: FinancialMetricObservation[] = finite(rawValue)
    ? [{
      metricId,
      value: rawValue,
      status: report.joinConflict ? "conflict" : "filed",
      period: normalizedPeriod,
      asOf: report.date,
      source: report.data_source ?? "Filed financial statement",
      currency: report.reported_currency || undefined,
      note: "Provider report field normalized into the analytical contract.",
    }]
    : [];
  const aligned = observations.filter(observation =>
    observation.metricId === metricId
    && finite(observation.value)
    && normalizeFinancialStatementPeriod(observation.period) === normalizedPeriod
    && ((DIRECT_STATUSES.has(observation.status) && sourceMatchesReport(observation, report)) || IMPORT_STATUSES.has(observation.status)),
  );
  return [...rawCandidate, ...aligned];
}

function resolveField(
  key: string,
  metricId: string,
  rawValue: number | undefined,
  report: FinancialStatementReportInput,
  observations: readonly FinancialMetricObservation[],
  normalizedPeriod: string,
): StatementFieldResolution | null {
  const candidates = candidatesForField(metricId, rawValue, report, observations, normalizedPeriod);
  const resolved = resolveFinancialMetric(metricId, candidates.map(candidate => ({
    ...candidate,
    period: normalizeFinancialStatementPeriod(candidate.period),
  })), { period: normalizedPeriod });
  if (!resolved || !finite(resolved.value)) return null;
  const values = new Set(candidates.map(candidate => candidate.value).filter(finite));
  const selected = candidates.find(candidate => candidate.value === resolved.value && candidate.status === resolved.status)
    ?? candidates.find(candidate => candidate.value === resolved.value);
  const definition = getFinancialMetricDefinition(metricId);
  return {
    key,
    metricId,
    value: resolved.value,
    status: resolved.status,
    unit: definition?.unit ?? "text",
    source: selected?.source ?? resolved.source,
    currency: selected?.currency ?? resolved.currency,
    conflict: values.size > 1,
  };
}

function resolveReport(
  report: FinancialStatementReportInput,
  statementType: StatementType,
  observations: readonly FinancialMetricObservation[],
): ResolvedFinancialStatementReport {
  const parsed = parseReportData(report.data);
  const normalizedPeriod = normalizeFinancialStatementPeriod(`${report.fiscal_year} ${report.period}`) ?? report.period;
  const mapping = STATEMENT_FIELD_METRIC_IDS[statementType];
  const fieldSources = Object.fromEntries(Object.entries(mapping).flatMap(([key, metricId]) => {
    const resolved = resolveField(key, metricId, parsed[key], report, observations, normalizedPeriod);
    return resolved ? [[key, resolved]] : [];
  }));
  const data = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, value]));
  for (const field of Object.values(fieldSources)) data[field.key] = field.value;
  const missingFields = CANONICAL_FIELDS[statementType]
    .map(field => field.key)
    .filter(key => !Object.prototype.hasOwnProperty.call(data, key));
  const conflictFields = Object.values(fieldSources).filter(field => field.conflict).map(field => field.key);
  const importedFields = Object.values(fieldSources)
    .filter(field => IMPORT_STATUSES.has(field.status))
    .map(field => field.key);
  const selectedCurrency = Object.values(fieldSources).find(field => field.currency)?.currency;
  return {
    ...report,
    data: JSON.stringify(data),
    normalized: {
      period: normalizedPeriod,
      currency: (selectedCurrency ?? report.reported_currency) || undefined,
      fieldSources,
      missingFields,
      conflictFields,
      importedFields,
    },
  };
}

function requestedPeriodMatches(normalizedPeriod: string, requestedPeriod?: string): boolean {
  const normalizedRequest = normalizeFinancialStatementPeriod(requestedPeriod);
  if (!normalizedRequest) return true;
  if (/^(FY|Q[1-4])$/.test(normalizedRequest)) return normalizedPeriod.endsWith(` ${normalizedRequest}`);
  return normalizedPeriod === normalizedRequest;
}

function importedOnlyReports(
  statementType: StatementType,
  observations: readonly FinancialMetricObservation[],
  providerPeriods: ReadonlySet<string>,
  requestedPeriod?: string,
): ResolvedFinancialStatementReport[] {
  const mapping = STATEMENT_FIELD_METRIC_IDS[statementType];
  const metricIds = new Set(Object.values(mapping));
  const periods = [...new Set(observations
    .filter(observation => IMPORT_STATUSES.has(observation.status) && metricIds.has(observation.metricId) && finite(observation.value))
    .map(observation => normalizeFinancialStatementPeriod(observation.period))
    .filter((period): period is string => period !== undefined && requestedPeriodMatches(period, requestedPeriod) && !providerPeriods.has(period)))];
  return periods.flatMap(normalizedPeriod => {
    const parts = periodParts(normalizedPeriod);
    if (!parts) return [];
    const fields = Object.entries(mapping).flatMap(([key, metricId]) => {
      const resolved = resolveFinancialMetric(metricId, observations
        .filter(observation => IMPORT_STATUSES.has(observation.status) && observation.metricId === metricId && finite(observation.value))
        .map(observation => ({ ...observation, period: normalizeFinancialStatementPeriod(observation.period) })), { period: normalizedPeriod });
      if (!resolved || !finite(resolved.value)) return [];
      const definition = getFinancialMetricDefinition(metricId);
      const selected = observations.find(observation => observation.metricId === metricId && observation.value === resolved.value && normalizeFinancialStatementPeriod(observation.period) === normalizedPeriod);
      return [[key, resolved.value, {
        key,
        metricId,
        value: resolved.value,
        status: resolved.status,
        unit: definition?.unit ?? "text",
        source: selected?.source,
        currency: selected?.currency,
        conflict: false,
      } as StatementFieldResolution] as const];
    });
    if (!fields.length) return [];
    const data = Object.fromEntries(fields.map(([key, value]) => [key, value]));
    const fieldSources = Object.fromEntries(fields.map(([key, , source]) => [key, source]));
    const first = fields.map(([, , field]) => field).find(field => field.currency || field.source);
    const date = observations
      .filter(observation => IMPORT_STATUSES.has(observation.status) && metricIds.has(observation.metricId) && normalizeFinancialStatementPeriod(observation.period) === normalizedPeriod)
      .map(observation => observation.asOf)
      .filter((asOf): asOf is string => Boolean(asOf))
      .sort()
      .at(-1) ?? "";
    return [{
      fiscal_year: parts.fiscalYear,
      period: parts.period,
      date,
      reported_currency: first?.currency ?? "",
      data: JSON.stringify(data),
      filing_date: null,
      data_source: first?.source ?? "Imported financial data",
      normalized: {
        period: normalizedPeriod,
        currency: first?.currency,
        fieldSources,
        missingFields: CANONICAL_FIELDS[statementType].map(field => field.key).filter(key => !Object.prototype.hasOwnProperty.call(data, key)),
        conflictFields: [],
        importedFields: fields.map(([key]) => key),
      },
    }];
  });
}

/**
 * Resolves provider report rows through the shared observation contract.
 * Explicit imported/manual observations win by registry precedence; absent
 * values stay absent, and imported-only periods are materialized only from
 * finite imported observations matching the requested period.
 */
export function resolveFinancialStatementReports(
  statementType: StatementType,
  reports: readonly FinancialStatementReportInput[] | undefined,
  observations: readonly FinancialMetricObservation[] = [],
  limit?: number,
  requestedPeriod?: string,
): ResolvedFinancialStatementReport[] {
  const providerRows = (reports ?? []).map(report => resolveReport(report, statementType, observations));
  const providerPeriods = new Set(providerRows.map(report => report.normalized.period));
  const combined = [...providerRows, ...importedOnlyReports(statementType, observations, providerPeriods, requestedPeriod)]
    .sort((a, b) => (b.date || b.normalized.period).localeCompare(a.date || a.normalized.period));
  return limit === undefined ? combined : combined.slice(0, limit);
}

export function statementReportData(report: ResolvedFinancialStatementReport): Record<string, number> {
  return parseReportData(report.data);
}
