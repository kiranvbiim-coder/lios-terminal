/**
 * Rebuilds raw BSE history from the immutable bhavcopy cache.
 *
 * The market-data consumer owns split/bonus adjustment and applies it to raw
 * bars at read time. This script deliberately stores only raw bars so a
 * partial rebuild cannot label a mixed series as adjusted.
 *
 *   npm run history:adjust:bse
 *
 * Process one calendar year at a time to avoid the historical OOM failure;
 * legacy replacements are staged on disk and committed per symbol only after
 * every requested year has been reconstructed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { loadHistory, replaceHistory, saveHistory } from "../server/marketHistoryStore";
import { fetchBhavcopyForDate, tradingDayCandidates } from "../server/bseBhavcopy";
import type { OHLCVBar } from "../server/marketData";

const DEFAULT_FROM = "2007-01-02";

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const fromDate = process.argv[2] || DEFAULT_FROM;
const toDate = process.argv[3] || yesterday();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function yearChunks(fromIso: string, toIso: string): Array<{ start: string; end: string }> {
  const fromYear = parseInt(fromIso.slice(0, 4), 10);
  const toYear = parseInt(toIso.slice(0, 4), 10);
  const chunks: Array<{ start: string; end: string }> = [];
  for (let y = fromYear; y <= toYear; y++) {
    const start = y === fromYear ? fromIso : `${y}-01-01`;
    const end = y === toYear ? toIso : `${y}-12-31`;
    chunks.push({ start, end });
  }
  return chunks;
}

async function reconstructYear(start: string, end: string): Promise<Map<string, OHLCVBar[]>> {
  const bySymbol = new Map<string, OHLCVBar[]>();
  for (const day of tradingDayCandidates(start, end)) {
    const dayBars = await fetchBhavcopyForDate(day); // cache-only for already-backfilled dates -- no network cost
    if (!dayBars) continue;
    for (const [symbol, bar] of dayBars) {
      const arr = bySymbol.get(symbol);
      if (arr) arr.push(bar);
      else bySymbol.set(symbol, [bar]);
    }
  }
  return bySymbol;
}

function stagePath(stagingDir: string, symbol: string): string {
  return path.join(stagingDir, `${symbol.replace(/[^A-Z0-9._-]/gi, "_")}.jsonl`);
}

function appendStage(stagingDir: string, symbol: string, bars: OHLCVBar[]): void {
  if (bars.length === 0) return;
  const content = bars.map((bar) => JSON.stringify(bar)).join("\n") + "\n";
  fs.appendFileSync(stagePath(stagingDir, symbol), content, "utf8");
}

function readStagedBars(stagingDir: string, symbol: string): OHLCVBar[] {
  const file = stagePath(stagingDir, symbol);
  const byDate = new Map<string, OHLCVBar>();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const bar = JSON.parse(line) as OHLCVBar;
    byDate.set(bar.date, bar);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
async function main() {
  const chunks = yearChunks(fromDate, toDate);
  console.log(`Rebuilding raw BSE history, ${fromDate} to ${toDate}, one year at a time (${chunks.length} year${chunks.length === 1 ? "" : "s"}).`);

  const startedAt = Date.now();
  let totalProcessed = 0;
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-bse-rebuild-"));
  const stagedSymbols = new Set<string>();
  const canReplaceLegacy = fromDate === DEFAULT_FROM && process.argv[3] === undefined;
  try {
    for (const { start, end } of chunks) {
      const yearStartedAt = Date.now();
      const bySymbol = await reconstructYear(start, end);

      for (const [symbol, rawBars] of bySymbol) {
        const existing = loadHistory(symbol);
        const sorted = [...rawBars].sort((a, b) => a.date.localeCompare(b.date));
        const needsLegacyReplacement = existing?.bars.length > 0 && existing.adjustmentState !== "raw";
        if (needsLegacyReplacement) {
          if (!canReplaceLegacy) {
            console.warn(`Skipping ${symbol}: existing history is adjusted or unclassified; use the full default rebuild range to replace it safely.`);
            continue;
          }
          appendStage(stagingDir, symbol, sorted);
          stagedSymbols.add(symbol);
        } else {
          saveHistory(symbol, sorted, "raw");
        }
        totalProcessed++;
      }

      console.log(
        `  ${start}..${end}: ${bySymbol.size} symbols processed ` +
        `(${Math.round((Date.now() - yearStartedAt) / 1000)}s this year, ${Math.round((Date.now() - startedAt) / 1000)}s total elapsed)`,
      );
    }

    for (const symbol of stagedSymbols) {
      const existing = loadHistory(symbol);
      const staged = readStagedBars(stagingDir, symbol);
      const stagedDates = new Set(staged.map((bar) => bar.date));
      if (existing && !existing.bars.every((bar) => stagedDates.has(bar.date))) {
        console.warn(`Skipping legacy replacement for ${symbol}: reconstructed source did not cover every existing date; old history retained.`);
        continue;
      }
      replaceHistory(symbol, staged, "raw");
    }
    console.log(`Done: ${totalProcessed} symbol-year passes, raw BSE history rebuilt in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("BSE split/bonus adjustment failed:", err);
  process.exit(1);
});
