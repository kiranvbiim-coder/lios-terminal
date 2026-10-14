/**
 * Persistent on-disk store for daily OHLCV history.
 *
 * Instead of re-fetching a symbol's full history from Yahoo/Stooq/yfinance on
 * every request (and losing it all on restart — the in-memory cache is
 * ephemeral), daily bars are persisted once per symbol and only the missing
 * recent tail is fetched on subsequent requests. Charts open instantly from
 * disk and upstream load drops from "full history per request" to "a few new
 * bars per symbol per day".
 *
 * Layout: one JSON file per symbol under the store directory
 * (`<data root>/history`, see dataRoot.ts). Only daily (1d) bars are persisted; intraday data
 * is inherently ephemeral and stays in the in-memory cache.
 *
 * The store can be bulk-seeded from Stooq's free full-market historical
 * database (https://stooq.com/db/h/) via `npm run history:import` — see
 * script/import_stooq_db.ts.
 */
import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import type { OHLCVBar } from "./marketData";
import { dataPath } from "./dataRoot";

// How long a store file with a non-current last bar is still trusted before
// we try topping it up again. Prevents refetch storms for delisted/illiquid
// symbols that will never produce a current bar.
const STALE_RETRY_MS = 6 * 60 * 60 * 1000;

export interface StoredHistoryProvenance {
  sourceRefs: string[];
  providerIds: string[];
  providerLabels: string[];
  observedAt: string;
  asOf: string | null;
  isFallback: boolean;
}

export interface StoredHistory {
  symbol: string;
  updatedAt: number;
  bars: OHLCVBar[];
  /** Indicates whether persisted bars already include the BSE split/bonus pass. */
  adjustmentState?: "raw" | "split_bonus_adjusted";
  /** P3: upstream lineage for newly persisted bars. Legacy stores may omit it. */
  provenance?: StoredHistoryProvenance;
}

// Memoize loaded files so repeated requests don't re-read/parse from disk.
const memory = new Map<string, StoredHistory>();

export function historyStorageNamespace(scopeKey = "global"): string {
  if (!scopeKey || scopeKey === "global") return "";
  const digest = crypto.createHash("sha256").update(scopeKey).digest("hex").slice(0, 32);
  return path.join("scoped", digest);
}

function directoryFor(scopeKey = "global"): string {
  const namespace = historyStorageNamespace(scopeKey);
  return namespace ? path.join(storeDir(), namespace) : storeDir();
}

