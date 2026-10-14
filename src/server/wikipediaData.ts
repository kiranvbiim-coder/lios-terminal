/**
 * Wikipedia Pageviews connector -- official Wikimedia REST API, free, no
 * API key, no registration. A genuine public-attention proxy independent of
 * GDELT's news-tone signal: this measures reader interest directly, not
 * how the press is framing a topic.
 * https://wikimedia.org/api/rest_v1/#/Pageviews%20data
 *
 * Same disk-cache resilience pattern as the other connectors, TTL 6h since
 * daily pageview counts update once a day upstream.
 */
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

const PAGEVIEWS_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheDir(): string {
  return dataPath("wikipedia-cache");
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

export interface PageviewObservation { date: string; views: number } // date = "YYYY-MM-DD"
export interface PageviewResult { article: string; history: PageviewObservation[]; isLive: boolean }

interface WikimediaRawItem { timestamp: string; views: number } // timestamp = "YYYYMMDD00"
interface WikimediaRawResponse { items?: WikimediaRawItem[] }

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function getPageviews(article: string, days = 60): Promise<PageviewResult> {
  const cacheKey = `pv_${article}_${days}`;
  const cached = readCache<PageviewObservation[]>(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { article, history: cached.data, isLive: cached.data.length > 0 };
  }

  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const url = `${PAGEVIEWS_BASE}/${encodeURIComponent(article)}/daily/${fmtDate(start)}/${fmtDate(end)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Limuria Terminal (internal research tool)" } });
    if (!res.ok) throw new Error(`Wikipedia Pageviews API returned ${res.status}`);
    const data = (await res.json()) as WikimediaRawResponse;
    const history: PageviewObservation[] = (data.items ?? []).map((item) => ({
      date: `${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}-${item.timestamp.slice(6, 8)}`,
      views: item.views,
    }));
    writeCache(cacheKey, history);
    return { article, history, isLive: history.length > 0 };
  } catch (err) {
    console.warn(`Wikipedia Pageviews fetch failed for "${article}", falling back to cache:`, err instanceof Error ? err.message : err);
    const fallback = cached?.data ?? [];
    return { article, history: fallback, isLive: fallback.length > 0 };
  }
}
