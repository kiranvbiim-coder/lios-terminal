/**
 * Google Trends connector -- search-interest-over-time data, free and
 * requiring no API key/account. Unlike FRED/World Bank/SEC EDGAR (documented
 * public APIs), Google has never published an official Trends API; this
 * uses the same undocumented `trends.google.com/trends/api/*` endpoints
 * every free Trends tool (pytrends, google-trends-api, etc.) relies on.
 * That means it is inherently more fragile than this app's other connectors
 * -- Google can change the response shape or rate-limit without notice --
 * so every call degrades honestly to isLive: false / an empty series rather
 * than throwing or fabricating a value, matching the same contract as
 * fredData.ts/worldBankData.ts.
 *
 * The API is a two-step token exchange:
 *  1. GET /explore with a comparisonItem request -> returns a per-widget
 *     token (one widget per requested "request type"; we want TIMESERIES).
 *  2. GET /widgetdata/multiline with that token -> returns the actual
 *     0-100 relative-interest series.
 * Both responses are prefixed with a `)]}'` XSSI-protection line that must
 * be stripped before JSON.parse.
 *
 * Same disk-cache resilience pattern as the other connectors -- a short TTL
 * since trends data updates roughly daily and repeated identical queries
 * within a session shouldn't re-hit Google each time.
 */
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

const TRENDS_BASE = "https://trends.google.com/trends/api";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h -- trends data itself updates roughly daily

function cacheDir(): string {
  return dataPath("google-trends-cache");
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

// Strips Google's `)]}'` XSSI-protection prefix (always the first line of
// every trends.google.com/trends/api/* response) before JSON.parse.
function stripXssiPrefix(text: string): string {
  const newlineIndex = text.indexOf("\n");
  return newlineIndex === -1 ? text : text.slice(newlineIndex + 1);
}

async function trendsFetchJson<T>(url: string, cacheKey: string): Promise<T | null> {
  const cached = readCache<T>(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Google Trends returned ${res.status}`);
    const text = await res.text();
    const data = JSON.parse(stripXssiPrefix(text)) as T;
    writeCache(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`Google Trends fetch failed for ${url}, falling back to cache:`, err instanceof Error ? err.message : err);
    return cached?.data ?? null;
  }
}

interface ExploreWidget { id: string; token: string; request: unknown }
interface ExploreResponse { widgets: ExploreWidget[] }

interface WidgetDataPoint { time: string; formattedTime: string; value: number[]; hasData: boolean[]; formattedValue: string[] }
interface WidgetDataResponse { default: { timelineData: WidgetDataPoint[] } }

export interface TrendPoint { date: string; value: number }
export interface TrendResult {
  keyword: string;
  geo: string;
  timeframe: string;
  points: TrendPoint[];
  isLive: boolean;
}

// Google's default lookback presets (there's no free-text "last N days" --
// these are the same fixed windows the public Trends UI itself offers).
export type TrendsTimeframe = "now 7-d" | "today 1-m" | "today 3-m" | "today 12-m" | "today 5-y";

function emptyResult(keyword: string, geo: string, timeframe: string): TrendResult {
  return { keyword, geo, timeframe, points: [], isLive: false };
}

export async function getSearchInterest(keyword: string, geo = "", timeframe: TrendsTimeframe = "today 12-m"): Promise<TrendResult> {
  const req = JSON.stringify({ comparisonItem: [{ keyword, geo, time: timeframe }], category: 0, property: "" });
  const exploreUrl = `${TRENDS_BASE}/explore?hl=en-US&tz=0&req=${encodeURIComponent(req)}`;
  const explore = await trendsFetchJson<ExploreResponse>(exploreUrl, `explore_${keyword}_${geo}_${timeframe}`);
  const widget = explore?.widgets.find((w) => w.id === "TIMESERIES");
  if (!widget) return emptyResult(keyword, geo, timeframe);

  const widgetReq = JSON.stringify(widget.request);
  const dataUrl = `${TRENDS_BASE}/widgetdata/multiline?hl=en-US&tz=0&req=${encodeURIComponent(widgetReq)}&token=${widget.token}`;
  const widgetData = await trendsFetchJson<WidgetDataResponse>(dataUrl, `widgetdata_${keyword}_${geo}_${timeframe}`);
  const rows = widgetData?.default?.timelineData ?? [];
  if (rows.length === 0) return emptyResult(keyword, geo, timeframe);

  const points: TrendPoint[] = rows.map((r) => ({
    date: new Date(Number(r.time) * 1000).toISOString().slice(0, 10),
    value: r.value[0] ?? 0,
  }));
  return { keyword, geo, timeframe, points, isLive: true };
}

export async function compareSearchInterest(keywords: string[], geo = "", timeframe: TrendsTimeframe = "today 12-m"): Promise<TrendResult[]> {
  // Google's own comparisonItem format supports multiple keywords in one
  // call, but keeping it one-keyword-per-request here is simpler to cache
  // and reuse (each keyword's series is independently cacheable) at the
  // cost of N requests instead of 1 -- acceptable for a curated few-keyword
  // comparison, not meant for bulk/high-cardinality use.
  return Promise.all(keywords.map((k) => getSearchInterest(k, geo, timeframe)));
}
