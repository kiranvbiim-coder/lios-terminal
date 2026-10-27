/**
 * Screener.in connector -- the richest India financial-statements source
 * found across this app's research (see conversation history): real,
 * structured, 12-year annual Balance Sheet / P&L / Cash Flow plus ~3 years of
 * quarterly P&L, all on a public company page that needs NO login (only
 * Screener's "Export to Excel" and its deeper JSON API are account-gated).
 * Live-verified against Reliance Industries on 2026-08-04: the page returns
 * real tables with real numbers, the reported "Total Liabilities" figure is
 * confirmed via arithmetic (Equity Capital + Reserves + Borrowings + Other
 * Liabilities == Total Liabilities == Total Assets) to mean "total sources of
 * funds" in the Indian Schedule-III sense, not liabilities-excluding-equity
 * -- an easy mislabel to get wrong, checked against real numbers rather than
 * assumed from the row name alone.
 *
 * Company-centric (one page per company, not per exchange), which is what
 * lets this single connector cover BOTH .NS and .BO tickers: for .NS, the
 * Screener URL slug is just the ticker symbol with the suffix stripped
 * (verified: RELIANCE.NS -> /company/RELIANCE/). For .BO, the ticker
 * universe only has a numeric BSE scrip code, which Screener's URLs don't
 * use -- resolved instead via Screener's own public search API
 * (/api/company/search/?q=<company name>), matched against the company name
 * already in tickers.json (verified live: "ABB INDIA" -> /company/ABB/,
 * "AEGIS LOGISTICS" -> /company/AEGISLOG/).
 *
 * HTML TABLE PARSING, NOT AN API: there's no JSON here (the free tier of the
 * real JSON API, /api/company/{id}/schedules/, requires a Screener login).
 * Regex-based table extraction was chosen over adding an HTML-parser
 * dependency since Screener's tables are machine-generated with a very
 * consistent structure (verified against the raw HTML directly, not assumed)
 * -- each row is either a <button onclick="Company.showSchedule('Label', ...)">
 * or plain text, each data cell is a <td>value</td>.
 *
 * FIELD MAPPING HONESTY: only line items with an unambiguous match to this
 * app's existing field names are mapped. Specifically NOT mapped: "Other
 * Income" (Screener's figure isn't netted the way totalOtherIncomeExpensesNet
 * is elsewhere in this app, so forcing it in would misrepresent the number,
 * not just omit one); "Reserves" as a standalone field (Indian "Reserves &
 * Surplus" bundles retained earnings + share premium + general reserve into
 * one figure with no clean single existing field to hold it -- used instead,
 * together with Equity Capital, to derive totalStockholdersEquity, which IS
 * unambiguous); OPM%/NPM%/Tax%/Dividend Payout%/CFO-OP% (ratios, not the
 * absolute line-item amounts this app's field set expects). "Borrowings"
 * is a single combined figure (Screener doesn't split current/non-current
 * debt) -- mapped to longTermDebt with shortTermDebt left unset, documented
 * inline, so real net-debt/EV calculations pick up the correct TOTAL even
 * though the current/non-current split isn't available; leaving it unmapped
 * entirely would have understated leverage far more (net debt = 0).
 */
import { fetchWithRetry } from "./providerUtils";
import type { LseFinancialReport } from "./lseData";
import { upsertCompany, persistFinancialStatementPeriods, getFinancialStatementPeriodsForSymbol } from "./companyStore";
import { parseIndiaQuarterLabel, parseIndiaFyLabel, parseIndianNumber } from "./indiaFiscalYear";
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";
import { isUsableCatalogIdentityRow } from "@shared/catalogIdentityRows";

const SCREENER_BASE = "https://www.screener.in";
const PAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // annual/quarterly tables update at most a few times a year
const SLUG_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a company's Screener slug essentially never changes

