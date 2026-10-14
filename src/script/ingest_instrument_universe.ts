/**
 * Idempotent background ingestion of real, free, no-auth provider listing
 * data into the bundled
 * provider-ingested instrument universe (server/data/provider_ingested_universe.json,
 * loaded by server/providerIngestedCatalog.ts and merged into the common
 * search index alongside the existing ~67k legacy catalog and any
 * persisted canonical rows -- see server/instrumentSearchIndexStore.ts).
 *
 * "Idempotent": re-running this script re-fetches the same three free
 * sources (SEC EDGAR, NASDAQ Trader, CoinGecko -- see
 * server/instrumentUniverseIngestion.ts) and recomputes net-new rows
 * against whatever's already bundled (both tickers.json and any prior
 * provider_ingested_universe.json output). A second run with unchanged
 * upstream data produces the same file; a run after upstream sources add
 * new listings only appends those, never duplicates or drops existing
 * rows keyed by symbol.
 *
 * Usage:
 *   tsx script/ingest_instrument_universe.ts             # bundled-catalog file only
 *   tsx script/ingest_instrument_universe.ts --promote-sec  # also promotes every
 *     fetched SEC EDGAR ticker into the canonical companies/companyListings
 *     tables via companyStore.upsertCompany (same standing PGlite rule as
 *     backfill_sectors_to_db.ts: must only run while no server process has
 *     the local database open).
 */
import fs from "node:fs";
import path from "node:path";
import { buildProviderIngestedUniverse, fetchSecTickerUniverse, promoteSecTickersToCanonical } from "../server/instrumentUniverseIngestion";
import { providerIngestedUniversePath } from "../server/providerIngestedCatalog";
import type { LegacySymbolCatalogRow } from "../shared/globalInstrumentMaster";

function loadExistingSymbols(): Set<string> {
  const symbols = new Set<string>();

  const legacyPath = path.resolve(process.cwd(), "server", "data", "tickers.json");
  if (fs.existsSync(legacyPath)) {
    const rows = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as Array<{ symbol: string }>;
    for (const row of rows) symbols.add(row.symbol.trim().toUpperCase());
  }

  const ingestedPath = providerIngestedUniversePath();
  if (fs.existsSync(ingestedPath)) {
    const rows = JSON.parse(fs.readFileSync(ingestedPath, "utf8")) as LegacySymbolCatalogRow[];
    for (const row of rows) symbols.add(row.symbol.trim().toUpperCase());
  }

  return symbols;
}

async function main(): Promise<void> {
  const promoteSec = process.argv.includes("--promote-sec");

  console.log("Instrument universe ingestion: fetching real free sources (SEC EDGAR, NASDAQ Trader, CoinGecko)...");
  const existingSymbols = loadExistingSymbols();
  console.log(`Already-bundled symbol count (legacy + prior provider-ingested runs): ${existingSymbols.size}`);

  const { candidates, summary } = await buildProviderIngestedUniverse(existingSymbols);
  for (const s of summary) {
    console.log(`  ${s.provider}: fetched ${s.fetched}, net-new (not already bundled) ${s.netNew}`);
  }
  console.log(`Total net-new candidates this run: ${candidates.length}`);

  const ingestedPath = providerIngestedUniversePath();
  const existingIngestedRows: LegacySymbolCatalogRow[] = fs.existsSync(ingestedPath)
    ? JSON.parse(fs.readFileSync(ingestedPath, "utf8"))
    : [];
  const newRows: LegacySymbolCatalogRow[] = candidates.map((c) => ({
    symbol: c.symbol,
    name: c.name,
    exchange: c.exchange ?? null,
    mic: c.mic ?? null,
    countryCode: c.countryCode ?? null,
    currency: c.currency ?? null,
    provider: c.source ?? null,
    providerId: c.identifiers.find((i) => i.type === "provider_id")?.value ?? null,
    active: c.lifecycleStatus !== "delisted",
  }));
  const mergedRows = [...existingIngestedRows, ...newRows];

  fs.mkdirSync(path.dirname(ingestedPath), { recursive: true });
  fs.writeFileSync(ingestedPath, JSON.stringify(mergedRows, null, 0));
  console.log(`Wrote ${mergedRows.length} total rows (${existingIngestedRows.length} carried over + ${newRows.length} new) to ${ingestedPath}`);

  const legacyPath = path.resolve(process.cwd(), "server", "data", "tickers.json");
  const legacyCount = fs.existsSync(legacyPath) ? (JSON.parse(fs.readFileSync(legacyPath, "utf8")) as unknown[]).length : 0;
  const grandTotal = legacyCount + mergedRows.length;
  console.log(`\nGrand total searchable identities (legacy ${legacyCount} + provider-ingested ${mergedRows.length}, before any persisted canonical rows): ${grandTotal}`);

  if (promoteSec) {
    console.log("\n--promote-sec: promoting every fetched SEC EDGAR ticker into canonical companies/companyListings...");
    const { initDb } = await import("../server/db");
    await initDb();
    const secRows = await fetchSecTickerUniverse();
    const result = await promoteSecTickersToCanonical(secRows);
    console.log(`SEC promotion: attempted=${result.attempted} promoted=${result.promoted} failures=${result.failures.length}`);
    if (result.failures.length) console.log("First few failures:", result.failures.slice(0, 5));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Instrument universe ingestion failed:", err);
  process.exit(1);
});
