/**
 * BSE bhavcopy (daily whole-market OHLCV) connector. Shared by the backfill
 * script (script/import_bse_bhavcopy.ts, walks a large date range building
 * every symbol's history at once) and the live incremental top-up path in
 * getOHLCV (marketData.ts, walks just the last few days for one symbol) --
 * one parser, one fetch/cache layer, no duplicated logic between the two.
 *
 * TWO FORMATS, auto-dispatched by date:
 *
 * 1. MODERN (2024-01-03 onward), VERIFIED LIVE:
 *      https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{YYYYMMDD}_F_0000.CSV
 *    Plain CSV, ~5,081 BSE-listed equities (cash market / "CM" segment).
 *    Confirmed via curl against 2026-08-03.
 *
 * 2. LEGACY (2007-01-02 through 2023-12-29), VERIFIED LIVE:
 *      https://www.bseindia.com/download/BhavCopy/Equity/EQ{ddmmyy}_csv.zip
 *    A ZIP containing one EQ{ddmmyy}.CSV with a different column set
 *    (SC_CODE/SC_NAME/SC_GROUP/SC_TYPE/OPEN/HIGH/LOW/CLOSE/...). Confirmed
 *    working as far back as 2007-01-02 (Jan 2 -- Jan 1 is a market holiday)
 *    via curl. THE URL EXTENSION CASE MATTERS: "_csv.zip" (lowercase) works;
 *    "_CSV.ZIP" (uppercase, the form that appears in an earlier, unverified
 *    codebase this session drew on, and in a 2021 GitHub repo found while
 *    researching this) is dead -- confirmed by testing both directly. This
 *    was the actual bug in that prior "the BSE endpoint doesn't exist"
 *    finding, not that the endpoint was truly gone.
 *
 * Both formats come back as HTTP 200 even for holidays/weekends/out-of-range
 * dates (BSE returns its SPA shell / an HTML error page, not a 404), so
 * content is validated by checking the response actually parses as the
 * expected format, never by HTTP status alone.
 *
 * ZIP extraction shells out to the system `unzip` (confirmed present at
 * /usr/bin/unzip) rather than adding a JS zip-parsing dependency -- consistent
 * with this codebase's existing pattern of shelling out to python3 for
 * yfinance (see downloadHistoryWithPython in marketData.ts) rather than
 * reimplementing that in Node.
 */
import { fetchWithRetry } from "./providerUtils";
import type { OHLCVBar } from "./marketData";
import { runCommand } from "./exec/run-command";
import fs from "fs";
import os from "os";
import path from "path";
import { dataPath } from "./dataRoot";

const BSE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const MODERN_FORMAT_START = "2024-01-03";
const LEGACY_FORMAT_START = "2007-01-02";

function cacheDir(): string {
  return dataPath("bse-bhavcopy-cache");
}

/** yyyymmdd, e.g. "20260803" */
function toModernDateParam(iso: string): string {
  return iso.replace(/-/g, "");
}

