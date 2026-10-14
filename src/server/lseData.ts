/**
 * London Strategic Edge connector -- a free, keyed REST API (api.londonstrategicedge.com/vault)
 * covering candles for stocks/FX/crypto/commodities/indices/ETFs/futures, 14,640 macro
 * economics series across 194 countries, 202 government bond yield tenors across 34
 * countries, options chains/flow/candles with greeks, and nine reference datasets
 * (economic calendar, insider trades, dividends, stock splits, COT positioning,
 * financial reports, company profiles, stock fundamentals, bond yields).
 *
 * Same optional-API-key pattern as fredData.ts/liveStream.ts's Finnhub key (env var or
 * ~/.limuria-terminal/config.json), and the same "be honest when data isn't live"
 * contract -- no key configured returns an empty/isLive:false result, never a
 * fabricated number. The account/key itself must be created by the user directly at
 * londonstrategicedge.com/data; nothing here signs up on anyone's behalf.
 *
 * Resilience: every successful response is cached to disk (~/.limuria-terminal/lse-cache)
 * with a per-endpoint TTL. If a live call fails (LSE downtime, network issue, rate
 * limit), the last good cached response is served instead of an error, so a transient
 * outage on their end doesn't take these panels down -- per explicit request that this
 * "wont interrupt if server is not working."
 *
 * Free tier (per /vault/usage as documented): 100 calls/minute, 50GB/month shared with
 * the WebSocket, 2 bulk exports/hour. This module only uses the interactive query
 * endpoints (not bulk /export), so it stays well inside those limits for panel-sized
 * pulls.
 */
import fs from "fs";
import path from "path";
import { getCredential } from "./terminalConfig";
import { recordConnectorVerification } from "./connectorVerification";
import { dataPath } from "./dataRoot";

const LSE_BASE_URL = "https://api.londonstrategicedge.com/vault";
const CACHE_TTL_MS = 15 * 60 * 1000;
export const LSE_MAX_LIMIT = 5000;
export const LSE_DEFAULT_LIMIT = 100;

export type LseOrder = "asc" | "desc";
export interface LseQueryOptions {
  start?: string;
  end?: string;
  order?: LseOrder;
  limit?: number;
  page?: number;
  cursor?: string;
  dataset?: "economics" | "bonds";
  /** Metadata is opt-in so existing array consumers remain compatible. */
  mode?: "page";
}

export interface LseProvenance {
  provider: "LSE";
  sourceReference: string;
  asOf: string | null;
  retrievedAt: string | null;
  freshness: "live" | "cached";
  cache: "live" | "fresh" | "stale" | "miss";
  fallback: boolean;
}

export interface LsePage<T> {
  rows: T[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
  provenance: LseProvenance;
}

export class LseQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LseQueryValidationError";
  }
}

function assertDate(value: string | undefined, field: string): void {
  if (value === undefined) return;
  // Provider accepts calendar dates; rejecting ambiguous values avoids silently
  // changing the requested window through Date's timezone normalization.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new LseQueryValidationError(`${field} must be an ISO calendar date (YYYY-MM-DD).`);
  }
}

/** Normalize and validate all shared query controls before they reach LSE. */
export function normalizeLseQueryOptions(options: LseQueryOptions = {}): LseQueryOptions {
  assertDate(options.start, "start");
  assertDate(options.end, "end");
  if (options.start && options.end && options.start > options.end) {
    throw new LseQueryValidationError("start must not be later than end.");
  }
  if (options.order !== undefined && options.order !== "asc" && options.order !== "desc") {
    throw new LseQueryValidationError("order must be asc or desc.");
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > LSE_MAX_LIMIT)) {
    throw new LseQueryValidationError(`limit must be an integer between 1 and ${LSE_MAX_LIMIT}.`);
  }
  if (options.page !== undefined && (!Number.isInteger(options.page) || options.page < 1)) {
    throw new LseQueryValidationError("page must be a positive integer.");
  }
  if (options.cursor !== undefined && (options.cursor.length === 0 || options.cursor.length > 256 || !/^[A-Za-z0-9._~:-]+$/.test(options.cursor))) {
    throw new LseQueryValidationError("cursor contains invalid characters or is too long.");
  }
  if (options.page !== undefined && options.cursor !== undefined) {
    throw new LseQueryValidationError("page and cursor cannot be supplied together.");
  }
  return {
    ...options,
    order: options.order,
    limit: options.limit === undefined ? undefined : Math.trunc(options.limit),
  };
}

