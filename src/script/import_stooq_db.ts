/**
 * Bulk-seed the persistent history store from Stooq's free full-market
 * historical database (https://stooq.com/db/h/).
 *
 * One-time manual step (the download is CAPTCHA-gated, so it can't be
 * automated): download e.g. "d_us_txt.zip" (daily, US, ASCII — ~333MB, 30+
 * years of data) from that page, unzip it, then run:
 *
 *   npm run history:import -- /path/to/unzipped/folder
 *
 * Every ticker file found is converted into the app's on-disk history store,
 * after which charts for those symbols open instantly with zero upstream
 * fetches — only the incremental daily top-up runs thereafter. Re-running is
 * safe: bars merge by date.
 *
 * Stooq file format (one file per ticker, e.g. aapl.us.txt):
 *   <TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>
 *   AAPL.US,D,20240102,000000,185.64,186.95,183.89,185.64,52464100,0
 */
import fs from "fs";
import path from "path";
import { saveHistory } from "../server/marketHistoryStore";
import type { OHLCVBar } from "../server/marketData";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) {
  console.error("Usage: npm run history:import -- /path/to/unzipped/stooq/folder");
  process.exit(1);
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".txt")) yield full;
  }
}

/** "AAPL.US" -> "AAPL"; international suffixes are preserved uppercase. */
function normalizeSymbol(raw: string): string {
  const upper = raw.toUpperCase();
  return upper.endsWith(".US") ? upper.slice(0, -3) : upper;
}

function parseStooqDbFile(file: string): { symbol: string; bars: OHLCVBar[] } | null {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const bars: OHLCVBar[] = [];
  let symbol = "";
  for (let i = 1; i < lines.length; i++) {
    const [ticker, _per, date, _time, open, high, low, close, volume] = lines[i].split(",");
    if (!ticker || !date || date.length !== 8) continue;
    symbol ||= normalizeSymbol(ticker);
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const bar = {
      date: iso,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume) || 0,
    };
    if (Number.isFinite(bar.close) && bar.close > 0) bars.push(bar);
  }
  return symbol && bars.length ? { symbol, bars } : null;
}

let imported = 0;
let skipped = 0;
const startedAt = Date.now();

for (const file of walk(root)) {
  const parsed = parseStooqDbFile(file);
  if (!parsed) {
    skipped++;
    continue;
  }
  saveHistory(parsed.symbol, parsed.bars);
  imported++;
  if (imported % 1000 === 0) {
    console.log(`  ...${imported} symbols imported (${Math.round((Date.now() - startedAt) / 1000)}s)`);
  }
}

console.log(`Done: ${imported} symbols imported, ${skipped} files skipped, in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