/** ddmmyy, e.g. "010620" for 2020-06-01 */
function toLegacyDateParam(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y.slice(2)}`;
}

/** Bhavcopy for a closed trading day never changes, so a hit is cached
 * forever (no TTL) -- unlike every other India connector in this app, which
 * caches live/current data for minutes to hours. Cached in the modern CSV's
 * own text shape regardless of source format, so the parser only ever needs
 * to look at cache content, not which format produced it. */
function cachePathFor(iso: string): string {
  return path.join(cacheDir(), `${toModernDateParam(iso)}.csv`);
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Parses the modern (2024+) format into scripcode -> bar. Returns null if
 * the content isn't real bhavcopy data (wrong header -- holiday, weekend, or
 * a date outside the confirmed-working range). */
export function parseBhavcopyCsv(csvText: string, date: string): Map<string, OHLCVBar> | null {
  if (!csvText.startsWith("TradDt,BizDt,Sgmt")) return null;

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].split(",");
  const idx = (col: string) => header.indexOf(col);
  const iFinInstrmId = idx("FinInstrmId");
  const iSgmt = idx("Sgmt");
  const iOpn = idx("OpnPric");
  const iHgh = idx("HghPric");
  const iLw = idx("LwPric");
  const iCls = idx("ClsPric");
  const iVol = idx("TtlTradgVol");
  if ([iFinInstrmId, iSgmt, iOpn, iHgh, iLw, iCls, iVol].some((i) => i === -1)) return null;

  const bars = new Map<string, OHLCVBar>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[iSgmt] !== "CM") continue; // cash-market equities only -- file also carries other segments
    const scripCode = cols[iFinInstrmId];
    if (!scripCode || !/^\d+$/.test(scripCode)) continue; // equities are numeric scrip codes; skip anything else defensively
    const open = Number(cols[iOpn]);
    const high = Number(cols[iHgh]);
    const low = Number(cols[iLw]);
    const close = Number(cols[iCls]);
    const volume = Number(cols[iVol]) || 0;
    if (!Number.isFinite(close) || close <= 0) continue;
    bars.set(`${scripCode}.BO`, { date, open, high, low, close, volume });
  }
  return bars.size > 0 ? bars : null;
}

/** Parses the legacy (2007-2023) format into scripcode -> bar. Verified live
 * against 2020-06-01: SC_CODE,SC_NAME,SC_GROUP,SC_TYPE,OPEN,HIGH,LOW,CLOSE,
 * LAST,PREVCLOSE,NO_TRADES,NO_OF_SHRS,NET_TURNOV,TDCLOINDI. SC_TYPE "Q"
 * (equity) is kept; other observed values (I/P/B/D -- index/preference/
 * bond/debt instruments mixed into the same file) are filtered out, mirroring
 * the modern parser's Sgmt=="CM" filter. */
export function parseLegacyBhavcopyCsv(csvText: string, date: string): Map<string, OHLCVBar> | null {
  if (!csvText.startsWith("SC_CODE,SC_NAME,SC_GROUP,SC_TYPE")) return null;

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].split(",");
  const idx = (col: string) => header.indexOf(col);
  const iScCode = idx("SC_CODE");
  const iScType = idx("SC_TYPE");
  const iOpen = idx("OPEN");
  const iHigh = idx("HIGH");
  const iLow = idx("LOW");
  const iClose = idx("CLOSE");
  const iShares = idx("NO_OF_SHRS");
  if ([iScCode, iScType, iOpen, iHigh, iLow, iClose, iShares].some((i) => i === -1)) return null;

  const bars = new Map<string, OHLCVBar>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols[iScType]?.trim() !== "Q") continue; // equities only
    const scripCode = cols[iScCode]?.trim();
    if (!scripCode || !/^\d+$/.test(scripCode)) continue;
    const open = Number(cols[iOpen]);
    const high = Number(cols[iHigh]);
    const low = Number(cols[iLow]);
    const close = Number(cols[iClose]);
    const volume = Number(cols[iShares]) || 0;
    if (!Number.isFinite(close) || close <= 0) continue;
    bars.set(`${scripCode}.BO`, { date, open, high, low, close, volume });
  }
  return bars.size > 0 ? bars : null;
}

/** Downloads the legacy ZIP, extracts the single CSV inside via the system
 * unzip binary, returns its text. Uses a per-request temp directory (unique
 * per date + a random suffix) so sequential/concurrent calls never collide,
 * and always cleans up afterward even on failure. */
async function fetchLegacyBhavcopyText(iso: string): Promise<string | null> {
  const url = `https://www.bseindia.com/download/BhavCopy/Equity/EQ${toLegacyDateParam(iso)}_csv.zip`;
  const res = await fetchWithRetry(url, BSE_HEADERS);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bse-bhav-"));
  const zipPath = path.join(tmpDir, "bhav.zip");
  try {
    fs.writeFileSync(zipPath, buffer);
    try {
      if (process.platform === "win32") {
        await runCommand({ argv: ["python", "-m", "zipfile", "-e", zipPath, tmpDir], timeoutMs: 30_000, maxOutputChars: 1024 * 1024 });
      } else {
        await runCommand({ argv: ["unzip", "-o", "-q", zipPath, "-d", tmpDir], timeoutMs: 30_000, maxOutputChars: 1024 * 1024 });
      }
    } catch (primaryErr) {
      try {
        if (process.platform === "win32") {
          await runCommand({ argv: ["unzip", "-o", "-q", zipPath, "-d", tmpDir], timeoutMs: 30_000, maxOutputChars: 1024 * 1024 });
        } else {
          await runCommand({ argv: ["python3", "-m", "zipfile", "-e", zipPath, tmpDir], timeoutMs: 30_000, maxOutputChars: 1024 * 1024 });
        }
      } catch (fallbackErr) {
        throw new Error(
          `Extraction failed. Primary error: ${primaryErr instanceof Error ? primaryErr.message : primaryErr}. ` +
          `Fallback error: ${fallbackErr instanceof Error ? fallbackErr.message : fallbackErr}`
        );
      }
    }
    const csvFile = fs.readdirSync(tmpDir).find((f) => f.toUpperCase().endsWith(".CSV"));
    if (!csvFile) return null;
    return fs.readFileSync(path.join(tmpDir, csvFile), "utf8");
  } catch (err) {
    console.warn(`BSE legacy bhavcopy unzip failed for ${iso}:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Fetches + parses one day's bhavcopy from whichever format covers that
 * date, disk-cached forever once a real (non-holiday, in-range) day is
 * found. Returns null for weekends, holidays, and dates outside both
 * confirmed-working ranges (pre-2007, or the gap between the two formats if
 * one ever turns out to exist) -- all indistinguishable from the caller's
 * point of view: "no data for this day," not an error. */
export async function fetchBhavcopyForDate(iso: string): Promise<Map<string, OHLCVBar> | null> {
  if (iso < LEGACY_FORMAT_START || isWeekend(iso)) return null;

  const cacheFile = cachePathFor(iso);
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = fs.readFileSync(cacheFile, "utf8");
      return iso >= MODERN_FORMAT_START ? parseBhavcopyCsv(cached, iso) : parseLegacyBhavcopyCsv(cached, iso);
    }
  } catch {
    // fall through to a live fetch
  }

  try {
    let text: string | null;
    let parsed: Map<string, OHLCVBar> | null;
    if (iso >= MODERN_FORMAT_START) {
      const url = `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${toModernDateParam(iso)}_F_0000.CSV`;
      const res = await fetchWithRetry(url, BSE_HEADERS);
      text = await res.text();
      parsed = parseBhavcopyCsv(text, iso);
    } else {
      text = await fetchLegacyBhavcopyText(iso);
      parsed = text ? parseLegacyBhavcopyCsv(text, iso) : null;
    }

    if (parsed && text) {
      try {
        if (!fs.existsSync(cacheDir())) fs.mkdirSync(cacheDir(), { recursive: true });
        fs.writeFileSync(cacheFile, text, "utf8");
      } catch {
        // best-effort cache -- a write failure shouldn't break the live response
      }
    }
    return parsed;
  } catch (err) {
    console.warn(`BSE bhavcopy fetch failed for ${iso}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** All ISO trading-day candidates (weekends excluded; holidays are filtered
 * out downstream by fetchBhavcopyForDate returning null for them) in
 * [fromIso, toIso] inclusive. */
export function tradingDayCandidates(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    if (!isWeekend(iso)) out.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Single-symbol convenience wrapper over fetchBhavcopyForDate, for the live
 * incremental top-up path in getOHLCV (marketData.ts) -- walks a small
 * recent date range and pulls out just the one scrip code asked for. The
 * backfill script (script/import_bse_bhavcopy.ts) does NOT use this; it
 * calls fetchBhavcopyForDate directly so it can harvest every symbol from
 * each day's file in one pass instead of re-fetching the same file once per
 * symbol. */
export async function getBseHistoryRange(symbol: string, fromIso: string, toIso: string): Promise<OHLCVBar[]> {
  const upper = symbol.toUpperCase();
  const bars: OHLCVBar[] = [];
  for (const day of tradingDayCandidates(fromIso, toIso)) {
    const dayBars = await fetchBhavcopyForDate(day);
    const bar = dayBars?.get(upper);
    if (bar) bars.push(bar);
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}