function pageNumber(options: LseQueryOptions): number {
  if (options.page !== undefined) return options.page;
  if (options.cursor && /^\d+$/.test(options.cursor)) return Number(options.cursor);
  return 1;
}

function pageResult<T>(rows: T[], options: LseQueryOptions, provenance: LseProvenance, hasMoreOverride?: boolean): LsePage<T> {
  const page = pageNumber(options);
  const limit = options.limit ?? LSE_DEFAULT_LIMIT;
  const hasMore = hasMoreOverride ?? rows.length >= limit;
  return {
    rows,
    page,
    limit,
    hasMore,
    ...(hasMore ? { nextCursor: String(page + 1) } : {}),
    provenance,
  };
}

function resolveApiKey(): string | null {
  return getCredential("LSE_API_KEY", "lseApiKey");
}

function cacheDir(): string {
  return dataPath("lse-cache");
}

function cachePathFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
  return path.join(cacheDir(), `${safe}.json`);
}

interface CacheEnvelope<T> { cachedAt: number; data: T }

function readCacheEnvelope<T>(key: string): CacheEnvelope<T> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePathFor(key), "utf8")) as Partial<CacheEnvelope<T>>;
    return raw && typeof raw.cachedAt === "number" && "data" in raw ? raw as CacheEnvelope<T> : null;
  } catch {
    return null;
  }
}

function readCache<T>(key: string): T | null {
  return readCacheEnvelope<T>(key)?.data ?? null;
}

function writeCache<T>(key: string, data: T): void {
  try {
    if (!fs.existsSync(cacheDir())) fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cachePathFor(key), JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // best-effort cache -- a write failure shouldn't break the live response
  }
}

function isCacheFresh(key: string): boolean {
  const envelope = readCacheEnvelope<unknown>(key);
  return envelope !== null && Date.now() - envelope.cachedAt < CACHE_TTL_MS;
}

let loggedMissingKey = false;

interface LseFetchResult<T> {
  data: T | null;
  provenance: LseProvenance;
}

