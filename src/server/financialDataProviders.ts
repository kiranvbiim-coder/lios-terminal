/**
 * Provider-waterfall for financial statement data. The ticker-universe audit
 * (see conversation history) found LSE's financial_reports coverage is
 * strong for large caps but thin-to-absent for the long tail -- China
 * A-shares (SSE/SZSE), Brazil (B3), and India's BSE listings in particular.
 * Relying on a single vendor for that data means those gaps are permanent.
 *
 * This module is the seam: it tries each registered provider in priority
 * order for a given (symbol, reportType) and returns the first non-empty
 * result, tagged with which provider actually supplied it. India's BSE
 * listings are covered by screenerIndiaProvider/bseIndiaProvider below;
 * China A-shares and the rest of the long tail are covered by
 * yfinanceProvider, the broadest fallback (see yfinanceFinancials.ts) --
 * added once the sector-classification backfill elsewhere in this app
 * confirmed live that LSE genuinely has zero coverage for real SSE/SZSE
 * symbols yfinance has complete statement data for. Adding another
 * regional specialist (Korea's DART, Brazil's CVM, ...) later is just
 * writing a new provider module and appending it to PROVIDERS, with no
 * changes needed to routes or the client.
 */
import { getFinancialReports, type LseFinancialReport } from "./lseData";
import { getSecFinancialReports } from "./secEdgarFinancials";
import { getFinnhubFinancialReports } from "./finnhubFinancials";
import { getSimFinFinancialReports } from "./simfinFinancials";
import { getBseFinancialReports } from "./bseIndia";
import { getScreenerFinancialReports } from "./screenerIndia";
import { getXbrlFilingsOrgReports } from "./xbrlFilingsOrg";
import { getYfinanceFinancialReports } from "./yfinanceFinancials";
import { loadImportedFinancials } from "./uideEngine/importedFinancialsStore";
import { buildDataStatus, type DataStatus } from "./dataStatus";
import { getRequestIdentity } from "./requestContext";
import { resolveFamilyProviderOrder } from "./dataStackService";

export interface FinancialReportRow extends LseFinancialReport {
  /** Which provider actually supplied this row -- surfaced in the UI so a
   * user can tell filed-by-LSE apart from (eventually) filed-by-EDGAR/DART/etc. */
  data_source: string;
  /** Freshness/provenance for the shared DataStatusBadge -- "manual" for
   * user-imported PDFs, "feed" for every automatic connector. */
  status: DataStatus;
  sourcePriority?: "private" | "public";
  joinConflict?: {
    publicProvider: string;
    differingFields: string[];
  };
  field_provenance?: Record<string, FinancialFieldProvenance>;
}
export interface FinancialFieldProvenance {
  provider: string;
  sourceReference: string;
  asOf: string | null;
  freshness: DataStatus["freshness"];
}

export interface FinancialDataProvider {
  id: string;
  label: string;
  getReports(symbol: string, reportType: string, period: string, userId?: number): Promise<LseFinancialReport[]>;
}

const pdfImportProvider: FinancialDataProvider = {
  id: "pdf_import",
  label: "Manual PDF Import",
  getReports: async (symbol, reportType, period, userId) => {
    // Imported financials are always owner-scoped (see uideEngine/importedFinancialsStore) --
    // an unauthenticated or userId-less call can never see them, by design.
    if (userId === undefined) return [];
    const stored = loadImportedFinancials(symbol, userId);
    if (!stored) return [];
    return stored.reports.filter((r) => r.report_type === reportType && r.period === period);
  },
};

const lseProvider: FinancialDataProvider = {
  id: "lse",
  label: "London Strategic Edge",
  getReports: getFinancialReports,
};

const secEdgarProvider: FinancialDataProvider = {
  id: "sec_edgar",
  label: "SEC EDGAR",
  getReports: getSecFinancialReports,
};

const finnhubProvider: FinancialDataProvider = {
  id: "finnhub",
  label: "Finnhub",
  getReports: getFinnhubFinancialReports,
};

const simfinProvider: FinancialDataProvider = {
  id: "simfin",
  label: "SimFin",
  getReports: getSimFinFinancialReports,
};

const bseIndiaProvider: FinancialDataProvider = {
  id: "bse_india",
  label: "BSE India",
  getReports: getBseFinancialReports,
};

const screenerIndiaProvider: FinancialDataProvider = {
  id: "screener_india",
  label: "Screener.in",
  getReports: getScreenerFinancialReports,
};

const xbrlFilingsOrgProvider: FinancialDataProvider = {
  id: "xbrl_filings_org",
  label: "XBRL Filings (ESEF/UKSEF)",
  getReports: getXbrlFilingsOrgReports,
};

const yfinanceProvider: FinancialDataProvider = {
  id: "yfinance",
  label: "yfinance",
  getReports: getYfinanceFinancialReports,
};

