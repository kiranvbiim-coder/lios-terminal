/**
 * Kenneth French Data Library connector -- the official, free, public
 * source of real Fama-French/Carhart factor returns
 * (mba.tuck.dartmouth.edu/pages/faculty/ken.french). No API key, no
 * registration. Files are zipped daily CSVs; unzipped server-side with
 * fflate (Node has no built-in zip support) and parsed into date-keyed
 * factor rows.
 *
 * This replaces what was previously a fake "Fama-French" 2-asset OLS proxy
 * in PortfolioOptimizerPanel.tsx with the real academic factor definitions:
 * Mkt-RF, SMB (size), HML (value), RMW (profitability), CMA (investment),
 * Mom (momentum), and RF (risk-free rate).
 *
 * Same disk-cache resilience pattern as the other connectors. TTL 24h --
 * Ken French refreshes these files periodically, not intraday.
 */
import fs from "fs";
import path from "path";
import { unzipSync } from "fflate";
import { dataPath } from "./dataRoot";

const BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheDir(): string {
  return dataPath("famafrench-cache");
}

function cachePathFor(key: string): string {
  return path.join(cacheDir(), `${key}.json`);
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

async function fetchAndUnzipCsv(zipUrl: string, cacheKey: string): Promise<string | null> {
  const cached = readCache<string>(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  try {
    const res = await fetch(zipUrl);
    if (!res.ok) throw new Error(`Ken French library returned ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf);
    const firstName = Object.keys(files)[0];
    const text = new TextDecoder().decode(files[firstName]);
    writeCache(cacheKey, text);
    return text;
  } catch (err) {
    console.warn(`Ken French fetch failed for ${zipUrl}, falling back to cache:`, err instanceof Error ? err.message : err);
    return cached?.data ?? null;
  }
}

function ymdToIso(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

// Every one of these files uses the same shape: a few lines of prose header,
// then `date,col1,col2,...` data rows (date = 8-digit YYYYMMDD, no dashes),
// then a trailing blank line + copyright notice. Only lines starting with
// an 8-digit date are real data.
function parseFactorCsv(text: string, columns: string[]): Record<string, Record<string, number>> {
  const rows: Record<string, Record<string, number>> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!/^\d{8},/.test(trimmed)) continue;
    const parts = trimmed.split(",").map((p) => p.trim()).filter((p) => p !== "");
    if (parts.length < columns.length + 1) continue;
    const date = ymdToIso(parts[0]);
    const row: Record<string, number> = {};
    columns.forEach((col, i) => { row[col] = Number(parts[i + 1]); });
    rows[date] = row;
  }
  return rows;
}

let factors3Promise: Promise<Record<string, Record<string, number>>> | null = null;
let momentumPromise: Promise<Record<string, Record<string, number>>> | null = null;
let factors5Promise: Promise<Record<string, Record<string, number>>> | null = null;

async function getFactors3Raw() {
  if (!factors3Promise) {
    factors3Promise = (async () => {
      const text = await fetchAndUnzipCsv(`${BASE}/F-F_Research_Data_Factors_daily_CSV.zip`, "factors3_daily");
      return text ? parseFactorCsv(text, ["MktRF", "SMB", "HML", "RF"]) : {};
    })();
  }
  return factors3Promise;
}

async function getMomentumRaw() {
  if (!momentumPromise) {
    momentumPromise = (async () => {
      const text = await fetchAndUnzipCsv(`${BASE}/F-F_Momentum_Factor_daily_CSV.zip`, "momentum_daily");
      return text ? parseFactorCsv(text, ["Mom"]) : {};
    })();
  }
  return momentumPromise;
}

async function getFactors5Raw() {
  if (!factors5Promise) {
    factors5Promise = (async () => {
      const text = await fetchAndUnzipCsv(`${BASE}/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip`, "factors5_daily");
      return text ? parseFactorCsv(text, ["MktRF", "SMB", "HML", "RMW", "CMA", "RF"]) : {};
    })();
  }
  return factors5Promise;
}

export interface FactorRow3 { date: string; MktRF: number; SMB: number; HML: number; RF: number }
export interface FactorRow4 extends FactorRow3 { Mom: number }
export interface FactorRow5 { date: string; MktRF: number; SMB: number; HML: number; RMW: number; CMA: number; RF: number }

export async function isFamaFrenchAvailable(): Promise<boolean> {
  const raw = await getFactors3Raw();
  return Object.keys(raw).length > 0;
}

export async function getFamaFrench3Factors(startDate: string, endDate: string): Promise<FactorRow3[]> {
  const raw = await getFactors3Raw();
  return Object.entries(raw)
    .filter(([date]) => date >= startDate && date <= endDate)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, r]) => ({ date, MktRF: r.MktRF, SMB: r.SMB, HML: r.HML, RF: r.RF }));
}

// Carhart 4-factor = Fama-French 3-factor + momentum, joined on date.
export async function getCarhart4Factors(startDate: string, endDate: string): Promise<FactorRow4[]> {
  const [ff3, mom] = await Promise.all([getFactors3Raw(), getMomentumRaw()]);
  const dates = Object.keys(ff3).filter((d) => d >= startDate && d <= endDate && mom[d] !== undefined).sort();
  return dates.map((date) => ({ date, MktRF: ff3[date].MktRF, SMB: ff3[date].SMB, HML: ff3[date].HML, RF: ff3[date].RF, Mom: mom[date].Mom }));
}

export async function getFamaFrench5Factors(startDate: string, endDate: string): Promise<FactorRow5[]> {
  const raw = await getFactors5Raw();
  return Object.entries(raw)
    .filter(([date]) => date >= startDate && date <= endDate)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, r]) => ({ date, MktRF: r.MktRF, SMB: r.SMB, HML: r.HML, RMW: r.RMW, CMA: r.CMA, RF: r.RF }));
}