const SCREENER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function cacheDir(sub: string): string {
  return dataPath(sub);
}
function cachePathFor(dir: string, key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
  return path.join(dir, `${safe}.json`);
}
function readCache<T>(dir: string, key: string, ttlMs: number): T | null {
  try {
    const file = cachePathFor(dir, key);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - raw.cachedAt > ttlMs) return null;
    return raw.data as T;
  } catch {
    return null;
  }
}
function writeCache<T>(dir: string, key: string, data: T): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePathFor(dir, key), JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // best-effort cache
  }
}
// Cache reads that ignore TTL -- used as the last-resort fallback when a live
// fetch fails, same "stale data beats no data" contract as lseData.ts.
function readStaleCache<T>(dir: string, key: string): T | null {
  try {
    const file = cachePathFor(dir, key);
    if (!fs.existsSync(file)) return null;
    return (JSON.parse(fs.readFileSync(file, "utf8")).data) as T;
  } catch {
    return null;
  }
}

// ── Ticker universe: symbol -> company name (needed to resolve .BO scrip
// codes to a Screener slug via search; loaded once, same file routes.ts
// already reads tickers.json from). ──────────────────────────────────────
let tickerNameBySymbol: Map<string, string> | null = null;
function loadTickerNames(): Map<string, string> {
  if (tickerNameBySymbol) return tickerNameBySymbol;
  tickerNameBySymbol = new Map();
  try {
    const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
    const dataPath = resourcesBase
      ? path.resolve(resourcesBase, "server", "data", "tickers.json")
      : path.resolve(process.cwd(), "server", "data", "tickers.json");
    if (fs.existsSync(dataPath)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Invalid ticker catalog");
      for (const row of parsed) {
        if (!isUsableCatalogIdentityRow(row)) continue;
        tickerNameBySymbol.set(row.symbol.toUpperCase(), row.name);
      }
    }
  } catch (err) {
    console.warn("screenerIndia: failed to load tickers.json for .BO name resolution:", err instanceof Error ? err.message : err);
  }
  return tickerNameBySymbol;
}

interface ScreenerSearchResult { id: number; name: string; url: string }

/** ".NS" -> strip suffix directly. ".BO" -> resolve via Screener's public
 * search API using the company name already in the ticker universe. */