async function lseFetchDetailed<T>(pathSuffix: string, params: Record<string, string | number | undefined>): Promise<LseFetchResult<T>> {
  const apiKey = resolveApiKey();
  const cacheKey = `${pathSuffix}?${JSON.stringify(params)}`;
  const cached = readCacheEnvelope<T>(cacheKey);
  const cachedAt = cached ? new Date(cached.cachedAt).toISOString() : null;
  const base: Omit<LseProvenance, "cache" | "fallback" | "freshness" | "retrievedAt"> = {
    provider: "LSE",
    sourceReference: `lse:${pathSuffix}`,
    asOf: null,
  };

  if (!apiKey) {
    if (!loggedMissingKey) {
      console.log("London Strategic Edge domain disabled (no LSE_API_KEY or ~/.limuria-terminal/config.json lseApiKey). Get a free key at londonstrategicedge.com/data.");
      loggedMissingKey = true;
    }
    return {
      data: cached?.data ?? null,
      provenance: { ...base, retrievedAt: cachedAt, freshness: "cached", cache: cached ? "stale" : "miss", fallback: true },
    };
  }

  if (isCacheFresh(cacheKey) && cached) {
    return {
      data: cached.data,
      provenance: { ...base, retrievedAt: cachedAt, freshness: "cached", cache: "fresh", fallback: false },
    };
  }

  try {
    const url = new URL(`${LSE_BASE_URL}${pathSuffix}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!res.ok) throw new Error(`LSE API returned ${res.status} for ${pathSuffix}`);
    const data = (await res.json()) as T;
    const retrievedAt = new Date().toISOString();
    writeCache(cacheKey, data);
    recordConnectorVerification("lse", true, "London Strategic Edge responded to a live request.");
    return { data, provenance: { ...base, retrievedAt, freshness: "live", cache: "live", fallback: false } };
  } catch (err) {
    recordConnectorVerification("lse", false, err instanceof Error ? err.message : String(err));
    console.warn(`LSE fetch failed for ${pathSuffix}, falling back to cache:`, err instanceof Error ? err.message : err);
    return {
      data: cached?.data ?? null,
      provenance: { ...base, retrievedAt: cachedAt, freshness: "cached", cache: cached ? "stale" : "miss", fallback: true },
    };
  }
}

async function lseFetch<T>(pathSuffix: string, params: Record<string, string | number | undefined>): Promise<T | null> {
  return (await lseFetchDetailed<T>(pathSuffix, params)).data;
}

function queryParams(options: LseQueryOptions): Record<string, string | number | undefined> {
  const normalized = normalizeLseQueryOptions(options);
  return {
    start: normalized.start,
    end: normalized.end,
    order: normalized.order,
    limit: normalized.limit,
    page: normalized.page,
    cursor: normalized.cursor,
  };
}

export function isLseConfigured(): boolean {
  return resolveApiKey() !== null;
}

// ── Candles ──────────────────────────────────────────────────────────────
export interface LseCandle { ts: string; symbol: string; open: number; high: number; low: number; close: number; volume: number | null }

export function getCandles(symbol: string, timeframe: string, opts: LseQueryOptions & { mode: "page" }): Promise<LsePage<LseCandle>>;
export function getCandles(symbol: string, timeframe?: string, opts?: LseQueryOptions): Promise<LseCandle[]>;
export async function getCandles(symbol: string, timeframe = "1d", opts: LseQueryOptions = {}): Promise<LseCandle[] | LsePage<LseCandle>> {
  const normalized = normalizeLseQueryOptions(opts);
  const result = await lseFetchDetailed<LseCandle[]>("/candles", { symbol, timeframe, ...queryParams(normalized) });
  const rows = result.data ?? [];
  return normalized.mode === "page" ? pageResult(rows, normalized, result.provenance) : rows;
}

// ── Macro series and bond yields ────────────────────────────────────────
export interface LseSeriesPoint { symbol: string; date: string; value: number }

export function getSeries(symbol: string, opts: LseQueryOptions & { dataset?: "economics" | "bonds"; mode: "page" }): Promise<LsePage<LseSeriesPoint>>;
export function getSeries(symbol: string, opts?: LseQueryOptions & { dataset?: "economics" | "bonds" }): Promise<LseSeriesPoint[]>;
export async function getSeries(symbol: string, opts: LseQueryOptions & { dataset?: "economics" | "bonds" } = {}): Promise<LseSeriesPoint[] | LsePage<LseSeriesPoint>> {
  const normalized = normalizeLseQueryOptions(opts);
  const result = await lseFetchDetailed<LseSeriesPoint[]>("/series", { symbol, dataset: normalized.dataset, ...queryParams(normalized) });
  const rows = result.data ?? [];
  return normalized.mode === "page" ? pageResult(rows, normalized, result.provenance) : rows;
}

// ── Reference datasets ──────────────────────────────────────────────────
export interface LseInsiderTrade {
  symbol: string; transaction_date: string; filing_date: string; transaction_type: string;
  acquisition_or_disposition: string | null; reporting_name: string; type_of_owner: string | null;
  securities_transacted: number | null; securities_owned: number | null; price: number | null;
  security_name: string | null; form_type: string | null; url: string | null;
  office: string | null; district: string | null; owner: string | null; amount: string | null;
}
export interface LseDividend {
  symbol: string; effective_date: string; declaration_date: string | null; record_date: string | null;
  payment_date: string | null; dividend_amount: number; currency: string; frequency: string | null;
}
export interface LseStockSplit { symbol: string; effective_date: string; split_from: number; split_to: number }
export interface LseCotRow { symbol: string; date: string; [key: string]: unknown }
export interface LseFinancialReport {
  symbol: string; report_type: string; date: string; fiscal_year: string; period: string;
  reported_currency: string; data: string; filing_date: string | null;
}
export interface LseCompanyProfile {
  symbol: string; company_name: string; exchange: string; currency: string; country: string;
  sector: string; industry: string; ceo: string | null; description: string | null; website: string | null;
  full_time_employees: number | null; address: string | null; city: string | null; state: string | null;
  price: number | null; market_cap: number | null; beta: number | null; last_dividend: number | null;
  price_range: string | null; volume: number | null; average_volume: number | null; ipo_date: string | null;
  image_url_dark: string | null;
}
export interface LseStockFundamentals {
  symbol: string; name: string; exchange: string; sector: string; industry: string; country: string;
  ipo_date: string | null; current_price: number | null; market_cap: number | null; beta: number | null;
  pe_ratio: number | null; week_52_high: number | null; week_52_low: number | null;
  dividend_yield: number | null; revenue_ttm: number | null; profit_margin: number | null;
}
export interface LseBondYield {
  symbol: string; country_name: string; maturity: string; currency: string; date: string;
  open: number; high: number; low: number; close: number;
}

export interface LseEconomicCalendarEvent {
  date: string; time: string; datetime: string; region_code: string; event: string;
  actual: string | null; previous: string | null; consensus: string | null; forecast: string | null;
}
async function getRef<T>(dataset: string, params: Record<string, string | number | undefined>, opts: LseQueryOptions = {}): Promise<T[] | LsePage<T>> {
  const normalized = normalizeLseQueryOptions(opts);
  const result = await lseFetchDetailed<T[]>(`/ref/${dataset}`, { ...params, ...queryParams(normalized) });
  const rows = result.data ?? [];
  return normalized.mode === "page" ? pageResult(rows, normalized, result.provenance) : rows;
}

type RefQueryArgument = number | LseQueryOptions;
function refOptions(argument: RefQueryArgument | undefined, fallbackLimit: number): LseQueryOptions {
  if (typeof argument === "number") return { limit: argument };
  return { limit: fallbackLimit, ...argument };
}

export const getInsiderTrades = (symbol?: string, type?: string, limitOrOptions: RefQueryArgument = 100) =>
  getRef<LseInsiderTrade>("insider_trades", { symbol, type, order: "desc" }, refOptions(limitOrOptions, 100));

export const getDividends = (symbol: string, limitOrOptions: RefQueryArgument = 50) =>
  getRef<LseDividend>("dividends", { symbol, order: "desc" }, refOptions(limitOrOptions, 50));

export const getCot = (symbol: string, limitOrOptions: RefQueryArgument = 104) =>
  getRef<LseCotRow>("cot", { symbol, order: "desc" }, refOptions(limitOrOptions, 104));
export function getFinancialReports(symbol: string, reportType: string | undefined, period: string | undefined, options: LseQueryOptions & { mode: "page" }): Promise<LsePage<LseFinancialReport>>;
export function getFinancialReports(symbol: string, reportType?: string, period?: string, userIdOrOptions?: number | LseQueryOptions): Promise<LseFinancialReport[]>;
export function getFinancialReports(symbol: string, reportType?: string, period?: string, userIdOrOptions: number | LseQueryOptions = {}): Promise<LseFinancialReport[] | LsePage<LseFinancialReport>> {
  const options = typeof userIdOrOptions === "number" ? {} : userIdOrOptions;
  return getRef<LseFinancialReport>("financial_reports", { symbol, report_type: reportType, period, order: "desc" }, options);
}
export const getStockSplits = (symbol: string, limitOrOptions: RefQueryArgument = 20) =>
  getRef<LseStockSplit>("stock_splits", { symbol, order: "desc" }, refOptions(limitOrOptions, 20));

export const getCompanyProfile = async (symbol: string): Promise<LseCompanyProfile | null> => {
  const result = await getRef<LseCompanyProfile>("company_profiles", { symbol });
  const rows = Array.isArray(result) ? result : result.rows;
  return rows[0] ?? null;
};

export const getStockFundamentals = async (symbol: string): Promise<LseStockFundamentals | null> => {
  const result = await getRef<LseStockFundamentals>("stock_fundamentals", { symbol });
  const rows = Array.isArray(result) ? result : result.rows;
  return rows[0] ?? null;
};

export const getBondYields = (symbol: string, startOrOptions?: string | LseQueryOptions, limitOrOptions: RefQueryArgument = 260) => {
  const options = typeof startOrOptions === "object" ? startOrOptions : { ...refOptions(limitOrOptions, 260), start: startOrOptions };
  return getRef<LseBondYield>("bond_yields", { symbol, order: "desc" }, options);
};

export const getEconomicCalendar = (region?: string, event?: string, releasedOnly = false, limitOrOptions: RefQueryArgument = 50) =>
  getRef<LseEconomicCalendarEvent>("economic_calendar", { region, event, released: releasedOnly ? 1 : undefined, order: "desc" }, refOptions(limitOrOptions, 50));
// ── Options ──────────────────────────────────────────────────────────────
export interface LseOptionContract {
  ticker: string; underlying: string; contract_type: "call" | "put"; strike: number; expiry: string;
  last_price: number; volume_today: number; premium_today: number; underlying_price: number; dte: number;
  iv: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null;
}
export interface LseOptionFlowPrint {
  id: number; ts: string; ticker: string; underlying: string; contract_type: "call" | "put"; strike: number;
  expiry: string; last_price: number; volume: number; premium: number; underlying_price: number; dte: number;
  iv: number | null; delta: number | null;
}

export interface LseOptionsQuery extends LseQueryOptions {
  underlying?: string;
  type?: "call" | "put";
  expiry?: string;
  minDte?: number;
  maxDte?: number;
  minPremium?: number;
}

function normalizeOptionsQuery(options: LseOptionsQuery, defaultLimit = LSE_DEFAULT_LIMIT): LseOptionsQuery {
  const normalized = normalizeLseQueryOptions({ ...options, limit: options.limit ?? defaultLimit });
  for (const [field, value] of [["minDte", options.minDte], ["maxDte", options.maxDte]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 3650)) {
      throw new LseQueryValidationError(`${field} must be an integer between 0 and 3650.`);
    }
  }
  if (options.minDte !== undefined && options.maxDte !== undefined && options.minDte > options.maxDte) {
    throw new LseQueryValidationError("minDte must not be greater than maxDte.");
  }
  if (options.expiry !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(options.expiry)) {
    throw new LseQueryValidationError("expiry must be an ISO calendar date (YYYY-MM-DD).");
  }
  if (options.minPremium !== undefined && (!Number.isFinite(options.minPremium) || options.minPremium < 0)) {
    throw new LseQueryValidationError("minPremium must be a finite non-negative number.");
  }
  return { ...normalized, ...options, limit: normalized.limit };
}

function filterOptionRows<T extends { contract_type: "call" | "put"; expiry: string; dte: number; premium?: number }>(rows: T[], options: LseOptionsQuery): T[] {
  return rows.filter((row) =>
    (options.type === undefined || row.contract_type === options.type)
    && (options.expiry === undefined || row.expiry === options.expiry)
    && (options.minDte === undefined || row.dte >= options.minDte)
    && (options.maxDte === undefined || row.dte <= options.maxDte)
    && (options.minPremium === undefined || (row.premium ?? 0) >= options.minPremium)
  );
}

export function getOptionsChain(underlying: string, opts: LseOptionsQuery & { mode: "page" }): Promise<LsePage<LseOptionContract>>;
export function getOptionsChain(underlying: string, opts?: LseOptionsQuery): Promise<LseOptionContract[]>;
export async function getOptionsChain(underlying: string, opts: LseOptionsQuery = {}): Promise<LseOptionContract[] | LsePage<LseOptionContract>> {
  const normalized = normalizeOptionsQuery(opts);
  const result = await lseFetchDetailed<LseOptionContract[]>("/options/chain", {
    underlying, type: normalized.type, expiry: normalized.expiry, min_dte: normalized.minDte, max_dte: normalized.maxDte,
    ...queryParams(normalized),
  });
  const rows = filterOptionRows(result.data ?? [], normalized);
  return normalized.mode === "page" ? pageResult(rows, normalized, result.provenance) : rows;
}

export function getOptionsFlow(opts: LseOptionsQuery & { mode: "page" }): Promise<LsePage<LseOptionFlowPrint>>;
export function getOptionsFlow(opts?: LseOptionsQuery): Promise<LseOptionFlowPrint[]>;
export async function getOptionsFlow(opts: LseOptionsQuery = {}): Promise<LseOptionFlowPrint[] | LsePage<LseOptionFlowPrint>> {
  const normalized = normalizeOptionsQuery(opts);
  const result = await lseFetchDetailed<LseOptionFlowPrint[]>("/options/flow", {
    underlying: normalized.underlying, type: normalized.type, expiry: normalized.expiry, min_premium: normalized.minPremium,
    min_dte: normalized.minDte, max_dte: normalized.maxDte, ...queryParams(normalized),
  });
  const rows = filterOptionRows(result.data ?? [], normalized);
  return normalized.mode === "page" ? pageResult(rows, normalized, result.provenance) : rows;
}

// ── Catalog (discovery) ─────────────────────────────────────────────────
export interface LseCatalogRow {
  dataset: string; symbol: string; name?: string; ticks: number; first_tick?: string; last_tick?: string; years?: number;
  last_value?: number; change_pct?: number; change_1y?: number; unit?: string; category?: string; frequency?: string;
  country?: string | null; country_name?: string | null;
}

async function getCatalogResult(datasetFilter: string | undefined, options: LseQueryOptions = {}): Promise<{ rows: LseCatalogRow[]; provenance: LseProvenance }> {
  const normalized = normalizeLseQueryOptions(options);
  const result = await lseFetchDetailed<LseCatalogRow[]>("/catalog", queryParams(normalized));
  const rows = (result.data ?? []).filter((row) => !datasetFilter || row.dataset === datasetFilter);
  return { rows, provenance: result.provenance };
}

export function getCatalog(datasetFilter: string | undefined, options: LseQueryOptions & { mode: "page" }): Promise<LsePage<LseCatalogRow>>;
export function getCatalog(datasetFilter?: string, options?: LseQueryOptions): Promise<LseCatalogRow[]>;
export async function getCatalog(datasetFilter?: string, options: LseQueryOptions = {}): Promise<LseCatalogRow[] | LsePage<LseCatalogRow>> {
  const normalized = normalizeLseQueryOptions(options);
  const result = await getCatalogResult(datasetFilter, normalized.mode === "page" ? { ...normalized, page: undefined, cursor: undefined, limit: undefined } : normalized);
  if (normalized.mode !== "page") return result.rows;
  const page = normalized.page ?? 1;
  const limit = normalized.limit ?? LSE_DEFAULT_LIMIT;
  const offset = (page - 1) * limit;
  const rows = result.rows.slice(offset, offset + limit);
  return pageResult(rows, normalized, result.provenance, offset + rows.length < result.rows.length);
}

export function searchEconomicsCatalog(query: string, country: string | undefined, limit: number, dataset: "economics" | "bonds", options: LseQueryOptions & { mode: "page" }): Promise<LsePage<LseCatalogRow>>;
export function searchEconomicsCatalog(query: string, country?: string, limit?: number, dataset?: "economics" | "bonds", options?: LseQueryOptions): Promise<LseCatalogRow[]>;
export async function searchEconomicsCatalog(query: string, country?: string, limit = 100, dataset: "economics" | "bonds" = "economics", options: LseQueryOptions = {}): Promise<LseCatalogRow[] | LsePage<LseCatalogRow>> {
  const normalized = normalizeLseQueryOptions({ ...options, limit: options.limit ?? limit });
  const result = await getCatalogResult(dataset);
  const q = query.trim().toLowerCase();
  const filtered = result.rows.filter((row) =>
    (!q || row.symbol.toLowerCase().includes(q) || (row.name ?? "").toLowerCase().includes(q) || (row.category ?? "").toLowerCase().includes(q))
    && (!country || row.country === country)
  );
  if (normalized.mode !== "page") return filtered.slice(0, normalized.limit);
  const page = normalized.page ?? 1;
  const pageRows = filtered.slice((page - 1) * normalized.limit!, page * normalized.limit!);
  return pageResult(pageRows, normalized, result.provenance, page * normalized.limit! < filtered.length);
}

// ── Bond & Macro screeners -- both "bonds" and "economics" are catalog
// datasets already carrying a pre-aggregated last_value (current yield for
// bonds, current reading for macro indicators), so a threshold screen is
// just a filter over the existing catalog fetch -- no new data source, no
// per-country N+1 fetching. Backs the Bond/Macro Screener UI tabs.
export interface CatalogScreenFilters { country?: string; category?: string; minValue?: number; maxValue?: number; query?: string }

export function screenCatalog(dataset: "economics" | "bonds", filters: CatalogScreenFilters, limit: number, options: LseQueryOptions & { mode: "page" }): Promise<LsePage<LseCatalogRow>>;
export function screenCatalog(dataset: "economics" | "bonds", filters: CatalogScreenFilters, limit?: number, options?: LseQueryOptions): Promise<LseCatalogRow[]>;
export async function screenCatalog(dataset: "economics" | "bonds", filters: CatalogScreenFilters, limit = 200, options: LseQueryOptions = {}): Promise<LseCatalogRow[] | LsePage<LseCatalogRow>> {
  const normalized = normalizeLseQueryOptions({ ...options, limit: options.limit ?? limit });
  const result = await getCatalogResult(dataset);
  const q = filters.query?.trim().toLowerCase();
  const filtered = result.rows.filter((row) => {
    if (filters.country && row.country !== filters.country) return false;
    if (filters.category && !(row.category ?? "").toLowerCase().includes(filters.category.toLowerCase())) return false;
    if (filters.minValue !== undefined && (row.last_value === undefined || row.last_value < filters.minValue)) return false;
    if (filters.maxValue !== undefined && (row.last_value === undefined || row.last_value > filters.maxValue)) return false;
    return !q || row.symbol.toLowerCase().includes(q) || (row.name ?? "").toLowerCase().includes(q);
  });
  if (normalized.mode !== "page") return filtered.slice(0, normalized.limit);
  const page = normalized.page ?? 1;
  const pageRows = filtered.slice((page - 1) * normalized.limit!, page * normalized.limit!);
  return pageResult(pageRows, normalized, result.provenance, page * normalized.limit! < filtered.length);
}

export interface LseDatasetManifestEntry {
  dataset: string;
  endpoint: string;
  access: "rows" | "single" | "catalog";
  queryControls: string[];
  notes: string;
}

export function getLseDatasetManifest(): { provider: "LSE"; generatedAt: string; verification: string; datasets: LseDatasetManifestEntry[] } {
  return {
    provider: "LSE",
    generatedAt: new Date().toISOString(),
    verification: "Capabilities observed from implemented LSE wrapper payloads; upstream capacity and pagination guarantees remain request-scoped and undocumented here.",
    datasets: [
      { dataset: "candles", endpoint: "/candles", access: "rows", queryControls: ["start", "end", "order", "limit", "page", "cursor"], notes: "Cross-asset OHLCV; provider pagination support is not independently documented." },
      { dataset: "economics_series", endpoint: "/series", access: "rows", queryControls: ["start", "end", "order", "limit", "page", "cursor"], notes: "Observed economics series payload." },
      { dataset: "bond_series", endpoint: "/series", access: "rows", queryControls: ["start", "end", "order", "limit", "page", "cursor"], notes: "Observed bonds series payload." },
      { dataset: "options_chain", endpoint: "/options/chain", access: "rows", queryControls: ["minDte", "maxDte", "expiry", "type", "limit", "page", "cursor"], notes: "Observed option contract payload; full expiry capacity is provider-dependent." },
      { dataset: "options_flow", endpoint: "/options/flow", access: "rows", queryControls: ["start", "end", "order", "expiry", "minDte", "maxDte", "minPremium", "limit", "page", "cursor"], notes: "Observed option flow payload." },
      { dataset: "catalog", endpoint: "/catalog", access: "catalog", queryControls: ["limit", "page", "cursor"], notes: "Observed catalog metadata only; catalog row count and upstream paging contract remain unknown." },
      { dataset: "reference", endpoint: "/ref/{dataset}", access: "rows", queryControls: ["start", "end", "order", "limit", "page", "cursor"], notes: "Only observed reference dataset names are exposed by wrapper methods." },
    ],
  };
}
