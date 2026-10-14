/**
 * CFTC Commitments of Traders connector -- the official, free, public Socrata
 * API at publicreporting.cftc.gov (dataset 6dca-aqww, "Legacy Futures Only").
 * No API key, no registration, no rate-limit account, no ToS restriction on
 * redistribution -- this is public-domain US government data, the same
 * primary source every commercial COT reseller (including LSE) repackages.
 * Chosen over the Disaggregated/TFF variants because Legacy covers every
 * asset class (metals, energy, ag, financials, FX) in one uniform schema and
 * carries fields LSE's COT feed doesn't expose: %-of-open-interest
 * breakdowns, reporting trader counts, and top-4/top-8 concentration ratios.
 *
 * Same disk-cache resilience pattern as lseData.ts (last-good response
 * served on a failed live fetch), TTL set to 6 hours since CFTC only
 * publishes new reports weekly (Fridays, for the prior Tuesday).
 */
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

const CFTC_BASE = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function cacheDir(): string {
  return dataPath("cftc-cache");
}

function cachePathFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
  return path.join(cacheDir(), `${safe}.json`);
}

function readCache<T>(key: string): T | null {
  try {
    const file = cachePathFor(key);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw.data as T;
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

function isCacheFresh(key: string): boolean {
  try {
    const file = cachePathFor(key);
    if (!fs.existsSync(file)) return false;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return Date.now() - raw.cachedAt < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

async function cftcFetch<T>(params: Record<string, string>): Promise<T | null> {
  const cacheKey = JSON.stringify(params);
  if (isCacheFresh(cacheKey)) {
    const cached = readCache<T>(cacheKey);
    if (cached !== null) return cached;
  }
  try {
    const url = new URL(CFTC_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`CFTC API returned ${res.status}`);
    const data = (await res.json()) as T;
    writeCache(cacheKey, data);
    return data;
  } catch (err) {
    console.warn("CFTC fetch failed, falling back to cache:", err instanceof Error ? err.message : err);
    return readCache<T>(cacheKey);
  }
}

export interface CftcMarket { code: string; label: string; marketName: string }

// Real market_and_exchange_names values, verified against the live dataset --
// not guessed. Mirrors the 10 futures codes the COT panel already exposes.
export const CFTC_PRESET_MARKETS: CftcMarket[] = [
  { code: "GC", label: "Gold", marketName: "GOLD - COMMODITY EXCHANGE INC." },
  { code: "SI", label: "Silver", marketName: "SILVER - COMMODITY EXCHANGE INC." },
  { code: "CL", label: "Crude Oil (WTI)", marketName: "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE" },
  { code: "NG", label: "Natural Gas", marketName: "NATURAL GAS - NEW YORK MERCANTILE EXCHANGE" },
  { code: "ES", label: "E-mini S&P 500", marketName: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE" },
  { code: "ZW", label: "Wheat", marketName: "WHEAT - CHICAGO BOARD OF TRADE" },
  { code: "ZC", label: "Corn", marketName: "CORN - CHICAGO BOARD OF TRADE" },
  { code: "ZS", label: "Soybeans", marketName: "SOYBEANS - CHICAGO BOARD OF TRADE" },
  { code: "HG", label: "Copper", marketName: "COPPER-GRADE #1 - COMMODITY EXCHANGE INC." },
  { code: "6E", label: "Euro FX", marketName: "EURO FX - CHICAGO MERCANTILE EXCHANGE" },
];

interface RawCftcRow {
  report_date_as_yyyy_mm_dd: string;
  market_and_exchange_names: string;
  commodity_name: string;
  open_interest_all: string;
  noncomm_positions_long_all: string;
  noncomm_positions_short_all: string;
  noncomm_postions_spread_all: string;
  comm_positions_long_all: string;
  comm_positions_short_all: string;
  nonrept_positions_long_all: string;
  nonrept_positions_short_all: string;
  pct_of_oi_noncomm_long_all: string;
  pct_of_oi_noncomm_short_all: string;
  pct_of_oi_comm_long_all: string;
  pct_of_oi_comm_short_all: string;
  traders_noncomm_long_all: string;
  traders_noncomm_short_all: string;
  traders_comm_long_all: string;
  traders_comm_short_all: string;
  conc_gross_le_4_tdr_long: string;
  conc_gross_le_4_tdr_short: string;
  conc_gross_le_8_tdr_long: string;
  conc_gross_le_8_tdr_short: string;
}

export interface CftcCotRow {
  symbol: string;
  date: string;
  name: string;
  sector: string;
  open_interest: number;
  noncomm_long: number;
  noncomm_short: number;
  noncomm_spread: number;
  comm_long: number;
  comm_short: number;
  nonrept_long: number;
  nonrept_short: number;
  change_open_interest: number | null;
  change_noncomm_long: number | null;
  change_noncomm_short: number | null;
  change_comm_long: number | null;
  change_comm_short: number | null;
  pct_noncomm_long: number;
  pct_noncomm_short: number;
  pct_comm_long: number;
  pct_comm_short: number;
  traders_noncomm_long: number;
  traders_noncomm_short: number;
  traders_comm_long: number;
  traders_comm_short: number;
  conc_top4_long: number;
  conc_top4_short: number;
  conc_top8_long: number;
  conc_top8_short: number;
}

const num = (v: string | undefined | null): number => (v ? Number(v) : 0);

function mapRow(raw: RawCftcRow, code: string, prev: RawCftcRow | undefined): CftcCotRow {
  return {
    symbol: code,
    date: raw.report_date_as_yyyy_mm_dd.slice(0, 10),
    name: raw.market_and_exchange_names,
    sector: raw.commodity_name,
    open_interest: num(raw.open_interest_all),
    noncomm_long: num(raw.noncomm_positions_long_all),
    noncomm_short: num(raw.noncomm_positions_short_all),
    noncomm_spread: num(raw.noncomm_postions_spread_all),
    comm_long: num(raw.comm_positions_long_all),
    comm_short: num(raw.comm_positions_short_all),
    nonrept_long: num(raw.nonrept_positions_long_all),
    nonrept_short: num(raw.nonrept_positions_short_all),
    change_open_interest: prev ? num(raw.open_interest_all) - num(prev.open_interest_all) : null,
    change_noncomm_long: prev ? num(raw.noncomm_positions_long_all) - num(prev.noncomm_positions_long_all) : null,
    change_noncomm_short: prev ? num(raw.noncomm_positions_short_all) - num(prev.noncomm_positions_short_all) : null,
    change_comm_long: prev ? num(raw.comm_positions_long_all) - num(prev.comm_positions_long_all) : null,
    change_comm_short: prev ? num(raw.comm_positions_short_all) - num(prev.comm_positions_short_all) : null,
    pct_noncomm_long: num(raw.pct_of_oi_noncomm_long_all),
    pct_noncomm_short: num(raw.pct_of_oi_noncomm_short_all),
    pct_comm_long: num(raw.pct_of_oi_comm_long_all),
    pct_comm_short: num(raw.pct_of_oi_comm_short_all),
    traders_noncomm_long: num(raw.traders_noncomm_long_all),
    traders_noncomm_short: num(raw.traders_noncomm_short_all),
    traders_comm_long: num(raw.traders_comm_long_all),
    traders_comm_short: num(raw.traders_comm_short_all),
    conc_top4_long: num(raw.conc_gross_le_4_tdr_long),
    conc_top4_short: num(raw.conc_gross_le_4_tdr_short),
    conc_top8_long: num(raw.conc_gross_le_8_tdr_long),
    conc_top8_short: num(raw.conc_gross_le_8_tdr_short),
  };
}

export async function getCftcCot(code: string, limit = 26): Promise<CftcCotRow[]> {
  const market = CFTC_PRESET_MARKETS.find((m) => m.code.toUpperCase() === code.toUpperCase());
  if (!market) return [];
  const rows = await cftcFetch<RawCftcRow[]>({
    "$where": `market_and_exchange_names = '${market.marketName.replace(/'/g, "''")}'`,
    "$order": "report_date_as_yyyy_mm_dd DESC",
    "$limit": String(limit),
  });
  if (!rows || !rows.length) return [];
  // rows arrive newest-first; pair each with the prior week for deltas
  return rows.map((raw, i) => mapRow(raw, market.code, rows[i + 1]));
}

export interface CftcMarketMatch { marketName: string; commodityName: string }

export async function searchCftcMarkets(query: string): Promise<CftcMarketMatch[]> {
  if (!query || query.length < 2) return [];
  const rows = await cftcFetch<Array<{ market_and_exchange_names: string; commodity_name: string }>>({
    "$select": "market_and_exchange_names,commodity_name",
    "$where": `market_and_exchange_names like '%${query.toUpperCase().replace(/'/g, "''")}%'`,
    "$group": "market_and_exchange_names,commodity_name",
    "$limit": "25",
  });
  return (rows ?? []).map((r) => ({ marketName: r.market_and_exchange_names, commodityName: r.commodity_name }));
}
