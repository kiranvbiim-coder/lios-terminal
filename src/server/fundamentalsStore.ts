/**
 * Persistent on-disk store for company fundamentals (market cap, P/E, EPS,
 * revenue, etc.), mirroring marketHistoryStore.ts's convention -- one JSON file per
 * symbol, so a restart doesn't lose everything and Quote/Valuation/Peer-Comp
 * panels don't force a fresh yfinance fetch on every load. Fundamentals move
 * far slower than price (most fields update quarterly), so the TTL here is
 * measured in hours, not the minutes appropriate for a live quote.
 */
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

function storeRoot(): string {
  return dataPath("fundamentals");
}

export const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000; // 24h -- these barely move intraday

export interface Fundamentals {
  symbol: string;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  priceToBook: number | null;
  dividendYield: number | null;
  beta: number | null;
  totalRevenue: number | null;
  profitMargins: number | null;
  revenueGrowth: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sharesOutstanding: number | null;
  bookValue: number | null;
  returnOnEquity: number | null;
  debtToEquity: number | null;
  sector: string | null;
  industry: string | null;
  longName: string | null;
  currency: string | null;
}

interface StoredFundamentals {
  data: Fundamentals;
  fetchedAt: number;
}

const memory = new Map<string, StoredFundamentals>();

function ensureStoreDir(): void {
  if (!fs.existsSync(storeRoot())) fs.mkdirSync(storeRoot(), { recursive: true });
}

// Same conservative filename-safe encoding as marketHistoryStore.ts (symbols like
// ^GSPC, GC=F, BRK-B, 0P0000ABC.BO contain filesystem-unsafe characters).
function fileFor(symbol: string): string {
  const safe = symbol.toUpperCase().replace(/[^A-Z0-9.\-]/g, (ch) => `_${ch.charCodeAt(0)}_`);
  return path.join(storeRoot(), `${safe}.json`);
}

export function loadFundamentals(symbol: string): StoredFundamentals | null {
  const upper = symbol.toUpperCase();
  const hit = memory.get(upper);
  if (hit) return hit;
  try {
    const file = fileFor(upper);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredFundamentals;
    if (!parsed.data) return null;
    memory.set(upper, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function saveFundamentals(symbol: string, data: Fundamentals): StoredFundamentals {
  const upper = symbol.toUpperCase();
  const record: StoredFundamentals = { data, fetchedAt: Date.now() };
  memory.set(upper, record);
  try {
    ensureStoreDir();
    fs.writeFileSync(fileFor(upper), JSON.stringify(record));
  } catch (err) {
    console.warn(`[fundamentalsStore] failed to persist ${upper}:`, err);
  }
  return record;
}

export function isFreshFundamentals(stored: StoredFundamentals): boolean {
  return Date.now() - stored.fetchedAt < FUNDAMENTALS_TTL_MS;
}
