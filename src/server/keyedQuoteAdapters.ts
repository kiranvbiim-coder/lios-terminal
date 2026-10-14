/**
 * Generic base for keyed commercial market-data providers: any provider
 * whose free tier this app doesn't already have a bespoke integration for
 * (unlike LSE, FRED, or Finnhub, which have their own dedicated modules).
 *
 * The point of this file is the *base*, not any one provider: implement
 * `KeyedQuoteAdapter`, add the instance to `KEYED_QUOTE_ADAPTERS`, and a
 * key saved in the Data Connection Center becomes an executable source.
 * Runtime routing still respects the user's selected connector IDs and the
 * quota policy in `marketData.ts`: keyed adapters are automatic fallbacks
 * for single-symbol Quote/Chart/calculation workflows, never for bulk
 * ticker tapes or screeners that could exhaust a free-tier quota in one
 * render.
 *
 * Every adapter here does a real HTTP call against the provider's actual
 * publicly documented endpoint and maps its actual documented response
 * shape -- there is no synthetic/placeholder data path. What's genuinely
 * unverified without a live key is whether a given account's specific plan
 * still matches the publicly documented free-tier response (vendors do
 * change these); `resolveCredential`'s absence of a key is the only case
 * that's silently skipped, everything else fails loudly to the next layer.
 */
import { getCredential } from "./terminalConfig";
import { recordConnectorVerification } from "./connectorVerification";
import { resolveFamilyProviderOrder } from "./dataStackService";
import type { DataStackPin } from "@shared/dataStackPins";

export interface KeyedQuoteSnapshot {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string;
  time: string;
  currency?: string;
}

export interface KeyedOhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KeyedQuoteAdapter {
  id: string;
  label: string;
  /** Equity-only, crypto-only, or both -- callers filter by this before trying an adapter. */
  assetClasses: Array<"equity" | "crypto">;
  isAvailable(): boolean;
  fetchQuote(symbol: string): Promise<KeyedQuoteSnapshot | null>;
  fetchOHLCV?(symbol: string, days: number): Promise<KeyedOhlcvBar[] | null>;
}

// A provider that just rate-limited us shouldn't be hammered again on the
// very next symbol in the same batch -- that burns the rest of a 5-call/min
// or 25-call/day quota on requests already known to fail. Cooldown is
// process-local and resets on restart, matching every other in-memory cache
// in this file (historyCache, quoteCache, etc.) rather than persisting a
// vendor-specific outage as durable state.
const cooldownUntil = new Map<string, number>();

interface ProviderQuotaPolicy { perMinute?: number; perDay?: number }
const PROVIDER_QUOTAS: Record<string, ProviderQuotaPolicy> = {
  // Public/free-plan limits documented in shared/connectorRegistry.ts and
  // the provider blocks below. Conservative local guards protect the user's
  // key; they do not claim to replace the provider's authoritative meter.
  twelve_data: { perMinute: 8, perDay: 800 },
  polygon: { perMinute: 5 },
  alpha_vantage: { perMinute: 5, perDay: 25 },
  coinmarketcap: { perMinute: 5, perDay: 333 },
};
const requestStartedAt = new Map<string, number[]>();

function reserveProviderRequest(id: string): void {
  const policy = PROVIDER_QUOTAS[id];
  if (!policy) return;
  const now = Date.now();
  const dayStart = now - 24 * 60 * 60_000;
  const minuteStart = now - 60_000;
  const timestamps = (requestStartedAt.get(id) ?? []).filter((timestamp) => timestamp > dayStart);
  if (policy.perDay !== undefined && timestamps.length >= policy.perDay) {
    throw new Error(`${id} local daily request budget exhausted`);
  }
  if (policy.perMinute !== undefined && timestamps.filter((timestamp) => timestamp > minuteStart).length >= policy.perMinute) {
    throw new Error(`${id} local minute request budget exhausted`);
  }
  timestamps.push(now);
  requestStartedAt.set(id, timestamps);
}