async function resolveScreenerSlug(upperSymbol: string): Promise<string | null> {
  const cacheDirPath = cacheDir("screener-india-slug-cache");
  const cached = readCache<string | null>(cacheDirPath, upperSymbol, SLUG_CACHE_TTL_MS);
  if (cached !== null) return cached;

  let slug: string | null = null;
  if (upperSymbol.endsWith(".NS")) {
    slug = upperSymbol.slice(0, -3);
  } else if (upperSymbol.endsWith(".BO")) {
    const name = loadTickerNames().get(upperSymbol);
    if (name) {
      try {
        const url = `${SCREENER_BASE}/api/company/search/?q=${encodeURIComponent(name)}`;
        const res = await fetchWithRetry(url, SCREENER_HEADERS);
        const results = (await res.json()) as ScreenerSearchResult[];
        const first = results[0];
        if (first?.url) {
          const m = first.url.match(/\/company\/([^/]+)\//);
          if (m) slug = m[1];
        }
      } catch (err) {
        console.warn(`screenerIndia: slug search failed for ${upperSymbol} ("${name}"):`, err instanceof Error ? err.message : err);
      }
    }
  }
  writeCache(cacheDirPath, upperSymbol, slug);
  return slug;
}

/** Tries the consolidated page first (most large/mid-caps report
 * consolidated); falls back to standalone for companies that only file
 * standalone statements (no subsidiaries to consolidate). Presence of the
 * profit-loss table id is what distinguishes "real company page" from a
 * redirect/404/empty shell. */
async function fetchCompanyPage(slug: string): Promise<string | null> {
  const cacheDirPath = cacheDir("screener-india-page-cache");
  const cacheKey = `page_${slug}`;
  const cached = readCache<string>(cacheDirPath, cacheKey, PAGE_CACHE_TTL_MS);
  if (cached) return cached;

  for (const variant of [`/company/${slug}/consolidated/`, `/company/${slug}/`]) {
    try {
      const res = await fetchWithRetry(`${SCREENER_BASE}${variant}`, SCREENER_HEADERS);
      const html = await res.text();
      if (html.includes('id="profit-loss"')) {
        writeCache(cacheDirPath, cacheKey, html);
        return html;
      }
    } catch (err) {
      console.warn(`screenerIndia: fetch failed for ${SCREENER_BASE}${variant}:`, err instanceof Error ? err.message : err);
    }
  }
  return readStaleCache<string>(cacheDirPath, cacheKey);
}

// ── Table parsing ───────────────────────────────────────────────────────
interface ParsedTable { headers: string[]; rows: Record<string, string[]> }

function parseSection(html: string, sectionId: string): ParsedTable | null {
  const secIdx = html.indexOf(`id="${sectionId}"`);
  if (secIdx === -1) return null;
  const tableStart = html.indexOf("<table", secIdx);
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableStart === -1 || tableEnd === -1) return null;
  const table = html.slice(tableStart, tableEnd);

  const theadMatch = table.match(/<thead[\s\S]*?<\/thead>/);
  const headers = theadMatch
    ? Array.from(theadMatch[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)).map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    : [];

  const rows: Record<string, string[]> = {};
  const rowRe = /<tr class="[^"]*">\s*<td class="text">([\s\S]*?)<\/tr>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(table)) !== null) {
    const rowHtml = rm[1];
    const labelMatch = rowHtml.match(/showSchedule\('([^']+)'/);
    let label: string;
    if (labelMatch) {
      label = labelMatch[1];
    } else {
      const plain = rowHtml.match(/^([\s\S]*?)<\/td>/);
      label = plain ? plain[1].replace(/<[^>]+>/g, "").trim() : "";
    }
    if (!label) continue;
    const values = Array.from(rowHtml.matchAll(/<td class="[^"]*">\s*([\s\S]*?)\s*<\/td>/g)).map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    rows[label] = values;
  }
  return headers.length > 0 ? { headers: headers.slice(1), rows } : null; // drop the blank label-column header
}

function cellFor(table: ParsedTable, label: string, headerLabel: string): number | undefined {
  const colIndex = table.headers.indexOf(headerLabel);
  if (colIndex === -1) return undefined;
  const row = table.rows[label];
  if (!row) return undefined;
  return parseIndianNumber(row[colIndex]);
}

const CRORE_TO_ABSOLUTE = 10_000_000;

function buildIncomeRow(table: ParsedTable, headerLabel: string): Record<string, number> {
  const out: Record<string, number> = {};
  const get = (label: string) => cellFor(table, label, headerLabel);
  const sales = get("Sales");
  const expenses = get("Expenses");
  const opProfit = get("Operating Profit");
  const interest = get("Interest");
  const depreciation = get("Depreciation");
  const pbt = get("Profit before tax");
  const netProfit = get("Net Profit");
  const eps = get("EPS in Rs");
  if (sales !== undefined) out.revenue = sales * CRORE_TO_ABSOLUTE;
  if (expenses !== undefined) out.operatingExpenses = expenses * CRORE_TO_ABSOLUTE;
  if (opProfit !== undefined) { out.operatingIncome = opProfit * CRORE_TO_ABSOLUTE; out.ebit = out.operatingIncome; }
  if (interest !== undefined) out.interestExpense = interest * CRORE_TO_ABSOLUTE;
  if (depreciation !== undefined) out.depreciationAndAmortization = depreciation * CRORE_TO_ABSOLUTE;
  if (pbt !== undefined) out.incomeBeforeTax = pbt * CRORE_TO_ABSOLUTE;
  if (netProfit !== undefined) out.netIncome = netProfit * CRORE_TO_ABSOLUTE;
  if (eps !== undefined) out.eps = eps; // per-share, not scaled
  if (out.incomeBeforeTax !== undefined && out.netIncome !== undefined) {
    out.incomeTaxExpense = out.incomeBeforeTax - out.netIncome;
  }
  if (out.operatingIncome !== undefined && out.depreciationAndAmortization !== undefined) {
    out.ebitda = out.operatingIncome + out.depreciationAndAmortization;
  }
  return out;
}

