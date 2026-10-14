/**
 * Phase B of the real peer-universe backfill: reads the JSON-lines results
 * files produced by the three independent sector-fetch sources (main
 * equity + BSE via yfinance, plus SEC EDGAR's SIC classification for US
 * filers) and upserts every real hit into the `companies` table via
 * companyStore.upsertCompany.
 *
 * Kept as a separate phase from the Python fetch scripts so the long
 * network-bound fetches never have to share a process with the database --
 * this script's own DB-write phase is fast (a few minutes for tens of
 * thousands of rows), and per this project's standing PGlite rule, it must
 * only run while no server process has the local database open.
 *
 * Sources run in this order; upsertCompany's coalesce-on-conflict means a
 * symbol only picked up by an earlier source keeps that source's real
 * value rather than being overwritten by a later, different-but-still-real
 * one -- first real answer wins, same principle the live provider
 * waterfall in financialDataProviders.ts uses.
 *
 * Usage: tsx script/backfill_sectors_to_db.ts
 */
import fs from "fs";
import { initDb } from "../server/db";
import { upsertCompany } from "../server/companyStore";

const SCRATCH = "/private/tmp/claude-501/-Users-kiran-Desktop/49439f4a-4075-4716-bef1-c158048df700/scratchpad";
const SOURCES: Array<{ label: string; path: string }> = [
  { label: "main equity (yfinance)", path: `${SCRATCH}/yf_sectors_results.jsonl` },
  { label: "BSE (yfinance, alphabetic-ticker crosswalk)", path: `${SCRATCH}/yf_bse_sectors_results.jsonl` },
  { label: "SEC EDGAR (SIC)", path: `${SCRATCH}/sec_sectors_results.jsonl` },
];

interface ResultRow {
  symbol: string;
  sector?: string | null;
  industry?: string | null;
  name?: string | null;
  country?: string | null;
  error?: string;
}

async function processSource(label: string, filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${label}: no results file at ${filePath}.`);
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  console.log(`${label}: read ${lines.length} result rows from ${filePath}.`);

  let upserted = 0, skippedNoSector = 0, parseErrors = 0;

  for (let i = 0; i < lines.length; i++) {
    let row: ResultRow;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      parseErrors++;
      continue;
    }

    if (!row.sector) { skippedNoSector++; continue; }

    await upsertCompany({
      symbol: row.symbol,
      name: row.name || null,
      country: row.country || null,
      sector: row.sector,
      industry: row.industry || null,
      assetClass: "equity",
    });
    upserted++;

    if ((i + 1) % 2000 === 0) console.log(`  ${label}: ${i + 1}/${lines.length} processed -- upserted=${upserted}`);
  }

  console.log(`${label}: done. upserted=${upserted} skipped(no real sector)=${skippedNoSector} parseErrors=${parseErrors}`);
  console.log("");
}

async function main() {
  await initDb();

  for (const source of SOURCES) {
    await processSource(source.label, source.path);
  }

  console.log("All sources processed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Sector backfill (phase B) failed:", err);
  process.exit(1);
});
