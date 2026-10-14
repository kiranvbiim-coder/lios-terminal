import { XMLParser } from "fast-xml-parser";
import { getIndicatorQuotes } from "./fredData";
import { buildDataStatus, type DataStatus } from "./dataStatus";
import { fetchText, fetchWithRetry, getCached, setCached } from "./providerUtils";
import { loadHistory, saveHistory, isFresh, coversRange, listStoredSymbols, type StoredHistory, type StoredHistoryProvenance } from "./marketHistoryStore";
import { loadFundamentals, saveFundamentals, isFreshFundamentals, type Fundamentals } from "./fundamentalsStore";
import { getCompanyProfile, isLseConfigured } from "./lseData";
import { getCompaniesWithSectorIndustry } from "./companyStore";
import { getBseIndiaQuote } from "./bseIndiaQuote";
import { getBseHistoryRange } from "./bseBhavcopy";
import { applyCanonicalCorporateActionAdjustments, getBseCorporateActionAdjustments } from "./bseCorporateActions";
import { CommandExecutionError, runCommand } from "./exec/run-command";
import path from "path";
import fs from "fs";
import { getRequestIdentity } from "./requestContext";
import { communityMarketDataAllowed } from "./communityDataConsent";
import { resolveCommunityPythonExecutable } from "./communityPythonRuntime";
import {
  areMarketDataProvidersAuthorized,
  isMarketDataProviderAuthorized,
  marketDataCacheKey,
  resolveMarketDataScope,
  shouldUseGlobalMarketHistory,
  type MarketDataScopeContext,
  type ResolvedMarketDataScope,
} from "./marketDataScope";
import { keyedAdaptersFor } from "./keyedQuoteAdapters";
import { recordConnectorVerification } from "./connectorVerification";
import { resolveQuoteEntitlementFor } from "./marketDataConnectors";
import type { MarketDataEntitlementSnapshot } from "@shared/marketDataEntitlement";
import { buildContinuousHistory, normalizeContinuityEvent, type ContinuityEvent, type ContinuousHistory } from "@shared/corporateActionContinuity";
import {
  aggregatePricePoints,
  average,
  formatCompactDate,
  formatCompactTime,
  mapToStooqSymbol,
  normalizeSearchQuery,
  parseNumberish,
  round,
  stripHtml,
  uniqueBy,
} from "./marketDataCore";
export { aggregatePricePoints } from "./marketDataCore";

export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type OhlcvInterval = "5m" | "15m" | "1h" | "1d";

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
  /** LV4-05-09: what access tier this quote was actually served from, separate from
   * freshness -- see shared/marketDataEntitlement.ts header comment. */
  entitlement: MarketDataEntitlementSnapshot;
}

export interface OHLCVSeries {
  bars: OHLCVBar[];
  status: DataStatus;
  supportsIntraday: boolean;
}

export interface OHLCVProvenance {
  sourceRefs: string[];
  providerIds: string[];
  providerLabels: string[];
  status: DataStatus;
  observedAt: string;
  notes: string[];
}

export interface OHLCVWithProvenance {
  bars: OHLCVBar[];
  provenance: OHLCVProvenance;
}

export interface NewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  feedProvider: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
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
interface CurrentQuoteSnapshot {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string;
  time: string;
}

export interface InstrumentProfile {
  name: string;
  exchange: string;
  sector?: string;
  marketCap?: number;
  referencePrice?: number;
  eps?: number;
  revenue?: number;
  assetClass?: "equity" | "etf" | "index" | "commodity" | "crypto" | "forex" | "mutual_fund";
  coinGeckoId?: string;
}

interface BuildQuoteInput {
  symbol: string;
  provider: string;
  profile?: InstrumentProfile;
  current: CurrentQuoteSnapshot;
  history: OHLCVBar[];
  isLive?: boolean;
  status?: DataStatus;
  currency?: string;
}

interface RssFeedConfig {
  url: string;
  fallbackSource: string;
}

export interface NewsPageOptions {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  windowDays?: number;
}

export interface NewsPage {
  items: NewsItem[];
  page: number;
  limit: number;
  returnedCount: number;
  knownCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  coverage: "provider-total-unknown" | "window-exhausted";
  from: string | null;
  to: string | null;
}

interface PricePoint {
  timestamp: number;
  price: number;
  volume: number;
}

const XML = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false,
});

const QUOTE_TTL_MS = 90_000;          // 90 s — serve from cache, batch fetch on expiry
const HISTORY_TTL_MS = 30 * 60_000;   // 30 min — daily bars don't change intraday
const NEWS_TTL_MS = 5 * 60_000;
const ARTICLE_TTL_MS = 15 * 60_000;

// ─── Bounded LRU Cache ───────────────────────────────────────────────────────
// Implements a simple doubly-linked-list LRU eviction on top of a Map so that
// memory stays bounded even as new symbols are requested indefinitely.
class LRUCache<V> {
  private readonly maxSize: number;
  private readonly map: Map<string, { expiresAt: number; value: V }>;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key: string): { expiresAt: number; value: V } | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // Move to end (most recently used) by reinserting
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, entry: { expiresAt: number; value: V }): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);
    // Evict oldest entry when over capacity
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  values(): IterableIterator<{ expiresAt: number; value: V }> {
    return this.map.values();
  }
}

// Bounded LRU caches replacing unbounded plain Maps
const quoteCache = new LRUCache<Quote>(300);
const historyCache = new LRUCache<OHLCVBar[]>(100);
const historyProvenanceCache = new LRUCache<OHLCVProvenance>(100);
const newsCache = new LRUCache<NewsItem[]>(100);
const articleCache = new LRUCache<NewsArticle>(100);

// In-flight dedup map: prevents multiple concurrent requests for the same URL
const _inflight = new Map<string, Promise<any>>();

const POSITIVE_WORDS = [
  "beat", "beats", "surge", "surges", "jump", "jumps", "rally", "rallies", "gain", "gains",
  "upgrade", "upgrades", "tops", "strong", "record", "optimism", "expands", "growth", "bullish",
];
const NEGATIVE_WORDS = [
  "fall", "falls", "drop", "drops", "miss", "misses", "weak", "weaker", "downgrade", "downgrades",
  "fears", "fear", "probe", "scrutiny", "recession", "pressure", "lawsuit", "slump", "bearish",
];