function buildBalanceRow(table: ParsedTable, headerLabel: string): Record<string, number> {
  const out: Record<string, number> = {};
  const get = (label: string) => cellFor(table, label, headerLabel);
  const equityCapital = get("Equity Capital");
  const reserves = get("Reserves");
  const borrowings = get("Borrowings");
  const otherLiabilities = get("Other Liabilities");
  const totalLiabilities = get("Total Liabilities"); // Indian convention: total sources of funds (equity + liabilities), verified via arithmetic against Total Assets
  const fixedAssets = get("Fixed Assets");
  const investments = get("Investments");
  const otherAssets = get("Other Assets");
  const totalAssets = get("Total Assets");

  if (equityCapital !== undefined) out.commonStock = equityCapital * CRORE_TO_ABSOLUTE;
  if (equityCapital !== undefined && reserves !== undefined) {
    out.totalStockholdersEquity = (equityCapital + reserves) * CRORE_TO_ABSOLUTE;
  }
  if (borrowings !== undefined) out.longTermDebt = borrowings * CRORE_TO_ABSOLUTE; // combined ST+LT -- see file header
  if (otherLiabilities !== undefined) out.otherNonCurrentLiabilities = otherLiabilities * CRORE_TO_ABSOLUTE;
  if (totalLiabilities !== undefined) out.totalLiabilitiesAndTotalEquity = totalLiabilities * CRORE_TO_ABSOLUTE;
  if (borrowings !== undefined && otherLiabilities !== undefined) {
    out.totalLiabilities = (borrowings + otherLiabilities) * CRORE_TO_ABSOLUTE; // excludes equity, matches SEC EDGAR's "Liabilities" tag semantics
  }
  if (fixedAssets !== undefined) out.propertyPlantEquipmentNet = fixedAssets * CRORE_TO_ABSOLUTE;
  if (investments !== undefined) out.longTermInvestments = investments * CRORE_TO_ABSOLUTE;
  if (otherAssets !== undefined) out.otherNonCurrentAssets = otherAssets * CRORE_TO_ABSOLUTE;
  if (totalAssets !== undefined) out.totalAssets = totalAssets * CRORE_TO_ABSOLUTE;
  return out;
}

function buildCashflowRow(table: ParsedTable, headerLabel: string): Record<string, number> {
  const out: Record<string, number> = {};
  const get = (label: string) => cellFor(table, label, headerLabel);
  const cfo = get("Cash from Operating Activity");
  const cfi = get("Cash from Investing Activity");
  const cff = get("Cash from Financing Activity");
  const netChange = get("Net Cash Flow");
  const fcf = get("Free Cash Flow");
  if (cfo !== undefined) { out.netCashProvidedByOperatingActivities = cfo * CRORE_TO_ABSOLUTE; out.operatingCashFlow = out.netCashProvidedByOperatingActivities; }
  if (cfi !== undefined) out.netCashProvidedByInvestingActivities = cfi * CRORE_TO_ABSOLUTE;
  if (cff !== undefined) out.netCashProvidedByFinancingActivities = cff * CRORE_TO_ABSOLUTE;
  if (netChange !== undefined) out.netChangeInCash = netChange * CRORE_TO_ABSOLUTE;
  if (fcf !== undefined) out.freeCashFlow = fcf * CRORE_TO_ABSOLUTE; // Screener reports this directly, not derived
  return out;
}