function ensureStoreDir(scopeKey = "global"): void {
  const directory = directoryFor(scopeKey);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

// Symbols may contain characters unsafe in filenames (^GSPC, GC=F, BRK-B,
// 0P0000ABC.BO). Encode conservatively; decoding is never needed because the
// symbol is stored inside the file too.
function fileFor(symbol: string, scopeKey = "global"): string {
  const safe = symbol.toUpperCase().replace(/[^A-Z0-9.\-]/g, (ch) => `_${ch.charCodeAt(0)}_`);
  return path.join(directoryFor(scopeKey), `${safe}.json`);
}

function memoryKey(symbol: string, scopeKey = "global"): string {
  return `${scopeKey || "global"}:${symbol.toUpperCase()}`;
}

export function loadHistory(symbol: string, scopeKey = "global"): StoredHistory | null {
  const upper = symbol.toUpperCase();
  const key = memoryKey(upper, scopeKey);
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const file = fileFor(upper, scopeKey);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredHistory;
    if (!Array.isArray(parsed.bars)) return null;
    memory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Merge new bars into the stored set (dedup by date, sorted) and persist atomically. */
export function saveHistory(
  symbol: string,
  newBars: OHLCVBar[],
  adjustmentState: "raw" | "split_bonus_adjusted" = "raw",
  provenance?: StoredHistoryProvenance,
  scopeKey = "global",
): StoredHistory {
  const upper = symbol.toUpperCase();
  const existing = loadHistory(upper, scopeKey);
  const isBseHistory = upper.endsWith(".BO");
  if (isBseHistory && existing?.bars.length && existing.adjustmentState === undefined) {
    throw new Error(`History provenance is unavailable for ${upper}; rebuild it before merging.`);
  }
  if (isBseHistory && existing && existing.adjustmentState !== adjustmentState) {
    const incomingDates = new Set(newBars.map((bar) => bar.date));
    const existingDates = new Set(existing.bars.map((bar) => bar.date));
    const replacesExistingSeries =
      incomingDates.size === existingDates.size &&
      [...existingDates].every((date) => incomingDates.has(date));
    if (!replacesExistingSeries) {
      throw new Error(`History adjustment state transition for ${upper} requires a complete replacement series.`);
    }
  }
  const byDate = new Map<string, OHLCVBar>();
  for (const bar of existing?.bars ?? []) byDate.set(bar.date, bar);
  for (const bar of newBars) byDate.set(bar.date, bar);
  const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  const mergedProvenance = provenance
    ? existing?.provenance
      ? {
          sourceRefs: [...new Set([...existing.provenance.sourceRefs, ...provenance.sourceRefs])],
          providerIds: [...new Set([...existing.provenance.providerIds, ...provenance.providerIds])],
          providerLabels: [...new Set([...existing.provenance.providerLabels, ...provenance.providerLabels])],
          observedAt: provenance.observedAt,
          asOf: provenance.asOf ?? existing.provenance.asOf,
          isFallback: existing.provenance.isFallback || provenance.isFallback,
        }
      : existing?.bars.length
        ? {
            sourceRefs: [...new Set(["provenance:legacy-unattributed", ...provenance.sourceRefs])],
            providerIds: [...provenance.providerIds],
            providerLabels: [...new Set(["Legacy unattributed history", ...provenance.providerLabels])],
            observedAt: provenance.observedAt,
            asOf: provenance.asOf,
            isFallback: provenance.isFallback,
          }
        : provenance
    : existing?.provenance;
  const record: StoredHistory = { symbol: upper, updatedAt: Date.now(), bars: merged, adjustmentState, ...(mergedProvenance ? { provenance: mergedProvenance } : {}) };
  memory.set(memoryKey(upper, scopeKey), record);
  try {
    ensureStoreDir(scopeKey);
    const file = fileFor(upper, scopeKey);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record), "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn(`Failed to persist history for ${upper}:`, err);
  }
  return record;
}

/** Atomically replaces a complete history series. Intended for full raw
 * rebuilds that migrate legacy or adjusted BSE records without mixing bases. */
export function replaceHistory(
  symbol: string,
  bars: OHLCVBar[],
  adjustmentState: "raw" | "split_bonus_adjusted" = "raw",
  provenance?: StoredHistoryProvenance,
  scopeKey = "global",
): StoredHistory {
  const upper = symbol.toUpperCase();
  const record: StoredHistory = {
    symbol: upper,
    updatedAt: Date.now(),
    bars: [...bars].sort((a, b) => a.date.localeCompare(b.date)),
    adjustmentState,
    ...(provenance ? { provenance } : {}),
  };
  memory.set(memoryKey(upper, scopeKey), record);
  try {
    ensureStoreDir(scopeKey);
    const file = fileFor(upper, scopeKey);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record), "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn(`Failed to replace history for ${upper}:`, err);
  }
  return record;

}
/** Most recent weekday (UTC) as YYYY-MM-DD — approximates the last trading day. */
function lastExpectedTradingDay(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Walk back over the weekend; markets may also lag a day pre-close/holidays,
  // so accept one extra day of slack.
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** True if the stored bars are current enough to serve without an upstream fetch. */
export function isFresh(stored: StoredHistory): boolean {
  const last = stored.bars[stored.bars.length - 1];
  if (!last) return false;
  if (last.date >= lastExpectedTradingDay()) return true;
  return Date.now() - stored.updatedAt < STALE_RETRY_MS;
}

/** True if the stored series reaches back far enough to cover `days` of lookback. */
export function coversRange(stored: StoredHistory, days: number): boolean {
  const first = stored.bars[0];
  if (!first) return false;
  if (stored.bars.length >= days) return true;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return first.date <= cutoff;
}

export function storeDir(): string {
  return dataPath("history");
}

export function storedSymbolCount(): number {
  try {
    if (!fs.existsSync(storeDir())) return 0;
    return fs.readdirSync(storeDir()).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

/**
 * Every symbol currently persisted, decoded straight from filenames --
 * cheap enough to call per-request (a directory listing + string replace,
 * no file reads) so callers building a broad candidate pool (screener,
 * market movers) can include every symbol this app has ever successfully
 * fetched, not just a hand-picked seed list.
 */
export function listStoredSymbols(): string[] {
  try {
    if (!fs.existsSync(storeDir())) return [];
    return fs.readdirSync(storeDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length).replace(/_(\d+)_/g, (_, code) => String.fromCharCode(Number(code))));
  } catch {
    return [];
  }
}
