/**
 * World Bank Open Data connector -- the official, free, public Indicators
 * API at api.worldbank.org. No API key, no registration, no rate-limit
 * account, no ToS restriction. 29,000+ indicators across 200+ countries,
 * 1960-present. Unlike FRED (US-only), this is the connector that gives
 * every domain an international/cross-country lens: fiscal & trade data
 * for Economics, logistics & trade-flow proxies for Supply Chain,
 * renewable-energy & emissions share for Environment, and tourism
 * arrivals/receipts for Tourism & Hospitality.
 *
 * Annual series, published on a real-world reporting lag (a given
 * country's latest value for an indicator can be 1-4 years stale, or
 * missing for a given year entirely) -- this module always walks back
 * through recent years per country/indicator to find the latest real,
 * non-null observation and reports the year it's actually from, rather
 * than implying current-year freshness it doesn't have.
 *
 * Same disk-cache resilience pattern as the other connectors, TTL set to
 * 24h since these are annual series that don't change intraday.
 */
import fs from "fs";
import path from "path";
import { recordConnectorVerification } from "./connectorVerification";
import { dataPath } from "./dataRoot";

const WB_BASE = "https://api.worldbank.org/v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheDir(): string {
  return dataPath("worldbank-cache");
}

function cachePathFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
  return path.join(cacheDir(), `${safe}.json`);
}

