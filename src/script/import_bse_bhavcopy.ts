/**
 * Bulk-seed the persistent history store with real BSE daily OHLCV, walking
 * bhavcopy day by day (see server/bseBhavcopy.ts for the endpoint and format
 * -- verified live before this script was written). Unlike
 * import_stooq_db.ts's Stooq database (CAPTCHA-gated, one manual download),
 * this endpoint has no such gate, so the whole backfill runs unattended:
 *
 *   npm run history:import:bse -- [fromDate] [toDate]
 *
 * Dates default to 2007-01-02 (the earliest date real bhavcopy data is
 * confirmed to exist for BSE -- see bseBhavcopy.ts for how that was found
 * and verified, and the two-format dispatch that covers the full range)
 * through yesterday. Re-running is safe and cheap: each day's file is cached
 * forever once fetched (a closed trading day's data never changes), and
 * saveHistory merges by date -- so re-running for a range that overlaps
 * already-backfilled dates just no-ops on the overlap instead of duplicating
 * work.
 *
 * PROCESSED ONE CALENDAR YEAR AT A TIME, saving after each year, rather than
 * accumulating the entire requested range in memory before writing anything.
 * The first version of this script did the latter and OOM'd partway through
 * a 2007-2023 run (~17 years x ~5,000-9,862 symbols' worth of bars held
 * simultaneously blew past Node's default heap) -- confirmed via the crash's
 * own stack trace, not guessed. Chunking by year bounds peak memory to one
 * year's worth of bars regardless of how large the total requested range is,
 * and a crash (or a deliberate interrupt) only loses the current year's
 * progress, not the whole run, since every prior year is already saved.
 */
import { loadHistory, saveHistory } from "../server/marketHistoryStore";
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

/** [{start, end}] for each calendar year overlapping [fromIso, toIso], each
 * clipped to the requested range. */
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

async function processYear(start: string, end: string): Promise<{ daysFound: number; daysSkipped: number; symbolCount: number }> {
  const days = tradingDayCandidates(start, end);
  const bySymbol = new Map<string, OHLCVBar[]>();
  let daysFound = 0;
  let daysSkipped = 0;

  for (let i = 0; i < days.length; i++) {
    const dayBars = await fetchBhavcopyForDate(days[i]);
    if (!dayBars) {
      daysSkipped++;
    } else {
      daysFound++;
      for (const [symbol, bar] of dayBars) {
        const arr = bySymbol.get(symbol);
        if (arr) arr.push(bar);
        else bySymbol.set(symbol, [bar]);
      }
    }
    await sleep(150); // polite delay -- no documented rate limit to calibrate against precisely
  }

  for (const [symbol, bars] of bySymbol) {
    const existing = loadHistory(symbol);
    if (existing && (existing.adjustmentState === "split_bonus_adjusted" || existing.adjustmentState === undefined && existing.bars.length > 0)) {
      console.warn(`Skipping ${symbol}: existing history is adjusted or unclassified; rebuild it explicitly before raw import.`);
      continue;
    }
    saveHistory(symbol, [...bars].sort((a, b) => a.date.localeCompare(b.date)), "raw");
  }

  return { daysFound, daysSkipped, symbolCount: bySymbol.size };
}

async function main() {
  const chunks = yearChunks(fromDate, toDate);
  console.log(`Backfilling BSE bhavcopy from ${fromDate} to ${toDate}, one year at a time (${chunks.length} year${chunks.length === 1 ? "" : "s"}).`);

  const startedAt = Date.now();
  let totalDaysFound = 0;

  for (const { start, end } of chunks) {
    const yearStartedAt = Date.now();
    const { daysFound, daysSkipped, symbolCount } = await processYear(start, end);
    totalDaysFound += daysFound;
    console.log(
      `  ${start}..${end}: ${daysFound} trading days, ${daysSkipped} skipped, ${symbolCount} symbols saved ` +
      `(${Math.round((Date.now() - yearStartedAt) / 1000)}s this year, ${Math.round((Date.now() - startedAt) / 1000)}s total elapsed)`,
    );
  }

  console.log(`Done: ${totalDaysFound} total trading days backfilled across ${chunks.length} year${chunks.length === 1 ? "" : "s"}, in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
}

main().catch((err) => {
  console.error("BSE bhavcopy backfill failed:", err);
  process.exit(1);
});