// Priority order -- first provider with a non-empty result wins. LSE first
// since it has broader (multi-exchange) coverage when it has data at all;
// EDGAR as the fallback for the US small/mid-cap gap the ticker audit found
// (EDGAR only covers US SEC filers, so it's a no-op for every non-US
// exchange -- appending it after LSE costs nothing on those requests since
// LSE already either hit or missed by the time EDGAR would be tried).
// Finnhub right after EDGAR: a real second US-filer source (confirmed live
// its free tier's real data is US-only, same us-gaap tag system as EDGAR),
// added for resilience against EDGAR's own CIK resolution silently missing
// a real company, not for new geographic coverage -- a no-op for every
// symbol EDGAR already answered, and for every non-US symbol either way.
// Screener.in before BSE India: Screener has genuinely full Balance
// Sheet/P&L/Cash Flow (12yr annual + ~3yr quarterly P&L, see
// screenerIndia.ts), while BSE's TabResults_PAR is a thin 3-line-item
// snapshot (see bseIndia.ts) -- BSE only gets a chance to answer when
// Screener's HTML scrape fails (site change, network issue, no page found).
// Both are no-ops for every symbol that isn't .NS/.BO, so appending them
// costs nothing for non-Indian tickers.
// XBRL Filings (ESEF/UKSEF) covers .L/.PA/.AS/.BR/.VI (UK/France/Netherlands/
// Belgium/Austria) -- a no-op for every other suffix, so appending it costs
// nothing elsewhere. Placed after LSE/EDGAR (existing vendor coverage wins
// where it already has data) and alongside the India providers, which are
// mutually exclusive by symbol suffix so ordering between them doesn't matter.
//
// yfinance goes LAST, as the broadest possible net: unlike every provider
// above (each scoped to a specific vendor/region), it's a genuine global
// fallback with no symbol-suffix restriction, so it should only ever be
// tried once every more specific/authoritative source above has answered
// with nothing. It closes the gap this module's own top comment named --
// China A-shares (SSE/SZSE) and Brazil (B3) -- confirmed live before
// adding it: LSE returns 0 reports for real SSE/SZSE symbols that yfinance
// has complete real statement data for.
//
// pdfImportProvider goes FIRST, ahead of every automatic connector: a user
// who bothered to upload and review a statement PDF for a specific symbol
// did so deliberately (often because nothing else covers it, or because they
// have a more authoritative source than what's scraped) -- that explicit
// intent should win over an automatic source, not lose to it. A no-op for
// every symbol nobody has ever imported, so it costs nothing elsewhere.
export const PROVIDERS: FinancialDataProvider[] = [pdfImportProvider, lseProvider, secEdgarProvider, finnhubProvider, simfinProvider, screenerIndiaProvider, bseIndiaProvider, xbrlFilingsOrgProvider, yfinanceProvider];

export interface FinancialReportsResult {
  reports: FinancialReportRow[];
  provider: string | null; // provider id that supplied the data, or null if none had any
  attemptedProviders: string[];
  failures: Array<{ provider: string; message: string }>;
}

export async function runFinancialProviderWaterfall(
  providers: FinancialDataProvider[],
  symbol: string,
  reportType: string,
  period: string,
  userId?: number,
): Promise<{ reports: LseFinancialReport[]; provider: FinancialDataProvider | null; attemptedProviders: string[]; failures: Array<{ provider: string; message: string }> }> {
  const attemptedProviders: string[] = [];
  const failures: Array<{ provider: string; message: string }> = [];
  for (const provider of providers) {
    attemptedProviders.push(provider.id);
    try {
      const reports = await provider.getReports(symbol, reportType, period, userId);
      if (reports.length > 0) return { reports, provider, attemptedProviders, failures };
    } catch (error) {
      failures.push({ provider: provider.id, message: error instanceof Error ? error.message : "Unknown provider error" });
    }
  }
  return { reports: [], provider: null, attemptedProviders, failures };
}

export function financialReportJoinKey(report: Pick<LseFinancialReport, "report_type" | "fiscal_year" | "period">) {
  return `${report.report_type}:${report.fiscal_year}:${report.period}`;
}

export function differingFinancialFields(leftData: string, rightData: string) {
  let left: Record<string, unknown> = {};
  let right: Record<string, unknown> = {};
  try { left = JSON.parse(leftData); } catch { left = {}; }
  try { right = JSON.parse(rightData); } catch { right = {}; }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Array.from(keys).filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])).sort();
}

