/**
 * Bureau of Labor Statistics (BLS) connector. The public tier needs no
 * credential and allows ten-year windows; an optional registration key
 * (`BLS_API_KEY`/`blsApiKey`) enables the registered twenty-year window.
 * Requests remain bounded to one series here and never claim a full catalog.
 * https://www.bls.gov/developers/
 *
 * FRED already re-publishes BLS's headline unemployment rate (UNRATE), so
 * this connector is for series FRED's catalog doesn't carry: wage growth,
 * the input real-world Taylor Rule / cost-of-living discussions actually
 * use alongside CPI, not just the unemployment rate.
 *
 * Same disk-cache resilience pattern as the other connectors, TTL 12h since
 * this is a monthly series.
 */
import fs from "fs";
import path from "path";
import { getCredential } from "./terminalConfig";
import { recordConnectorVerification } from "./connectorVerification";
import { dataPath } from "./dataRoot";

const BLS_BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
export const BLS_UNREGISTERED_WINDOW_YEARS = 10;
export const BLS_REGISTERED_WINDOW_YEARS = 20;
export const BLS_MAX_YEARS_BACK = 100;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function cacheDir(): string {
  return dataPath("bls-cache");
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
  }
}

export interface BlsObservation { date: string; value: number } // date = "YYYY-MM-01"
export type BlsFetchStatus = "live" | "cached" | "unavailable";
export interface BlsSeriesResult {
  seriesId: string; name: string; unit: string; history: BlsObservation[]; isLive: boolean;
  status: BlsFetchStatus; retrievedAt: string | null; sourceReference: string;
}
export interface BlsSeriesOptions { yearsBack?: number; startYear?: number; endYear?: number }

export interface BlsSeriesProfile { seriesId: string; name: string; unit: string }

export const BLS_CATALOG: BlsSeriesProfile[] = [
  { seriesId: "CES0500000003", name: "Average Hourly Earnings (Total Private)", unit: "$/hr" },
];

const PERIOD_TO_MONTH: Record<string, string> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`M${String(i + 1).padStart(2, "0")}`, String(i + 1).padStart(2, "0")]),
);

interface BlsRawResponse {
  status: string;
  Results?: { series: Array<{ seriesID: string; data: Array<{ year: string; period: string; value: string }> }> };
}

function normalizeBlsOptions(input: number | BlsSeriesOptions): { startYear: number; endYear: number; yearsBack: number; windowYears: number; apiKey: string | null } {
  const apiKey = getCredential("BLS_API_KEY", "blsApiKey");
  const currentYear = new Date().getFullYear();
  const options = typeof input === "number" ? { yearsBack: input } : input;
  const yearsBack = options.yearsBack ?? 10;
  if (!Number.isInteger(yearsBack) || yearsBack < 1 || yearsBack > BLS_MAX_YEARS_BACK) throw new RangeError(`yearsBack must be an integer between 1 and ${BLS_MAX_YEARS_BACK}`);
  const startYear = options.startYear ?? currentYear - yearsBack;
  const endYear = options.endYear ?? currentYear;
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1900 || endYear < 1900 || startYear > endYear || endYear > currentYear + 1) throw new RangeError("startYear/endYear must be valid years with startYear on or before endYear");
  if (endYear - startYear > BLS_MAX_YEARS_BACK) throw new RangeError(`date range cannot exceed ${BLS_MAX_YEARS_BACK} years`);
  return { startYear, endYear, yearsBack, windowYears: apiKey ? BLS_REGISTERED_WINDOW_YEARS : BLS_UNREGISTERED_WINDOW_YEARS, apiKey };
}
export function buildBlsWindows(startYear: number, endYear: number, windowYears: number): Array<{ startYear: number; endYear: number }> {
  const windows: Array<{ startYear: number; endYear: number }> = [];
  let cursor = endYear;
  while (cursor >= startYear) {
    const start = Math.max(startYear, cursor - windowYears);
    windows.push({ startYear: start, endYear: cursor });
    if (start === startYear) break;
    cursor = start;
  }
  return windows;
}

export function mergeBlsObservations(chunks: BlsObservation[][]): BlsObservation[] {
  const byDate = new Map<string, BlsObservation>();
  for (const chunk of chunks) for (const observation of chunk) byDate.set(observation.date, observation);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildBlsRequestBody(seriesId: string, startYear: number, endYear: number, apiKey: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = { seriesid: [seriesId], startyear: String(startYear), endyear: String(endYear) };
  if (apiKey) body.registrationkey = apiKey;
  return body;
}

async function fetchBlsWindow(seriesId: string, startYear: number, endYear: number, apiKey: string | null): Promise<BlsObservation[]> {
  const res = await fetch(BLS_BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildBlsRequestBody(seriesId, startYear, endYear, apiKey)) });
  if (!res.ok) throw new Error(`BLS API returned ${res.status}`);
  const data = (await res.json()) as BlsRawResponse;
  if (data.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS API status: ${data.status}`);
  return (data.Results?.series?.[0]?.data ?? [])
    .filter((r) => PERIOD_TO_MONTH[r.period] && r.value !== "")
    .map((r) => ({ date: `${r.year}-${PERIOD_TO_MONTH[r.period]}-01`, value: parseFloat(r.value) }))
    .filter((r) => Number.isFinite(r.value));
}

export async function getBlsSeries(seriesId: string, input: number | BlsSeriesOptions = 10): Promise<BlsSeriesResult> {
  const normalizedId = seriesId.trim().toUpperCase();
  if (!normalizedId) throw new RangeError("seriesId is required");
  const options = normalizeBlsOptions(input);
  const profile = BLS_CATALOG.find((s) => s.seriesId === normalizedId);
  const cacheKey = `bls_${normalizedId}_${options.startYear}_${options.endYear}`;
  const cached = readCache<BlsObservation[]>(cacheKey);
  const sourceReference = `${BLS_BASE}${normalizedId}`;
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { seriesId: normalizedId, name: profile?.name ?? normalizedId, unit: profile?.unit ?? "", history: cached.data, isLive: false, status: "cached", retrievedAt: new Date(cached.cachedAt).toISOString(), sourceReference };
  }
  try {
    const chunks: BlsObservation[][] = [];
    for (const window of buildBlsWindows(options.startYear, options.endYear, options.windowYears)) {
      chunks.push(await fetchBlsWindow(normalizedId, window.startYear, window.endYear, options.apiKey));
    }
    const history = mergeBlsObservations(chunks);
    writeCache(cacheKey, history);
    recordConnectorVerification("bls", true, "BLS responded to a live request.");
    return { seriesId: normalizedId, name: profile?.name ?? normalizedId, unit: profile?.unit ?? "", history, isLive: true, status: "live", retrievedAt: new Date().toISOString(), sourceReference };
  } catch (err) {
    recordConnectorVerification("bls", false, err instanceof Error ? err.message : String(err));
    console.warn(`BLS fetch failed for ${normalizedId}, falling back to cache:`, err instanceof Error ? err.message : err);
    const fallback = cached?.data ?? [];
    return { seriesId: normalizedId, name: profile?.name ?? normalizedId, unit: profile?.unit ?? "", history: fallback, isLive: false, status: fallback.length ? "cached" : "unavailable", retrievedAt: cached ? new Date(cached.cachedAt).toISOString() : null, sourceReference };
  }
}