/** Test-only state reset; not used by runtime code. */
export function resetKeyedAdapterExecutionStateForTests(): void {
  cooldownUntil.clear();
  requestStartedAt.clear();
}
const COOLDOWN_MS = 60 * 60_000;

function isCoolingDown(id: string): boolean {
  const until = cooldownUntil.get(id);
  return typeof until === "number" && until > Date.now();
}

export function isAdapterCoolingDown(id: string): boolean {
  return isCoolingDown(id);
}

function startCooldown(id: string): void {
  cooldownUntil.set(id, Date.now() + COOLDOWN_MS);
}

// Deliberately not `fetchWithRetry`: that helper retries 429s with backoff,
// which is the right behavior for free/unlimited endpoints (Yahoo, Stooq)
// but the wrong one for a strictly-quota-limited keyed API -- retrying a
// rate limit just burns more of a 25-request/day budget on requests
// already known to fail. A single attempt, with the 429 itself starting
// this adapter's cooldown, is copied per-adapter into `startCooldown`.
async function getJson<T>(url: string, adapterId: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  reserveProviderRequest(adapterId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json", ...extraHeaders }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    startCooldown(adapterId);
    recordConnectorVerification(adapterId, false, `${adapterId} rate-limited (429).`);
    throw new Error(`${adapterId} rate-limited (429)`);
  }
  if (!res.ok) {
    recordConnectorVerification(adapterId, false, `${adapterId} request failed: ${res.status} ${res.statusText}`);
    throw new Error(`${adapterId} request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as T;
  recordConnectorVerification(adapterId, true, `${adapterId} responded to a live request.`);
  return body;
}

function todayParts(): { date: string; time: string } {
  const now = new Date();
  return { date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 19) };
}

// ── Alpha Vantage ───────────────────────────────────────────────────────
// https://www.alphavantage.co/documentation/#latestprice (GLOBAL_QUOTE)
// Free tier: 25 requests/day -- the tightest quota of any adapter here, so
// it's deliberately last in KEYED_QUOTE_ADAPTERS.
interface AlphaVantageGlobalQuote {
  "Global Quote"?: {
    "01. symbol"?: string;
    "02. open"?: string;
    "03. high"?: string;
    "04. low"?: string;
    "05. price"?: string;
    "06. volume"?: string;
    "07. latest trading day"?: string;
    "08. previous close"?: string;
  };
}
const alphaVantageAdapter: KeyedQuoteAdapter = {
  id: "alpha_vantage",
  label: "Alpha Vantage",
  assetClasses: ["equity"],
  isAvailable: () => getCredential("ALPHA_VANTAGE_API_KEY", "alphaVantageApiKey") !== null && !isCoolingDown("alpha_vantage"),
  async fetchQuote(symbol) {
    const apiKey = getCredential("ALPHA_VANTAGE_API_KEY", "alphaVantageApiKey");
    if (!apiKey) return null;
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const payload = await getJson<AlphaVantageGlobalQuote>(url, "alpha_vantage");
    const q = payload["Global Quote"];
    const close = Number(q?.["05. price"]);
    if (!q || !Number.isFinite(close) || close <= 0) return null;
    const { date, time } = todayParts();
    return {
      open: Number(q["02. open"]) || close,
      high: Number(q["03. high"]) || close,
      low: Number(q["04. low"]) || close,
      close,
      volume: Number(q["06. volume"]) || 0,
      date: q["07. latest trading day"] || date,
      time,
    };
  },
};

// ── Twelve Data ─────────────────────────────────────────────────────────
// https://twelvedata.com/docs#quote -- verified against a real live response
// during setup (2026-08-29): {"symbol":"AAPL","open":"317.09",...}. Free
// tier: 800 requests/day, 8/minute.
interface TwelveDataQuote {
  symbol?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  datetime?: string;
  currency?: string;
  status?: string;
  message?: string;
}
interface TwelveDataTimeSeries {
  status?: string;
  message?: string;
  values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
}
const twelveDataAdapter: KeyedQuoteAdapter = {
  id: "twelve_data",
  label: "Twelve Data",
  assetClasses: ["equity"],
  isAvailable: () => getCredential("TWELVE_DATA_API_KEY", "twelveDataApiKey") !== null && !isCoolingDown("twelve_data"),
  async fetchQuote(symbol) {
    const apiKey = getCredential("TWELVE_DATA_API_KEY", "twelveDataApiKey");
    if (!apiKey) return null;
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const payload = await getJson<TwelveDataQuote>(url, "twelve_data");
    if (payload.status === "error") return null;
    const close = Number(payload.close);
    if (!Number.isFinite(close) || close <= 0) return null;
    const { date, time } = todayParts();
    return {
      open: Number(payload.open) || close,
      high: Number(payload.high) || close,
      low: Number(payload.low) || close,
      close,
      volume: Number(payload.volume) || 0,
      date: payload.datetime || date,
      time,
      currency: payload.currency,
    };
  },
  async fetchOHLCV(symbol, days) {
    const apiKey = getCredential("TWELVE_DATA_API_KEY", "twelveDataApiKey");
    if (!apiKey) return null;
    const outputsize = Math.min(Math.max(Math.ceil(days * 1.5), 30), 5000);
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&order=ASC&apikey=${apiKey}`;
    const payload = await getJson<TwelveDataTimeSeries>(url, "twelve_data");
    if (payload.status === "error" || !payload.values?.length) return null;
    return payload.values.flatMap((bar) => {
      const open = Number(bar.open);
      const high = Number(bar.high);
      const low = Number(bar.low);
      const close = Number(bar.close);
      if (![open, high, low, close].every(Number.isFinite)) return [];
      return [{ date: bar.datetime.slice(0, 10), open, high, low, close, volume: Number(bar.volume) || 0 }];
    });
  },
};

// ── Tiingo ──────────────────────────────────────────────────────────────
// https://www.tiingo.com/documentation/iex -- REST top-of-book snapshot
// (not the websocket feed). Free tier covers US equities/ETFs.
interface TiingoIexQuote {
  last?: number;
  tngoLast?: number;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  volume?: number;
  timestamp?: string;
  quoteTimestamp?: string;
}
const tiingoAdapter: KeyedQuoteAdapter = {
  id: "tiingo",
  label: "Tiingo",
  assetClasses: ["equity"],
  isAvailable: () => getCredential("TIINGO_API_KEY", "tiingoApiKey") !== null && !isCoolingDown("tiingo"),
  async fetchQuote(symbol) {
    const apiKey = getCredential("TIINGO_API_KEY", "tiingoApiKey");
    if (!apiKey) return null;
    const url = `https://api.tiingo.com/iex/${encodeURIComponent(symbol)}?token=${apiKey}`;
    const payload = await getJson<TiingoIexQuote[] | TiingoIexQuote>(url, "tiingo");
    const q = Array.isArray(payload) ? payload[0] : payload;
    const close = Number(q?.tngoLast ?? q?.last);
    if (!q || !Number.isFinite(close) || close <= 0) return null;
    const stamp = q.quoteTimestamp ?? q.timestamp;
    const { date: fallbackDate, time: fallbackTime } = todayParts();
    return {
      open: Number(q.open) || close,
      high: Number(q.high) || close,
      low: Number(q.low) || close,
      close,
      volume: Number(q.volume) || 0,
      date: stamp ? stamp.slice(0, 10) : fallbackDate,
      time: stamp ? stamp.slice(11, 19) : fallbackTime,
    };
  },
  async fetchOHLCV(symbol, days) {
    const apiKey = getCredential("TIINGO_API_KEY", "tiingoApiKey");
    if (!apiKey) return null;
    const startDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${startDate}&token=${apiKey}`;
    const payload = await getJson<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>(url, "tiingo");
    if (!Array.isArray(payload) || !payload.length) return null;
    return payload.map((bar) => ({ date: bar.date.slice(0, 10), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  },
};

// ── EODHD ───────────────────────────────────────────────────────────────
// https://eodhd.com/financial-apis/live-realtime-stocks-api/
// Ticker must carry an exchange suffix (e.g. AAPL.US) -- appended here for
// bare US symbols since that's this app's dominant symbol shape; a symbol
// that already carries a different suffix (e.g. .L, .NS) is passed through
// unchanged so EODHD's own exchange codes still resolve.
interface EodhdRealtimeQuote {
  code?: string;
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  previousClose?: number;
}
function eodhdTicker(symbol: string): string {
  return symbol.includes(".") ? symbol : `${symbol}.US`;
}
const eodhdAdapter: KeyedQuoteAdapter = {
  id: "eodhd",
  label: "EODHD",
  assetClasses: ["equity"],
  isAvailable: () => getCredential("EODHD_API_KEY", "eodhdApiKey") !== null && !isCoolingDown("eodhd"),
  async fetchQuote(symbol) {
    const apiKey = getCredential("EODHD_API_KEY", "eodhdApiKey");
    if (!apiKey) return null;
    const url = `https://eodhd.com/api/real-time/${encodeURIComponent(eodhdTicker(symbol))}?api_token=${apiKey}&fmt=json`;
    const payload = await getJson<EodhdRealtimeQuote>(url, "eodhd");
    const close = Number(payload.close);
    if (!Number.isFinite(close) || close <= 0) return null;
    const stamp = Number.isFinite(payload.timestamp) ? new Date(Number(payload.timestamp) * 1000) : new Date();
    return {
      open: Number(payload.open) || close,
      high: Number(payload.high) || close,
      low: Number(payload.low) || close,
      close,
      volume: Number(payload.volume) || 0,
      date: stamp.toISOString().slice(0, 10),
      time: stamp.toISOString().slice(11, 19),
    };
  },
  async fetchOHLCV(symbol, days) {
    const apiKey = getCredential("EODHD_API_KEY", "eodhdApiKey");
    if (!apiKey) return null;
    const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const url = `https://eodhd.com/api/eod/${encodeURIComponent(eodhdTicker(symbol))}?api_token=${apiKey}&fmt=json&from=${fromDate}`;
    const payload = await getJson<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>(url, "eodhd");
    if (!Array.isArray(payload) || !payload.length) return null;
    return payload.map((bar) => ({ date: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }));
  },
};

// ── Polygon.io ──────────────────────────────────────────────────────────
// https://polygon.io/docs/rest/stocks/aggregates/previous-day-bar
// Free tier: 5 calls/minute, so this is a genuinely last-resort adapter.
interface PolygonPrevAggs {
  results?: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>;
}
const polygonAdapter: KeyedQuoteAdapter = {
  id: "polygon",
  label: "Polygon.io",
  assetClasses: ["equity"],
  isAvailable: () => getCredential("POLYGON_API_KEY", "polygonApiKey") !== null && !isCoolingDown("polygon"),
  async fetchQuote(symbol) {
    const apiKey = getCredential("POLYGON_API_KEY", "polygonApiKey");
    if (!apiKey) return null;
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true&apiKey=${apiKey}`;
    const payload = await getJson<PolygonPrevAggs>(url, "polygon");
    const bar = payload.results?.[0];
    if (!bar || !Number.isFinite(bar.c) || bar.c <= 0) return null;
    const stamp = new Date(bar.t);
    return {
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      date: stamp.toISOString().slice(0, 10),
      time: stamp.toISOString().slice(11, 19),
    };
  },
};

// ── CoinMarketCap (crypto only) ─────────────────────────────────────────
// https://coinmarketcap.com/api/documentation/v1/#operation/getV1CryptocurrencyQuotesLatest
// Free tier: 333 calls/day (10k credits/month). Header-based auth, not a
// query param, and the symbol must be the bare ticker (BTC, not BTC-USD).
interface CoinMarketCapQuotes {
  data?: Record<string, { quote?: { USD?: { price?: number; volume_24h?: number; percent_change_24h?: number; last_updated?: string } } }>;
}
function cmcSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/-USD$/, "").replace(/USD$/, "");
}
const coinMarketCapAdapter: KeyedQuoteAdapter = {
  id: "coinmarketcap",
  label: "CoinMarketCap",
  assetClasses: ["crypto"],
  isAvailable: () => getCredential("COINMARKETCAP_API_KEY", "coinmarketcapApiKey") !== null && !isCoolingDown("coinmarketcap"),
  async fetchQuote(symbol) {
    const apiKey = getCredential("COINMARKETCAP_API_KEY", "coinmarketcapApiKey");
    if (!apiKey) return null;
    const ticker = cmcSymbol(symbol);
    const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(ticker)}`;
    const payload = await getJson<CoinMarketCapQuotes>(url, "coinmarketcap", { "X-CMC_PRO_API_KEY": apiKey });
    const usd = payload.data?.[ticker]?.quote?.USD;
    const close = usd?.price;
    if (!Number.isFinite(close) || !close || close <= 0) return null;
    const stamp = usd?.last_updated ? new Date(usd.last_updated) : new Date();
    // CoinMarketCap's "latest" endpoint returns only a point-in-time price,
    // not an OHLC bar -- open/high/low are set to the same price rather
    // than fabricated from the 24h change, which would misrepresent the
    // day's actual range.
    return {
      open: close,
      high: close,
      low: close,
      close,
      volume: usd?.volume_24h ?? 0,
      date: stamp.toISOString().slice(0, 10),
      time: stamp.toISOString().slice(11, 19),
    };
  },
};

// Priority order: generous-quota providers with both quote+OHLCV first,
// tightest-quota/quote-only providers last. Callers filter to
// `isAvailable()` and the right `assetClasses` before use, so an
// unconfigured or wrong-asset-class adapter costs nothing to have listed.
export const KEYED_QUOTE_ADAPTERS: KeyedQuoteAdapter[] = [
  twelveDataAdapter,
  tiingoAdapter,
  eodhdAdapter,
  coinMarketCapAdapter,
  polygonAdapter,
  alphaVantageAdapter,
];

export function keyedAdaptersFor(
  assetClass: "equity" | "crypto",
  allowedConnectorIds?: readonly string[],
  stackOrder?: readonly string[],
  opts?: { pins?: readonly DataStackPin[]; symbol?: string; family?: "quote" | "ohlcv" },
): KeyedQuoteAdapter[] {
  const allowed = allowedConnectorIds?.length ? new Set(allowedConnectorIds) : null;
  const filtered = KEYED_QUOTE_ADAPTERS.filter((adapter) =>
    adapter.assetClasses.includes(assetClass) &&
    adapter.isAvailable() &&
    (!allowed || allowed.has(adapter.id)),
  );
  // P0.2 universal resolver: same order-resolution logic financial
  // statements and macro/FX use (dataStackService.ts), so a pin set on
  // the quote/OHLCV family (or a specific symbol within it) is honored
  // here exactly like the flat providerStackOrder always was.
  const order = resolveFamilyProviderOrder(opts?.family ?? "quote", filtered.map((a) => a.id), {
    globalStackOrder: stackOrder,
    pins: opts?.pins,
    symbol: opts?.symbol,
  });
  const byId = new Map(filtered.map((a) => [a.id, a]));
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

/** Every keyed adapter with a currently usable credential, independent of asset class or an
 * explicit connector allow-list -- used by the market-data entitlement resolver (LV4-05-09)
 * to know which real quote sources the current session can actually reach right now. An
 * adapter mid-cooldown after a rate-limit is correctly excluded: treating it as still fully
 * connected while it can't actually serve a request would misrepresent entitlement state. */
export function connectedKeyedAdapterIds(): string[] {
  return KEYED_QUOTE_ADAPTERS.filter((adapter) => adapter.isAvailable()).map((adapter) => adapter.id);
}