async function financialReportsFromStore(symbol: string, reportType: string, period: string): Promise<LseFinancialReport[]> {
  const rows = await getFinancialStatementPeriodsForSymbol(symbol, reportType).catch(() => []);
  return rows
    .filter((r) => r.period === period)
    .map((r) => ({
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

/** NOTE for future maintainers: this fetches the CONSOLIDATED page by
 * default (fetchCompanyPage tries /consolidated/ first). Confirmed live for
 * Reliance that consolidated figures run ~2x standalone (consolidated rolls
 * up subsidiaries like Jio/Retail) -- so numbers from this provider won't
 * match bseIndia.ts's TabResults_PAR figures, which appear to be standalone.
 * Not a bug: the PROVIDERS waterfall in financialDataProviders.ts only ever
 * lets ONE source answer a given request, it never blends two providers'
 * numbers together -- but worth knowing if the two are ever compared side by
 * side while debugging. */
export async function getScreenerFinancialReports(symbol: string, reportType = "income", period = "FY"): Promise<LseFinancialReport[]> {
  const upper = symbol.toUpperCase();
  if (!upper.endsWith(".NS") && !upper.endsWith(".BO")) return []; // this provider only covers India

  try {
    const slug = await resolveScreenerSlug(upper);
    if (!slug) throw new Error("could not resolve a Screener.in slug for this symbol");
    const html = await fetchCompanyPage(slug);
    if (!html) throw new Error("no page available (live and cache both empty)");

    const rows: LseFinancialReport[] = [];

    if (reportType === "income" && period !== "FY") {
      // Quarterly P&L only -- Screener doesn't publish quarterly balance
      // sheet or cash flow (matches real Indian reporting norms: SEBI LODR
      // mandates quarterly P&L, not full quarterly statements).
      const table = parseSection(html, "quarters");
      if (table) {
        for (const headerLabel of table.headers) {
          if (headerLabel === "TTM") continue; // trailing-twelve-months isn't a discrete filed period -- don't fabricate one
          const parsed = parseIndiaQuarterLabel(headerLabel);
          if (!parsed || parsed.quarter !== period) continue;
          const row = buildIncomeRow(table, headerLabel);
          if (Object.keys(row).length === 0) continue;
          rows.push({
            symbol: upper, report_type: "income", date: parsed.periodEndIso,
            fiscal_year: parsed.fiscalYear, period: parsed.quarter,
            reported_currency: "INR", data: JSON.stringify(row), filing_date: null,
          });
        }
      }
    } else if (period === "FY") {
      const sectionId = reportType === "balance" ? "balance-sheet" : reportType === "cashflow" ? "cash-flow" : "profit-loss";
      const table = parseSection(html, sectionId);
      if (table) {
        for (const headerLabel of table.headers) {
          if (headerLabel === "TTM") continue;
          const parsed = parseIndiaFyLabel(headerLabel);
          if (!parsed) continue;
          const row = reportType === "balance" ? buildBalanceRow(table, headerLabel)
            : reportType === "cashflow" ? buildCashflowRow(table, headerLabel)
            : buildIncomeRow(table, headerLabel);
          if (Object.keys(row).length === 0) continue;
          rows.push({
            symbol: upper, report_type: reportType, date: parsed.periodEndIso,
            fiscal_year: parsed.fiscalYear, period: "FY",
            reported_currency: "INR", data: JSON.stringify(row), filing_date: null,
          });
        }
      }
    }
    // Q1-Q4 balance/cashflow: no data from this source (see above) -- falls through to the empty-rows branch below.

    if (rows.length > 0) {
      try {
        const companyId = await upsertCompany({ symbol: upper, exchange: upper.endsWith(".NS") ? "NSE" : "BSE", country: "IN" });
        await persistFinancialStatementPeriods(
          companyId,
          rows.map((r) => ({
            reportType: r.report_type, periodEnd: r.date, fiscalYear: r.fiscal_year, period: r.period,
            reportedCurrency: r.reported_currency, data: JSON.parse(r.data) as Record<string, number>,
            filingDate: r.filing_date, source: "screener_india",
          })),
        );
      } catch (err) {
        console.warn(`Failed to persist Screener financial statements for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    return rows.length > 0 ? rows : await financialReportsFromStore(symbol, reportType, period);
  } catch (err) {
    console.warn(`Live Screener.in financials fetch failed for ${symbol}, falling back to persisted data:`, err instanceof Error ? err.message : err);
    return financialReportsFromStore(symbol, reportType, period);
  }
}