export const PROFILE_CATALOG: Record<string, InstrumentProfile> = {
  // ── US Large Cap Tech ─────────────────────────────────────────────────────
  AAPL:    { name: "Apple Inc.",              exchange: "NASDAQ", sector: "Technology",              marketCap: 4.8e12,  referencePrice: 317.31, eps: 6.5,  revenue: 3.85e11, assetClass: "equity" },
  MSFT:    { name: "Microsoft Corp.",         exchange: "NASDAQ", sector: "Technology",              marketCap: 2.9e12,  referencePrice: 390.99, eps: 11.8, revenue: 2.45e11, assetClass: "equity" },
  NVDA:    { name: "NVIDIA Corp.",            exchange: "NASDAQ", sector: "Technology",              marketCap: 3.8e12,  referencePrice: 157.20, eps: 2.9,  revenue: 9.6e10,  assetClass: "equity" },
  TSLA:    { name: "Tesla Inc.",              exchange: "NASDAQ", sector: "Consumer Cyclical",       marketCap: 8.5e11,  referencePrice: 380.84, eps: 3.1,  revenue: 9.6e10,  assetClass: "equity" },
  GOOGL:   { name: "Alphabet Inc.",           exchange: "NASDAQ", sector: "Communication Services",  marketCap: 2.3e12,  referencePrice: 192.41, eps: 7.2,  revenue: 3.07e11, assetClass: "equity" },
  AMZN:    { name: "Amazon.com Inc.",         exchange: "NASDAQ", sector: "Consumer Cyclical",       marketCap: 2.4e12,  referencePrice: 228.93, eps: 6.3,  revenue: 5.75e11, assetClass: "equity" },
  META:    { name: "Meta Platforms",          exchange: "NASDAQ", sector: "Communication Services",  marketCap: 1.9e12,  referencePrice: 742.83, eps: 18.7, revenue: 1.34e11, assetClass: "equity" },
  "BRK-B": { name: "Berkshire Hathaway",      exchange: "NYSE",   sector: "Financial Services",      marketCap: 1.1e12,  referencePrice: 488.20, eps: 35.5, revenue: 3.64e11, assetClass: "equity" },
  // ── US Financials ─────────────────────────────────────────────────────────
  JPM:     { name: "JPMorgan Chase",          exchange: "NYSE",   sector: "Financial Services",      marketCap: 7.8e11,  referencePrice: 268.35, eps: 17.6, assetClass: "equity" },
  BAC:     { name: "Bank of America",         exchange: "NYSE",   sector: "Financial Services",      marketCap: 3.7e11,  referencePrice: 46.81,  eps: 3.3,  assetClass: "equity" },
  GS:      { name: "Goldman Sachs",           exchange: "NYSE",   sector: "Financial Services",      marketCap: 2.4e11,  referencePrice: 1065.22, eps: 37.2, assetClass: "equity" },
  MS:      { name: "Morgan Stanley",          exchange: "NYSE",   sector: "Financial Services",      marketCap: 2.2e11,  referencePrice: 215.5, eps: 6.7,  assetClass: "equity" },
  V:       { name: "Visa Inc.",               exchange: "NYSE",   sector: "Financial Services",      marketCap: 6.6e11,  referencePrice: 331.42, eps: 10.2, assetClass: "equity" },
  MA:      { name: "Mastercard Inc.",         exchange: "NYSE",   sector: "Financial Services",      marketCap: 5.5e11,  referencePrice: 583.19, eps: 14.1, assetClass: "equity" },
  PYPL:    { name: "PayPal Holdings",         exchange: "NASDAQ", sector: "Financial Services",      marketCap: 9.2e10,  referencePrice: 85.53,  eps: 4.2,  assetClass: "equity" },
  // ── US Energy ─────────────────────────────────────────────────────────────
  XOM:     { name: "Exxon Mobil",             exchange: "NYSE",   sector: "Energy",                  marketCap: 5.5e11,  referencePrice: 131.48, eps: 8.6,  assetClass: "equity" },
  CVX:     { name: "Chevron Corp.",           exchange: "NYSE",   sector: "Energy",                  marketCap: 2.8e11,  referencePrice: 152.37, eps: 10.4, assetClass: "equity" },
  COP:     { name: "ConocoPhillips",          exchange: "NYSE",   sector: "Energy",                  marketCap: 1.3e11,  referencePrice: 108.91, eps: 8.7,  assetClass: "equity" },
  SLB:     { name: "Schlumberger",            exchange: "NYSE",   sector: "Energy",                  marketCap: 5.8e10,  referencePrice: 41.68,  eps: 3.4,  assetClass: "equity" },
  // ── US Healthcare ─────────────────────────────────────────────────────────
  UNH:     { name: "UnitedHealth Group",      exchange: "NYSE",   sector: "Healthcare",              marketCap: 2.1e11,  referencePrice: 239.81, eps: 27.5, assetClass: "equity" },
  JNJ:     { name: "Johnson & Johnson",       exchange: "NYSE",   sector: "Healthcare",              marketCap: 3.8e11,  referencePrice: 253.04, eps: 10.1, assetClass: "equity" },
  PFE:     { name: "Pfizer Inc.",             exchange: "NYSE",   sector: "Healthcare",              marketCap: 1.5e11,  referencePrice: 26.23,  eps: 2.6,  assetClass: "equity" },
  // ── US Consumer & Media ───────────────────────────────────────────────────
  KO:      { name: "Coca-Cola Co.",           exchange: "NYSE",   sector: "Consumer Defensive",      marketCap: 3.2e11,  referencePrice: 73.82,  eps: 2.8,  assetClass: "equity" },
  PEP:     { name: "PepsiCo Inc.",            exchange: "NASDAQ", sector: "Consumer Defensive",      marketCap: 2.1e11,  referencePrice: 152.96, eps: 8.2,  assetClass: "equity" },
  WMT:     { name: "Walmart Inc.",            exchange: "NYSE",   sector: "Consumer Defensive",      marketCap: 7.9e11,  referencePrice: 98.42,  eps: 2.4,  assetClass: "equity" },
  HD:      { name: "Home Depot",              exchange: "NYSE",   sector: "Consumer Cyclical",       marketCap: 3.9e11,  referencePrice: 392.84, eps: 15.1, assetClass: "equity" },
  DIS:     { name: "Walt Disney Co.",         exchange: "NYSE",   sector: "Communication Services",   marketCap: 2.0e11,  referencePrice: 113.61, eps: 4.8,  assetClass: "equity" },
  NFLX:    { name: "Netflix Inc.",            exchange: "NASDAQ", sector: "Communication Services",   marketCap: 7.1e11,  referencePrice: 68.95,eps: 19.3, assetClass: "equity" },
  // ── US Semiconductors / Tech ──────────────────────────────────────────────
  CRM:     { name: "Salesforce",              exchange: "NYSE",   sector: "Technology",              marketCap: 2.6e11,  referencePrice: 271.53, eps: 7.9,  assetClass: "equity" },
  ADBE:    { name: "Adobe Inc.",              exchange: "NASDAQ", sector: "Technology",              marketCap: 2.0e11,  referencePrice: 448.72, eps: 16.1, assetClass: "equity" },
  AMD:     { name: "Advanced Micro Devices",  exchange: "NASDAQ", sector: "Technology",              marketCap: 2.8e11,  referencePrice: 170.48, eps: 1.6,  assetClass: "equity" },
  INTC:    { name: "Intel Corp.",             exchange: "NASDAQ", sector: "Technology",              marketCap: 8.9e10,  referencePrice: 22.12,  eps: 0.9,  assetClass: "equity" },
  QCOM:    { name: "Qualcomm Inc.",           exchange: "NASDAQ", sector: "Technology",              marketCap: 1.8e11,  referencePrice: 161.35, eps: 8.1,  assetClass: "equity" },
  TXN:     { name: "Texas Instruments",       exchange: "NASDAQ", sector: "Technology",              marketCap: 1.9e11,  referencePrice: 207.84, eps: 6.2,  assetClass: "equity" },
  AVGO:    { name: "Broadcom Inc.",           exchange: "NASDAQ", sector: "Technology",              marketCap: 7.2e11,  referencePrice: 370.83, eps: 12.4, assetClass: "equity" },
  MU:      { name: "Micron Technology",       exchange: "NASDAQ", sector: "Technology",              marketCap: 1.3e11,  referencePrice: 848.95, eps: 4.8,  assetClass: "equity" },
  AMAT:    { name: "Applied Materials",       exchange: "NASDAQ", sector: "Technology",              marketCap: 1.9e11,  referencePrice: 529.66, eps: 8.8,  assetClass: "equity" },
  ASML:    { name: "ASML Holding",            exchange: "NASDAQ", sector: "Technology",              marketCap: 3.1e11,  referencePrice: 1747.58, eps: 24.5, assetClass: "equity" },
  // ── US ETFs / Indices ─────────────────────────────────────────────────────
  SPY:     { name: "SPDR S&P 500 ETF",        exchange: "ARCA",   sector: "ETF",                     referencePrice: 591.82, assetClass: "etf" },
  QQQ:     { name: "Invesco QQQ Trust",        exchange: "NASDAQ", sector: "ETF",                     referencePrice: 522.18, assetClass: "etf" },
  IWM:     { name: "iShares Russell 2000 ETF", exchange: "ARCA",   sector: "ETF",                     referencePrice: 221.43, assetClass: "etf" },
  "^GSPC": { name: "S&P 500",                  exchange: "INDEX",  sector: "Index",                   referencePrice: 5912.17, assetClass: "index" },
  "^DJI":  { name: "Dow Jones",               exchange: "INDEX",  sector: "Index",                   referencePrice: 44458.30, assetClass: "index" },

  "^IXIC": { name: "NASDAQ Composite",      exchange: "INDEX", sector: "Index",     referencePrice: 19281.40, assetClass: "index" },
  "^RUT":  { name: "Russell 2000",            exchange: "INDEX", sector: "Index",     referencePrice: 2234.12,  assetClass: "index" },
  "^VIX":  { name: "CBOE Volatility Index",   exchange: "CBOE",  sector: "Index",     referencePrice: 14.82,    assetClass: "index" },
  "GC=F":  { name: "Gold Futures",            exchange: "COMEX", sector: "Commodity", referencePrice: 3344.20,  assetClass: "commodity" },
  "CL=F":  { name: "Crude Oil WTI",           exchange: "NYMEX", sector: "Commodity", referencePrice: 76.84,    assetClass: "commodity" },
  "BTC-USD": { name: "Bitcoin USD", exchange: "CRYPTO", sector: "Crypto", assetClass: "crypto", coinGeckoId: "bitcoin" },
  "ETH-USD": { name: "Ethereum USD", exchange: "CRYPTO", sector: "Crypto", assetClass: "crypto", coinGeckoId: "ethereum" },
  "SOL-USD": { name: "Solana USD", exchange: "CRYPTO", sector: "Crypto", assetClass: "crypto", coinGeckoId: "solana" },
  "XRP-USD": { name: "XRP USD", exchange: "CRYPTO", sector: "Crypto", assetClass: "crypto", coinGeckoId: "ripple" },
  // ── India (NSE/BSE) ───────────────────────────────────────────────────────
  "^NSEI":           { name: "Nifty 50",                    exchange: "NSE", sector: "Index",                   referencePrice: 24100,   assetClass: "index" },
  "^BSESN":          { name: "BSE Sensex",                  exchange: "BSE", sector: "Index",                   referencePrice: 79400,   assetClass: "index" },
  "RELIANCE.NS":     { name: "Reliance Industries Ltd.",    exchange: "NSE", sector: "Energy",                  marketCap: 9.2e12,  referencePrice: 1293,    eps: 102.5, revenue: 10.0e11, assetClass: "equity" },
  "TCS.NS":          { name: "Tata Consultancy Services",   exchange: "NSE", sector: "Technology",              marketCap: 1.4e13,  referencePrice: 2269,    eps: 125,   revenue: 2.4e11,  assetClass: "equity" },
  "HDFCBANK.NS":     { name: "HDFC Bank Ltd.",              exchange: "NSE", sector: "Financial Services",      marketCap: 1.3e13,  referencePrice: 819.6,    eps: 80,    revenue: 1.2e11,  assetClass: "equity" },
  "INFY.NS":         { name: "Infosys Ltd.",                exchange: "NSE", sector: "Technology",              marketCap: 6.8e12,  referencePrice: 1096.5,    eps: 63,    revenue: 1.8e11,  assetClass: "equity" },
  "ICICIBANK.NS":    { name: "ICICI Bank Ltd.",             exchange: "NSE", sector: "Financial Services",      marketCap: 9.1e12,  referencePrice: 1283,    eps: 58,    revenue: 1.1e11,  assetClass: "equity" },
  "SBIN.NS":         { name: "State Bank of India",         exchange: "NSE", sector: "Financial Services",      marketCap: 6.8e12,  referencePrice: 762,     eps: 70,    revenue: 1.3e11,  assetClass: "equity" },
  "TATAMOTORS.NS":   { name: "Tata Motors Ltd.",            exchange: "NSE", sector: "Consumer Cyclical",       marketCap: 3.1e12,  referencePrice: 845,     eps: 85,    revenue: 4.3e10,  assetClass: "equity" },
  "BHARTIARTL.NS":   { name: "Bharti Airtel Ltd.",          exchange: "NSE", sector: "Communication Services",  marketCap: 9.4e12,  referencePrice: 1579,    eps: 28,    revenue: 1.4e11,  assetClass: "equity" },
  "LT.NS":           { name: "Larsen & Toubro Ltd.",        exchange: "NSE", sector: "Industrials",             marketCap: 5.3e12,  referencePrice: 3843,    eps: 98,    revenue: 2.1e11,  assetClass: "equity" },
  "ITC.NS": { name: "ITC Ltd.", exchange: "NSE", sector: "Consumer Defensive", marketCap: 6.2e12, referencePrice: 500, eps: 16, revenue: 7.0e10, assetClass: "equity" },
  // ── Japan (TSE) ───────────────────────────────────────────────────────────
  "7203.T":  { name: "Toyota Motor Corp.",     exchange: "TSE",   sector: "Consumer Cyclical", marketCap: 4.3e13, referencePrice: 2839,    eps: 350,  revenue: 4.3e13, assetClass: "equity" },
  "9984.T":  { name: "SoftBank Group Corp.",   exchange: "TSE",   sector: "Technology",       marketCap: 1.5e13, referencePrice: 5424,   eps: -220, revenue: 6.8e12, assetClass: "equity" },
  "6758.T":  { name: "Sony Group Corp.",       exchange: "TSE",   sector: "Consumer Cyclical", marketCap: 1.5e13, referencePrice: 2860,    eps: 750,  revenue: 1.3e13, assetClass: "equity" },
  "^N225":   { name: "Nikkei 225",             exchange: "INDEX", sector: "Index",             referencePrice: 64141.12,   assetClass: "index" },
  // Hong Kong (HKEX)
  "0700.HK": { name: "Tencent Holdings Ltd.", exchange: "HKEX", sector: "Technology",        marketCap: 4.2e12, referencePrice: 456.20,  eps: 18.5, revenue: 6.6e11, assetClass: "equity" },
  "9988.HK": { name: "Alibaba Group",          exchange: "HKEX", sector: "Consumer Cyclical",  marketCap: 2.1e12, referencePrice: 103.50,  eps: 8.4,  revenue: 9.4e11, assetClass: "equity" },
  "3690.HK": { name: "Meituan",                exchange: "HKEX", sector: "Consumer Cyclical",  marketCap: 7.2e11, referencePrice: 83.65,     eps: 3.2,  revenue: 2.7e11, assetClass: "equity" },
  "^HSI":    { name: "Hang Seng Index",         exchange: "INDEX", sector: "Index",             referencePrice: 24562.24,   assetClass: "index" },

  // ── UK (LSE) ──────────────────────────────────────────────────────────────
  "BP.L": { name: "BP plc", exchange: "LSE", sector: "Energy", referencePrice: 470, assetClass: "equity" },
  "VOD.L": { name: "Vodafone Group plc", exchange: "LSE", sector: "Communication Services", referencePrice: 117.8, assetClass: "equity" },
  "AZN.L": { name: "AstraZeneca plc", exchange: "LSE", sector: "Healthcare", referencePrice: 10500, assetClass: "equity" },
  "HSBA.L": { name: "HSBC Holdings plc", exchange: "LSE", sector: "Financial Services", referencePrice: 680, assetClass: "equity" },
  "SHEL.L": { name: "Shell plc", exchange: "LSE", sector: "Energy", referencePrice: 2500, assetClass: "equity" },
  "GSK.L": { name: "GSK plc", exchange: "LSE", sector: "Healthcare", referencePrice: 1600, assetClass: "equity" },
  "BARC.L": { name: "Barclays plc", exchange: "LSE", sector: "Financial Services", referencePrice: 220, assetClass: "equity" },
  "LLOY.L": { name: "Lloyds Banking Group plc", exchange: "LSE", sector: "Financial Services", referencePrice: 111.5, assetClass: "equity" },
  "AAL.L": { name: "Anglo American plc", exchange: "LSE", sector: "Basic Materials", referencePrice: 3400, assetClass: "equity" },
  "BATS.L": { name: "British American Tobacco plc", exchange: "LSE", sector: "Consumer Defensive", referencePrice: 2400, assetClass: "equity" },
  
  // ── Germany (XETRA) ───────────────────────────────────────────────────────
  "SAP.DE": { name: "SAP SE", exchange: "XETRA", sector: "Technology", referencePrice: 210, assetClass: "equity" },
  "SIE.DE": { name: "Siemens AG", exchange: "XETRA", sector: "Industrials", referencePrice: 264.55, assetClass: "equity" },
  "ALV.DE": { name: "Allianz SE", exchange: "XETRA", sector: "Financial Services", referencePrice: 280, assetClass: "equity" },
  "DTE.DE": { name: "Deutsche Telekom AG", exchange: "XETRA", sector: "Communication Services", referencePrice: 26, assetClass: "equity" },
  "BMW.DE": { name: "Bayerische Motoren Werke AG", exchange: "XETRA", sector: "Consumer Cyclical", referencePrice: 75, assetClass: "equity" },
  "MBG.DE": { name: "Mercedes-Benz Group AG", exchange: "XETRA", sector: "Consumer Cyclical", referencePrice: 58, assetClass: "equity" },
  "BAS.DE": { name: "BASF SE", exchange: "XETRA", sector: "Basic Materials", referencePrice: 44, assetClass: "equity" },
  "BAYN.DE": { name: "Bayer AG", exchange: "XETRA", sector: "Healthcare", referencePrice: 28, assetClass: "equity" },
  "VOW3.DE": { name: "Volkswagen AG", exchange: "XETRA", sector: "Consumer Cyclical", referencePrice: 90, assetClass: "equity" },
  "DBK.DE": { name: "Deutsche Bank AG", exchange: "XETRA", sector: "Financial Services", referencePrice: 15, assetClass: "equity" },

  // ── Canada (TSX) ──────────────────────────────────────────────────────────
  "RY.TO": { name: "Royal Bank of Canada", exchange: "TSX", sector: "Financial Services", referencePrice: 170, assetClass: "equity" },
  "TD.TO": { name: "Toronto-Dominion Bank", exchange: "TSX", sector: "Financial Services", referencePrice: 173.31, assetClass: "equity" },
  "ENB.TO": { name: "Enbridge Inc.", exchange: "TSX", sector: "Energy", referencePrice: 79.42, assetClass: "equity" },
  "CNR.TO": { name: "Canadian National Railway", exchange: "TSX", sector: "Industrials", referencePrice: 155, assetClass: "equity" },
  "CP.TO": { name: "Canadian Pacific Kansas City", exchange: "TSX", sector: "Industrials", referencePrice: 105, assetClass: "equity" },
  "BNS.TO": { name: "Bank of Nova Scotia", exchange: "TSX", sector: "Financial Services", referencePrice: 72, assetClass: "equity" },
  "BMO.TO": { name: "Bank of Montreal", exchange: "TSX", sector: "Financial Services", referencePrice: 120, assetClass: "equity" },
  "ABX.TO": { name: "Barrick Gold Corp", exchange: "TSX", sector: "Basic Materials", referencePrice: 24, assetClass: "equity" },
  "SHOP.TO": { name: "Shopify Inc.", exchange: "TSX", sector: "Technology", referencePrice: 110, assetClass: "equity" },
  "CNQ.TO": { name: "Canadian Natural Resources", exchange: "TSX", sector: "Energy", referencePrice: 48, assetClass: "equity" },

  // ── Australia (ASX) ───────────────────────────────────────────────────────
  "BHP.AX": { name: "BHP Group Ltd", exchange: "ASX", sector: "Basic Materials", referencePrice: 42, assetClass: "equity" },
  "CBA.AX": { name: "Commonwealth Bank of Australia", exchange: "ASX", sector: "Financial Services", referencePrice: 130, assetClass: "equity" },
  "CSL.AX": { name: "CSL Ltd", exchange: "ASX", sector: "Healthcare", referencePrice: 123.32, assetClass: "equity" },
  "NAB.AX": { name: "National Australia Bank Ltd", exchange: "ASX", sector: "Financial Services", referencePrice: 38, assetClass: "equity" },
  "WBC.AX": { name: "Westpac Banking Corp", exchange: "ASX", sector: "Financial Services", referencePrice: 28, assetClass: "equity" },
  "ANZ.AX": { name: "ANZ Group Holdings Ltd", exchange: "ASX", sector: "Financial Services", referencePrice: 29, assetClass: "equity" },
  "WDS.AX": { name: "Woodside Energy Group Ltd", exchange: "ASX", sector: "Energy", referencePrice: 26, assetClass: "equity" },
  "FMG.AX": { name: "Fortescue Ltd", exchange: "ASX", sector: "Basic Materials", referencePrice: 22, assetClass: "equity" },
  "TLS.AX": { name: "Telstra Group Ltd", exchange: "ASX", sector: "Communication Services", referencePrice: 3.8, assetClass: "equity" },
  "RIO.AX": { name: "Rio Tinto Ltd", exchange: "ASX", sector: "Basic Materials", referencePrice: 115, assetClass: "equity" },

  // ── Singapore (SGX) ───────────────────────────────────────────────────────
  "D05.SI": { name: "DBS Group Holdings Ltd", exchange: "SGX", sector: "Financial Services", referencePrice: 71.96, assetClass: "equity" },
  "O39.SI": { name: "Oversea-Chinese Banking Corp Ltd", exchange: "SGX", sector: "Financial Services", referencePrice: 28.56, assetClass: "equity" },
  "U11.SI": { name: "United Overseas Bank Ltd", exchange: "SGX", sector: "Financial Services", referencePrice: 32, assetClass: "equity" },
  "Z74.SI": { name: "Singapore Telecommunications Ltd", exchange: "SGX", sector: "Communication Services", referencePrice: 2.8, assetClass: "equity" },
  "C38U.SI": { name: "CapitaLand Integrated Commercial Trust", exchange: "SGX", sector: "Real Estate", referencePrice: 2.0, assetClass: "equity" },
  "A17U.SI": { name: "Ascendas Real Estate Investment Trust", exchange: "SGX", sector: "Real Estate", referencePrice: 2.7, assetClass: "equity" },
  "T82U.SI": { name: "Suntec Real Estate Investment Trust", exchange: "SGX", sector: "Real Estate", referencePrice: 1.15, assetClass: "equity" },
  "BS6.SI": { name: "Yangzijiang Shipbuilding Holdings Ltd", exchange: "SGX", sector: "Industrials", referencePrice: 2.4, assetClass: "equity" },
  "C09.SI": { name: "City Developments Ltd", exchange: "SGX", sector: "Real Estate", referencePrice: 7.7, assetClass: "equity" },
  "V03.SI": { name: "Venture Corp Ltd", exchange: "SGX", sector: "Technology", referencePrice: 14.5, assetClass: "equity" },

  // ── India BSE ─────────────────────────────────────────────────────────────
  "500325.BO": { name: "Reliance Industries Ltd", exchange: "BSE", sector: "Energy", referencePrice: 1293, assetClass: "equity" },
  "500112.BO": { name: "State Bank of India", exchange: "BSE", sector: "Financial Services", referencePrice: 762, assetClass: "equity" },
  "500209.BO": { name: "Infosys Ltd", exchange: "BSE", sector: "Technology", referencePrice: 1637, assetClass: "equity" },
  "500180.BO": { name: "HDFC Bank Ltd", exchange: "BSE", sector: "Financial Services", referencePrice: 1945, assetClass: "equity" },
  "532215.BO": { name: "Axis Bank Ltd", exchange: "BSE", sector: "Financial Services", referencePrice: 1150, assetClass: "equity" },
  "500570.BO": { name: "Tata Motors Ltd", exchange: "BSE", sector: "Consumer Cyclical", referencePrice: 845, assetClass: "equity" },
  "500124.BO": { name: "Dr. Reddy's Laboratories", exchange: "BSE", sector: "Healthcare", referencePrice: 1244.55, assetClass: "equity" },
  "500696.BO": { name: "Hindustan Unilever Ltd", exchange: "BSE", sector: "Consumer Defensive", referencePrice: 2500, assetClass: "equity" },
  "500820.BO": { name: "Asian Paints Ltd", exchange: "BSE", sector: "Consumer Defensive", referencePrice: 2850, assetClass: "equity" },
  "500510.BO": { name: "Larsen & Toubro Ltd", exchange: "BSE", sector: "Industrials", referencePrice: 3843, assetClass: "equity" },
  "^FTSE": { name: "FTSE 100", exchange: "INDEX", sector: "Index", referencePrice: 8200, assetClass: "index" },
  "^GDAXI": { name: "DAX Performance Index", exchange: "INDEX", sector: "Index", referencePrice: 18500, assetClass: "index" },

  // ── Euronext ──────────────────────────────────────────────────────────────
  "MC.PA": { name: "LVMH Moët Hennessy", exchange: "Euronext", sector: "Consumer Cyclical", referencePrice: 720, assetClass: "equity" },
  "ASML.AS": { name: "ASML Holding N.V.", exchange: "Euronext", sector: "Technology", referencePrice: 850, assetClass: "equity" },
  "OR.PA": { name: "L'Oréal S.A.", exchange: "Euronext", sector: "Consumer Defensive", referencePrice: 420, assetClass: "equity" },
  "RMS.PA": { name: "Hermès International", exchange: "Euronext", sector: "Consumer Cyclical", referencePrice: 2100, assetClass: "equity" },
  "SAN.PA": { name: "Sanofi S.A.", exchange: "Euronext", sector: "Healthcare", referencePrice: 92, assetClass: "equity" },
  "TTE.PA": { name: "TotalEnergies SE", exchange: "Euronext", sector: "Energy", referencePrice: 65, assetClass: "equity" },
  "HEIA.AS": { name: "Heineken N.V.", exchange: "Euronext", sector: "Consumer Defensive", referencePrice: 90, assetClass: "equity" },
  "ABI.BR": { name: "Anheuser-Busch InBev", exchange: "Euronext", sector: "Consumer Defensive", referencePrice: 58, assetClass: "equity" },

  // ── Taiwan (TWSE) ─────────────────────────────────────────────────────────
  "2330.TW": { name: "Taiwan Semiconductor Manufacturing", exchange: "TWSE", sector: "Technology", referencePrice: 950, assetClass: "equity" },
  "2317.TW": { name: "Hon Hai Precision (Foxconn)", exchange: "TWSE", sector: "Technology", referencePrice: 180, assetClass: "equity" },
  "2454.TW": { name: "MediaTek Inc.", exchange: "TWSE", sector: "Technology", referencePrice: 1250, assetClass: "equity" },
  "2308.TW": { name: "Delta Electronics", exchange: "TWSE", sector: "Technology", referencePrice: 1740, assetClass: "equity" },
  "2881.TW": { name: "Fubon Financial Holding", exchange: "TWSE", sector: "Financial Services", referencePrice: 124.5, assetClass: "equity" },
  "2882.TW": { name: "Cathay Financial Holding", exchange: "TWSE", sector: "Financial Services", referencePrice: 55, assetClass: "equity" },

  // ── South Korea (KRX) ─────────────────────────────────────────────────────
  "005930.KS": { name: "Samsung Electronics Co., Ltd.", exchange: "KRX", sector: "Technology", referencePrice: 255000, assetClass: "equity" },
  "000660.KS": { name: "SK Hynix Inc.", exchange: "KRX", sector: "Technology", referencePrice: 195000, assetClass: "equity" },
  "005380.KS": { name: "Hyundai Motor Co.", exchange: "KRX", sector: "Consumer Cyclical", referencePrice: 260000, assetClass: "equity" },
  "207940.KS": { name: "Samsung Biologics Co., Ltd.", exchange: "KRX", sector: "Healthcare", referencePrice: 1396000, assetClass: "equity" },
  "068270.KS": { name: "Celltrion, Inc.", exchange: "KRX", sector: "Healthcare", referencePrice: 185000, assetClass: "equity" },

  // ── China (SSE / SZSE) ────────────────────────────────────────────────────
  "600519.SS": { name: "Kweichow Moutai Co., Ltd.", exchange: "SSE", sector: "Consumer Defensive", referencePrice: 1550, assetClass: "equity" },
  "601398.SS": { name: "Industrial and Commercial Bank of China", exchange: "SSE", sector: "Financial Services", referencePrice: 5.8, assetClass: "equity" },
  "601318.SS": { name: "Ping An Insurance Group", exchange: "SSE", sector: "Financial Services", referencePrice: 42, assetClass: "equity" },
  "002594.SZ": { name: "BYD Company Limited", exchange: "SZSE", sector: "Consumer Cyclical", referencePrice: 93.47, assetClass: "equity" },
  "300750.SZ": { name: "CATL", exchange: "SZSE", sector: "Technology", referencePrice: 360, assetClass: "equity" },
  "000651.SZ": { name: "Gree Electric Appliances", exchange: "SZSE", sector: "Consumer Cyclical", referencePrice: 40, assetClass: "equity" },

  // ── Brazil (B3) ───────────────────────────────────────────────────────────
  "PETR4.SA": { name: "Petróleo Brasileiro S.A. (Petrobras)", exchange: "B3", sector: "Energy", referencePrice: 38, assetClass: "equity" },
  "VALE3.SA": { name: "Vale S.A.", exchange: "B3", sector: "Basic Materials", referencePrice: 62, assetClass: "equity" },
  "ITUB4.SA": { name: "Itaú Unibanco Holding S.A.", exchange: "B3", sector: "Financial Services", referencePrice: 34, assetClass: "equity" },
  "BBDC4.SA": { name: "Banco Bradesco S.A.", exchange: "B3", sector: "Financial Services", referencePrice: 13, assetClass: "equity" },

  // ── Malaysia (Bursa) ──────────────────────────────────────────────────────
  "1155.KL": { name: "Malayan Banking Berhad (Maybank)", exchange: "Bursa", sector: "Financial Services", referencePrice: 9.9, assetClass: "equity" },
  "1295.KL": { name: "Public Bank Berhad", exchange: "Bursa", sector: "Financial Services", referencePrice: 4.2, assetClass: "equity" },
  "1023.KL": { name: "CIMB Group Holdings Berhad", exchange: "Bursa", sector: "Financial Services", referencePrice: 6.8, assetClass: "equity" },

  // ── Mutual Funds ──────────────────────────────────────────────────────────
  "VFIAX": { name: "Vanguard 500 Index Fund Admiral", exchange: "NASDAQ", sector: "Blended Large Cap", referencePrice: 688.41, assetClass: "mutual_fund" },
  "FCNTX": { name: "Fidelity Contrafund", exchange: "NYSE", sector: "Growth Large Cap", referencePrice: 26.17, assetClass: "mutual_fund" },
  "PONAX": { name: "PIMCO Income Fund Class A", exchange: "NYSE", sector: "Fixed Income Bond", referencePrice: 11.5, assetClass: "mutual_fund" },
  "0P0000XWAI.BO": { name: "SBI Bluechip Fund Direct Growth", exchange: "BSE", sector: "Equity Large Cap", referencePrice: 95.5, assetClass: "mutual_fund" },
  "0P0000XW4Y.BO": { name: "HDFC Top 100 Mutual Fund Growth", exchange: "BSE", sector: "Equity Large Cap", referencePrice: 110.2, assetClass: "mutual_fund" },
  "0P0000XVZE.BO": { name: "Nippon India Growth Fund Direct Growth", exchange: "BSE", sector: "Equity Mid Cap", referencePrice: 2450.4, assetClass: "mutual_fund" },
  "0P0000Y1S2.T": { name: "Nomura Morningstar Index Fund", exchange: "TSE", sector: "Index Blend", referencePrice: 15400, assetClass: "mutual_fund" },
  "0P00018G8I.T": { name: "Nikko AM World Equity Fund", exchange: "TSE", sector: "Global Equity", referencePrice: 23100, assetClass: "mutual_fund" },
  "0P0000Y2B0.HK": { name: "Hang Seng Index Fund Class A", exchange: "HKEX", sector: "Index Blend", referencePrice: 65.2, assetClass: "mutual_fund" },
  "0P0001LUX8.HK": { name: "HSBC Hang Seng Tech Index Fund", exchange: "HKEX", sector: "Technology Sector", referencePrice: 8.8, assetClass: "mutual_fund" },
  "0P0000KSP2.L": { name: "Vanguard FTSE U.K. All Share Index", exchange: "LSE", sector: "UK Equity Blend", referencePrice: 320.5, assetClass: "mutual_fund" },
  "0P00000B2H.L": { name: "BlackRock World Gold Fund Class A", exchange: "LSE", sector: "Precious Metals", referencePrice: 42.1, assetClass: "mutual_fund" },
  "0P000071C6.TO": { name: "RBC Select Balanced Fund Class A", exchange: "TSX", sector: "Multi-Asset Balanced", referencePrice: 52.4, assetClass: "mutual_fund" },
  "0P0000720O.TO": { name: "TD Comfort Balanced Portfolio Class A", exchange: "TSX", sector: "Multi-Asset Balanced", referencePrice: 28.9, assetClass: "mutual_fund" },
  "0P0000W82O.AX": { name: "Vanguard Balanced Index Fund", exchange: "ASX", sector: "Multi-Asset Balanced", referencePrice: 3.1, assetClass: "mutual_fund" },
  "0P00000B1A.DE": { name: "DWS Deutschland Fund", exchange: "XETRA", sector: "German Equity", referencePrice: 195.4, assetClass: "mutual_fund" },
  "0P00000AWG.PA": { name: "Amundi Funds - European Equity", exchange: "Euronext", sector: "European Equity", referencePrice: 142.1, assetClass: "mutual_fund" },
  "0P0000Y7P7.TW": { name: "Yuanta Taiwan Top 50 ETF Mutual Fund", exchange: "TWSE", sector: "Index Blend", referencePrice: 154.2, assetClass: "mutual_fund" },
  "0P0000YD7L.KS": { name: "Samsung KODEX 200 Mutual Fund", exchange: "KRX", sector: "Index Blend", referencePrice: 34500, assetClass: "mutual_fund" },
  "0P0000UGX8.SA": { name: "Itaú ETF Ibovespa Mutual Fund", exchange: "B3", sector: "Index Blend", referencePrice: 118.4, assetClass: "mutual_fund" },
  "0P0000UYP5.KL": { name: "Public Ittikal Fund (Malaysia)", exchange: "Bursa", sector: "Islamic Equity", referencePrice: 1.15, assetClass: "mutual_fund" },
};

