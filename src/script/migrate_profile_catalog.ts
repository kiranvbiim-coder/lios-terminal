/**
 * LV4-04-09: migrate PROFILE_CATALOG's ~180 hand-curated symbols (see
 * server/marketData.ts) into the canonical identity tables (companies /
 * company_listings) so they resolve through the real Global Instrument
 * Master and search index instead of staying reachable only through the
 * live-quote path.
 *
 * This is deliberately a gap-filler, not an overwrite source. PROFILE_CATALOG
 * is a hand-maintained reference table with no provenance/timestamp -- a
 * source like SEC EDGAR's SIC classification (backfill_sectors_to_db.ts) is
 * more authoritative for any symbol both know about. So for a symbol that
 * already has a real sector AND exchange in `companies`, this script skips
 * it entirely rather than risk silently overwriting a better answer with
 * upsertCompany's coalesce-prefers-incoming semantics. For a new symbol, or
 * one missing sector/exchange, it fills the gap.
 *
 * Only marketCap/referencePrice/eps/revenue/coinGeckoId are left behind --
 * those are point-in-time financial-snapshot fields, not identity fields,
 * and have no column on companies/company_listings; they stay served live
 * from PROFILE_CATALOG via the existing quote path in marketData.ts.
 *
 * Per this project's standing PGlite rule, run only while no server process
 * has the local database open.
 *
 * Usage: tsx script/migrate_profile_catalog.ts
 */
import { initDb } from "../server/db";
import { getCompanyBySymbol, upsertCompany } from "../server/companyStore";
import { PROFILE_CATALOG, type InstrumentProfile } from "../server/marketData";

// company_listings.asset_class / companies.asset_class (shared/schema.ts
// assetClassEnum) has no "mutual_fund" value -- PROFILE_CATALOG's is the
// only place that string is used, so map it at the migration boundary
// rather than touching the shared enum for one legacy label.
function mapAssetClass(input: InstrumentProfile["assetClass"]): CompanyAssetClass {
  if (input === "mutual_fund") return "fund";
  return input ?? "equity";
}

type CompanyAssetClass = "equity" | "etf" | "fund" | "bond" | "index" | "commodity" | "forex" | "crypto";

async function main() {
  await initDb();

  const symbols = Object.keys(PROFILE_CATALOG);
  console.log(`PROFILE_CATALOG: ${symbols.length} symbols to consider.`);

  let inserted = 0, gapFilled = 0, skippedComplete = 0;

  for (const symbol of symbols) {
    const profile = PROFILE_CATALOG[symbol];
    const existing = await getCompanyBySymbol(symbol);

    if (existing && existing.sector && existing.exchange) {
      skippedComplete++;
      continue;
    }

    await upsertCompany({
      symbol,
      name: profile.name,
      exchange: profile.exchange,
      sector: profile.sector ?? null,
      assetClass: mapAssetClass(profile.assetClass),
      source: "profile_catalog",
    });

    if (existing) gapFilled++;
    else inserted++;
  }

  console.log(
    `Done. inserted=${inserted} gapFilled=${gapFilled} skipped(already-complete)=${skippedComplete} total=${symbols.length}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("PROFILE_CATALOG migration failed:", err);
  process.exit(1);
});
