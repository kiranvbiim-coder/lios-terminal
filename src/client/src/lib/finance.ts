// Finance data fetching via backend proxy to finance API
// All calls go through /api/finance/* which the server proxies to the finance connector

// Re-exported for backward compat -- canonical definitions moved to
// shared/dataStatus.ts.
import type { DataStatus } from "@shared/dataStatus";
export type { DataFreshness, DataStatus } from "@shared/dataStatus";

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  revenue: number | null;
  high52: number;
  low52: number;
  open: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  avgVolume: number;
  exchange: string;
  sector?: string;
  quoteSource: string;
  isLive: boolean;
  status: DataStatus;
  currency: string;
}

export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OHLCVSeries {
  bars: OHLCVBar[];
  status: DataStatus;
  supportsIntraday: boolean;
}

import type { EditorialMedia } from "@shared/editorialMedia";

export interface NewsItem {
  title: string;
  summary: string;
  /** Only eligible, locally bundled, rights-verified assets may render. */
  media?: EditorialMedia;
  url: string;
  source: string;
  feedProvider: string;
  publishedAt: string;
  sentiment?: "positive" | "negative" | "neutral";
  status: DataStatus;
}

export interface NewsArticle {
  title: string;
  source: string;
  feedProvider: string;
  url: string;
  publishedAt: string;
  excerpt: string;
  content: string[];
  status: DataStatus;
}

export interface EconomicsSnapshotMetric {
  value: number | null;
  prev: number | null;
  label: string;
  unit: string;
}

export interface EconomicsSnapshot {
  gdp: EconomicsSnapshotMetric;
  cpi: EconomicsSnapshotMetric;
  unemployment: EconomicsSnapshotMetric;
  fedFunds: EconomicsSnapshotMetric;
  t10y: EconomicsSnapshotMetric;
  t2y: EconomicsSnapshotMetric;
  t30y: EconomicsSnapshotMetric;
  dolllarIndex: EconomicsSnapshotMetric;
  eurUsd: EconomicsSnapshotMetric;
  gbpUsd: EconomicsSnapshotMetric;
  usdJpy: EconomicsSnapshotMetric;
  gold: EconomicsSnapshotMetric;
  oil: EconomicsSnapshotMetric;
  status: DataStatus;
}

export interface EconomicCalendarEvent {
  id: string;
  releaseId: number;
  title: string;
  category: "inflation" | "labor" | "growth" | "policy" | "consumption" | "activity" | "housing";
  importance: "high" | "medium";
  date: string;
  timeCt: string;
  releaseUrl: string;
  status: DataStatus;
}

export interface EconomicEventDetail {
  releaseId: number;
  title: string;
  category: EconomicCalendarEvent["category"];
  importance: EconomicCalendarEvent["importance"];
  sourceName: string;
  sourceUrl: string | null;
  releaseCalendarUrl: string;
  releaseWebsiteUrl: string | null;
  tables: Array<{ title: string; url: string; recordCount: number | null }>;
  upcomingDates: Array<{ date: string; timeCt: string }>;
  status: DataStatus;
}

export interface PortfolioPositionInput {
  symbol: string;
  shares: number;
  avgCost: number;
}

export interface PortfolioAnalytics {
  benchmarkSymbol: string;
  portfolioReturnPct: number | null;
  benchmarkReturnPct: number | null;
  activeReturnPct: number | null;
  beta: number | null;
  annualizedVolatilityPct: number | null;
  maxDrawdownPct: number | null;
  /** Historical, same-date recorded close concentration; null for incomplete/untrusted exposure. */
  effectiveNumberOfAssets: number | null;
  diversificationAsOf: string | null;
  chart: Array<{ date: string; portfolio: number; benchmark: number }>;
}

// ── Screeners beyond equities (Country/Directory, Bond, Macro) ─────────────
export interface DirectoryEntry {
  symbol: string; name: string; exchange: string; sector: string; assetClass?: string; region?: string; isPrimaryListing?: boolean;
}
export interface DirectoryScreenResult { items: DirectoryEntry[]; total: number; page: number; totalPages: number }

export interface CatalogScreenRow {
  dataset: string; symbol: string; name?: string; ticks: number; first_tick?: string; last_tick?: string; years?: number;
  last_value?: number; change_pct?: number; change_1y?: number; unit?: string; category?: string; frequency?: string;
  country?: string | null; country_name?: string | null;
}

// ── Currency display ────────────────────────────────────────────────────────
// Two ways to get a currency for a security:
//  1. Authoritative: quote.currency, straight from the data source (Yahoo's
//     own chart API reports it per-quote -- see server/marketData.ts). Use
//     this whenever a live quote is available; it's exactly what the source
//     says the security is denominated in, no guessing.
//  2. Fallback: inferCurrencyFromSymbol(), a ticker-suffix guess for when no
//     quote has loaded yet. Every suffix here is 100% consistent across the
//     57k-ticker universe (verified against server/data/tickers.json).
// "GBp" (lowercase p) is real, not a typo: LSE equities are quoted in pence,
// not pounds, and Yahoo itself reports this as a distinct currency code.

interface CurrencyInfo { symbol: string; suffix?: boolean }

