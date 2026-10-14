/**
 * Finnhub-based financial statements -- a real second US-filer source,
 * added alongside SEC EDGAR (not instead of it) for resilience: EDGAR's
 * own CIK resolution can silently miss a real company (ticker not in SEC's
 * company_tickers.json snapshot, a recent listing, a symbol change), and a
 * single point of failure for the whole US market is worth avoiding when a
 * second free, real source exists.
 *
 * Confirmed live before building this: Finnhub's `stock/financials-reported`
 * endpoint tags every line item with the exact same us-gaap XBRL concept
 * names SEC EDGAR's own companyfacts API uses (e.g.
 * "us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax" for AAPL's
 * real filed revenue) -- so this reuses secEdgarFinancials.ts's own
 * INCOME_FIELDS/BALANCE_FIELDS/CASHFLOW_FIELDS tag tables directly rather
 * than a second, independently-fragile mapping. Also confirmed live: the
 * free tier's real data coverage is US-only (tested against real China/
 * India/Japan/Korea symbols -- zero data for all of them), so this is
 * registered as a US-resilience layer, not a new geography -- yfinance
 * (yfinanceFinancials.ts) is what closes the non-US gaps.
 *
 * Free tier: 60 calls/minute (Finnhub's documented limit), no daily cap --
 * generous enough for live per-request use, same key already used for this
 * app's optional live-streaming quotes (see liveStream.ts).
 */
import { getCredential } from "./terminalConfig";
import type { LseFinancialReport } from "./lseData";
import { INCOME_FIELDS, BALANCE_FIELDS, CASHFLOW_FIELDS } from "./secEdgarFinancials";
import { upsertCompany, persistFinancialStatementPeriods, getFinancialStatementPeriodsForSymbol } from "./companyStore";
import { recordConnectorVerification } from "./connectorVerification";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function resolveApiKey(): string | null {
  return getCredential("FINNHUB_API_KEY", "finnhubApiKey");
}

export interface FinnhubReportItem { concept: string; unit: string; label: string; value: number }
export interface FinnhubReportEntry {
  year: number; quarter: number; form: string;
  startDate: string; endDate: string; filedDate: string;
  report: { bs: FinnhubReportItem[]; ic: FinnhubReportItem[]; cf: FinnhubReportItem[] };
}
interface FinnhubReportedResponse { symbol: string; data: FinnhubReportEntry[] }