function readCache<T>(key: string): { data: T; cachedAt: number } | null {
  try {
    const file = cachePathFor(key);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
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

type WbFetchStatus = "live" | "cached" | "unavailable";
interface WbFetchResult<T> { data: T | null; status: WbFetchStatus; cachedAt: number | null }

async function wbFetch<T>(url: string, cacheKey: string): Promise<WbFetchResult<T>> {
  const cached = readCache<T>(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return { data: cached.data, status: "cached", cachedAt: cached.cachedAt };
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`World Bank API returned ${res.status}`);
    const data = (await res.json()) as T;
    writeCache(cacheKey, data);
    recordConnectorVerification("world_bank", true, "World Bank responded to a live request.");
    return { data, status: "live", cachedAt: Date.now() };
  } catch (err) {
    recordConnectorVerification("world_bank", false, err instanceof Error ? err.message : String(err));
    console.warn(`World Bank fetch failed for ${url}, falling back to cache:`, err instanceof Error ? err.message : err);
    return cached ? { data: cached.data, status: "cached", cachedAt: cached.cachedAt } : { data: null, status: "unavailable", cachedAt: null };
  }
}
export type WbDomain = "economics_policy" | "supply_chain" | "environment_sustainability" | "tourism_hospitality";

export interface WbIndicatorProfile { code: string; name: string; unit: string; category: string; domain?: WbDomain }

export const WB_INDICATOR_CATALOG: WbIndicatorProfile[] = [
  // ── Economics & Public Policy (fiscal/budget lens FRED can't give -- int'l) ──
  { code: "NY.GDP.MKTP.CD", name: "GDP (current US$)", unit: "$", category: "Growth", domain: "economics_policy" },
  { code: "FP.CPI.TOTL.ZG", name: "Inflation, Consumer Prices", unit: "% annual", category: "Inflation", domain: "economics_policy" },
  { code: "GC.XPN.TOTL.GD.ZS", name: "Government Expense (% of GDP)", unit: "% GDP", category: "Fiscal / Budget", domain: "economics_policy" },
  { code: "GC.REV.XGRT.GD.ZS", name: "Government Revenue (% of GDP)", unit: "% GDP", category: "Fiscal / Budget", domain: "economics_policy" },
  { code: "GC.DOD.TOTL.GD.ZS", name: "Central Government Debt (% of GDP)", unit: "% GDP", category: "Fiscal / Budget", domain: "economics_policy" },
  { code: "SL.UEM.TOTL.ZS", name: "Unemployment Rate", unit: "%", category: "Labor", domain: "economics_policy" },
  // ── Supply Chain (trade flows + logistics quality, no FRED equivalent) ──
  { code: "LP.LPI.OVRL.XQ", name: "Logistics Performance Index (Overall)", unit: "1-5 scale", category: "Logistics Quality", domain: "supply_chain" },
  { code: "TX.VAL.MRCH.CD.WT", name: "Merchandise Exports", unit: "$", category: "Trade Flow", domain: "supply_chain" },
  { code: "TM.VAL.MRCH.CD.WT", name: "Merchandise Imports", unit: "$", category: "Trade Flow", domain: "supply_chain" },
  { code: "IS.SHP.GOOD.TU", name: "Container Port Traffic", unit: "TEU", category: "Port Throughput", domain: "supply_chain" },
  // ── Environment & Sustainability (international, complements FRED's US-only CO2 series) ──
  { code: "EN.GHG.CO2.MT.CE.AR5", name: "CO2 Emissions", unit: "Mt CO2e", category: "Emissions", domain: "environment_sustainability" },
  { code: "EG.FEC.RNEW.ZS", name: "Renewable Energy Consumption", unit: "% of total", category: "Renewables", domain: "environment_sustainability" },
  { code: "EG.ELC.RNEW.ZS", name: "Renewable Electricity Output", unit: "% of total", category: "Renewables", domain: "environment_sustainability" },
  { code: "AG.LND.FRST.ZS", name: "Forest Area", unit: "% of land", category: "Land Use", domain: "environment_sustainability" },
  // ── Tourism & Hospitality (international arrivals/receipts, no FRED equivalent) ──
  { code: "ST.INT.ARVL", name: "International Tourism Arrivals", unit: "Arrivals", category: "Demand", domain: "tourism_hospitality" },
  { code: "ST.INT.RCPT.CD", name: "International Tourism Receipts", unit: "$", category: "Revenue", domain: "tourism_hospitality" },
  { code: "ST.INT.XPND.CD", name: "International Tourism Expenditures", unit: "$", category: "Outbound Spend", domain: "tourism_hospitality" },
];

export function getWbIndicatorProfile(code: string): WbIndicatorProfile | undefined {
  return WB_INDICATOR_CATALOG.find((i) => i.code.toUpperCase() === code.toUpperCase());
}

export function getWbIndicatorCatalog(domain: WbDomain): WbIndicatorProfile[] {
  return WB_INDICATOR_CATALOG.filter((i) => i.domain === domain);
}

export interface WbCountry { iso2: string; iso3: string; name: string }

// A representative set spanning major/regional economies -- World Bank
// covers 200+, this keeps comparison views readable.
export const WB_COUNTRIES: WbCountry[] = [
  { iso2: "US", iso3: "USA", name: "United States" },
  { iso2: "IN", iso3: "IND", name: "India" },
  { iso2: "CN", iso3: "CHN", name: "China" },
  { iso2: "GB", iso3: "GBR", name: "United Kingdom" },
  { iso2: "DE", iso3: "DEU", name: "Germany" },
  { iso2: "JP", iso3: "JPN", name: "Japan" },
  { iso2: "BR", iso3: "BRA", name: "Brazil" },
  { iso2: "ZA", iso3: "ZAF", name: "South Africa" },
  { iso2: "AE", iso3: "ARE", name: "UAE" },
  { iso2: "SG", iso3: "SGP", name: "Singapore" },
  { iso2: "AU", iso3: "AUS", name: "Australia" },
  { iso2: "FR", iso3: "FRA", name: "France" },
  { iso2: "CA", iso3: "CAN", name: "Canada" },
  { iso2: "MX", iso3: "MEX", name: "Mexico" },
  { iso2: "ID", iso3: "IDN", name: "Indonesia" },
  { iso2: "NG", iso3: "NGA", name: "Nigeria" },
  { iso2: "SA", iso3: "SAU", name: "Saudi Arabia" },
  { iso2: "KR", iso3: "KOR", name: "South Korea" },
];

interface WbRawObservation { date?: unknown; value?: unknown; country?: { id?: unknown; value?: unknown } }
interface WbPageMeta { page?: unknown; pages?: unknown; per_page?: unknown; total?: unknown }
type WbRawResponse = unknown;

function parseWbYear(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999) return String(value);
  if (typeof value !== "string") return null;
  const year = value.trim();
  return /^\d{4}$/.test(year) ? year : null;
}

function parseFiniteWbValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWbEnvelope(data: unknown): { metadata: WbPageMeta; rows: WbRawObservation[] } {
  if (!Array.isArray(data)) return { metadata: {}, rows: [] };
  const metadata = data[0] && typeof data[0] === "object" && !Array.isArray(data[0])
    ? data[0] as WbPageMeta
    : {};
  const rows = Array.isArray(data[1])
    ? data[1].filter((row): row is WbRawObservation => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
  return { metadata, rows };
}

function parseWbObservations(rows: WbRawObservation[]): WbObservation[] {
  return rows.flatMap((row) => {
    const year = parseWbYear(row.date);
    const value = parseFiniteWbValue(row.value);
    return year !== null && value !== null ? [{ year, value }] : [];
  }).sort((a, b) => a.year.localeCompare(b.year));
}

export const WB_DEFAULT_YEARS_BACK = 60;
export const WB_MAX_YEARS_BACK = 100;
export const WB_MAX_PAGE_SIZE = 1_000;

export interface WbIndicatorOptions {
  yearsBack?: number;
  startYear?: number;
  endYear?: number;
  page?: number;
  limit?: number;
}

export function normalizeWbOptions(input: number | WbIndicatorOptions): Required<Pick<WbIndicatorOptions, "startYear" | "endYear" | "page" | "limit">> {
  const currentYear = new Date().getFullYear();
  const options = typeof input === "number" ? { yearsBack: input } : input;
  const yearsBack = options.yearsBack ?? WB_DEFAULT_YEARS_BACK;
  if (!Number.isInteger(yearsBack) || yearsBack < 1 || yearsBack > WB_MAX_YEARS_BACK) {
    throw new RangeError(`yearsBack must be an integer between 1 and ${WB_MAX_YEARS_BACK}`);
  }
  const startYear = options.startYear ?? currentYear - yearsBack;
  const endYear = options.endYear ?? currentYear;
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1900 || endYear < 1900 || startYear > endYear || endYear > currentYear + 1) {
    throw new RangeError("startYear/endYear must be valid years with startYear on or before endYear");
  }
  if (endYear - startYear > WB_MAX_YEARS_BACK) throw new RangeError(`date range cannot exceed ${WB_MAX_YEARS_BACK} years`);
  const page = options.page ?? 1;
  const limit = options.limit ?? Math.min(endYear - startYear + 1, WB_MAX_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > WB_MAX_PAGE_SIZE) {
    throw new RangeError(`page must be >= 1 and limit must be between 1 and ${WB_MAX_PAGE_SIZE}`);
  }
  return { startYear, endYear, page, limit };
}

function parseBoundedPositiveInteger(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

export interface WbObservation { year: string; value: number }
export interface WbIndicatorResult {
  code: string; name: string; unit: string; country: string; countryCode: string;
  latestValue: number | null; latestYear: string | null; history: WbObservation[]; isLive: boolean;
  status: WbFetchStatus; retrievedAt: string | null; page: number; limit: number; hasMore: boolean; nextPage: number | null;
}

export async function getWbIndicator(code: string, countryIso2: string, input: number | WbIndicatorOptions = WB_DEFAULT_YEARS_BACK): Promise<WbIndicatorResult> {
  const options = normalizeWbOptions(input);
  const profile = getWbIndicatorProfile(code);
  const country = WB_COUNTRIES.find((c) => c.iso2.toUpperCase() === countryIso2.toUpperCase());
  const url = `${WB_BASE}/country/${encodeURIComponent(countryIso2)}/indicator/${encodeURIComponent(code)}?format=json&per_page=${options.limit}&page=${options.page}&date=${options.startYear}:${options.endYear}`;
  const response = await wbFetch<WbRawResponse>(url, `ind_${code}_${countryIso2}_${options.startYear}_${options.endYear}_${options.page}_${options.limit}`);
  const parsed = parseWbEnvelope(response.data);
  const history = parseWbObservations(parsed.rows);
  const latest = history[history.length - 1];
  const meta = parsed.metadata;
  const page = parseBoundedPositiveInteger(meta.page, options.page);
  const limit = parseBoundedPositiveInteger(meta.per_page, options.limit, WB_MAX_PAGE_SIZE);
  const pages = parseBoundedPositiveInteger(meta.pages, page);
  return {
    code, name: profile?.name ?? code, unit: profile?.unit ?? "",
    country: country?.name ?? countryIso2, countryCode: countryIso2,
    latestValue: latest?.value ?? null, latestYear: latest?.year ?? null,
    history, isLive: response.status === "live", status: response.status, retrievedAt: response.cachedAt ? new Date(response.cachedAt).toISOString() : null,
    page, limit, hasMore: page < pages, nextPage: page < pages ? page + 1 : null,
  };
}

export interface WbCompareResult { country: string; countryCode: string; value: number | null; year: string | null }

export interface WbCatalogPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number | null;
  hasMore: boolean;
  nextPage: number | null;
  status: WbFetchStatus;
  retrievedAt: string | null;
}

