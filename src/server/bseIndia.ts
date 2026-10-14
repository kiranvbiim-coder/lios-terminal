/**
 * BSE (Bombay Stock Exchange) India connector -- third provider in the
 * financial-reports waterfall (see financialDataProviders.ts). Activates only
 * for .BO-suffixed symbols (India's long-tail BSE coverage that the ticker
 * audit found "London Strategic Edge" is thin-to-absent for).
 *
 * IMPORTANT PROVENANCE NOTE: an earlier candidate for this provider assumed a
 * BSE XBRL zip-download endpoint (/BseIndiaAPI/api/XBRL_zip/w) existed, copied
 * from an unverified third-party codebase. Live-tested before writing this
 * file: that endpoint 302-redirects to an error page and does not work.
 * Cross-checked against BennyThadikaran/BseIndiaApi (a real, actively
 * maintained -- as of Aug 2026 -- unofficial client, 77+ stars) confirmed BSE
 * has no XBRL endpoint at all; corporate filings are PDF-only. What *is* real
 * and live (curl-verified against Reliance/500325, TCS/532540, Infosys/500209,
 * HDFC Bank/500180 on 2026-08-03, numbers cross-checked for plausibility) is
 * /TabResults_PAR/w, an unauthenticated JSON endpoint returning a quarterly
 * results snapshot: latest quarter, prior quarter, and latest full fiscal
 * year, each with Revenue, Net Profit, and EPS (banks substitute CAR% for
 * OPM%, confirming line items vary by industry -- parsed by title match, not
 * fixed array position, for that reason).
 *
 * SCOPE HONESTY: this is a snapshot, not full financial statements. Unlike
 * SEC EDGAR's companyfacts (10 years of full balance sheet / income / cash
 * flow), BSE's endpoint gives exactly 2 quarters + 1 FY, and only 3 income
 * line items. Only fields the API actually reports are mapped -- "Cash EPS"
 * (EPS + D&A add-back) is deliberately NOT mapped to epsDiluted, since that
 * would misrepresent a different metric under an existing field name.
 * Margins (OPM%/NPM%/CAR%) aren't stored -- they're ratios, not the absolute
 * line-item amounts BALANCE_FIELDS/INCOME_FIELDS/CASHFLOW_FIELDS expect.
 *
 * India's fiscal year runs April-March. The API labels periods as "Mon-YY"
 * (e.g. "Jun-26" = quarter ended June 2026) and "FYyy-yy" (e.g. "FY25-26" =
 * April 2025-March 2026). Mapped to this app's period/fiscal_year convention
 * (fiscal_year = the calendar year the period ENDS in, matching SEC EDGAR's
 * `fy` semantics) via: Jan-Mar -> Q4 of the fiscal year ending that same
 * calendar year; Apr-Jun -> Q1, Jul-Sep -> Q2, Oct-Dec -> Q3 of the fiscal
 * year ending the FOLLOWING calendar year. Verified: "Jun-26" -> Q1, FY2027;
 * "Mar-26" -> Q4, FY2026 -- both correctly land one fiscal year apart despite
 * being only three calendar months apart, which is the whole point of doing
 * this arithmetic instead of a naive year-string parse.
 *
 * Values arrive in both crores (resultinCr) and millions (resultinM) --
 * resultinM is used directly since XBRL/SEC-style absolute figures are what
 * FinancialStatementsPanel expects, avoiding an India-specific unit ambiguity
 * (1 crore = 10 million, confirmed by cross-multiplying the two arrays).
 */
import { fetchWithRetry } from "./providerUtils";
import type { LseFinancialReport } from "./lseData";
import { upsertCompany, persistFinancialStatementPeriods, getFinancialStatementPeriodsForSymbol } from "./companyStore";
import { parseIndiaQuarterLabel, parseIndiaFyLabel, parseIndianNumber } from "./indiaFiscalYear";
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

const BSE_BASE = "https://api.bseindia.com/BseIndiaAPI/api";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // BSE posts results a few times a day at most during results season

const BSE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Origin": "https://www.bseindia.com",
  "Referer": "https://www.bseindia.com/",
};

function cacheDir(): string {
  return dataPath("bse-india-cache");
}
function cachePathFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
  return path.join(cacheDir(), `${safe}.json`);
}
function readCache<T>(key: string): T | null {
  try {
    const file = cachePathFor(key);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - raw.cachedAt > CACHE_TTL_MS) return null;
    return raw.data as T;
  } catch {
    return null;
  }
}
function writeCache<T>(key: string, data: T): void {
  try {
    if (!fs.existsSync(cacheDir())) fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cachePathFor(key), JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // best-effort cache
  }
}

interface TabResultLine { title: string; v1: string; v2: string; v3: string }
interface TabResultsResponse {
  col2: string; // latest quarter label, e.g. "Jun-26"
  col3: string; // prior quarter label, e.g. "Mar-26"
  col4: string; // latest FY label, e.g. "FY25-26"
  resultinM: TabResultLine[];
}