const SCREENER_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META", "BRK-B",
  "JPM", "BAC", "GS", "V", "MA", "XOM", "CVX", "UNH", "JNJ", "PFE",
  "KO", "PEP", "WMT", "HD", "DIS", "NFLX", "CRM", "ADBE", "PYPL",
  "AMD", "INTC", "QCOM", "TXN", "AVGO", "MU", "AMAT", "ASML",
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
  "SBIN.NS", "TATAMOTORS.NS", "BHARTIARTL.NS", "LT.NS", "ITC.NS",
  "7203.T", "9984.T", "6758.T", "0700.HK", "9988.HK", "3690.HK",
  // LSE
  "BP.L", "VOD.L", "AZN.L", "HSBA.L", "SHEL.L", "GSK.L", "BARC.L", "LLOY.L", "AAL.L", "BATS.L",
  // XETRA
  "SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "BMW.DE", "MBG.DE", "BAS.DE", "BAYN.DE", "VOW3.DE", "DBK.DE",
  // TSX
  "RY.TO", "TD.TO", "ENB.TO", "CNR.TO", "CP.TO", "BNS.TO", "BMO.TO", "ABX.TO", "SHOP.TO", "CNQ.TO",
  // ASX
  "BHP.AX", "CBA.AX", "CSL.AX", "NAB.AX", "WBC.AX", "ANZ.AX", "WDS.AX", "FMG.AX", "TLS.AX", "RIO.AX",
  // SGX
  "D05.SI", "O39.SI", "U11.SI", "Z74.SI", "C38U.SI", "A17U.SI", "T82U.SI", "BS6.SI", "C09.SI", "V03.SI",
  // BSE
  "500325.BO", "500112.BO", "500209.BO", "500180.BO", "532215.BO", "500570.BO", "500124.BO", "500696.BO", "500820.BO", "500510.BO",
  // Euronext
  "MC.PA", "ASML.AS", "OR.PA", "RMS.PA", "SAN.PA", "TTE.PA", "HEIA.AS", "ABI.BR",
  // TWSE
  "2330.TW", "2317.TW", "2454.TW", "2308.TW", "2881.TW", "2882.TW",
  // KRX
  "005930.KS", "000660.KS", "005380.KS", "207940.KS", "068270.KS",
  // SSE / SZSE
  "600519.SS", "601398.SS", "601318.SS", "002594.SZ", "300750.SZ",
  // B3 / Bursa
  "PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBDC4.SA", "1155.KL", "1295.KL", "1023.KL",
  // Mutual Funds
  "VFIAX", "FCNTX", "PONAX", "0P0000XWAI.BO", "0P0000XW4Y.BO", "0P0000XVZE.BO",
  "0P0000Y1S2.T", "0P00018G8I.T", "0P0000Y2B0.HK", "0P0001LUX8.HK",
  "0P0000KSP2.L", "0P00000B2H.L", "0P000071C6.TO", "0P0000720O.TO",
  "0P0000W82O.AX", "0P00000B1A.DE", "0P00000AWG.PA", "0P0000Y7P7.TW",
  "0P0000YD7L.KS", "0P0000UGX8.SA", "0P0000UYP5.KL"
];

const PEER_MAP: Record<string, string[]> = {
  AAPL: ["MSFT", "GOOGL", "META", "AMZN", "NVDA"],
  MSFT: ["AAPL", "GOOGL", "AMZN", "CRM", "ADBE"],
  NVDA: ["AMD", "INTC", "QCOM", "AVGO", "MU"],
  TSLA: ["AMZN", "GOOGL", "NVDA", "MSFT", "AAPL"],
  META: ["GOOGL", "NFLX", "AMZN", "AAPL", "MSFT"],
  GOOGL: ["META", "MSFT", "AAPL", "AMZN", "NFLX"],
  AMZN: ["MSFT", "GOOGL", "AAPL", "WMT", "META"],
  JPM: ["BAC", "GS", "MS", "V", "MA"],
  XOM: ["CVX", "COP", "SLB", "CL=F", "GC=F"],
  "RELIANCE.NS": ["TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS"],
  "TCS.NS": ["INFY.NS", "RELIANCE.NS", "HDFCBANK.NS", "ICICIBANK.NS"],
  "HDFCBANK.NS": ["ICICIBANK.NS", "SBIN.NS", "RELIANCE.NS", "TCS.NS"],
  "INFY.NS": ["TCS.NS", "RELIANCE.NS", "HDFCBANK.NS", "ICICIBANK.NS"],
  "ICICIBANK.NS": ["HDFCBANK.NS", "SBIN.NS", "RELIANCE.NS", "TCS.NS"],
  "SBIN.NS": ["HDFCBANK.NS", "ICICIBANK.NS", "RELIANCE.NS", "TCS.NS"],
};

const GENERAL_NEWS_FEEDS: RssFeedConfig[] = [
  // Google News RSS — confirmed working, real-time
  { url: buildGoogleNewsSearchUrl("stock market earnings inflation federal reserve when:1d"), fallbackSource: "Google News" },
  { url: buildGoogleNewsSearchUrl("NASDAQ S&P 500 Dow Jones stocks when:1d"), fallbackSource: "Google News" },
  { url: buildGoogleNewsSearchUrl("cryptocurrency bitcoin ethereum crypto markets when:1d"), fallbackSource: "Google News" },
  { url: buildGoogleNewsSearchUrl("Nifty Sensex Indian stock market BSE NSE when:1d"), fallbackSource: "Google News" },
  { url: buildGoogleNewsSearchUrl("Nikkei Hang Seng Asia markets Tokyo Hong Kong when:1d"), fallbackSource: "Google News" },
  { url: buildGoogleNewsSearchUrl("forex EUR USD GBP JPY INR currency when:1d"), fallbackSource: "Google News" },
];


