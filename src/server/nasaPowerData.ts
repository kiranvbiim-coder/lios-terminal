/**
 * NASA POWER connector -- the official, free, public satellite-derived
 * climate/weather API at power.larc.nasa.gov. No API key, no registration,
 * no rate-limit account. Point-based daily meteorology for any lat/lon on
 * Earth, which is what lets this serve three domains at once: Environment
 * & Sustainability (climate monitoring), Supply Chain (weather risk at
 * major ports/trade routes), and Tourism & Hospitality (destination
 * climate conditions) -- one connector, tagged locations per domain.
 *
 * Same disk-cache resilience pattern as the other connectors. TTL 6h --
 * NASA POWER's near-real-time layer updates with a short satellite-data
 * lag, so daily figures can shift slightly as they finalize.
 */
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

const POWER_BASE = "https://power.larc.nasa.gov/api/temporal/daily/point";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheDir(): string {
  return dataPath("nasapower-cache");
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

async function powerFetch<T>(url: string, cacheKey: string): Promise<T | null> {
  const cached = readCache<T>(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`NASA POWER API returned ${res.status}`);
    const data = (await res.json()) as T;
    writeCache(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`NASA POWER fetch failed for ${url}, falling back to cache:`, err instanceof Error ? err.message : err);
    return cached?.data ?? null;
  }
}

export type LocationTag = "port" | "tourist_hub" | "both";

export interface ClimateLocation { code: string; name: string; lat: number; lon: number; tag: LocationTag }

// Real coordinates for major global ports and tourist destinations --
// several serve both roles (Singapore, Dubai, Rotterdam-adjacent Amsterdam
// area cities are major cruise/tourism hubs too), tagged accordingly.
export const CLIMATE_LOCATIONS: ClimateLocation[] = [
  { code: "SGP", name: "Singapore (Port of Singapore)", lat: 1.29, lon: 103.85, tag: "both" },
  { code: "SHA", name: "Shanghai (Port of Shanghai)", lat: 31.23, lon: 121.47, tag: "port" },
  { code: "RTM", name: "Rotterdam (Port of Rotterdam)", lat: 51.92, lon: 4.48, tag: "port" },
  { code: "LAX", name: "Los Angeles / Long Beach (Port)", lat: 33.74, lon: -118.26, tag: "port" },
  { code: "DXB", name: "Dubai (Jebel Ali Port)", lat: 25.02, lon: 55.06, tag: "both" },
  { code: "HKG", name: "Hong Kong (Port)", lat: 22.28, lon: 114.17, tag: "both" },
  { code: "BUS", name: "Busan (Port of Busan)", lat: 35.1, lon: 129.04, tag: "port" },
  { code: "MUM", name: "Mumbai (JNPT Port)", lat: 18.95, lon: 72.95, tag: "port" },
  { code: "PAR", name: "Paris", lat: 48.86, lon: 2.35, tag: "tourist_hub" },
  { code: "BKK", name: "Bangkok", lat: 13.76, lon: 100.5, tag: "tourist_hub" },
  { code: "NYC", name: "New York City", lat: 40.71, lon: -74.01, tag: "tourist_hub" },
  { code: "LON", name: "London", lat: 51.51, lon: -0.13, tag: "tourist_hub" },
  { code: "BCN", name: "Barcelona", lat: 41.39, lon: 2.17, tag: "tourist_hub" },
  { code: "CUN", name: "Cancun", lat: 21.16, lon: -86.85, tag: "tourist_hub" },
  { code: "BAL", name: "Bali (Denpasar)", lat: -8.65, lon: 115.22, tag: "tourist_hub" },
  { code: "CAI", name: "Cairo", lat: 30.04, lon: 31.24, tag: "tourist_hub" },
];

export function getClimateLocationsByTag(tag?: LocationTag): ClimateLocation[] {
  if (!tag) return CLIMATE_LOCATIONS;
  return CLIMATE_LOCATIONS.filter((l) => l.tag === tag || l.tag === "both");
}

const PARAMS = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,WS2M,ALLSKY_SFC_SW_DWN";

interface RawPowerResponse {
  properties: { parameter: Record<string, Record<string, number>> };
}

export interface ClimateReading {
  date: string;
  tempAvgC: number | null; tempMaxC: number | null; tempMinC: number | null;
  precipMm: number | null; windSpeedMs: number | null; solarKwhM2: number | null;
}

export interface ClimateSnapshot {
  location: ClimateLocation;
  readings: ClimateReading[];
  latest: ClimateReading | null;
  isLive: boolean;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// NASA POWER's near-real-time layer trails by a few days; request a wider
// window and only present readings that actually came back with data.
export async function getClimateSnapshot(locationCode: string, days = 7): Promise<ClimateSnapshot | null> {
  const location = CLIMATE_LOCATIONS.find((l) => l.code === locationCode.toUpperCase());
  if (!location) return null;

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (days + 5));
  const url = `${POWER_BASE}?parameters=${PARAMS}&community=RE&longitude=${location.lon}&latitude=${location.lat}&start=${fmtDate(start)}&end=${fmtDate(end)}&format=JSON`;

  const raw = await powerFetch<RawPowerResponse>(url, `climate_${location.code}_${days}`);
  const params = raw?.properties?.parameter;
  if (!params) return { location, readings: [], latest: null, isLive: false };

  const dates = Object.keys(params.T2M ?? {}).sort();
  const FILL = -999;
  const clean = (v: number | undefined): number | null => (v === undefined || v === FILL ? null : v);

  const readings: ClimateReading[] = dates
    .map((d) => ({
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      tempAvgC: clean(params.T2M?.[d]),
      tempMaxC: clean(params.T2M_MAX?.[d]),
      tempMinC: clean(params.T2M_MIN?.[d]),
      precipMm: clean(params.PRECTOTCORR?.[d]),
      windSpeedMs: clean(params.WS2M?.[d]),
      solarKwhM2: clean(params.ALLSKY_SFC_SW_DWN?.[d]),
    }))
    .filter((r) => r.tempAvgC !== null)
    .slice(-days);

  return { location, readings, latest: readings[readings.length - 1] ?? null, isLive: readings.length > 0 };
}

export async function getClimateSnapshotsForTag(tag?: LocationTag): Promise<ClimateSnapshot[]> {
  const locations = getClimateLocationsByTag(tag);
  const results = await Promise.all(locations.map((l) => getClimateSnapshot(l.code, 3)));
  return results.filter((r): r is ClimateSnapshot => r !== null);
}