async function fetchTabResults(scripCode: string): Promise<TabResultsResponse | null> {
  const cacheKey = `tabresults_${scripCode}`;
  try {
    const url = `${BSE_BASE}/TabResults_PAR/w?scripcode=${scripCode}&tabtype=RESULTS`;
    const res = await fetchWithRetry(url, BSE_HEADERS);
    const text = await res.text();
    // BSE returns a JSON string literal (quoted + escaped), not a bare object.
    const outer = JSON.parse(text);
    const parsed = (typeof outer === "string" ? JSON.parse(outer) : outer) as TabResultsResponse;
    if (!parsed?.resultinM || parsed.resultinM.length === 0) throw new Error("empty resultinM");
    writeCache(cacheKey, parsed);
    return parsed;
  } catch (err) {
    console.warn(`BSE TabResults fetch failed for scrip ${scripCode}, falling back to cache:`, err instanceof Error ? err.message : err);
    return readCache<TabResultsResponse>(cacheKey);
  }
}

function lineValue(lines: TabResultLine[], title: string, col: "v1" | "v2" | "v3"): number | undefined {
  const row = lines.find((l) => l.title.trim().toLowerCase() === title.toLowerCase());
  return row ? parseIndianNumber(row[col]) : undefined;
}

/** Builds the flat field map this app's FinancialStatementsPanel/ValuationPanel
 * already read via LseFinancialReport.data -- only revenue/netIncome/eps,
 * since that's genuinely all this endpoint reports (see file header). Values
 * are in millions (resultinM) scaled to absolute INR to match how SEC EDGAR
 * stores absolute USD, not "in millions". */
function buildIncomeRow(lines: TabResultLine[], col: "v1" | "v2" | "v3"): Record<string, number> {
  const out: Record<string, number> = {};
  const revenue = lineValue(lines, "Revenue", col);
  const netIncome = lineValue(lines, "Net Profit", col);
  const eps = lineValue(lines, "EPS", col);
  if (revenue !== undefined) out.revenue = revenue * 1_000_000;
  if (netIncome !== undefined) out.netIncome = netIncome * 1_000_000;
  if (eps !== undefined) out.eps = eps; // per-share value, not scaled
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

export async function getBseFinancialReports(symbol: string, reportType = "income", period = "FY"): Promise<LseFinancialReport[]> {
  const upper = symbol.toUpperCase();
  if (!upper.endsWith(".BO")) return []; // this provider only covers BSE-listed symbols
  if (reportType !== "income") return financialReportsFromStore(symbol, reportType, period); // no balance/cashflow data from this endpoint

  const scripCode = upper.slice(0, -3);
  if (!/^\d+$/.test(scripCode)) return []; // BSE scrip codes are numeric; ticker universe already encodes them as "{scripcode}.BO"

  try {
    const snapshot = await fetchTabResults(scripCode);
    if (!snapshot) throw new Error("no snapshot available (live and cache both empty)");

    const candidates: Array<{ label: string; col: "v1" | "v2" | "v3"; kind: "quarter" | "fy" }> = [
      { label: snapshot.col2, col: "v1", kind: "quarter" },
      { label: snapshot.col3, col: "v2", kind: "quarter" },
      { label: snapshot.col4, col: "v3", kind: "fy" },
    ];

    const rows: LseFinancialReport[] = [];
    for (const c of candidates) {
      const parsed = c.kind === "quarter" ? parseIndiaQuarterLabel(c.label) : parseIndiaFyLabel(c.label);
      if (!parsed) continue;
      const rowPeriod = "quarter" in parsed ? parsed.quarter : "FY";
      if (rowPeriod !== period) continue;
      const row = buildIncomeRow(snapshot.resultinM, c.col);
      if (Object.keys(row).length === 0) continue;
      rows.push({
        symbol: upper,
        report_type: "income",
        date: parsed.periodEndIso,
        fiscal_year: parsed.fiscalYear,
        period: rowPeriod,
        reported_currency: "INR",
        data: JSON.stringify(row),
        filing_date: null, // BSE's snapshot endpoint doesn't expose the actual filing date
      });
    }

    if (rows.length > 0) {
      try {
        const companyId = await upsertCompany({ symbol: upper, exchange: "BSE", country: "IN" });
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
            source: "bse_india",
          })),
        );
      } catch (err) {
        console.warn(`Failed to persist BSE financial statements for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    return rows.length > 0 ? rows : await financialReportsFromStore(symbol, reportType, period);
  } catch (err) {
    console.warn(`Live BSE financials fetch failed for ${symbol}, falling back to persisted data:`, err instanceof Error ? err.message : err);
    return financialReportsFromStore(symbol, reportType, period);
  }
}
