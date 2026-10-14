/**
 * Ground-truth coverage map: what Limuria actually covers, region by region,
 * across the four data categories that matter for equity research (quotes,
 * price history, financial statements, corporate actions). This is a static,
 * hand-audited table -- not derived from provider code at runtime -- because
 * the whole point is to tell a user honestly what's covered *without* them
 * having to discover a gap by hitting it. It must be kept in sync by hand
 * whenever a provider is added or a gap is closed; nothing enforces that
 * automatically, so treat edits to PROVIDERS in financialDataProviders.ts
 * (and its quote/history equivalents) as a signal to revisit this file too.
 *
 * Every row here reflects what was actually verified this session (see the
 * ticker-universe audit, the XBRL Filings provider build, and the BSE
 * split/bonus adjustment work) -- not an assumption about vendor coverage.
 */

export type CoverageLevel = "full" | "partial" | "none";

export interface CoverageCell {
  level: CoverageLevel;
  note: string;
}

export interface RegionCoverage {
  id: string;
  label: string;
  /** Ticker suffixes or exchange codes that route to this region, for display only. */
  suffixes: string[];
  quotes: CoverageCell;
  history: CoverageCell;
  statements: CoverageCell;
  corporateActions: CoverageCell;
}

const full = (note: string): CoverageCell => ({ level: "full", note });
const partial = (note: string): CoverageCell => ({ level: "partial", note });
const none = (note: string): CoverageCell => ({ level: "none", note });

export const COVERAGE_MAP: RegionCoverage[] = [
  {
    id: "us",
    label: "United States",
    suffixes: ["NASDAQ", "NYSE", "no suffix"],
    quotes: full("Live/delayed quotes, full depth"),
    history: full("Full OHLCV history"),
    statements: full("LSE primary, SEC EDGAR fallback for the small/mid-cap long tail"),
    corporateActions: full("Dividends and splits via LSE vendor feed"),
  },
  {
    id: "india",
    label: "India (NSE / BSE)",
    suffixes: [".NS", ".BO"],
    quotes: full("Live quotes via BSE India + NSE feeds"),
    history: full("Full OHLCV history, split/bonus-adjusted using BSE corporate-action data"),
    statements: full("Screener.in primary (12yr annual + ~3yr quarterly), BSE India TabResults as fallback"),
    corporateActions: full("BSE India corporate actions (splits, bonuses) -- feeds the price-history adjustment pipeline"),
  },
  {
    id: "uk-xbrl-europe",
    label: "UK, France, Netherlands, Belgium, Austria",
    suffixes: [".L", ".PA", ".AS", ".BR", ".VI"],
    quotes: full("Quotes via LSE/Yahoo vendor feed"),
    history: full("Full OHLCV history"),
    statements: partial("XBRL Filings (ESEF/UKSEF) -- coverage depends on which filers have submitted machine-readable XBRL; not every filer/year is present"),
    corporateActions: none("No dividend/split feed confirmed for this region beyond price-series-implied adjustments"),
  },
  {
    id: "canada-germany-australia",
    label: "Canada, Germany, Australia",
    suffixes: [".TO", ".DE", ".AX"],
    quotes: full("Quotes via Yahoo vendor feed"),
    history: full("Full OHLCV history"),
    statements: none("No statement provider covers these exchanges -- confirmed gap, not yet built"),
    corporateActions: none("No dedicated corporate-actions feed"),
  },
  {
    id: "row",
    label: "Rest of world",
    suffixes: ["all other suffixes"],
    quotes: partial("Best-effort via Yahoo vendor feed -- coverage and reliability vary by exchange"),
    history: partial("Best-effort via Yahoo vendor feed, same caveat as quotes"),
    statements: none("No statement provider"),
    corporateActions: none("No corporate-actions feed"),
  },
];

export function getCoverageMap(): RegionCoverage[] {
  return COVERAGE_MAP;
}
