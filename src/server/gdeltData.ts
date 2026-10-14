/**
 * Marketing, PR & Communications domain connector -- unlike Economics,
 * Supply Chain, and Environment, this domain has no FRED-hosted data
 * (there's no government series for "brand sentiment"). Uses GDELT (the
 * Global Database of Events, Language, and Tone), a free, no-API-key-
 * required public research project that scans global news coverage every
 * 15 minutes and scores its tone -- a genuine, non-fabricated proxy for
 * media sentiment. No paid social-listening vendor needed for a starting
 * catalog.
 *
 * GDELT's DOC 2.0 API asks callers to stay under one request per 5
 * seconds (https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), so
 * this module serializes outbound requests through a queue and caches
 * results for 10 minutes -- a shared public resource, not a paid key we
 * can lean on harder.
 */
const GDELT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const MIN_REQUEST_GAP_MS = 5200;
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface MediaTopicProfile {
  topicId: string; // slug, also used as the search query sent to GDELT
  name: string;
  category: string;
  wikipediaArticle: string; // en.wikipedia.org article title, for the Pageviews attention signal
}

// A curated starting set of globally-covered public brands/topics -- picked
// for reliable news volume so the tone series isn't sparse/noisy. Same
// spirit as marketData.ts's PROFILE_CATALOG or fredData.ts's INDICATOR_CATALOG:
// example subjects a real PR desk would swap for their own brand/competitors.
export const MEDIA_CATALOG: MediaTopicProfile[] = [
  { topicId: "tesla", name: "Tesla — Media Tone", category: "Consumer Brands", wikipediaArticle: "Tesla,_Inc." },
  { topicId: "apple", name: "Apple — Media Tone", category: "Consumer Brands", wikipediaArticle: "Apple_Inc." },
  { topicId: "nike", name: "Nike — Media Tone", category: "Consumer Brands", wikipediaArticle: "Nike,_Inc." },
  { topicId: "starbucks", name: "Starbucks — Media Tone", category: "Consumer Brands", wikipediaArticle: "Starbucks" },
  { topicId: "boeing", name: "Boeing — Media Tone", category: "Corporate Reputation", wikipediaArticle: "Boeing" },
  { topicId: "artificial intelligence", name: "AI Industry — Media Tone", category: "Industry Topics", wikipediaArticle: "Artificial_intelligence" },
];

export function getMediaTopicProfile(topicId: string): MediaTopicProfile | undefined {
  return MEDIA_CATALOG.find((t) => t.topicId === topicId.toLowerCase());
}

export function getMediaCatalog(): MediaTopicProfile[] {
  return MEDIA_CATALOG;
}

export interface MediaObservation {
  date: string;
  value: number; // GDELT average tone, roughly -10 (very negative) to +10 (very positive)
}

export interface MediaQuote {
  topicId: string;
  name: string;
  unit: string;
  value: number | null;
  previousValue: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string | null;
  isLive: boolean;
}

interface CacheEntry {
  observations: MediaObservation[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
let lastRequestAt = 0;
let requestChain: Promise<void> = Promise.resolve();

function parseGdeltDate(raw: string): string {
  // "20260718T000000Z" -> "2026-07-18"
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

async function fetchTimelineTone(topicId: string): Promise<MediaObservation[]> {
  const cached = cache.get(topicId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.observations;

  // Serialize all outbound GDELT calls through one queue, spaced out, so
  // concurrent panel loads never burst past the documented rate limit.
  const run = requestChain.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    const url = `${GDELT_BASE_URL}?query=${encodeURIComponent(topicId)}&mode=timelinetone&timespan=1m&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GDELT API returned ${res.status} for "${topicId}"`);
    const text = await res.text();
    const data = JSON.parse(text); // GDELT returns plain-text rate-limit notices, not JSON, when throttled
    const series = data.timeline?.[0]?.data as Array<{ date: string; value: number }> | undefined;
    const observations = (series ?? []).map((row) => ({ date: parseGdeltDate(row.date), value: row.value }));
    cache.set(topicId, { observations, fetchedAt: Date.now() });
    return observations;
  });

  requestChain = run.then(() => undefined, () => undefined);
  return run;
}

function emptyQuote(topicId: string): MediaQuote {
  const profile = getMediaTopicProfile(topicId);
  return {
    topicId, name: profile?.name ?? topicId, unit: "Tone Score",
    value: null, previousValue: null, change: null, changePercent: null, asOf: null, isLive: false,
  };
}

export async function getMediaQuote(topicId: string): Promise<MediaQuote> {
  const profile = getMediaTopicProfile(topicId);
  try {
    const obs = await fetchTimelineTone(topicId);
    if (!obs.length) return emptyQuote(topicId);
    const latest = obs[obs.length - 1];
    const previous = obs.length > 1 ? obs[obs.length - 2] : null;
    const change = previous ? latest.value - previous.value : null;
    const changePercent = previous && previous.value !== 0 ? (change! / Math.abs(previous.value)) * 100 : null;
    return {
      topicId, name: profile?.name ?? topicId, unit: "Tone Score",
      value: latest.value, previousValue: previous?.value ?? null, change, changePercent,
      asOf: latest.date, isLive: true,
    };
  } catch (err) {
    console.warn(`GDELT fetch failed for "${topicId}":`, err instanceof Error ? err.message : err);
    return emptyQuote(topicId);
  }
}

export async function getMediaQuotes(topicIds: string[]): Promise<MediaQuote[]> {
  const results: MediaQuote[] = [];
  for (const id of topicIds) results.push(await getMediaQuote(id));
  return results;
}

export async function getMediaHistory(topicId: string): Promise<MediaObservation[]> {
  try {
    return await fetchTimelineTone(topicId);
  } catch (err) {
    console.warn(`GDELT history fetch failed for "${topicId}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Mention volume (coverage intensity, distinct from tone) ────────────────
// GDELT's timelinevolinfo mode returns the % of that day's monitored global
// news volume matching the query -- a real "how much is this being covered"
// signal, independent of whether the coverage is positive or negative.
// Routed through the same rate-limited/cached queue as tone.

const volumeCache = new Map<string, CacheEntry>();

async function fetchTimelineVolume(topicId: string): Promise<MediaObservation[]> {
  const cached = volumeCache.get(topicId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.observations;

  const run = requestChain.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    const url = `${GDELT_BASE_URL}?query=${encodeURIComponent(topicId)}&mode=timelinevolinfo&timespan=1m&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GDELT API returned ${res.status} for "${topicId}"`);
    const text = await res.text();
    const data = JSON.parse(text);
    const series = data.timeline?.[0]?.data as Array<{ date: string; value: number }> | undefined;
    const observations = (series ?? []).map((row) => ({ date: parseGdeltDate(row.date), value: row.value }));
    volumeCache.set(topicId, { observations, fetchedAt: Date.now() });
    return observations;
  });

  requestChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function getMediaVolume(topicId: string): Promise<MediaObservation[]> {
  try {
    return await fetchTimelineVolume(topicId);
  } catch (err) {
    console.warn(`GDELT volume fetch failed for "${topicId}":`, err instanceof Error ? err.message : err);
    return [];
  }
}
