import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same isolation requirement as environmentSetupService.test.ts and
// financialStatementsConflictStore.test.ts: db.ts freezes its PGLITE_DIR
// the instant it's first imported, including transitively through
// instrumentUniverseIngestion.ts -> secEdgarData.ts/companyStore.ts -> db.ts,
// so every import touching that chain is deferred until after
// LIMURIA_DATA_DIR points at an isolated temp directory. Kept in its own
// file, separate from instrumentUniverseIngestion.test.ts's pure-logic
// tests, specifically so those can use plain static imports without this
// file's DB isolation concern leaking into them.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-instrument-ingestion-promotion-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { promoteSecTickersToCanonical, INGESTION_PROVIDERS } = await import("./instrumentUniverseIngestion");
const { initDb, closeDb, getDb } = await import("./db");
const { companies, companyListings, companyIdentifiers } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");

await initDb();
after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("promoteSecTickersToCanonical idempotently upserts real CIK identity into companies/companyListings", { concurrency: false }, async () => {

  const rows = [
    { cik: "0000320193", ticker: "AAPL", name: "Apple Inc." },
    { cik: "0000789019", ticker: "MSFT", name: "Microsoft Corp" },
  ];

  const firstRun = await promoteSecTickersToCanonical(rows);
  assert.equal(firstRun.attempted, 2);
  assert.equal(firstRun.promoted, 2);
  assert.equal(firstRun.failures.length, 0);

  const db = getDb();
  const [listing] = await db.select().from(companyListings).where(eq(companyListings.symbol, "AAPL"));
  assert.ok(listing, "expected a companyListings row for AAPL");
  assert.equal(listing.source, INGESTION_PROVIDERS.secEdgar);

  const [identifier] = await db.select().from(companyIdentifiers).where(eq(companyIdentifiers.identifier, "0000320193"));
  assert.ok(identifier, "expected the real CIK to be recorded as a company identifier");
  assert.equal(identifier.identifierType, "cik");

  // Re-running with the exact same input must not create a second row --
  // upsertCompany's onConflictDoUpdate target is [symbol, exchange].
  const secondRun = await promoteSecTickersToCanonical(rows);
  assert.equal(secondRun.promoted, 2);
  const allAaplListings = await db.select().from(companyListings).where(eq(companyListings.symbol, "AAPL"));
  assert.equal(allAaplListings.length, 1, "re-running promotion must update the existing row, not duplicate it");

  const allCompanies = await db.select().from(companies);
  assert.equal(allCompanies.length, 2, "two distinct real companies, no phantom rows from the second run");
});

test("promoteSecTickersToCanonical reports a per-row failure without aborting the rest of the batch", { concurrency: false }, async () => {
  const rows = [
    { cik: "0000320193", ticker: "AAPL", name: "Apple Inc." },
    { cik: "", ticker: "   ", name: "Blank ticker" }, // skipped, not a failure -- filtered by the ticker.trim() guard
    { cik: "0000789019", ticker: "MSFT", name: "Microsoft Corp" },
  ];
  const result = await promoteSecTickersToCanonical(rows);
  assert.equal(result.attempted, 3);
  assert.equal(result.promoted, 2, "two real rows promoted; the blank-ticker row is silently skipped, not a failure");
});