async function fetchReported(symbol: string, frequency: "annual" | "quarterly"): Promise<FinnhubReportedResponse | null> {
  const apiKey = resolveApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${FINNHUB_BASE}/stock/financials-reported?symbol=${encodeURIComponent(symbol)}&freq=${frequency}&token=${apiKey}`);
    if (!res.ok) {
      recordConnectorVerification("finnhub", false, `Finnhub request returned ${res.status}.`);
      return null;
    }
    const body = (await res.json()) as FinnhubReportedResponse;
    recordConnectorVerification("finnhub", true, "Finnhub responded to a live request.");
    return body;
  } catch (err) {
    recordConnectorVerification("finnhub", false, err instanceof Error ? err.message : String(err));
    return null;
  }
}

export interface FinnhubFinancialReportQuery {
  limit?: number;
  offset?: number;
}

function boundEntries(entries: FinnhubReportEntry[], query: FinnhubFinancialReportQuery = {}): FinnhubReportEntry[] {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 100), 1), 100);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  const unique = new Map<string, FinnhubReportEntry>();
  for (const entry of entries) {
    const key = `${entry.endDate}|${entry.form}|${entry.quarter}`;
    if (!unique.has(key)) unique.set(key, entry);
  }
  return Array.from(unique.values()).sort((a, b) => b.endDate.localeCompare(a.endDate)).slice(offset, offset + limit);
}

export function selectFinnhubEntries(
  entries: FinnhubReportEntry[],
  period: string,
  query: FinnhubFinancialReportQuery = {},
): FinnhubReportEntry[] {
  if (period === "FY") return boundEntries(entries.filter((entry) => entry.form === "10-K"), query);
  const quarter = Number(period.slice(1));
  if (![1, 2, 3].includes(quarter)) return [];
  return boundEntries(entries.filter((entry) => entry.form === "10-Q" && entry.quarter === quarter), query);
}

function conceptToTag(concept: string): string {
  return concept.startsWith("us-gaap_") ? concept.slice("us-gaap_".length) : concept;
}

function buildRow(items: FinnhubReportItem[], fields: Record<string, { tags: string[]; negate?: boolean }>): Record<string, number> {
  const byTag = new Map<string, number>();
  for (const item of items) byTag.set(conceptToTag(item.concept), item.value);

  const out: Record<string, number> = {};
  for (const [key, spec] of Object.entries(fields)) {
    for (const tag of spec.tags) {
      const v = byTag.get(tag);
      if (v !== undefined) { out[key] = spec.negate ? -Math.abs(v) : v; break; }
    }
  }
  return out;
}

function deriveAliasesAndTotals(reportType: string, row: Record<string, number>): void {
  if (reportType === "income" && row.ebit === undefined && row.operatingIncome !== undefined) {
    row.ebit = row.operatingIncome;
  }
  if (reportType === "cashflow") {
    if (row.operatingCashFlow === undefined && row.netCashProvidedByOperatingActivities !== undefined) {
      row.operatingCashFlow = row.netCashProvidedByOperatingActivities;
    }
    if (row.capitalExpenditure === undefined && row.investmentsInPropertyPlantAndEquipment !== undefined) {
      row.capitalExpenditure = row.investmentsInPropertyPlantAndEquipment;
    }
    if (row.freeCashFlow === undefined && row.operatingCashFlow !== undefined && row.capitalExpenditure !== undefined) {
      row.freeCashFlow = row.operatingCashFlow + row.capitalExpenditure; // capex already negative
    }
    if (row.netCommonStockIssuance === undefined && (row.commonStockIssuance !== undefined || row.commonStockRepurchased !== undefined)) {
      row.netCommonStockIssuance = (row.commonStockIssuance ?? 0) + (row.commonStockRepurchased ?? 0);
    }
  }
}

async function financialReportsFromStore(symbol: string, reportType: string, period: string, query: FinnhubFinancialReportQuery = {}): Promise<LseFinancialReport[]> {
  const rows = await getFinancialStatementPeriodsForSymbol(symbol, reportType).catch(() => []);
  const filtered = rows.filter((r) => r.period === period);
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 100), 1), 100);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  return filtered.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(offset, offset + limit).map((r) => ({
    symbol: symbol.toUpperCase(),
    report_type: r.reportType,
    date: r.periodEnd,
    fiscal_year: r.fiscalYear,
    period: r.period,
    reported_currency: r.reportedCurrency,
    data: JSON.stringify(r.data),
    filing_date: r.filingDate,
  }));

}
export async function getFinnhubFinancialReports(
  symbol: string,
  reportType = "income",
  period = "FY",
  optionsOrUserId?: number | FinnhubFinancialReportQuery,
): Promise<LseFinancialReport[]> {
  // Finnhub exposes genuine standalone Q1/Q2/Q3 reports through freq=quarterly.
  // Q4 is not a separately filed 10-Q; leave it to persisted explicit Q4 rows
  const query = typeof optionsOrUserId === "object" && optionsOrUserId !== null ? optionsOrUserId : {};
  // rather than manufacturing FY minus the first three quarters.
  if (period === "Q4") return financialReportsFromStore(symbol, reportType, period, query);
  if (period !== "FY" && !/^Q[1-3]$/.test(period)) return financialReportsFromStore(symbol, reportType, period, query);

  const frequency = period === "FY" ? "annual" : "quarterly";
  const payload = await fetchReported(symbol, frequency);
  if (!payload?.data?.length) return financialReportsFromStore(symbol, reportType, period, query);

  const fieldMap = reportType === "balance" ? BALANCE_FIELDS : reportType === "cashflow" ? CASHFLOW_FIELDS : INCOME_FIELDS;
  const statementKey = reportType === "balance" ? "bs" : reportType === "cashflow" ? "cf" : "ic";
  const entries = selectFinnhubEntries(payload.data, period, query);
  const rows: LseFinancialReport[] = [];
  for (const entry of entries) {
    const row = buildRow(entry.report[statementKey], fieldMap);
    if (Object.keys(row).length === 0) continue;
    deriveAliasesAndTotals(reportType, row);
    rows.push({
      symbol: symbol.toUpperCase(),
      report_type: reportType,
      date: entry.endDate,
      fiscal_year: String(entry.year),
      period,
      reported_currency: "USD",
      data: JSON.stringify(row),
      filing_date: entry.filedDate,
    });
  }
  if (rows.length === 0) return financialReportsFromStore(symbol, reportType, period, query);

  try {
    const companyId = await upsertCompany({ symbol: symbol.toUpperCase() });
    await persistFinancialStatementPeriods(
      companyId,
      rows.map((r) => ({
        reportType: r.report_type,
        periodEnd: r.date,
        fiscalYear: r.fiscal_year,
        period: r.period,
        reportedCurrency: r.reported_currency,
        data: JSON.parse(r.data) as Record<string, number>,
        filingDate: r.filing_date,
        source: "finnhub",
      })),
    );
  } catch (err) {
    console.warn(`Failed to persist Finnhub financial statements for ${symbol}:`, err instanceof Error ? err.message : err);
  }

  return rows;
}

export function isFinnhubConfigured(): boolean {
  return resolveApiKey() !== null;
}