function rowStatus(provider: FinancialDataProvider, report: LseFinancialReport, isFallback: boolean) {
  const isManual = provider.id === "pdf_import";
  return buildDataStatus({
    provider: provider.label,
    freshness: isManual ? "manual" : "feed",
    asOf: report.filing_date ?? null,
    isFallback,
  });
}
const SOURCE_REFERENCE_BY_PROVIDER: Record<string, string> = {
  "Manual PDF Import": "user-imported-filing",
  "London Strategic Edge": "lse:financial_reports",
  "SEC EDGAR": "https://data.sec.gov/api/xbrl/companyfacts",
  Finnhub: "https://finnhub.io/api/v1/stock/financials-reported",
  SimFin: "https://backend.simfin.com/api/v3/companies/statements/compact",
  "BSE India": "bse:financial-statements",
  "Screener.in": "screener.in:financial-statements",
  "XBRL Filings (ESEF/UKSEF)": "xbrl-filings.org:financial-statements",
  yfinance: "yfinance:Ticker.financials",
};

export function attachFinancialFieldProvenance(provider: FinancialDataProvider, report: LseFinancialReport, isFallback: boolean): FinancialReportRow {
  const status = rowStatus(provider, report, isFallback);
  let fields: string[] = [];
  try {
    const parsed = JSON.parse(report.data) as Record<string, unknown>;
    fields = Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).map(([key]) => key);
  } catch {
    fields = [];
  }
  const sourceReference = SOURCE_REFERENCE_BY_PROVIDER[provider.label] ?? provider.id;
  const field_provenance: Record<string, FinancialFieldProvenance> = Object.fromEntries(fields.map((field) => [
    field,
    { provider: provider.label, sourceReference, asOf: report.filing_date ?? null, freshness: status.freshness },
  ]));
  return { ...report, data_source: provider.label, status, field_provenance };
}


// The universal resolver is used here because `PROVIDERS.slice(1)` used exactly
// as module-defined at both call sites below, meaning a user's
// providerStackOrder/pins (already respected by quote/OHLCV adapters --
// see keyedQuoteAdapters.ts) had zero effect on which financial-statement
// provider actually won. pdfImportProvider is still excluded
// here and handled separately above/below via its own manual-precedence
// branch, unaffected by this reordering -- that precedence is a different,
// stronger guarantee (explicit user upload always wins) than "which
// automatic source is tried first among several automatic sources".
function orderedAutomaticProviders(symbol: string): FinancialDataProvider[] {
  const automatic = PROVIDERS.slice(1);
  const identity = getRequestIdentity();
  if (!identity?.providerStackOrder?.length && !identity?.dataStackPins?.length) return automatic;
  const order = resolveFamilyProviderOrder("statements", automatic.map((p) => p.id), {
    globalStackOrder: identity.providerStackOrder,
    pins: identity.dataStackPins,
    symbol,
  });
  const byId = new Map(automatic.map((p) => [p.id, p]));
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

export async function getFinancialReportsWithFallback(
  symbol: string,
  reportType: string,
  period: string,
  userId?: number,
): Promise<FinancialReportsResult> {
  const attemptedProviders: string[] = [];
  const failures: Array<{ provider: string; message: string }> = [];

  const manualReports = userId === undefined ? [] : await pdfImportProvider.getReports(symbol, reportType, period, userId);
  attemptedProviders.push(pdfImportProvider.id);
  if (manualReports.length > 0) {
    const publicResult = await runFinancialProviderWaterfall(orderedAutomaticProviders(symbol), symbol, reportType, period, userId);
    attemptedProviders.push(...publicResult.attemptedProviders);
    failures.push(...publicResult.failures);
    const publicByKey = new Map(publicResult.reports.map((report) => [financialReportJoinKey(report), report]));
    const manualByKey = new Set(manualReports.map(financialReportJoinKey));
    const publicProvider = publicResult.provider;
    const manualRows: FinancialReportRow[] = manualReports.map((report) => {
      const matchingPublic = publicByKey.get(financialReportJoinKey(report));
      const diff = matchingPublic ? differingFinancialFields(report.data, matchingPublic.data) : [];
      const enriched = attachFinancialFieldProvenance(pdfImportProvider, report, false);
      return {
        ...enriched,
        sourcePriority: "private",
        joinConflict: matchingPublic && diff.length && publicProvider ? { publicProvider: publicProvider.label, differingFields: diff } : undefined,
      };
    });
    const publicRows: FinancialReportRow[] = publicResult.reports
      .filter((report) => !manualByKey.has(financialReportJoinKey(report)))
      .map((report) => ({
        ...attachFinancialFieldProvenance(publicProvider!, report, publicProvider!.id !== "lse"),
        sourcePriority: "public" as const,
      }));
    return { reports: [...manualRows, ...publicRows], provider: "pdf_import", attemptedProviders, failures };
  }

  const result = await runFinancialProviderWaterfall(orderedAutomaticProviders(symbol), symbol, reportType, period, userId);
  attemptedProviders.push(...result.attemptedProviders);
  failures.push(...result.failures);
  if (result.provider) {
    const provider = result.provider;
    return {
      reports: result.reports.map((report) => ({
        ...attachFinancialFieldProvenance(provider, report, provider.id !== "lse"),
      })),
      provider: provider.id,
      attemptedProviders,
      failures,
    };
  }
  return { reports: [], provider: null, attemptedProviders, failures };
}
