/**
 * BSE (Bombay Stock Exchange) live-quote connector. Built after confirming
 * live that the app's existing quote pipeline (Yahoo Finance, falling back
 * to Stooq -- see getQuotes/getYahooQuote in marketData.ts) has ZERO
 * coverage for .BO tickers: Yahoo's chart API returns "symbol may be
 * delisted" for real, actively-traded BSE names (verified against
 * 500002.BO / ABB India, a large, liquid, definitely-not-delisted stock),
 * and Stooq has no India data at all (verified: both .ns and .bo queries
 * 404). NSE (.NS) needed no new connector -- Yahoo already covers it well,
 * confirmed live down to a micro-cap (21STCENMGM.NS) and a sub-₹1 penny
 * stock (RCOM.NS).
 *
 * Endpoints are the same real, unofficial BSE API surface confirmed in
 * bseIndia.ts (cross-checked against the actively-maintained
 * BennyThadikaran/BseIndiaApi client), combined here to build a complete
 * Quote:
 *   - getScripHeaderData: LTP, change, %change, open/high/low, prev close,
 *     an "Ason" timestamp used as this quote's asOf.
 *   - ComHeadernew: company name/short name is on getScripHeaderData
 *     instead (Cmpname.FullN); this endpoint supplies EPS, P/E, P/B,
 *     sector/industry.
 *   - HighLow: real 52-week high/low with the dates they occurred.
 *   - StockTrading: today's traded quantity, 2-week average quantity, and
 *     BSE's own reported market cap (full + free-float) -- used directly
 *     rather than estimated from a static profile catalog, since it's a
 *     real reported figure.
 * All four hit the same scrip code in parallel. "revenue" is left null --
 * none of these endpoints report it, and this app's convention (established
 * throughout this session) is an honest gap over a fabricated or
 * proxy-derived number.
 */
import { fetchWithRetry } from "./providerUtils";
import { buildDataStatus, type DataStatus } from "./dataStatus";
import { resolveQuoteEntitlementFor } from "./marketDataConnectors";
import type { MarketDataEntitlementSnapshot } from "@shared/marketDataEntitlement";
import { parseIndianNumber } from "./indiaFiscalYear";
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

const BSE_BASE = "https://api.bseindia.com/BseIndiaAPI/api";
const CACHE_TTL_MS = 60_000; // matches the app's general QUOTE_TTL_MS cadence

const BSE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Origin": "https://www.bseindia.com",
  "Referer": "https://www.bseindia.com/",
};

// Mirrors the Quote interface in marketData.ts (kept as a structural type
// rather than importing, to avoid a circular import -- marketData.ts will
// import getBseIndiaQuote from here, not the other way around).
export interface BseQuote {
  symbol: string; name: string; price: number; change: number; changePercent: number;
  volume: number; marketCap: number | null; pe: number | null; eps: number | null;
  revenue: number | null; high52: number; low52: number; open: number; previousClose: number;
  dayHigh: number; dayLow: number; avgVolume: number; exchange: string; sector?: string;
  quoteSource: string; isLive: boolean; status: DataStatus; currency: string; entitlement: MarketDataEntitlementSnapshot;
}

function cacheDir(): string {
  return dataPath("bse-india-quote-cache");
}
function cachePathFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
  return path.join(cacheDir(), `${safe}.json`);
}
function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const file = cachePathFor(key);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - raw.cachedAt > ttlMs) return null;
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
function readStaleCache<T>(key: string): T | null {
  try {
    const file = cachePathFor(key);
    if (!fs.existsSync(file)) return null;
    return (JSON.parse(fs.readFileSync(file, "utf8")).data) as T;
  } catch {
    return null;
  }
}

interface HeaderResp {
  CurrRate: { LTP: string; Chg: string; PcChg: string };
  Cmpname: { FullN: string };
  Header: { PrevClose: string; Open: string; High: string; Low: string; LTP: string; Ason: string };
}
interface ComHeaderResp { EPS: string; PE: string; Sector: string; IndustryNew: string }
interface HighLowResp { Fifty2WkHigh_adj: string; Fifty2WkLow_adj: string }
interface TradingStatsResp { TTQ: string; TwoWkAvgQty: string; MktCapFull: string }

async function bseJsonFetch<T>(endpoint: string, cacheKeySuffix: string): Promise<T | null> {
  const cacheKey = `${cacheKeySuffix}`;
  try {
    const res = await fetchWithRetry(`${BSE_BASE}${endpoint}`, BSE_HEADERS);
    const data = (await res.json()) as T;
    writeCache(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`BSE quote fetch failed for ${endpoint}:`, err instanceof Error ? err.message : err);
    return readStaleCache<T>(cacheKey);
  }
}