export function extractArticleContent(html: string): string[] {
  const preferredBlock = html.match(/<(article|main)[^>]*>[\s\S]*?<\/\1>/i)?.[0] ?? html;
  const withoutBoilerplate = preferredBlock
    .replace(/<(script|style|noscript|svg|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(header|footer|nav|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const blocks = Array.from(withoutBoilerplate.matchAll(/<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi))
    .map((match) => stripHtml(match[2]))
    .filter((text) => text.length >= 40 || text.split(" ").length >= 4);

  // Article extraction is explicitly user-triggered from the read-through
  // pane. Do not silently truncate a provider article; the feed itself is
  // still paginated separately by getNewsPage().
  return uniqueBy(blocks, (text) => text);
}

export function filterNewsItems(items: NewsItem[], query?: string): NewsItem[] {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return items;

  return items.filter((item) => {
    const haystack = `${item.title} ${item.summary} ${item.source}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function sanitizeArticleUrl(url: string) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported article protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

function inferSentiment(text: string): NewsItem["sentiment"] {
  const input = text.toLowerCase();
  const positive = POSITIVE_WORDS.reduce((count, word) => count + Number(input.includes(word)), 0);
  const negative = NEGATIVE_WORDS.reduce((count, word) => count + Number(input.includes(word)), 0);
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "neutral";
}

function splitTitleAndSource(title: string, explicitSource: string | undefined, fallbackSource: string) {
  const cleaned = stripHtml(title);
  if (explicitSource) {
    const suffix = ` - ${explicitSource}`;
    return {
      title: cleaned.endsWith(suffix) ? cleaned.slice(0, -suffix.length).trim() : cleaned,
      source: explicitSource,
    };
  }

  const match = cleaned.match(/^(.*)\s+-\s+([^\-]+)$/);
  if (match) {
    return {
      title: match[1].trim(),
      source: match[2].trim(),
    };
  }

  return { title: cleaned, source: fallbackSource };
}

function getProfile(symbol: string): InstrumentProfile | undefined {
  return PROFILE_CATALOG[symbol.toUpperCase()];
}

// Bulk real crypto symbol -> {CoinGecko id, name} map (~10,900 real coins,
// built from a live CoinGecko markets pull, deduplicated to the
// highest-market-cap coin per ticker symbol). PROFILE_CATALOG only
// hand-covers 4 of these (BTC/ETH/SOL/XRP); every other crypto symbol added
// to tickers.json needs this bulk map to route to a live CoinGecko
// quote/chart at all, which is why isCryptoSymbol/getCoinGeckoId/getProfile
// all check both sources rather than just PROFILE_CATALOG.
let CRYPTO_ID_MAP: Record<string, { id: string; name: string }> = {};
try {
  const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  const cryptoMapPath = resourcesBase
    ? path.resolve(resourcesBase, "server", "data", "crypto_coingecko_ids.json")
    : path.resolve(process.cwd(), "server", "data", "crypto_coingecko_ids.json");
  if (fs.existsSync(cryptoMapPath)) {
    CRYPTO_ID_MAP = JSON.parse(fs.readFileSync(cryptoMapPath, "utf8"));
  }
} catch (err) {
  console.error("Failed to load crypto_coingecko_ids.json:", err);
}

function getCoinGeckoId(symbol: string): string | undefined {
  const upper = symbol.toUpperCase();
  return PROFILE_CATALOG[upper]?.coinGeckoId ?? CRYPTO_ID_MAP[upper]?.id;
}

function isCryptoSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return PROFILE_CATALOG[upper]?.assetClass === "crypto" || upper in CRYPTO_ID_MAP;
}

// getProfile only has hand-curated data for 4 crypto symbols; every other
// bulk-map crypto symbol still needs a name/exchange/sector for quote
// construction, search, etc. -- this fills that in from the bulk map
// (exchange/sector are the same for every crypto, so no data loss there).
function getProfileWithCryptoFallback(symbol: string): InstrumentProfile | undefined {
  const direct = getProfile(symbol);
  if (direct) return direct;
  const upper = symbol.toUpperCase();
  const bulk = CRYPTO_ID_MAP[upper];
  if (!bulk) return undefined;
  return { name: bulk.name, exchange: "CRYPTO", sector: "Crypto", assetClass: "crypto", coinGeckoId: bulk.id };
}

function getRangeDays(range: string) {
  switch (range) {
    case "1D": return 1;
    case "5D": return 5;
    case "1M": return 31;
    case "3M": return 93;
    case "6M": return 186;
    case "1Y": return 366;
    case "2Y": return 730;
    case "3Y": return 1095;
    case "5Y": return 1826;
    case "25Y": return 9131;
    case "MAX": return 30000;
    default:
      return 366;
  }
}


async function fetchJson<T>(url: string): Promise<T> {
  // Dedup: if there's already an in-flight request for this URL, share its promise
  const existing = _inflight.get(url);
  if (existing) return existing as Promise<T>;

  const ua = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  ][Math.floor(Math.random() * 2)];

  const promise = fetchWithRetry(url, {
    "User-Agent": ua,
    "Accept": "application/json,text/plain;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  })
    .then((response) => response.json() as Promise<T>)
    .finally(() => {
      _inflight.delete(url);
    });

  _inflight.set(url, promise);
  return promise;
}

export function parseStooqCurrent(csv: string): CurrentQuoteSnapshot {
  const row = csv.trim().split(/\r?\n/).pop() ?? "";
  const [symbol, date, time, open, high, low, close, volume] = row.split(",");
  const parsedOpen = Number(open);
  const parsedHigh = Number(high);
  const parsedLow = Number(low);
  const parsedClose = Number(close);
  if (!symbol || !date || !time || date === "N/D" || close === "N/D" || !Number.isFinite(parsedOpen) || !Number.isFinite(parsedHigh) || !Number.isFinite(parsedLow) || !Number.isFinite(parsedClose)) {
    throw new Error(`Malformed current quote row: ${row}`);
  }

  return {
    open: parsedOpen,
    high: parsedHigh,
    low: parsedLow,
    close: parsedClose,
    volume: parseNumberish(volume),
    date: formatCompactDate(date),
    time: formatCompactTime(time),
  };
}

export function parseStooqHistory(csv: string): OHLCVBar[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, open, high, low, close, volume] = line.split(",");
      return {
        date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: parseNumberish(volume),
      };
    })
    .filter((bar) => Number.isFinite(bar.close));
}

interface YahooChartMeta {
  regularMarketPrice?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  currency?: string;
  exchangeName?: string;
}


interface YahooChartSeries {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
}

interface YahooChartResult {
  meta?: YahooChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: YahooChartSeries[];
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
}
const YAHOO_FINANCE_BASE_URL = "https://query1.finance.yahoo.com";
export function mapRangeToYahoo(range: string): string {
  switch (range.toUpperCase()) {
    case "1D": return "1d";
    case "5D": return "5d";
    case "1M": return "1mo";
    case "3M": return "3mo";
    case "6M": return "6mo";
    case "1Y": return "1y";
    case "2Y": return "2y";
    // Yahoo's chart API has no 3Y or 25Y range token. 5y is the smallest
    // valid range covering 3Y; max is the only valid token covering 25Y.
    case "3Y":
    case "5Y": return "5y";
    case "25Y":
    case "MAX": return "max";
    default: return "1y";
  }
}

type YahooChartInterval = OhlcvInterval | "1m";

function mapIntervalToYahoo(interval: YahooChartInterval) {
  switch (interval) {
    case "1m": return "1m";
    case "5m": return "5m";
    case "15m": return "15m";
    case "1h": return "60m";
    case "1d":
    default:
      return "1d";
  }
}

function splitSnapshotDateTime(raw: string) {
  if (!raw.includes("T")) {
    return { date: raw, time: "00:00:00" };
  }

  const [date, time] = raw.split("T");
  return { date, time: time.slice(0, 8) };
}

function toSnapshotAsOf(snapshot: CurrentQuoteSnapshot) {
  if (!snapshot.date) return null;
  const time = snapshot.time || "00:00:00";
  return `${snapshot.date}T${time}.000Z`;
}

function buildSnapshotFromBars(
  bars: OHLCVBar[],
  overrides: { close?: number; high?: number; low?: number; volume?: number } = {},
): CurrentQuoteSnapshot {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) {
    throw new Error("Cannot build a quote snapshot from empty bars");
  }

  const { date, time } = splitSnapshotDateTime(last.date);
  const close = Number.isFinite(overrides.close) ? Number(overrides.close) : last.close;
  const high = Number.isFinite(overrides.high) ? Number(overrides.high) : Math.max(...bars.map((bar) => bar.high), close);
  const low = Number.isFinite(overrides.low) ? Number(overrides.low) : Math.min(...bars.map((bar) => bar.low), close);
  const volume = Number.isFinite(overrides.volume)
    ? Number(overrides.volume)
    : Math.round(bars.reduce((sum, bar) => sum + bar.volume, 0));

  return {
    open: first.open,
    high: round(high),
    low: round(low),
    close: round(close),
    volume,
    date,
    time,
  };
}

export function parseYahooChart(payload: YahooChartResponse, interval: YahooChartInterval): OHLCVBar[] {
  const error = payload.chart?.error;
  if (error) {
    throw new Error(error.description ?? error.code ?? "Yahoo Finance chart error");
  }

  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];
  if (!result || !quote || !timestamps.length) {
    throw new Error("Yahoo Finance returned no chart data");
  }

  const bars = timestamps.flatMap((timestamp, index) => {
    const close = quote.close?.[index];
    if (!Number.isFinite(close)) return [];

    const open = Number.isFinite(quote.open?.[index]) ? Number(quote.open?.[index]) : Number(close);
    const high = Number.isFinite(quote.high?.[index]) ? Number(quote.high?.[index]) : Number(close);
    const low = Number.isFinite(quote.low?.[index]) ? Number(quote.low?.[index]) : Number(close);
    const volume = Number.isFinite(quote.volume?.[index]) ? Number(quote.volume?.[index]) : 0;
    const iso = new Date(timestamp * 1000).toISOString();

    return [{
      date: interval === "1d" ? iso.slice(0, 10) : iso,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(Number(close)),
      volume: Math.round(volume),
    } satisfies OHLCVBar];
  });

  if (interval !== "1d") return bars;

  const deduped = new Map<string, OHLCVBar>();
  for (const bar of bars) {
    const existing = deduped.get(bar.date);
    deduped.set(bar.date, existing ? {
      ...bar,
      high: Math.max(existing.high, bar.high),
      low: Math.min(existing.low, bar.low),
    } : bar);
  }

  return Array.from(deduped.values());
}

async function fetchYahooChart(symbol: string, range: string, interval: YahooChartInterval) {
  if (!communityMarketDataAllowed()) {
    throw new Error("Community Yahoo access is not enabled for this LiOS profile.");
  }
  const query = new URLSearchParams({
    range: mapRangeToYahoo(range),
    interval: mapIntervalToYahoo(interval),
    includePrePost: "false",
  });

  return fetchJson<YahooChartResponse>(
    `${YAHOO_FINANCE_BASE_URL}/v8/finance/chart/${encodeURIComponent(symbol)}?${query.toString()}`,
  );
}

// Suffix -> currency, for paths that don't get a currency straight from the
// data source (Stooq fallback, CoinGecko, reference fallback). Yahoo's own
// chart API returns an authoritative meta.currency per quote (see
// getYahooQuote) -- this is a secondary, best-effort inference only used
// when that isn't available. Every one of these suffixes is 100% consistent
// across the 57k-ticker universe (verified against server/data/tickers.json).
// Note "GBp" (lowercase p) for London: LSE equities are quoted in pence, not
// pounds -- Yahoo itself reports this distinct currency code, not "GBP".
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

export function inferCurrencyFromSymbol(symbol: string): string {
  const match = /\.([A-Z]+)$/.exec(symbol.toUpperCase());
  if (!match) return "USD";
  return SUFFIX_CURRENCY[match[1]] ?? "USD";
}

/** LV4-05-09: resolves the entitlement snapshot for a quote already served from
 * `providerLabel`, without ever inferring a higher tier than what was actually served. */
function resolveQuoteEntitlement(providerLabel: string, symbol: string, instrumentExists: boolean) {
  return resolveQuoteEntitlementFor(providerLabel, isCryptoSymbol(symbol) ? "crypto" : "equity", instrumentExists);
}


export function buildQuoteFromSnapshot({ symbol, provider, profile, current, history, isLive = true, status, currency }: BuildQuoteInput): Quote {
  const recentHistory = history.slice(-252);
  const previousCloseBar = history.length > 1
    ? (history.at(-1)?.date === current.date ? history.at(-2) : history.at(-1))
    : undefined;
  const previousClose = previousCloseBar?.close ?? current.open;

  // When the market is closed and this isn't a live tick, show the actual
  // previous close -- not a fabricated price. (This used to run a GBM random
  // walk off the last close "so charts look alive during off-hours," but that
  // directly contradicted showing the real previous close when markets are
  // shut, so the displayed price is now always the real last-known close.)
  const quoteSourceLabel = "Limuria Intelligence";
  const effectiveClose = current.close;
  const change = round(effectiveClose - previousClose);
  const changePercent = previousClose === 0 ? 0 : round((change / previousClose) * 100);
  const windowBars = recentHistory.length ? recentHistory : [{ ...current, date: current.date }];
  const high52 = Math.max(current.high, ...windowBars.map((bar) => bar.high));
  const low52 = Math.min(current.low, ...windowBars.map((bar) => bar.low));
  const avgVolume = Math.round(average(windowBars.map((bar) => bar.volume).filter(Boolean)));
  const resolvedStatus = status ?? buildDataStatus({
    provider,
    freshness: isLive ? "current" : "daily",
    asOf: toSnapshotAsOf(current),
    isFallback: !isLive,
  });

  return {
    symbol,
    name: profile?.name ?? symbol,
    price: round(effectiveClose),
    change,
    changePercent,
    volume: current.volume,
    marketCap: null,
    pe: null,
    eps: null,
    revenue: null,
    high52,
    low52,
    open: current.open,
    previousClose: round(previousClose),
    dayHigh: current.high,
    dayLow: current.low,
    avgVolume,
    exchange: profile?.exchange ?? "UNKNOWN",
    sector: profile?.sector,
    quoteSource: quoteSourceLabel,
    isLive,
    status: resolvedStatus,
    currency: currency ?? inferCurrencyFromSymbol(symbol),
    entitlement: resolveQuoteEntitlement(provider, symbol, profile !== undefined),
  };
}

export function parseNewsFeed(xml: string, fallbackSource: string): NewsItem[] {
  const parsed = XML.parse(xml);
  const rawItems = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items
    .map((item): NewsItem | null => {
      const explicitSource = typeof item?.source === "string"
        ? stripHtml(item.source)
        : typeof item?.source?.["#text"] === "string"
          ? stripHtml(item.source["#text"])
          : undefined;
      const { title, source } = splitTitleAndSource(String(item?.title ?? ""), explicitSource, fallbackSource);
      const summary = stripHtml(String(item?.description ?? item?.summary ?? ""));
      const url = stripHtml(String(item?.link?.href ?? item?.link ?? ""));
      const publishedAt = new Date(String(item?.pubDate ?? item?.published ?? item?.updated ?? Date.now())).toISOString();
      if (!title || !url) return null;

      return {
        title,
        summary,
        url,
        source,
        feedProvider: "Limuria Intelligence",
        publishedAt,
        sentiment: inferSentiment(`${title} ${summary}`),
        status: buildDataStatus({
          provider: fallbackSource,
          freshness: "feed",
          asOf: publishedAt,
        }),
      };
    })
    .filter((item): item is NewsItem => Boolean(item));
}


async function getStooqHistory(symbol: string, marketScope = resolveMarketDataScope()): Promise<OHLCVBar[]> {
  const mapped = mapToStooqSymbol(symbol);
  if (!mapped) return [];
  const cacheKey = marketDataCacheKey(`history:stooq:${symbol}`, marketScope);
  const cached = getCached(historyCache, cacheKey);
  if (cached) return cached;

  const csv = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(mapped)}&i=d`);
  const bars = parseStooqHistory(csv);
  return setCached(historyCache, cacheKey, bars, HISTORY_TTL_MS);
}

async function getCoinGeckoQuotes(
  symbols: string[],
  allowKeyedFallback: boolean,
  marketScope = resolveMarketDataScope(),
): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();
  const requested = symbols.filter((symbol) => getCoinGeckoId(symbol));
  if (!requested.length) return results;
  if (!isMarketDataProviderAuthorized("coingecko", marketScope)) {
    if (allowKeyedFallback) {
      for (const symbol of requested) {
        const keyed = await tryKeyedQuote(symbol, marketScope);
        if (keyed) results.set(symbol, keyed);
      }
    }
    return results;
  }

  const uncached = requested.filter((symbol) => {
    const cached = getCached(quoteCache, marketDataCacheKey(`quote:${symbol}`, marketScope));
    if (!cached) return true;
    results.set(symbol, cached);
    return false;
  });

  if (!uncached.length) return results;

  try {
    const ids = uncached
      .map((symbol) => getCoinGeckoId(symbol))
      .filter((id): id is string => Boolean(id));

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
    const payload = await fetchJson<Record<string, { usd: number; usd_market_cap?: number; usd_24h_vol?: number; usd_24h_change?: number }>>(url);
    recordConnectorVerification("coingecko", true, "CoinGecko responded to a live request.");

    for (const symbol of uncached) {
      const profile = getProfileWithCryptoFallback(symbol);
      const id = getCoinGeckoId(symbol);
      const data = id ? payload[id] : undefined;
      if (!profile || !data) {
        const keyed = allowKeyedFallback ? await tryKeyedQuote(symbol, marketScope) : null;
        results.set(symbol, keyed ? setCached(quoteCache, marketDataCacheKey(`quote:${symbol}`, marketScope), keyed, QUOTE_TTL_MS) : buildReferenceFallbackQuote(symbol, marketScope));
        continue;
      }

      const previousClose = data.usd / (1 + ((data.usd_24h_change ?? 0) / 100));
      const change = data.usd - previousClose;
      const asOf = new Date().toISOString();
      // round()'s 2-decimal default is fine for equities and majors
      // (BTC/ETH/SOL/XRP), but the bulk crypto expansion added thousands of
      // sub-cent tokens (PEPE, SHIB, ...) that round to a misleading $0.00
      // at 2 decimals -- scale precision to the price's own magnitude
      // instead, same principle real exchanges use for micro-priced assets.
      const priceDigits = data.usd >= 1 ? 2 : data.usd >= 0.01 ? 4 : data.usd >= 0.0001 ? 6 : 8;
      const quote: Quote = {
        symbol,
        name: profile.name,
        price: round(data.usd, priceDigits),
        change: round(change, priceDigits),
        changePercent: round(data.usd_24h_change ?? 0),
        volume: Math.round(data.usd_24h_vol ?? 0),
        marketCap: data.usd_market_cap ?? null,
        pe: null,
        eps: null,
        revenue: null,
        high52: round(data.usd, priceDigits),
        low52: round(data.usd, priceDigits),
        open: round(previousClose, priceDigits),
        previousClose: round(previousClose, priceDigits),
        dayHigh: round(data.usd, priceDigits),
        dayLow: round(data.usd, priceDigits),
        avgVolume: Math.round(data.usd_24h_vol ?? 0),
        exchange: profile.exchange,
        sector: profile.sector,
        quoteSource: "Limuria Intelligence",
        isLive: true,
        status: buildDataStatus({
          provider: "CoinGecko",
          freshness: "current",
          asOf,
        }),
        currency: "USD",
        entitlement: resolveQuoteEntitlement("CoinGecko", symbol, true),
      };
      results.set(symbol, setCached(quoteCache, marketDataCacheKey(`quote:${symbol}`, marketScope), quote, QUOTE_TTL_MS));
    }
  } catch (err) {
    recordConnectorVerification("coingecko", false, err instanceof Error ? err.message : String(err));
    // Don't cache failures — let next request retry CoinGecko live
    for (const symbol of uncached) {
      const keyed = allowKeyedFallback ? await tryKeyedQuote(symbol, marketScope) : null;
      results.set(symbol, keyed ?? buildReferenceFallbackQuote(symbol, marketScope));
    }
  }

  return results;
}

// Last-resort fallback when Yahoo, Stooq, and (for crypto) CoinGecko have all
// failed for a request. Non-BSE symbols may safely use their persisted close.
// BSE history is persisted raw and requires the async canonical adjustment
// pipeline; this synchronous quote fallback therefore refuses BSE bars rather
// than surfacing an unadjusted or metadata-less price.
function buildReferenceFallbackQuote(symbol: string, marketScope = resolveMarketDataScope()): Quote {
  const profile = getProfileWithCryptoFallback(symbol);
  const stored = loadAuthorizedStoredHistory(symbol, marketScope)?.stored ?? null;
  const isVerifiedBseHistory = !symbol.toUpperCase().endsWith(".BO") && stored !== null;
  const bars = isVerifiedBseHistory ? stored?.bars ?? [] : [];
  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  const price = lastBar?.close ?? 0;
  const previousClose = prevBar?.close ?? price;
  const change = lastBar && prevBar ? round(price - previousClose) : 0;
  const changePercent = lastBar && prevBar && previousClose ? round((change / previousClose) * 100) : 0;
  const window = bars.slice(-252);
  return {
    symbol,
    name: profile?.name ?? symbol,
    price,
    change,
    changePercent,
    volume: lastBar?.volume ?? 0,
    marketCap: null,
    pe: null,
    eps: null,
    revenue: null,
    high52: window.length ? Math.max(...window.map((bar) => bar.high)) : price,
    low52: window.length ? Math.min(...window.map((bar) => bar.low)) : price,
    open: lastBar?.open ?? price,
    previousClose,
    dayHigh: lastBar?.high ?? price,
    dayLow: lastBar?.low ?? price,
    avgVolume: 0,
    exchange: profile?.exchange ?? "UNKNOWN",
    sector: profile?.sector,
    quoteSource: lastBar ? "Limuria Intelligence" : "Unavailable",
    isLive: false,
    status: buildDataStatus({
      provider: lastBar ? "Cached daily history" : "unavailable",
      freshness: lastBar ? "daily" : "reference",
      asOf: lastBar ? `${lastBar.date}T00:00:00.000Z` : null,
      delayLabel: lastBar ? "Previous close (cached)" : "No selected source returned an observation.",
      isFallback: true,
    }),
    currency: inferCurrencyFromSymbol(symbol),
    entitlement: resolveQuoteEntitlement(lastBar ? "Cached daily history" : "Unavailable", symbol, profile !== undefined),
  };
}


// Generic fallback into whatever keyed provider(s) the user has both
// configured and explicitly selected (see server/keyedQuoteAdapters.ts).
// It is intentionally enabled only for single-symbol requests by
// getQuotes(): ticker tapes/screeners request tens or hundreds of symbols,
// and silently spending a user's 8/minute or 25/day vendor quota on that
// bulk UI would be destructive. Single-symbol Quote/Chart/calculation
// workflows still gain the configured breadth automatically when the free
// Yahoo/Stooq chain misses.
const keyedQuoteInflight = new Map<string, Promise<Quote | null>>();
const keyedQuoteMissUntil = new Map<string, number>();
const KEYED_QUOTE_MISS_TTL_MS = 2 * 60_000;

async function tryKeyedQuote(symbol: string, marketScope = resolveMarketDataScope()): Promise<Quote | null> {
  const identity = getRequestIdentity();
  const allowedConnectorIds = identity?.selectedConnectorIds;
  const assetClass = isCryptoSymbol(symbol) ? "crypto" : "equity";
  const adapters = keyedAdaptersFor(assetClass, allowedConnectorIds, identity?.providerStackOrder, { pins: identity?.dataStackPins, symbol, family: "quote" });
  if (!adapters.length) return null;

  const cacheKey = marketDataCacheKey(`keyed-quote:${assetClass}:${symbol}`, marketScope);
  if ((keyedQuoteMissUntil.get(cacheKey) ?? 0) > Date.now()) return null;
  const existing = keyedQuoteInflight.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    for (const adapter of adapters) {
      try {
        const snapshot = await adapter.fetchQuote(symbol);
        if (!snapshot) continue;
        return buildQuoteFromSnapshot({
          symbol,
          provider: adapter.label,
          profile: getProfileWithCryptoFallback(symbol),
          current: snapshot,
          history: [],
          isLive: false,
          status: buildDataStatus({
            provider: adapter.label,
            freshness: "daily",
            asOf: toSnapshotAsOf(snapshot),
            delayLabel: `${adapter.label} fallback`,
            isFallback: true,
          }),
          currency: snapshot.currency,
        });
      } catch (err) {
        console.warn(`${adapter.label} quote fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }
    keyedQuoteMissUntil.set(cacheKey, Date.now() + KEYED_QUOTE_MISS_TTL_MS);
    return null;
  })().finally(() => keyedQuoteInflight.delete(cacheKey));
  keyedQuoteInflight.set(cacheKey, pending);
  return pending;
}

async function tryKeyedOHLCV(symbol: string, days: number): Promise<{ bars: OHLCVBar[]; providerId: string; providerLabel: string } | null> {
  const identity = getRequestIdentity();
  for (const adapter of keyedAdaptersFor("equity", identity?.selectedConnectorIds, identity?.providerStackOrder, { pins: identity?.dataStackPins, symbol, family: "ohlcv" })) {
    if (!adapter.fetchOHLCV) continue;
    try {
      const bars = await adapter.fetchOHLCV(symbol, days);
      if (bars?.length) return { bars, providerId: adapter.id, providerLabel: adapter.label };
    } catch (err) {
      console.warn(`${adapter.label} OHLCV fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
async function getStooqQuote(
  symbol: string,
  allowKeyedFallback: boolean,
  marketScope = resolveMarketDataScope(),
): Promise<Quote> {
  const cacheKey = marketDataCacheKey(`quote:${symbol}`, marketScope);
  const cached = getCached(quoteCache, cacheKey);
  if (cached) return cached;

  if (!isMarketDataProviderAuthorized("stooq", marketScope)) {
    const keyed = allowKeyedFallback ? await tryKeyedQuote(symbol, marketScope) : null;
    return keyed ? setCached(quoteCache, cacheKey, keyed, QUOTE_TTL_MS) : buildReferenceFallbackQuote(symbol, marketScope);
  }

  const mapped = mapToStooqSymbol(symbol);
  if (!mapped) {
    const keyed = allowKeyedFallback ? await tryKeyedQuote(symbol, marketScope) : null;
    return keyed ? setCached(quoteCache, cacheKey, keyed, QUOTE_TTL_MS) : buildReferenceFallbackQuote(symbol, marketScope);
  }

  try {
    const [currentCsv, history] = await Promise.all([
      fetchText(`https://stooq.com/q/l/?s=${encodeURIComponent(mapped)}&i=5`),
      getStooqHistory(symbol, marketScope),
    ]);
    const snapshot = parseStooqCurrent(currentCsv);
    const quote = buildQuoteFromSnapshot({
      symbol,
      provider: symbol === "^RUT" ? "Stooq daily fallback (IWM proxy)" : "Stooq daily fallback",
      profile: getProfileWithCryptoFallback(symbol),
      current: snapshot,
      history,
      isLive: false,
      status: buildDataStatus({
        provider: symbol === "^RUT" ? "Stooq daily fallback (IWM proxy)" : "Stooq daily fallback",
        freshness: "daily",
        asOf: toSnapshotAsOf(snapshot),
        delayLabel: "Daily fallback",
        isFallback: true,
      }),
    });
    return setCached(quoteCache, cacheKey, quote, QUOTE_TTL_MS);
  } catch {
    // Stooq CSV API is unreliable — don't cache failure, return reference without caching
    const keyed = allowKeyedFallback ? await tryKeyedQuote(symbol, marketScope) : null;
    return keyed ? setCached(quoteCache, cacheKey, keyed, QUOTE_TTL_MS) : buildReferenceFallbackQuote(symbol, marketScope);
  }
}

async function getYahooQuote(
  symbol: string,
  allowKeyedFallback: boolean,
  marketScope = resolveMarketDataScope(),
  scopeContext: MarketDataScopeContext = {},
): Promise<Quote> {
  const cacheKey = marketDataCacheKey(`quote:${symbol}`, marketScope);
  const cached = getCached(quoteCache, cacheKey);
  if (cached) return cached;

  if (!isMarketDataProviderAuthorized("yahoo_finance", marketScope)) {
    return getStooqQuote(symbol, allowKeyedFallback, marketScope);
  }

  try {
    const [intradayPayload, history] = await Promise.all([
      fetchYahooChart(symbol, "1D", "1m"),
      getOHLCV(symbol, "1Y", "1d", false, scopeContext).catch((err) => {
        console.warn(`[CACHE WARNING] Failed to load history for ${symbol}:`, err.message);
        return [] as OHLCVBar[];
      }),
    ]);
    const intradayBars = parseYahooChart(intradayPayload, "1m");
    const sessionBars = intradayBars.length ? intradayBars : history.slice(-1);
    if (!sessionBars.length) {
      throw new Error(`Yahoo Finance returned no quote bars for ${symbol}`);
    }
    recordConnectorVerification("yahoo_finance", true, "Yahoo Finance responded to a live request.");

    const meta = intradayPayload.chart?.result?.[0]?.meta;
    const quote = buildQuoteFromSnapshot({
      symbol,
      provider: "Yahoo Finance",
      profile: getProfileWithCryptoFallback(symbol),
      current: buildSnapshotFromBars(sessionBars, {
        close: Number.isFinite(meta?.regularMarketPrice) ? Number(meta?.regularMarketPrice) : undefined,
        high: Number.isFinite(meta?.regularMarketDayHigh) ? Number(meta?.regularMarketDayHigh) : undefined,
        low: Number.isFinite(meta?.regularMarketDayLow) ? Number(meta?.regularMarketDayLow) : undefined,
        volume: Number.isFinite(meta?.regularMarketVolume) ? Number(meta?.regularMarketVolume) : undefined,
      }),
      history,
      currency: meta?.currency,
    });

    return setCached(quoteCache, cacheKey, quote, QUOTE_TTL_MS);
  } catch (err) {
    recordConnectorVerification("yahoo_finance", false, err instanceof Error ? err.message : String(err));
    return getStooqQuote(symbol, allowKeyedFallback, marketScope);
  }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, as a true
 * rolling pool — not fixed batches of `limit`. Fixed-batch chunking (the
 * previous implementation) waits for the SLOWEST item in each batch before
 * starting the next batch, even if other workers finished early and sat
 * idle; one slow symbol in a batch of 8 stalls the other 7 slots for nothing.
 * A rolling pool keeps every slot continuously busy, which matters a lot
 * here: some symbols hit the Python/yfinance fallback chain (slow) while
 * others resolve from cache or a fast HTTP fetch (quick) — this let a
 * 163-symbol screener query that batched to ~88s instead scale with the true
 * bottleneck.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Yahoo Finance has zero coverage for BSE's numeric-scripcode symbols
// (confirmed live: it returns "symbol may be delisted" for real, liquid,
// actively-traded names like 500002.BO/ABB India), so routing .BO straight
// to the BSE connector skips a call that's confirmed to always fail rather
// than burning the Yahoo->Stooq fallback chain on every single BSE quote.
// NSE (.NS) is untouched -- Yahoo already covers it well, verified live down
// to a micro-cap and a sub-₹1 penny stock.
async function getSingleQuote(
  symbol: string,
  allowKeyedFallback: boolean,
  marketScope: ResolvedMarketDataScope,
  scopeContext: MarketDataScopeContext,
): Promise<Quote> {
  if (symbol.endsWith(".BO") && isMarketDataProviderAuthorized("bse_india", marketScope)) {
    const bseQuote = await getBseIndiaQuote(symbol);
    if (bseQuote) return bseQuote;
  }
  return getYahooQuote(symbol, allowKeyedFallback, marketScope, scopeContext);
}

/** Quota guard: never spend keyed-provider calls on bulk ticker/screener requests. */
export function shouldUseKeyedQuoteFallback(symbolCount: number): boolean {
  return symbolCount === 1;
}
export async function getQuotes(
  symbols: string[],
  concurrency = 8,
  scopeContext: MarketDataScopeContext = {},
): Promise<Quote[]> {
  const identity = getRequestIdentity();
  const marketScope = resolveMarketDataScope(scopeContext);
  if (identity?.userId !== null && identity?.userId !== undefined && !(identity.selectedConnectorIds?.length ?? 0)) {
    return [];
  }
  const uniqueSymbols = uniqueBy(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean), (symbol) => symbol);
  const allowKeyedFallback = shouldUseKeyedQuoteFallback(uniqueSymbols.length);
  const cryptoSymbols = uniqueSymbols.filter((symbol) => isCryptoSymbol(symbol));
  const nonCryptoSymbols = uniqueSymbols.filter((symbol) => !cryptoSymbols.includes(symbol));
  const cryptoQuotes = await getCoinGeckoQuotes(cryptoSymbols, allowKeyedFallback, marketScope);

  const quotes = await mapWithConcurrency(nonCryptoSymbols, concurrency, sym => getSingleQuote(sym, allowKeyedFallback, marketScope, scopeContext));

  return [
    ...quotes,
    ...cryptoSymbols.map((symbol) => cryptoQuotes.get(symbol) ?? buildReferenceFallbackQuote(symbol, marketScope)),
  ];
}

// Community Yahoo Python helpers use the single managed-runtime resolver.
// Packaged retail builds must never probe the host machine for Python.
async function downloadHistoryWithPython(symbol: string, range: string, interval: string): Promise<OHLCVBar[]> {
  if (!communityMarketDataAllowed()) {
    throw new Error("Community Yahoo/yfinance access is not enabled for this LiOS profile.");
  }
  // process.resourcesPath exists only under Electron; the backend runs as a
  // plain node subprocess, so it usually comes via ELECTRON_RESOURCES_PATH.
  const resourcesBase = ("resourcesPath" in process && typeof process.resourcesPath === "string" ? process.resourcesPath : undefined) || process.env.ELECTRON_RESOURCES_PATH;
  const scriptPath = resourcesBase
    ? path.join(resourcesBase, "script", "download_history.py")
    : path.resolve(process.cwd(), "script", "download_history.py");
  const python = resolveCommunityPythonExecutable();
  const { stdout } = await runCommand({
    argv: [python.executable, scriptPath, "--symbol", symbol, "--range", range, "--interval", interval],
    timeoutMs: 60_000,
    maxOutputChars: 1024 * 1024 * 50,
    env: {
      PYTHONDONTWRITEBYTECODE: "1",
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY,
      NO_PROXY: process.env.NO_PROXY,
      http_proxy: process.env.http_proxy,
      https_proxy: process.env.https_proxy,
      all_proxy: process.env.all_proxy,
      no_proxy: process.env.no_proxy,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      SSL_CERT_DIR: process.env.SSL_CERT_DIR,
      REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
      CURL_CA_BUNDLE: process.env.CURL_CA_BUNDLE,
    },
  }).catch((error: unknown) => {
    console.error("Python history downloader failure:", error, error instanceof CommandExecutionError ? error.result.stderr : "");
    throw error;
  });
  const data = JSON.parse(stdout);
  if (data.error) throw new Error(data.error);
  return data;
}

async function downloadFundamentalsWithPython(symbol: string): Promise<Fundamentals> {
  if (!communityMarketDataAllowed()) {
    throw new Error("Community Yahoo/yfinance access is not enabled for this LiOS profile.");
  }
  const resourcesBase = ("resourcesPath" in process && typeof process.resourcesPath === "string" ? process.resourcesPath : undefined) || process.env.ELECTRON_RESOURCES_PATH;
  const scriptPath = resourcesBase
    ? path.join(resourcesBase, "script", "download_fundamentals.py")
    : path.resolve(process.cwd(), "script", "download_fundamentals.py");
  const python = resolveCommunityPythonExecutable();
  const { stdout } = await runCommand({
    argv: [python.executable, scriptPath, "--symbol", symbol],
    timeoutMs: 60_000,
    maxOutputChars: 1024 * 1024 * 10,
    env: {
      PYTHONDONTWRITEBYTECODE: "1",
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY,
      NO_PROXY: process.env.NO_PROXY,
      http_proxy: process.env.http_proxy,
      https_proxy: process.env.https_proxy,
      all_proxy: process.env.all_proxy,
      no_proxy: process.env.no_proxy,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      SSL_CERT_DIR: process.env.SSL_CERT_DIR,
      REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
      CURL_CA_BUNDLE: process.env.CURL_CA_BUNDLE,
    },
  }).catch((error: unknown) => {
    console.error("Python fundamentals downloader failure:", error, error instanceof CommandExecutionError ? error.result.stderr : "");
    throw error;
  });
  const data = JSON.parse(stdout);
  if (data.error) throw new Error(data.error);
  return data;
}

// Live fundamentals (market cap, P/E, EPS, revenue, ...) via yfinance,
// disk-cached for FUNDAMENTALS_TTL_MS since these move far slower than price.
// Unlike getQuotes/getOHLCV, this is meant for single-symbol "calculation"
// panels (Quote, Valuation, Peer Comp, Asset Pricing) -- a yfinance .info
// call is meaningfully slower than a price fetch, so it isn't wired into bulk
// list views (Screener/Heatmap/Watchlist), which keep using the static
// PROFILE_CATALOG fallback to stay fast. Returns null (not a thrown error) on
// failure so callers can fall back to the catalog/show "no data" honestly.
export async function getFundamentals(
  symbol: string,
  scopeContext: MarketDataScopeContext = {},
): Promise<Fundamentals | null> {
  const marketScope = resolveMarketDataScope(scopeContext);
  if (!isMarketDataProviderAuthorized("yahoo_finance", marketScope)) return null;
  const upper = symbol.toUpperCase();
  const stored = loadFundamentals(upper);
  if (stored && isFreshFundamentals(stored)) return stored.data;

  try {
    const data = await downloadFundamentalsWithPython(upper);
    saveFundamentals(upper, data);
    return data;
  } catch (e) {
    console.warn(`Fundamentals fetch failed for ${upper}:`, e);
    // Stale-but-present beats nothing if the live fetch failed (offline, rate-limited, etc.)
    return stored?.data ?? null;
  }
}
function historyAsOf(bars: OHLCVBar[]): string | null {
  const last = bars.at(-1);
  if (!last?.date) return null;
  const parsed = Date.parse(last.date.length === 10 ? `${last.date}T23:59:59.999Z` : last.date);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function buildHistoryProvenance(input: {
  providerId: string;
  providerLabel: string;
  bars: OHLCVBar[];
  isFallback?: boolean;
  sourceRefs?: string[];
  notes?: string[];
}): OHLCVProvenance {
  const observedAt = new Date().toISOString();
  return {
    sourceRefs: input.sourceRefs ?? [`provider:${input.providerId}`],
    providerIds: [input.providerId],
    providerLabels: [input.providerLabel],
    status: buildDataStatus({
      provider: input.providerLabel,
      freshness: "daily",
      asOf: historyAsOf(input.bars),
      delayLabel: input.isFallback ? "Historical fallback" : "Daily historical observations",
      isFallback: input.isFallback ?? false,
    }),
    observedAt,
    notes: input.notes ?? [],
  };
}

function loadAuthorizedStoredHistory(
  symbol: string,
  scope: ResolvedMarketDataScope,
): { stored: StoredHistory; scopeKey: string } | null {
  const scoped = loadHistory(symbol, scope.key);
  if (scoped?.provenance && areMarketDataProvidersAuthorized(scoped.provenance.providerIds, scope)) {
    return { stored: scoped, scopeKey: scope.key };
  }
  if (!scope.scoped) return scoped ? { stored: scoped, scopeKey: "global" } : null;

  const shared = loadHistory(symbol, "global");
  if (
    shared?.provenance &&
    shouldUseGlobalMarketHistory(shared.provenance.providerIds, scope, shared.provenance.sourceRefs) &&
    areMarketDataProvidersAuthorized(shared.provenance.providerIds, scope)
  ) {
    return { stored: shared, scopeKey: "global" };
  }
  return null;
}

function historyWriteScopeKey(scope: ResolvedMarketDataScope, provenance: OHLCVProvenance): string {
  return shouldUseGlobalMarketHistory(provenance.providerIds, scope, provenance.sourceRefs) ? "global" : scope.key;
}

function historyProvenanceFromStored(
  symbol: string,
  bars: OHLCVBar[],
  storedOverride?: StoredHistory | null,
): OHLCVProvenance {
  const stored = storedOverride === undefined ? loadHistory(symbol) : storedOverride;
  if (stored?.provenance) {
    return {
      sourceRefs: stored.provenance.sourceRefs,
      providerIds: stored.provenance.providerIds,
      providerLabels: stored.provenance.providerLabels,
      status: buildDataStatus({
        provider: stored.provenance.providerLabels.join(", ") || "LiOS persisted history",
        freshness: "daily",
        asOf: stored.provenance.asOf ?? historyAsOf(bars),
        delayLabel: "Persisted daily history",
        isFallback: stored.provenance.isFallback,
      }),
      observedAt: new Date(stored.provenance.observedAt).toISOString(),
      notes: stored.provenance.sourceRefs.includes("provenance:legacy-unattributed")
        ? ["Persisted history combines legacy bars with unavailable upstream attribution and newer bars with recorded provider lineage; LiOS preserves that uncertainty."]
        : ["Served from LiOS local persisted history with recorded upstream lineage."],
    };
  }
  return {
    sourceRefs: [`dataset:local-history:${symbol}`, "provenance:legacy-unattributed"],
    providerIds: [],
    providerLabels: ["LiOS persisted history"],
    status: buildDataStatus({
      provider: "LiOS persisted history",
      freshness: "daily",
      asOf: historyAsOf(bars),
      delayLabel: "Persisted daily history · legacy upstream attribution unavailable",
      isFallback: false,
    }),
    observedAt: new Date().toISOString(),
    notes: ["Legacy persisted history does not encode its original upstream provider; LiOS does not guess one."],
  };
}

function toStoredHistoryProvenance(provenance: OHLCVProvenance): StoredHistoryProvenance {
  return {
    sourceRefs: provenance.sourceRefs,
    providerIds: provenance.providerIds,
    providerLabels: provenance.providerLabels,
    observedAt: provenance.observedAt,
    asOf: provenance.status.asOf,
    isFallback: provenance.status.isFallback,
  };
}

function cacheHistoryWithProvenance(
  cacheKey: string,
  bars: OHLCVBar[],
  provenance: OHLCVProvenance,
): OHLCVBar[] {
  historyProvenanceCache.set(cacheKey, { expiresAt: Date.now() + HISTORY_TTL_MS, value: provenance });
  return setCached(historyCache, cacheKey, bars, HISTORY_TTL_MS);
}

function isNumericBseSymbol(symbol: string): boolean {
  return /^\d{1,12}\.BO$/.test(symbol.toUpperCase());
}

async function adjustBseHistory(symbol: string, bars: OHLCVBar[]): Promise<OHLCVBar[]> {
  if (!isNumericBseSymbol(symbol) || bars.length === 0) return bars;
  const scripCode = symbol.toUpperCase().replace(/\.BO$/, "");
  const asOfDate = bars.reduce((latest, bar) => bar.date > latest ? bar.date : latest, bars[0].date);
  try {
    const actions = await getBseCorporateActionAdjustments(scripCode, asOfDate);
    return applyCanonicalCorporateActionAdjustments(bars, actions);
  } catch (error) {
    console.warn(`BSE corporate-action adjustment unavailable for ${symbol}:`, error instanceof Error ? error.message : error);
    return [];
  }
}



export async function getOHLCV(
  symbol: string,
  range = "1Y",
  interval: OhlcvInterval = "1d",
  allowKeyedFallback = true,
  scopeContext: MarketDataScopeContext = {},
): Promise<OHLCVBar[]> {
  const upper = symbol.toUpperCase();
  const days = Math.max(getRangeDays(range), 1);
  const marketScope = resolveMarketDataScope(scopeContext);
  const cacheKey = marketDataCacheKey(`history:${upper}:${days}:${interval}`, marketScope);
  const cached = getCached(historyCache, cacheKey);
  if (cached) return cached;

  // Daily bars are served from the persistent on-disk store when possible:
  // fresh + sufficient lookback means zero upstream calls, and a stale store
  // only needs a short incremental top-up instead of a full history download.
  const isDaily = interval === "1d" && !isCryptoSymbol(upper);
  if (isDaily) {
    const authorizedStored = loadAuthorizedStoredHistory(upper, marketScope);
    const stored = authorizedStored?.stored ?? null;
    if (stored && coversRange(stored, days)) {
      const availableStored = stored;
      if (isNumericBseSymbol(upper)) {
        if (availableStored.adjustmentState !== "raw") {
          console.warn(`BSE history provenance is not raw for ${upper}; refusing to apply adjustments twice.`);
          return cacheHistoryWithProvenance(cacheKey, [], historyProvenanceFromStored(upper, [], availableStored));
        }
        const adjustedStored = await adjustBseHistory(upper, availableStored.bars);
        if (availableStored.bars.length > 0 && adjustedStored.length === 0) {
          return cacheHistoryWithProvenance(cacheKey, [], historyProvenanceFromStored(upper, [], availableStored));
        }
        if (isFresh(availableStored)) {
          return cacheHistoryWithProvenance(cacheKey, adjustedStored.slice(-days), historyProvenanceFromStored(upper, adjustedStored, availableStored));
        }
        try {
          const recent = await getBseHistoryRange(
            upper,
            new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10),
            new Date().toISOString().slice(0, 10),
          );
          const provenance = buildHistoryProvenance({
            providerId: "bse_india",
            providerLabel: "BSE India",
            bars: recent,
            sourceRefs: ["provider:bse_india", "dataset:bse-bhavcopy"],
          });
          const merged = saveHistory(upper, recent, "raw", toStoredHistoryProvenance(provenance), historyWriteScopeKey(marketScope, provenance));
          const adjustedMerged = await adjustBseHistory(upper, merged.bars);
          if (merged.bars.length > 0 && adjustedMerged.length === 0) {
            return cacheHistoryWithProvenance(cacheKey, [], historyProvenanceFromStored(upper, [], availableStored));
          }
          return cacheHistoryWithProvenance(cacheKey, adjustedMerged.slice(-days), historyProvenanceFromStored(upper, adjustedMerged, merged));
        } catch {
          return cacheHistoryWithProvenance(cacheKey, adjustedStored.slice(-days), historyProvenanceFromStored(upper, adjustedStored, availableStored));
        }
      }

      if (isFresh(stored)) {
        return cacheHistoryWithProvenance(cacheKey, stored.bars.slice(-days), historyProvenanceFromStored(upper, stored.bars, stored));
      }
      if (!isMarketDataProviderAuthorized("yahoo_finance", marketScope)) {
        return cacheHistoryWithProvenance(cacheKey, stored.bars.slice(-days), historyProvenanceFromStored(upper, stored.bars, stored));
      }
      try {
        let recent: OHLCVBar[];
        let provenance: OHLCVProvenance;
        try {
          recent = await downloadHistoryWithPython(upper, "3M", "1d");
          provenance = buildHistoryProvenance({
            providerId: "yahoo_finance",
            providerLabel: "Yahoo Finance via yfinance",
            bars: recent,
            sourceRefs: ["provider:yahoo_finance", "adapter:yfinance"],
          });
        } catch {
          recent = parseYahooChart(await fetchYahooChart(upper, "3M", "1d"), "1d");
          provenance = buildHistoryProvenance({
            providerId: "yahoo_finance",
            providerLabel: "Yahoo Finance",
            bars: recent,
            sourceRefs: ["provider:yahoo_finance"],
          });
        }
        const merged = saveHistory(upper, recent, "raw", toStoredHistoryProvenance(provenance), historyWriteScopeKey(marketScope, provenance));
        return cacheHistoryWithProvenance(cacheKey, merged.bars.slice(-days), historyProvenanceFromStored(upper, merged.bars, merged));
      } catch {
        return cacheHistoryWithProvenance(cacheKey, stored.bars.slice(-days), historyProvenanceFromStored(upper, stored.bars, stored));
      }
    }
  }

  if (isDaily && upper.endsWith(".BO") && isMarketDataProviderAuthorized("bse_india", marketScope)) {
    // No usable stored history at all yet for this .BO symbol (backfill
    // script hasn't covered it -- e.g. newly listed) -- pull as much of the
    // confirmed-available bhavcopy range (2024-01-03 onward, see
    // bseBhavcopy.ts) as covers the requested lookback.
    const existing = loadAuthorizedStoredHistory(upper, marketScope)?.stored ?? null;
    if (existing && existing.adjustmentState !== "raw") {
      console.warn(`BSE history provenance is not raw for ${upper}; refusing to merge an unclassified series.`);
      return cacheHistoryWithProvenance(cacheKey, [], historyProvenanceFromStored(upper, [], existing));
    }
    const fromIso = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const toIso = new Date().toISOString().slice(0, 10);
    const bars = await getBseHistoryRange(upper, fromIso, toIso);
    const bseProvenance = buildHistoryProvenance({
      providerId: "bse_india",
      providerLabel: "BSE India",
      bars,
      sourceRefs: ["provider:bse_india", "dataset:bse-bhavcopy"],
    });
    const merged = bars.length > 0 ? saveHistory(upper, bars, "raw", toStoredHistoryProvenance(bseProvenance), historyWriteScopeKey(marketScope, bseProvenance)) : existing;
    const adjusted = await adjustBseHistory(upper, merged?.bars ?? []);
    if (merged?.bars.length && adjusted.length === 0) {
      return cacheHistoryWithProvenance(
        cacheKey,
        [],
        merged ? historyProvenanceFromStored(upper, [], merged) : bseProvenance,
      );
    }
    return cacheHistoryWithProvenance(cacheKey, adjusted.slice(-days), merged ? historyProvenanceFromStored(upper, adjusted, merged) : bseProvenance);
  }
  try {
    // Try Python/yfinance downloader first (except for crypto)
    if (!isCryptoSymbol(upper) && isMarketDataProviderAuthorized("yahoo_finance", marketScope)) {
      try {
        const bars = await downloadHistoryWithPython(upper, range, interval);
        if (bars.length > 0) {
          const provenance = buildHistoryProvenance({
            providerId: "yahoo_finance",
            providerLabel: "Yahoo Finance via yfinance",
            bars,
            sourceRefs: ["provider:yahoo_finance", "adapter:yfinance"],
          });
          if (isDaily) saveHistory(upper, bars, "raw", toStoredHistoryProvenance(provenance), historyWriteScopeKey(marketScope, provenance));
          const trimmed = interval === "1d" ? bars.slice(-days) : bars;
          return cacheHistoryWithProvenance(cacheKey, trimmed, provenance);
        }
      } catch (e) {
        console.warn(`yfinance downloader failed for ${upper}, falling back to Yahoo/Stooq:`, e);
      }
    }

    if (isCryptoSymbol(upper)) {
      if (!isMarketDataProviderAuthorized("coingecko", marketScope)) {
        return cacheHistoryWithProvenance(cacheKey, [], buildHistoryProvenance({
          providerId: "none",
          providerLabel: "No selected crypto historical provider",
          bars: [],
          isFallback: true,
          sourceRefs: ["dataset:ohlcv:unavailable"],
          notes: ["The selected source policy does not authorize CoinGecko for this request; LiOS did not bypass it."],
        }));
      }
      const id = getCoinGeckoId(upper);
      if (!id) {
        return cacheHistoryWithProvenance(cacheKey, [], buildHistoryProvenance({
          providerId: "coingecko",
          providerLabel: "CoinGecko",
          bars: [],
          isFallback: true,
          sourceRefs: ["provider:coingecko", "dataset:ohlcv:unavailable"],
          notes: ["No CoinGecko instrument mapping was available; LiOS did not synthesize history."],
        }));
      }
      const requestDays = interval === "5m" || interval === "15m" ? 1 : Math.min(days, 365);
      const payload = await fetchJson<{ prices: [number, number][]; total_volumes: [number, number][] }>(
        `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${requestDays}`,
      );
      const points = payload.prices.map(([timestamp, price], index) => ({
        timestamp,
        price,
        volume: payload.total_volumes[index]?.[1] ?? 0,
      }));
      const bars = aggregatePricePoints(points, interval);
      const provenance = buildHistoryProvenance({
        providerId: "coingecko",
        providerLabel: "CoinGecko",
        bars,
        sourceRefs: ["provider:coingecko"],
      });
      return cacheHistoryWithProvenance(cacheKey, bars, provenance);
    }

    if (!isMarketDataProviderAuthorized("yahoo_finance", marketScope)) {
      throw new Error("Yahoo Finance is not selected for this request.");
    }
    const bars = parseYahooChart(await fetchYahooChart(upper, range, interval), interval);
    if (!bars.length) {
      throw new Error(`Yahoo Finance returned no OHLCV data for ${upper}`);
    }

    const yahooProvenance = buildHistoryProvenance({
      providerId: "yahoo_finance",
      providerLabel: "Yahoo Finance",
      bars,
      sourceRefs: ["provider:yahoo_finance"],
    });
    if (isDaily) saveHistory(upper, bars, "raw", toStoredHistoryProvenance(yahooProvenance), historyWriteScopeKey(marketScope, yahooProvenance));
    const trimmed = interval === "1d" ? bars.slice(-days) : bars;
    return cacheHistoryWithProvenance(cacheKey, trimmed, yahooProvenance);
  } catch {
    if (interval !== "1d") {
      const empty = cached ?? [];
      if (!historyProvenanceCache.get(cacheKey)) {
        historyProvenanceCache.set(cacheKey, {
          expiresAt: Date.now() + HISTORY_TTL_MS,
          value: buildHistoryProvenance({
            providerId: "unknown",
            providerLabel: "Historical provider unavailable",
            bars: empty,
            isFallback: true,
            sourceRefs: ["dataset:ohlcv:provider-unattributed"],
            notes: ["The failed intraday path did not expose an upstream provider identity."],
          }),
        });
      }
      return empty;
    }
    if (isMarketDataProviderAuthorized("stooq", marketScope)) {
      const history = await getStooqHistory(upper, marketScope);
      if (history.length) {
        const provenance = buildHistoryProvenance({
          providerId: "stooq",
          providerLabel: "Stooq",
          bars: history,
          isFallback: true,
          sourceRefs: ["provider:stooq"],
        });
        if (isDaily) saveHistory(upper, history, "raw", toStoredHistoryProvenance(provenance), historyWriteScopeKey(marketScope, provenance));
        return cacheHistoryWithProvenance(cacheKey, history.slice(-days), provenance);
      }
    }
    if (allowKeyedFallback) {
      const keyed = await tryKeyedOHLCV(upper, days);
      if (keyed?.bars.length) {
        const provenance = buildHistoryProvenance({
          providerId: keyed.providerId,
          providerLabel: keyed.providerLabel,
          bars: keyed.bars,
          isFallback: true,
          sourceRefs: [`provider:${keyed.providerId}`],
        });
        if (isDaily) saveHistory(upper, keyed.bars, "raw", toStoredHistoryProvenance(provenance), historyWriteScopeKey(marketScope, provenance));
        return cacheHistoryWithProvenance(cacheKey, keyed.bars.slice(-days), provenance);
      }
    }
    return cacheHistoryWithProvenance(cacheKey, [], buildHistoryProvenance({
      providerId: "none",
      providerLabel: "No historical provider",
      bars: [],
      isFallback: true,
      sourceRefs: ["dataset:ohlcv:unavailable"],
      notes: ["No historical observations were available; LiOS did not synthesize bars."],
    }));
  }
}

export async function getOHLCVWithProvenance(
  symbol: string,
  range = "1Y",
  interval: OhlcvInterval = "1d",
  allowKeyedFallback = true,
  scopeContext: MarketDataScopeContext = {},
): Promise<OHLCVWithProvenance> {
  const upper = symbol.toUpperCase();
  const days = Math.max(getRangeDays(range), 1);
  const marketScope = resolveMarketDataScope(scopeContext);
  const cacheKey = marketDataCacheKey(`history:${upper}:${days}:${interval}`, marketScope);
  const bars = await getOHLCV(upper, range, interval, allowKeyedFallback, scopeContext);
  const cachedProvenance = getCached(historyProvenanceCache, cacheKey);
  if (cachedProvenance) return { bars, provenance: cachedProvenance };
  if (interval === "1d" && !isCryptoSymbol(upper)) {
    const authorizedStored = loadAuthorizedStoredHistory(upper, marketScope);
    if (authorizedStored) {
      return { bars, provenance: historyProvenanceFromStored(upper, bars, authorizedStored.stored) };
    }
  }
  return {
    bars,
    provenance: buildHistoryProvenance({
      providerId: "unknown",
      providerLabel: "Historical provider not attributed",
      bars,
      isFallback: true,
      sourceRefs: ["dataset:ohlcv:provider-unattributed"],
      notes: ["This response path predates provider attribution or did not expose one; LiOS does not infer it from the quote provider."],
    }),
  };
}

/** Fetches both sides of a canonical continuity event and stitches them at
 * the effective date without inventing a synthetic bridge observation. */
export async function getContinuousOHLCV(
  event: ContinuityEvent,
  range = "MAX",
  interval: "1d" = "1d",
): Promise<ContinuousHistory> {
  const normalizedEvent = normalizeContinuityEvent(event);
  const [sourceBars, targetBars] = await Promise.all([
    getOHLCV(normalizedEvent.sourceSymbol, range, interval),
    getOHLCV(normalizedEvent.targetSymbol, range, interval),
  ]);
  return buildContinuousHistory(sourceBars, targetBars, normalizedEvent);
}

export async function getOHLCVSeries(symbol: string, range = "1Y", interval: OhlcvInterval = "1d"): Promise<OHLCVSeries> {
  const upper = symbol.toUpperCase();
  const [bars, quote] = await Promise.all([
    getOHLCV(upper, range, interval),
    getQuotes([upper]).then((items) => items[0] ?? buildReferenceFallbackQuote(upper)),
  ]);

  return {
    bars,
    status: quote.status,
    supportsIntraday: isCryptoSymbol(upper) || quote.status.freshness === "current",
  };
}

export async function getIndexSparklines(): Promise<Record<string, number[]>> {
  const symbols = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "^NSEI", "^BSESN", "^N225", "^HSI", "^FTSE", "^GDAXI"];
  const result: Record<string, number[]> = {};
  for (const symbol of symbols) {
    const bars = await getOHLCV(symbol, "3M");
    result[symbol] = bars.slice(-30).map((bar) => bar.close);
  }
  return result;
}

// Suffix -> exchange, mirroring SUFFIX_CURRENCY's convention. Lets movers and
// the screener pull in every symbol this app has ever persisted locally
// (see listStoredSymbols in marketHistoryStore.ts) that belongs to a given
// exchange, instead of only ever ranking the ~10-15 hand-picked names in
// EXCHANGE_MOVER_MAP / the 163-symbol SCREENER_UNIVERSE below.
const EXCHANGE_SUFFIX: Record<string, string> = {
  NS: "NSE", BO: "BSE", T: "TSE", HK: "HKEX", L: "LSE",
  DE: "XETRA", TO: "TSX", AX: "ASX", SI: "SGX",
  PA: "EURONEXT", AS: "EURONEXT", BR: "EURONEXT",
  TW: "TWSE", KS: "KRX", SS: "SSE", SZ: "SZSE", SA: "B3", KL: "BURSA",
};

/** Best-effort exchange guess for a symbol, from its suffix (or lack of one for US). */
function classifyExchange(symbol: string): string {
  const upper = symbol.toUpperCase();
  const match = /\.([A-Z]+)$/.exec(upper);
  if (match && EXCHANGE_SUFFIX[match[1]]) return EXCHANGE_SUFFIX[match[1]];
  if (upper.startsWith("^") || upper.includes("=") || upper.endsWith("-USD")) return "OTHER";
  return "US";
}

const MAX_STORED_MOVER_CANDIDATES = 75;

export function isStoredReferenceCandidateSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  if (upper.startsWith("0P")) return false;
  if (upper.startsWith("^") || upper.includes("=") || upper.endsWith("-USD")) return false;
  return true;
}

function storedReferenceCandidates(exclude: Set<string>, limit: number, exchange?: string): string[] {
  const result: string[] = [];
  for (const symbol of listStoredSymbols()) {
    if (result.length >= limit) break;
    if (exclude.has(symbol)) continue;
    if (!isStoredReferenceCandidateSymbol(symbol)) continue;
    if (exchange && classifyExchange(symbol) !== exchange) continue;
    result.push(symbol);
  }
  return result;
}

// Extra candidates for a given exchange, pulled from the persisted history
// store rather than a live fetch. Bounded deliberately: a bulk history import
// can contain tens of thousands of large JSON files, and parsing all of them
// for a landing-page movers widget can exhaust the Node heap.
function storedCandidatesForExchange(exchange: string, exclude: Set<string>): Quote[] {
  return storedReferenceCandidates(exclude, MAX_STORED_MOVER_CANDIDATES, exchange)
    .map((sym) => buildReferenceFallbackQuote(sym))
    .filter((q) => q.price > 0);
}

export async function getMarketMovers(kind: "gainers" | "losers" | "active", region?: string) {
  let exchange = (region || "US").toUpperCase();
  if (exchange === "IN") exchange = "NSE";
  if (exchange === "JP") exchange = "TSE";
  if (exchange === "HK") exchange = "HKEX";
  if (exchange === "EU" || exchange === "FR" || exchange === "NL" || exchange === "BE") exchange = "EURONEXT";
  if (exchange === "TW") exchange = "TWSE";
  if (exchange === "KR") exchange = "KRX";
  if (exchange === "CN") exchange = "SSE";
  if (exchange === "BR") exchange = "B3";
  if (exchange === "MY") exchange = "BURSA";

  const EXCHANGE_MOVER_MAP: Record<string, string[]> = {
    US: ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META", "BRK-B", "JPM", "BAC", "GS", "NFLX", "AMD", "INTC", "WMT"],
    NSE: ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS", "TATAMOTORS.NS", "SBIN.NS", "ITC.NS", "BHARTIARTL.NS", "LT.NS"],
    BSE: ["500325.BO", "500112.BO", "500209.BO", "500180.BO", "532215.BO", "500570.BO", "500124.BO", "500696.BO", "500820.BO", "500510.BO"],
    TSE: ["7203.T", "6758.T", "9984.T", "7974.T", "9983.T", "8035.T", "6861.T", "8306.T", "9432.T", "6501.T"],
    HKEX: ["0700.HK", "9988.HK", "3690.HK", "0939.HK", "1299.HK", "0005.HK", "2318.HK", "1810.HK", "0388.HK", "0883.HK"],
    LSE: ["BP.L", "VOD.L", "AZN.L", "HSBA.L", "SHEL.L", "GSK.L", "BARC.L", "LLOY.L", "AAL.L", "BATS.L"],
    XETRA: ["SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "BMW.DE", "MBG.DE", "BAS.DE", "BAYN.DE", "VOW3.DE", "DBK.DE"],
    TSX: ["RY.TO", "TD.TO", "ENB.TO", "CNR.TO", "CP.TO", "BNS.TO", "BMO.TO", "ABX.TO", "SHOP.TO", "CNQ.TO"],
    ASX: ["BHP.AX", "CBA.AX", "CSL.AX", "NAB.AX", "WBC.AX", "ANZ.AX", "WDS.AX", "FMG.AX", "TLS.AX", "RIO.AX"],
    SGX: ["D05.SI", "O39.SI", "U11.SI", "Z74.SI", "C38U.SI", "A17U.SI", "T82U.SI", "BS6.SI", "C09.SI", "V03.SI"],
    EURONEXT: ["MC.PA", "ASML.AS", "OR.PA", "RMS.PA", "SAN.PA", "TTE.PA", "HEIA.AS", "ABI.BR"],
    TWSE: ["2330.TW", "2317.TW", "2454.TW", "2308.TW", "2881.TW", "2882.TW"],
    KRX: ["005930.KS", "000660.KS", "005380.KS", "207940.KS", "068270.KS"],
    SSE: ["600519.SS", "601398.SS", "601318.SS"],
    SZSE: ["002594.SZ", "300750.SZ", "000651.SZ"],
    B3: ["PETR4.SA", "VALE3.SA", "ITUB4.SA", "BBDC4.SA"],
    BURSA: ["1155.KL", "1295.KL", "1023.KL"],
    INDEX: ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "^NSEI", "^BSESN", "^N225", "^HSI", "^FTSE", "^GDAXI"],
    COMMODITY: ["GC=F", "CL=F", "BZ=F", "NG=F", "SI=F", "HG=F"],
    FOREX: ["EURUSD=X", "USDJPY=X", "GBPUSD=X", "USDINR=X", "AUDUSD=X", "USDCAD=X"],
    CRYPTO: ["BTC-USD", "ETH-USD", "SOL-USD"]
  };

  const symbols = EXCHANGE_MOVER_MAP[exchange] || EXCHANGE_MOVER_MAP["US"];
  const quotes = await getQuotes(symbols);
  const liveQuotes = quotes.filter((q) => q.isLive || q.price > 0);

  // Widen the candidate pool beyond the ~10-15 hand-picked seed names above
  // with every locally-persisted symbol for this exchange -- for the equity
  // exchanges (not INDEX/COMMODITY/FOREX/CRYPTO, which are inherently small,
  // enumerable universes) this grows over time as users open more tickers.
  const seedSymbols = new Set(liveQuotes.map((q) => q.symbol));
  const candidates = ["INDEX", "COMMODITY", "FOREX", "CRYPTO"].includes(exchange)
    ? []
    : storedCandidatesForExchange(exchange, seedSymbols);

  const sorted = [...liveQuotes, ...candidates].sort((a, b) => {
    if (kind === "active") return b.volume - a.volume;
    if (kind === "gainers") return b.changePercent - a.changePercent;
    return a.changePercent - b.changePercent;
  });
  return sorted.slice(0, 10);
}

export async function getMarketSentiment() {
  const news = await getNews();
  if (!news.length) {
    return { sentiment: "Neutral", score: 50, bullish: 50, bearish: 50 };
  }

  const positive = news.filter((item) => item.sentiment === "positive").length;
  const negative = news.filter((item) => item.sentiment === "negative").length;
  const bullish = Math.round((positive / news.length) * 100);
  const bearish = Math.round((negative / news.length) * 100);
  const score = Math.round(Math.max(0, Math.min(100, 50 + ((positive - negative) / news.length) * 50)));
  const sentiment = bullish > bearish ? "Bullish" : bearish > bullish ? "Bearish" : "Neutral";
  return { sentiment, score, bullish, bearish };
}

function buildGoogleNewsSearchUrl(query: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}
function buildSymbolNewsFeeds(symbol: string): RssFeedConfig[] {
  return [
    { url: buildGoogleNewsSearchUrl(`${symbol} stock when:7d`), fallbackSource: "Google News" },
    { url: buildGoogleNewsSearchUrl(`${symbol} earnings when:30d`), fallbackSource: "Google News" },
  ];
}

function isoDateOnly(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : match[1];
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Build a deterministic Google News date window for a chained page. */
export function buildNewsWindowQuery(
  query: string,
  page = 1,
  options: Pick<NewsPageOptions, "from" | "to" | "windowDays"> = {},
): string {
  const boundedPage = Math.max(1, Math.floor(page));
  const windowDays = Math.min(Math.max(Math.floor(options.windowDays ?? 7), 1), 366);
  const explicitFrom = isoDateOnly(options.from);
  const explicitTo = isoDateOnly(options.to);
  const today = new Date().toISOString().slice(0, 10);
  const end = explicitTo ?? shiftDate(today, -(boundedPage - 1) * windowDays);
  const start = explicitFrom && boundedPage === 1
    ? explicitFrom
    : shiftDate(end, -windowDays);
  const withoutRelativeWindow = query.replace(/\bwhen:\d+[dwmy]\b/gi, "").replace(/\s+/g, " ").trim();
  const clauses = [withoutRelativeWindow, `after:${start}`, `before:${shiftDate(end, 1)}`].filter(Boolean);
  return clauses.join(" ");
}

function feedUrlForPage(url: string, page: number, options: NewsPageOptions): string {
  if (page <= 1 && !options.from && !options.to) return url;
  try {
    const parsed = new URL(url);
    const query = parsed.searchParams.get("q") ?? "";
    parsed.searchParams.set("q", buildNewsWindowQuery(query, page, options));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function dedupeNewsItems(items: NewsItem[]): NewsItem[] {
  return uniqueBy(items, (item) => item.url || `${item.title}|${item.publishedAt}`)
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt) || a.url.localeCompare(b.url));
}

async function fetchNewsFeeds(cacheKey: string, feeds: RssFeedConfig[], options: NewsPageOptions = {}) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pagedKey = `${cacheKey}:${page}:${options.from ?? ""}:${options.to ?? ""}:${options.windowDays ?? ""}`;
  const cached = getCached(newsCache, pagedKey);
  if (cached) return cached;

  const settled = await Promise.allSettled(feeds.map(async (feed) => {
    const xml = await fetchText(feedUrlForPage(feed.url, page, options));
    return parseNewsFeed(xml, feed.fallbackSource);
  }));

  const items = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const normalized = dedupeNewsItems(items);

  // Don't cache empty results — let the next request retry live feeds.
  if (!normalized.length) return [];
  return setCached(newsCache, pagedKey, normalized, NEWS_TTL_MS);
}

export async function getNewsPage(symbol?: string, query?: string, options: NewsPageOptions = {}): Promise<NewsPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100);
  const feeds = symbol ? buildSymbolNewsFeeds(symbol.toUpperCase()) : GENERAL_NEWS_FEEDS;
  const feedItems = await fetchNewsFeeds(symbol ? `news:${symbol.toUpperCase()}` : "news:market", feeds, { ...options, page });
  let items = feedItems;
  if (symbol) {
    const upper = symbol.toUpperCase();
    const profile = getProfileWithCryptoFallback(upper);
    const tokens = [upper, profile?.name?.split(" ")[0]].filter(Boolean).map((token) => String(token).toLowerCase());
    items = feedItems.filter((item) => {
      const haystack = `${item.title} ${item.summary}`.toLowerCase();
      return tokens.some((token) => haystack.includes(token));
    });
  }
  items = filterNewsItems(items, query);
  const pageItems = items.slice(0, limit);
  const explicitTo = isoDateOnly(options.to);
  const explicitFrom = isoDateOnly(options.from);
  const hasMore = items.length > limit || (items.length === limit && !explicitFrom);
  return {
    items: pageItems,
    page,
    limit,
    returnedCount: pageItems.length,
    knownCount: items.length,
    hasMore,
    nextCursor: hasMore ? String(page + 1) : null,
    coverage: hasMore ? "provider-total-unknown" : "window-exhausted",
    from: explicitFrom ?? null,
    to: explicitTo ?? null,
  };
}

async function getNewsFeedsLegacy(symbol: string | undefined): Promise<NewsItem[]> {
  const feeds = symbol ? buildSymbolNewsFeeds(symbol.toUpperCase()) : GENERAL_NEWS_FEEDS;
  const feedItems = await fetchNewsFeeds(symbol ? `news:${symbol.toUpperCase()}` : "news:market", feeds);
  if (!symbol) return feedItems;
  const upper = symbol.toUpperCase();
  const profile = getProfileWithCryptoFallback(upper);
  const tokens = [upper, profile?.name?.split(" ")[0]].filter(Boolean).map((token) => String(token).toLowerCase());
  return feedItems.filter((item) => {
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  });
}

export async function getNews(symbol?: string, query?: string): Promise<NewsItem[]> {
  return filterNewsItems(await getNewsFeedsLegacy(symbol), query);
}

export async function getNewsArticle(input: {
  url: string;
  title: string;
  source: string;
  feedProvider?: string;
  publishedAt: string;
  summary?: string;
}): Promise<NewsArticle> {
  const url = sanitizeArticleUrl(input.url);
  const cacheKey = `article:${url}`;
  const cached = getCached(articleCache, cacheKey);
  if (cached) return cached;

  const status = buildDataStatus({
    provider: input.feedProvider ?? input.source,
    freshness: "feed",
    asOf: input.publishedAt,
  });

  try {
    const html = await fetchText(url);
    const content = extractArticleContent(html);
    const article: NewsArticle = {
      title: input.title,
      source: input.source,
      feedProvider: input.feedProvider ?? input.source,
      url,
      publishedAt: input.publishedAt,
      excerpt: input.summary?.trim() || content[0] || "Read-through unavailable for this source.",
      content: content.length ? content : (input.summary ? [input.summary.trim()] : []),
      status,
    };
    return setCached(articleCache, cacheKey, article, ARTICLE_TTL_MS);
  } catch {
    const fallback: NewsArticle = {
      title: input.title,
      source: input.source,
      feedProvider: input.feedProvider ?? input.source,
      url,
      publishedAt: input.publishedAt,
      excerpt: input.summary?.trim() || "Read-through unavailable for this source.",
      content: input.summary?.trim() ? [input.summary.trim()] : [],
      status,
    };
    return setCached(articleCache, cacheKey, fallback, ARTICLE_TTL_MS);
  }
}

// Real sector+industry peer discovery -- replaces the old static 16-ticker
// PEER_MAP as the primary path. LSE's company-profile endpoint has real
// sector/industry per symbol (verified: AAPL -> Technology / Consumer
// Electronics), but there's no bulk "search by sector" endpoint, and its
// own coverage turned out to be US-centric (empirically verified: ~32%
// real-sector hit rate on a random US sample vs. ~3% on a matched
// international sample spanning LSE-exchange/TSE/SZSE/HKEX/SSE/NSE/BSE/
// XETRA/KRX/ASX/B3) and rate-capped at 100 calls/min account-wide.
//
// Primary universe: the `companies` DB table, bulk-backfilled from
// yfinance instead (script/fetch_sectors_yfinance.py for the general
// equity universe, script/fetch_bse_sectors_yfinance.py for BSE, written to
// the DB by script/backfill_sectors_to_db.ts) -- a live
// side-by-side test showed yfinance covers the same international sample
// at ~87.5% real, with no external account-wide rate cap (just a per-IP
// anti-abuse throttle, handled with real batch-level backoff in the fetch
// scripts). BSE numeric scrip codes (e.g. "500325.BO") return nothing from
// yfinance's metadata endpoint, but the SAME companies resolve perfectly by
// their real alphabetic ticker (e.g. "RELIANCE.BO") -- BSE's own official
// BhavCopy CSV supplies that numeric-to-alphabetic crosswalk directly, so
// fetch_bse_sectors_yfinance.py uses it rather than writing BSE off. This
// is a real, substantial expansion (168 -> tens of thousands of real rows)
// of the peer universe, not a claim of full ~67k-ticker coverage, which no
// single free data source can fully support.
//
// Falls back to the old small live-call SCREENER_UNIVERSE path when the DB
// table isn't populated yet (fresh install, backfill not yet run), and to
// the static PEER_MAP only when LSE isn't configured or nothing real
// matches either path -- a safety net for coverage gaps, not the primary
// path.
const peerDiscoveryCache = new Map<string, { expiresAt: number; value: string[] }>();
const PEER_DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;
let universeProfilesCache: { expiresAt: number; value: Array<{ symbol: string; sector: string; industry: string }> } | null = null;

// Below this row count, the DB backfill clearly hasn't been run yet (a
// completed backfill lands in the thousands) -- fall back to the smaller
// live-call universe rather than serving a near-empty peer pool.
const DB_UNIVERSE_MIN_ROWS = 50;

async function getUniverseProfiles(): Promise<Array<{ symbol: string; sector: string; industry: string }>> {
  if (universeProfilesCache && universeProfilesCache.expiresAt > Date.now()) return universeProfilesCache.value;

  const fromDb = await getCompaniesWithSectorIndustry().catch(() => []);
  if (fromDb.length >= DB_UNIVERSE_MIN_ROWS) {
    universeProfilesCache = { expiresAt: Date.now() + PEER_DISCOVERY_TTL_MS, value: fromDb };
    return fromDb;
  }

  const results = await Promise.all(SCREENER_UNIVERSE.map(async (sym) => {
    const profile = await getCompanyProfile(sym).catch(() => null);
    return profile?.sector ? { symbol: sym, sector: profile.sector, industry: profile.industry ?? "" } : null;
  }));
  const value = results.filter((r): r is { symbol: string; sector: string; industry: string } => !!r);
  universeProfilesCache = { expiresAt: Date.now() + PEER_DISCOVERY_TTL_MS, value };
  return value;
}

export async function getRealPeerSymbols(symbol: string, limit = 8): Promise<string[]> {
  const upper = symbol.toUpperCase();
  const cached = getCached(peerDiscoveryCache, upper);
  if (cached) return cached;

  if (!isLseConfigured()) return PEER_MAP[upper] ?? [];

  try {
    const universe = await getUniverseProfiles();

    // Prefer the target's own real sector/industry already in the DB
    // universe (avoids a redundant live call for symbols the backfill
    // already covers); fall back to a fresh live profile call otherwise.
    const targetFromDb = universe.find((u) => u.symbol === upper);
    const targetProfile = targetFromDb ?? (await getCompanyProfile(upper).catch(() => null));
    const targetSector = targetFromDb?.sector ?? targetProfile?.sector;
    const targetIndustry = targetFromDb?.industry ?? (targetProfile && "industry" in targetProfile ? targetProfile.industry : undefined);
    if (!targetSector) return PEER_MAP[upper] ?? [];

    const sameIndustry = universe.filter((u) => u.symbol !== upper && u.industry && u.industry === targetIndustry);
    const sameSector = universe.filter((u) => u.symbol !== upper && u.sector === targetSector);
    const picked = (sameIndustry.length >= 3 ? sameIndustry : sameSector).slice(0, limit).map((u) => u.symbol);

    const result = picked.length > 0 ? picked : (PEER_MAP[upper] ?? []);
    return setCached(peerDiscoveryCache, upper, result, PEER_DISCOVERY_TTL_MS);
  } catch {
    return PEER_MAP[upper] ?? [];
  }
}

export async function getPeers(symbol: string) {
  const upper = symbol.toUpperCase();
  const realPeers = await getRealPeerSymbols(upper);
  return getQuotes(realPeers.length > 0 ? realPeers : ["AAPL", "MSFT", "GOOGL", "AMZN", "META"]);
}

const screenerUniverseCache = new Map<string, { expiresAt: number; value: Quote[] }>();
const SCREENER_UNIVERSE_TTL_MS = 90_000;

export interface ScreenerPage {
  items: Quote[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ScreenerFilters {
  sector?: string;
  minPe?: string;
  maxPe?: string;
  dynamicField?: string;
  dynamicOperator?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  dynamicValue?: string;
  page?: number;
  limit?: number;
}

export function filterAndPageScreenerResults(results: Quote[], filters: ScreenerFilters): ScreenerPage {
  let filtered = results;
  if (filters.sector && filters.sector !== "All") filtered = filtered.filter((quote) => quote.sector === filters.sector);
  const minPe = filters.minPe ? Number(filters.minPe) : null;
  const maxPe = filters.maxPe ? Number(filters.maxPe) : null;
  if (minPe !== null && Number.isFinite(minPe)) filtered = filtered.filter((quote) => quote.pe !== null && quote.pe >= minPe);
  if (maxPe !== null && Number.isFinite(maxPe)) filtered = filtered.filter((quote) => quote.pe !== null && quote.pe <= maxPe);

  // Wave C dynamic screener fields are deliberately allowlisted to quote
  // primitives. Provider-specific fundamentals still remain explicit rather
  // than being guessed from a thin quote response.
  const dynamicFieldMap: Record<string, keyof Quote> = {
    "market_data.price": "price",
    "market_data.marketCap": "marketCap",
    "market_data.volume": "volume",
    "market_data.peRatio": "pe",
    "financial_statements.eps": "eps",
    "metric.pe": "pe",
    "metric.epsBasic": "eps",
    "metric.epsDiluted": "eps",
  };
  const dynamicKey = filters.dynamicField ? dynamicFieldMap[filters.dynamicField] : undefined;
  const dynamicValue = filters.dynamicValue === undefined ? NaN : Number(filters.dynamicValue);
  const dynamicOperator = filters.dynamicOperator ?? "gte";
  if (dynamicKey && Number.isFinite(dynamicValue)) {
    filtered = filtered.filter((quote) => {
      const raw = quote[dynamicKey];
      if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
      switch (dynamicOperator) {
        case "eq": return raw === dynamicValue;
        case "neq": return raw !== dynamicValue;
        case "gt": return raw > dynamicValue;
        case "lt": return raw < dynamicValue;
        case "lte": return raw <= dynamicValue;
        case "gte": return raw >= dynamicValue;
      }
    });
  }

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const limit = Math.min(Math.max(Math.floor(filters.limit ?? 50), 1), 200);
  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);
  return { items, page, limit, total: filtered.length, hasMore: start + items.length < filtered.length };
}

async function loadScreenerUniverse(): Promise<Quote[]> {
  const cached = getCached(screenerUniverseCache, "universe");
  if (cached) return cached;

  // The company master is the authoritative backed universe. Keep the small
  // catalog only as a fresh-install fallback; never invent fundamentals for
  // DB rows whose quote provider returned null.
  const dbUniverse = await getCompaniesWithSectorIndustry().catch(() => []);
  const symbols = dbUniverse.length >= DB_UNIVERSE_MIN_ROWS
    ? dbUniverse.map((row) => row.symbol)
    : SCREENER_UNIVERSE;
  const dbProfiles = new Map(dbUniverse.map((row) => [row.symbol.toUpperCase(), row]));
  const quotes = await getQuotes(symbols);
  const results = quotes.map((quote) => {
    const profile = dbProfiles.get(quote.symbol.toUpperCase());
    return profile?.sector && !quote.sector ? { ...quote, sector: profile.sector } : quote;
  });
  setCached(screenerUniverseCache, "universe", results, SCREENER_UNIVERSE_TTL_MS);
  return results;
}

export async function getScreenerPage(filters: ScreenerFilters = {}): Promise<ScreenerPage> {
  return filterAndPageScreenerResults(await loadScreenerUniverse(), filters);
}

/** Backwards-compatible array response for existing screener consumers. */
export async function getScreenerResults(filters: ScreenerFilters = {}): Promise<Quote[]> {
  return (await getScreenerPage(filters)).items;
}

export async function getEconomicsSnapshot() {
  const [indicators, forex, commodities] = await Promise.all([
    getIndicatorQuotes(["GDPC1", "CPIAUCSL", "UNRATE", "FEDFUNDS", "DGS10", "DGS2", "DGS30"]),
    getForexQuotes(),
    getQuotes(["GC=F", "CL=F"]).catch(() => []),
  ]);
  const indicatorById = new Map(indicators.map((q) => [q.seriesId, q]));
  const forexByPair = new Map(forex.map((q) => [q.pair, q]));
  const gold = commodities.find((item) => item.symbol === "GC=F");
  const oil = commodities.find((item) => item.symbol === "CL=F");

  const fromIndicator = (seriesId: string, label: string, unit: string) => {
    const q = indicatorById.get(seriesId);
    return { value: q?.value ?? null, prev: q?.previousValue ?? null, label, unit };
  };
  // ForexQuote doesn't carry a separate previousClose field; it derives
  // cleanly from the already-real rate/change pair (change = rate - prev).
  const fromForex = (pair: string, label: string) => {
    const q = forexByPair.get(pair);
    const prev = q && q.rate !== null && q.change !== null ? round(q.rate - q.change, 6) : null;
    return { value: q?.rate ?? null, prev, label, unit: "" };
  };
  const fromCommodity = (quote: Quote | undefined, label: string) => ({
    value: quote ? round(quote.price, 2) : null,
    prev: quote ? round(quote.previousClose, 2) : null,
    label,
    unit: "",
  });

  const anyLive = indicators.some((q) => q.isLive) || forex.some((q) => q.isLive) || Boolean(gold?.isLive) || Boolean(oil?.isLive);

  return {
    // GDPC1/CPIAUCSL are raw FRED levels (chained-dollar GDP, CPI index),
    // not growth/inflation rates -- labeled and unit-tagged to match what
    // the series actually is rather than implying a %/YoY transform this
    // fetch doesn't perform. UNRATE/FEDFUNDS/DGSxx are already published as
    // percentages, so those labels are unchanged.
    gdp: fromIndicator("GDPC1", "Real GDP", "$B (chained 2017)"),
    cpi: fromIndicator("CPIAUCSL", "Consumer Price Index (CPI)", "Index"),
    unemployment: fromIndicator("UNRATE", "Unemployment Rate", "%"),
    fedFunds: fromIndicator("FEDFUNDS", "Federal Funds Rate", "%"),
    t10y: fromIndicator("DGS10", "10Y Treasury Yield", "%"),
    t2y: fromIndicator("DGS2", "2Y Treasury Yield", "%"),
    t30y: fromIndicator("DGS30", "30Y Treasury Yield", "%"),
    // No connected DXY source yet -- explicitly unavailable rather than a
    // fabricated index level.
    dolllarIndex: { value: null, prev: null, label: "USD Index (DXY)", unit: "" },
    eurUsd: fromForex("EURUSD=X", "EUR/USD"),
    gbpUsd: fromForex("GBPUSD=X", "GBP/USD"),
    usdJpy: fromForex("USDJPY=X", "USD/JPY"),
    gold: fromCommodity(gold, "Gold ($/oz)"),
    oil: fromCommodity(oil, "WTI Crude ($/bbl)"),
    status: buildDataStatus({
      provider: "mixed",
      freshness: anyLive ? "snapshot" : "reference",
      isFallback: !anyLive,
      delayLabel: anyLive ? "Snapshot / mixed-source view" : "Live macro sources unavailable",
    }),
  };
}

// ─── Earnings Calendar ────────────────────────────────────────────────────────
export interface EarningsEvent {
  symbol: string;
  name: string;
  date: string;
  time: "before" | "after" | "unknown";
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  quarter: string;
  region: "US" | "IN" | "JP" | "HK";
}

export function getEarningsCalendar(): EarningsEvent[] {
  // Earnings data remains unavailable until a verified provider is configured.
  return [];
}

// ─── Forex Quotes ─────────────────────────────────────────────────────────────
export interface ForexQuote {
  pair: string;
  base: string;
  quote: string;
  rate: number | null;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
  label: string;
  isLive: boolean;
  status: DataStatus;
}

const FX_PAIRS_DEF = [
  { pair: "EURUSD=X", base: "EUR", quote: "USD", label: "EUR / USD" },
  { pair: "GBPUSD=X", base: "GBP", quote: "USD", label: "GBP / USD" },
  { pair: "USDJPY=X", base: "USD", quote: "JPY", label: "USD / JPY" },
  { pair: "USDINR=X", base: "USD", quote: "INR", label: "USD / INR" },
  { pair: "AUDUSD=X", base: "AUD", quote: "USD", label: "AUD / USD" },
  { pair: "USDCNY=X", base: "USD", quote: "CNY", label: "USD / CNY" },
  { pair: "GBPINR=X", base: "GBP", quote: "INR", label: "GBP / INR" },
  { pair: "EURINR=X", base: "EUR", quote: "INR", label: "EUR / INR" },
  { pair: "USDSGD=X", base: "USD", quote: "SGD", label: "USD / SGD" },
  { pair: "USDHKD=X", base: "USD", quote: "HKD", label: "USD / HKD" },
];

// Governed Yahoo FX quote cache (2 min TTL)
const fxCache = new Map<string, { expiresAt: number; value: ForexQuote }>();
const FX_TTL_MS = 2 * 60 * 1000;
const FX_UNAVAILABLE_TTL_MS = 30_000;

function unavailableForexQuote(def: (typeof FX_PAIRS_DEF)[number], delayLabel: string): ForexQuote {
  return {
    pair: def.pair,
    base: def.base,
    quote: def.quote,
    label: def.label,
    rate: null,
    change: null,
    changePercent: null,
    high: null,
    low: null,
    isLive: false,
    status: buildDataStatus({ provider: "unavailable", freshness: "reference", isFallback: true, delayLabel }),
  };
}

async function fetchYahooFxPair(
  def: (typeof FX_PAIRS_DEF)[number],
  marketScope: ResolvedMarketDataScope,
): Promise<ForexQuote> {
  const cacheKey = marketDataCacheKey(`fx:${def.pair}`, marketScope);
  const cached = getCached(fxCache, cacheKey);
  if (cached) return cached;

  if (!isMarketDataProviderAuthorized("yahoo_finance", marketScope)) {
    return setCached(
      fxCache,
      cacheKey,
      unavailableForexQuote(def, "Yahoo Finance is not selected or community consent is unavailable."),
      FX_UNAVAILABLE_TTL_MS,
    );
  }

  try {
    const payload = await fetchJson<YahooChartResponse>(
      `${YAHOO_FINANCE_BASE_URL}/v8/finance/chart/${encodeURIComponent(def.pair)}?interval=1d&range=2d`,
    );

    const result0 = payload.chart?.result?.[0];
    const meta = result0?.meta;
    const rate = meta?.regularMarketPrice;

    if (!rate || rate === 0) {
      throw new Error(`Yahoo returned zero for ${def.pair}`);
    }

    const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
    const change = typeof prev === "number" ? rate - prev : null;
    const changePct = typeof prev === "number" && prev > 0 && change !== null ? (change / prev) * 100 : null;

    const result: ForexQuote = {
      pair: def.pair,
      base: def.base,
      quote: def.quote,
      label: def.label,
      rate: round(rate, 6),
      change: change !== null ? round(change, 6) : null,
      changePercent: changePct !== null ? round(changePct, 4) : null,
      high: typeof meta?.regularMarketDayHigh === "number" ? meta.regularMarketDayHigh : null,
      low: typeof meta?.regularMarketDayLow === "number" ? meta.regularMarketDayLow : null,
      isLive: true,
      status: buildDataStatus({ provider: "Yahoo Finance", freshness: "current" }),
    };
    return setCached(fxCache, cacheKey, result, FX_TTL_MS);
  } catch {
    return setCached(fxCache, cacheKey, unavailableForexQuote(def, "Live FX quote unavailable."), FX_UNAVAILABLE_TTL_MS);
  }
}

export async function getForexQuotes(): Promise<ForexQuote[]> {
  const marketScope = resolveMarketDataScope();
  const results = await Promise.allSettled(FX_PAIRS_DEF.map((def) => fetchYahooFxPair(def, marketScope)));
  return results.map((r, i) => r.status === "fulfilled" ? r.value : unavailableForexQuote(FX_PAIRS_DEF[i], "Live FX quote unavailable."));
}

// ── Market Breadth (Advance/Decline, New Highs/Lows, Arms Index, McClellan) ─
// Classic breadth indicators, computed over a fixed, liquid, all-US-listed
// large-cap universe -- these indicators fundamentally need one shared
// trading calendar ("advances vs declines" on a day both markets are closed
// is meaningless), so mixing exchanges would corrupt the count. 35 names is
// small enough to fetch on every cache miss (each already disk-cached via
// getOHLCV) while still being a representative cross-section of US large caps
// spanning tech/financials/healthcare/energy/consumer/industrials.
const BREADTH_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META", "BRK-B",
  "JPM", "BAC", "GS", "V", "MA", "XOM", "CVX", "UNH", "JNJ", "PFE",
  "KO", "PEP", "WMT", "HD", "DIS", "NFLX", "CRM", "ADBE", "PYPL",
  "AMD", "INTC", "QCOM", "TXN", "AVGO", "MU", "AMAT", "ASML",
];

export interface BreadthDailyPoint {
  date: string;
  advances: number;
  declines: number;
  unchanged: number;
  netAdvances: number;
  advanceDeclineLine: number;
  newHighs: number;
  newLows: number;
  mcClellanOscillator: number | null;
}

export interface MarketBreadthResult {
  universeSize: number;
  series: BreadthDailyPoint[];
  latest: {
    date: string;
    advances: number;
    declines: number;
    unchanged: number;
    newHighs: number;
    newLows: number;
    armsIndex: number | null;
    mcClellanOscillator: number | null;
  } | null;
  // No live options-volume data source exists anywhere in this app (verified
  // -- OptionsPanel is a Black-Scholes theoretical pricer, not a real chain
  // feed), so Put/Call Ratio is honestly reported as unavailable rather than
  // fabricated from a proxy.
  putCallRatio: null;
}

const breadthCache = new Map<string, { expiresAt: number; value: MarketBreadthResult }>();
const BREADTH_TTL_MS = 5 * 60 * 1000;

function emaSeries(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  result[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

export async function getMarketBreadth(): Promise<MarketBreadthResult> {
  const cached = getCached(breadthCache, "us");
  if (cached) return cached;

  const histories = await mapWithConcurrency(BREADTH_UNIVERSE, 8, (symbol) =>
    getOHLCV(symbol, "1Y", "1d").catch(() => [] as OHLCVBar[]));

  const valid = histories
    .map((bars, i) => ({ symbol: BREADTH_UNIVERSE[i], bars }))
    .filter((h) => h.bars.length > 30);

  if (valid.length < 10) {
    return { universeSize: valid.length, series: [], latest: null, putCallRatio: null };
  }

  // Per symbol: date -> bar, plus a same-length running-high/running-low
  // array (single pass, chronological) so the new-high/new-low check below
  // is an O(1) lookup per (symbol, day) instead of re-scanning history.
  const perSymbol = valid.map(({ bars }) => {
    const byDate = new Map(bars.map((b) => [b.date, b]));
    const runningHigh: number[] = [];
    const runningLow: number[] = [];
    let hi = -Infinity, lo = Infinity;
    for (const b of bars) {
      hi = Math.max(hi, b.close);
      lo = Math.min(lo, b.close);
      runningHigh.push(hi);
      runningLow.push(lo);
    }
    const dateIndex = new Map(bars.map((b, i) => [b.date, i]));
    return { bars, byDate, runningHigh, runningLow, dateIndex };
  });

  // Inner-join: only dates present across every valid symbol count toward
  // advances/declines, so the universe size is consistent day to day.
  const dateCounts = new Map<string, number>();
  for (const s of perSymbol) for (const b of s.bars) dateCounts.set(b.date, (dateCounts.get(b.date) ?? 0) + 1);
  const commonDates = Array.from(dateCounts.entries())
    .filter(([, count]) => count === perSymbol.length)
    .map(([date]) => date)
    .sort();

  if (commonDates.length < 30) {
    return { universeSize: valid.length, series: [], latest: null, putCallRatio: null };
  }

  const netAdvancesSeries: number[] = [];
  const dailyPoints: Omit<BreadthDailyPoint, "mcClellanOscillator">[] = [];
  let runningADLine = 0;
  let lastAdvVolume = 0, lastDeclVolume = 0;

  for (let i = 1; i < commonDates.length; i++) {
    const date = commonDates[i];
    const prevDate = commonDates[i - 1];
    let advances = 0, declines = 0, unchanged = 0, newHighs = 0, newLows = 0;
    let advVolume = 0, declVolume = 0;

    for (const s of perSymbol) {
      const today = s.byDate.get(date);
      const prev = s.byDate.get(prevDate);
      if (!today || !prev) continue;
      if (today.close > prev.close) { advances++; advVolume += today.volume; }
      else if (today.close < prev.close) { declines++; declVolume += today.volume; }
      else unchanged++;

      const idx = s.dateIndex.get(date)!;
      if (today.close >= s.runningHigh[idx]) newHighs++;
      if (today.close <= s.runningLow[idx]) newLows++;
    }

    const netAdvances = advances - declines;
    netAdvancesSeries.push(netAdvances);
    runningADLine += netAdvances;
    lastAdvVolume = advVolume; lastDeclVolume = declVolume;
    dailyPoints.push({ date, advances, declines, unchanged, netAdvances, advanceDeclineLine: runningADLine, newHighs, newLows });
  }

  const ema19 = emaSeries(netAdvancesSeries, 19);
  const ema39 = emaSeries(netAdvancesSeries, 39);
  const series: BreadthDailyPoint[] = dailyPoints.map((point, i) => ({
    ...point,
    mcClellanOscillator: ema19[i] !== null && ema39[i] !== null ? (ema19[i] as number) - (ema39[i] as number) : null,
  }));

  // McClellan's EMA39 warm-up needs the full fetched year; nobody wants to
  // look at a 1-year advance/decline chart, so only the recent window ships.
  const trimmed = series.slice(-90);
  const last = series[series.length - 1] ?? null;

  const advDeclRatio = last && last.declines > 0 ? last.advances / last.declines : null;
  const volRatio = lastDeclVolume > 0 ? lastAdvVolume / lastDeclVolume : null;
  const armsIndex = advDeclRatio !== null && volRatio !== null && volRatio > 0 ? advDeclRatio / volRatio : null;

  const result: MarketBreadthResult = {
    universeSize: valid.length,
    series: trimmed,
    latest: last ? {
      date: last.date, advances: last.advances, declines: last.declines, unchanged: last.unchanged,
      newHighs: last.newHighs, newLows: last.newLows, armsIndex, mcClellanOscillator: last.mcClellanOscillator,
    } : null,
    putCallRatio: null,
  };

  return setCached(breadthCache, "us", result, BREADTH_TTL_MS);
}