const CURRENCY_INFO: Record<string, CurrencyInfo> = {
  USD: { symbol: "$" },
  GBP: { symbol: "£" },
  GBp: { symbol: "p", suffix: true },
  GBX: { symbol: "p", suffix: true },
  EUR: { symbol: "€" },
  JPY: { symbol: "¥" },
  CNY: { symbol: "¥" },
  HKD: { symbol: "HK$" },
  INR: { symbol: "₹" },
  KRW: { symbol: "₩" },
  TWD: { symbol: "NT$" },
  CAD: { symbol: "C$" },
  AUD: { symbol: "A$" },
  BRL: { symbol: "R$" },
  SGD: { symbol: "S$" },
  MYR: { symbol: "RM" },
};

const SUFFIX_CURRENCY: Record<string, string> = {
  NS: "INR", BO: "INR",
  T: "JPY",
  HK: "HKD",
  L: "GBp",
  DE: "EUR", PA: "EUR", BR: "EUR", LS: "EUR", AS: "EUR", MI: "EUR",
  TO: "CAD",
  AX: "AUD",
  SA: "BRL",
  KS: "KRW", KQ: "KRW",
  SS: "CNY", SZ: "CNY",
  TW: "TWD", TWO: "TWD",
  KL: "MYR",
  SI: "SGD",
};

export function inferCurrencyFromSymbol(symbol?: string): string {
  if (!symbol) return "USD";
  const upper = symbol.toUpperCase();
  if (upper === "^NSEI" || upper === "^BSESN") return "INR";
  if (upper === "^N225") return "JPY";
  if (upper === "^HSI") return "HKD";
  const match = /\.([A-Z]+)$/.exec(upper);
  if (!match) return "USD";
  return SUFFIX_CURRENCY[match[1]] ?? "USD";
}

export function getCurrencyInfo(currencyCode?: string): CurrencyInfo {
  if (!currencyCode) return CURRENCY_INFO.USD;
  return CURRENCY_INFO[currencyCode] ?? { symbol: `${currencyCode} ` };
}

// Ticker-suffix-based guess -- kept for callers that only have a symbol, not
// a live quote. Prefer formatMoney(value, quote.currency) when a quote is
// available; it uses the source's own authoritative currency, not a guess.
export function getCurrencySymbol(symbol?: string): string {
  return getCurrencyInfo(inferCurrencyFromSymbol(symbol)).symbol;
}

// Helper: format large numbers, currency-aware. `currencyOrSymbol` accepts
// either a currency code (preferred, e.g. quote.currency) or a ticker symbol
// (legacy call sites -- inferred via suffix guess).
export function formatBig(n: number | null | undefined, currencyOrSymbol?: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const code = currencyOrSymbol && currencyOrSymbol in CURRENCY_INFO ? currencyOrSymbol : inferCurrencyFromSymbol(currencyOrSymbol);
  const info = getCurrencyInfo(code);
  const neg = n < 0;
  const abs = Math.abs(n);
  let numStr: string;
  if (abs >= 1e12) numStr = `${(abs / 1e12).toFixed(2)}T`;
  else if (abs >= 1e9) numStr = `${(abs / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) numStr = `${(abs / 1e6).toFixed(2)}M`;
  else numStr = abs.toLocaleString();
  const formatted = info.suffix ? `${numStr}${info.symbol}` : `${info.symbol}${numStr}`;
  return neg ? `(${formatted})` : formatted;
}

// Currency-aware price/value formatter (non-compact, 2 decimal places) --
// the direct replacement for ad hoc `${getCurrencySymbol(symbol)}${n.toFixed(2)}`
// patterns scattered across panels. Takes a currency CODE (quote.currency),
// not a ticker symbol.
export function formatMoney(value: number | null | undefined, currencyCode?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const info = getCurrencyInfo(currencyCode);
  const neg = value < 0;
  const numStr = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatted = info.suffix ? `${numStr}${info.symbol}` : `${info.symbol}${numStr}`;
  return neg ? `(${formatted})` : formatted;
}

export function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(2);
}

export function formatPct(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

export function formatChange(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

export function pctClass(n: number): string {
  if (n > 0) return "text-up";
  if (n < 0) return "text-down";
  return "text-flat";
}

// Major indices tickers
export const INDICES = [
  { symbol: "^NSEI", label: "NIFTY 50" },
  { symbol: "^BSESN", label: "SENSEX" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^DJI",  label: "DOW" },
  { symbol: "^IXIC", label: "NASDAQ" },
  { symbol: "^RUT",  label: "RUSSELL 2K" },
  { symbol: "^VIX",  label: "VIX" },
  { symbol: "^N225", label: "NIKKEI 225" },
  { symbol: "^HSI", label: "HANG SENG" },
  { symbol: "^FTSE", label: "FTSE 100" },
  { symbol: "^GDAXI", label: "DAX" },
];

// Ticker tape symbols
export const TAPE_SYMBOLS = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "^NSEI", "^BSESN",
  "AAPL","MSFT","NVDA","TSLA","GOOGL","AMZN","META","BRK-B",
  "JPM","BAC","GS","MS","V","MA","PYPL",
  "XOM","CVX","COP","SLB",
  "^GSPC","^DJI","^IXIC","GC=F","CL=F","BTC-USD","ETH-USD",
];

// Screener default filters
export const SCREENER_SECTORS = [
  "Technology","Healthcare","Financial Services","Consumer Cyclical",
  "Communication Services","Industrials","Consumer Defensive","Energy",
  "Utilities","Real Estate","Basic Materials",
];