/** "04 Aug 26 | 11:04" -> ISO 8601. Falls back to now() if the format ever
 * changes upstream -- an approximate asOf beats a crash, and this only
 * affects a display timestamp, not any figure that gets computed on. */
function parseAsOf(ason: string): string {
  const m = ason.trim().match(/^(\d{2})\s+([A-Za-z]{3})\s+(\d{2})\s*\|\s*(\d{2}):(\d{2})$/);
  if (!m) return new Date().toISOString();
  const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const month = months[m[2]];
  if (month === undefined) return new Date().toISOString();
  const date = new Date(2000 + parseInt(m[3], 10), month, parseInt(m[1], 10), parseInt(m[4], 10), parseInt(m[5], 10));
  return date.toISOString();
}

export async function getBseIndiaQuote(symbol: string): Promise<BseQuote | null> {
  const upper = symbol.toUpperCase();
  if (!upper.endsWith(".BO")) return null;
  const scripCode = upper.slice(0, -3);
  if (!/^\d+$/.test(scripCode)) return null;

  const cacheKey = `quote_${scripCode}`;
  const cached = readCache<BseQuote>(cacheKey, CACHE_TTL_MS);
  if (cached) return cached;

  const [header, comHeader, highLow, trading] = await Promise.all([
    bseJsonFetch<HeaderResp>(`/getScripHeaderData/w?scripcode=${scripCode}`, `header_${scripCode}`),
    bseJsonFetch<ComHeaderResp>(`/ComHeadernew/w?quotetype=EQ&scripcode=${scripCode}&seriesid=`, `comheader_${scripCode}`),
    bseJsonFetch<HighLowResp>(`/HighLow/w?Type=EQ&flag=C&scripcode=${scripCode}`, `highlow_${scripCode}`),
    bseJsonFetch<TradingStatsResp>(`/StockTrading/w?flag=1&quotetype=EQ&scripcode=${scripCode}`, `trading_${scripCode}`),
  ]);

  if (!header) return null; // no price data at all -- nothing honest to return

  const price = parseIndianNumber(header.CurrRate.LTP) ?? 0;
  const open = parseIndianNumber(header.Header.Open) ?? price;
  const dayHigh = parseIndianNumber(header.Header.High) ?? price;
  const dayLow = parseIndianNumber(header.Header.Low) ?? price;
  const previousClose = parseIndianNumber(header.Header.PrevClose) ?? price;
  const change = parseIndianNumber(header.CurrRate.Chg) ?? price - previousClose;
  const changePercent = parseIndianNumber(header.CurrRate.PcChg) ?? (previousClose ? (change / previousClose) * 100 : 0);

  // TTQ/TwoWkAvgQty are reported "in Lakh" (1 Lakh = 100,000) per the
  // endpoint's own "TTQin"/"TwoWkAvgQtyin" label fields -- confirmed live.
  const volumeLakh = trading ? parseIndianNumber(trading.TTQ) : undefined;
  const avgVolumeLakh = trading ? parseIndianNumber(trading.TwoWkAvgQty) : undefined;
  // MktCapFull is reported "(Cr.)" -- 1 Crore = 10,000,000.
  const marketCapCr = trading ? parseIndianNumber(trading.MktCapFull) : undefined;

  const quote: BseQuote = {
    symbol: upper,
    name: header.Cmpname.FullN,
    price,
    change,
    changePercent,
    volume: volumeLakh !== undefined ? Math.round(volumeLakh * 100_000) : 0,
    marketCap: marketCapCr !== undefined ? marketCapCr * 10_000_000 : null,
    pe: comHeader ? parseIndianNumber(comHeader.PE) ?? null : null,
    eps: comHeader ? parseIndianNumber(comHeader.EPS) ?? null : null,
    revenue: null, // not reported by any of these endpoints -- left honest rather than approximated
    high52: highLow ? parseIndianNumber(highLow.Fifty2WkHigh_adj) ?? dayHigh : dayHigh,
    low52: highLow ? parseIndianNumber(highLow.Fifty2WkLow_adj) ?? dayLow : dayLow,
    open,
    previousClose,
    dayHigh,
    dayLow,
    avgVolume: avgVolumeLakh !== undefined ? Math.round(avgVolumeLakh * 100_000) : 0,
    exchange: "BSE",
    sector: comHeader?.Sector,
    quoteSource: "BSE India",
    isLive: true,
    status: buildDataStatus({
      provider: "BSE India",
      freshness: "delayed", // unofficial endpoint, no SLA -- labeled honestly rather than claimed as true real-time
      asOf: parseAsOf(header.Header.Ason),
    }),
    currency: "INR",
    entitlement: resolveQuoteEntitlementFor("BSE India", "equity", true),
  };

  writeCache(cacheKey, quote);
  return quote;
}