interface WbProviderIndicator { id: string; name: string; unit?: string; sourceNote?: string }
interface WbProviderCountry { id: string; iso2Code?: string; iso3Code?: string; name: string }

export async function getWbProviderIndicatorCatalog(input: { page?: number; limit?: number; search?: string } = {}): Promise<WbCatalogPage<WbIndicatorProfile & { sourceNote?: string }>> {
  const page = input.page ?? 1;
  const limit = input.limit ?? 50;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > WB_MAX_PAGE_SIZE) throw new RangeError(`page must be >= 1 and limit must be between 1 and ${WB_MAX_PAGE_SIZE}`);
  const response = await wbFetch<[WbPageMeta, WbProviderIndicator[] | null]>(`${WB_BASE}/indicator?format=json&per_page=${limit}&page=${page}`, `catalog_indicators_${page}_${limit}`);
  const metadata = response.data?.[0] ?? {};
  const records = (response.data?.[1] ?? []).map((item) => ({ code: item.id, name: item.name, unit: item.unit ?? "", category: "World Bank provider catalog (unclassified)", ...(item.sourceNote ? { sourceNote: item.sourceNote } : {}) }));
  const search = input.search?.trim().toLowerCase();
  const items = search ? records.filter((item) => `${item.code} ${item.name} ${item.sourceNote ?? ""}`.toLowerCase().includes(search)) : records;
  const actualPage = Number(metadata.page) || page;
  const actualLimit = Number(metadata.per_page) || limit;
  const pages = Number(metadata.pages);
  const total = Number.isFinite(Number(metadata.total)) ? Number(metadata.total) : null;
  const hasMore = pages ? actualPage < pages : items.length === actualLimit;
  return { items, page: actualPage, limit: actualLimit, total, hasMore, nextPage: hasMore ? actualPage + 1 : null, status: response.status, retrievedAt: response.cachedAt ? new Date(response.cachedAt).toISOString() : null };
}

export async function getWbProviderCountries(input: { page?: number; limit?: number; search?: string } = {}): Promise<WbCatalogPage<WbCountry>> {
  const page = input.page ?? 1;
  const limit = input.limit ?? 100;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > WB_MAX_PAGE_SIZE) throw new RangeError(`page must be >= 1 and limit must be between 1 and ${WB_MAX_PAGE_SIZE}`);
  const response = await wbFetch<[WbPageMeta, WbProviderCountry[] | null]>(`${WB_BASE}/country?format=json&per_page=${limit}&page=${page}`, `catalog_countries_${page}_${limit}`);
  const metadata = response.data?.[0] ?? {};
  const records = (response.data?.[1] ?? []).filter((item) => item.iso2Code && item.iso3Code).map((item) => ({ iso2: item.iso2Code!, iso3: item.iso3Code!, name: item.name }));
  const search = input.search?.trim().toLowerCase();
  const items = search ? records.filter((item) => `${item.iso2} ${item.iso3} ${item.name}`.toLowerCase().includes(search)) : records;
  const actualPage = Number(metadata.page) || page;
  const actualLimit = Number(metadata.per_page) || limit;
  const pages = Number(metadata.pages);
  const total = Number.isFinite(Number(metadata.total)) ? Number(metadata.total) : null;
  const hasMore = pages ? actualPage < pages : items.length === actualLimit;
  return { items, page: actualPage, limit: actualLimit, total, hasMore, nextPage: hasMore ? actualPage + 1 : null, status: response.status, retrievedAt: response.cachedAt ? new Date(response.cachedAt).toISOString() : null };
}
export async function getWbCompare(code: string, countryIso2List: string[]): Promise<WbCompareResult[]> {
  const results = await Promise.all(
    countryIso2List.map(async (iso2) => {
      const r = await getWbIndicator(code, iso2, 10);
      return { country: r.country, countryCode: iso2, value: r.latestValue, year: r.latestYear };
    }),
  );
  return results;
}
