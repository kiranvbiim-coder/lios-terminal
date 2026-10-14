/**
 * Shared India fiscal-year (April-March) period-label parsing, used by every
 * India data provider (bseIndia.ts, screenerIndia.ts) so the quarter/FY math
 * lives in exactly one place instead of drifting out of sync across modules.
 *
 * fiscal_year uses the "ending calendar year" convention (matches SEC EDGAR's
 * `fy` semantics elsewhere in this app): a quarter or year that ends in
 * calendar year Y is labeled fiscal_year=Y. Verified: a quarter ending June
 * 2026 falls in the fiscal year that starts April 2026 and ends March 2027,
 * so it's Q1 of fiscal_year "2027" -- one fiscal year apart from a quarter
 * ending March 2026 (Q4 of fiscal_year "2026"), despite being only three
 * calendar months apart. Getting this arithmetic right (not a naive
 * year-string parse) is the entire point of this module.
 */
const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface IndiaPeriod { quarter: string; fiscalYear: string; periodEndIso: string }

/** Accepts "Jun-26" (BSE's format) or "Jun 2026" (Screener's format). */
export function parseIndiaQuarterLabel(label: string): IndiaPeriod | null {
  const trimmed = label.trim();
  const short = trimmed.match(/^([A-Za-z]{3})-(\d{2})$/);
  const long = trimmed.match(/^([A-Za-z]{3})[ ](\d{4})$/);
  const m = short ?? long;
  if (!m) return null;
  const month = MONTH_ABBR[m[1].toLowerCase()];
  if (!month) return null;
  const calendarYear = short ? 2000 + parseInt(m[2], 10) : parseInt(m[2], 10);
  const fiscalYear = month <= 3 ? calendarYear : calendarYear + 1;
  const quarter = month <= 3 ? "Q4" : month <= 6 ? "Q1" : month <= 9 ? "Q2" : "Q3";
  const lastDay = new Date(calendarYear, month, 0).getDate();
  const periodEndIso = `${calendarYear}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { quarter, fiscalYear: String(fiscalYear), periodEndIso };
}

/** Accepts "FY25-26" (BSE's format) or "Mar 2026" (Screener's annual column format). */
export function parseIndiaFyLabel(label: string): { fiscalYear: string; periodEndIso: string } | null {
  const trimmed = label.trim();
  const bse = trimmed.match(/^FY(\d{2})-(\d{2})$/);
  if (bse) {
    const endYear = 2000 + parseInt(bse[2], 10);
    return { fiscalYear: String(endYear), periodEndIso: `${endYear}-03-31` };
  }
  const screener = trimmed.match(/^Mar[ ](\d{4})$/);
  if (screener) {
    const endYear = parseInt(screener[1], 10);
    return { fiscalYear: String(endYear), periodEndIso: `${endYear}-03-31` };
  }
  return null;
}

export function parseIndianNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "--" || trimmed === "-") return undefined;
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const cleaned = trimmed.replace(/[(),]/g, "");
  const val = parseFloat(cleaned);
  if (Number.isNaN(val)) return undefined;
  return negative ? -val : val;
}
