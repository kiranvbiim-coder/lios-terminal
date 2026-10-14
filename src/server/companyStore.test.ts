import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// This test owns a real isolated PGlite instance. The environment must be set
// before ./db is evaluated, so dynamic imports are a genuine module-loading
// boundary exception to the static-import convention (same pattern as
// controlPlaneService.test.ts and dataSpineIngestionMonitor.test.ts).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-company-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { upsertCompany } = await import("./companyStore");
const { loadPersistedInstrumentCandidates } = await import("./globalInstrumentMasterStore");
const { companyListings, securities } = await import("@shared/schema");
test("upsertCompany creates one durable security and reuses it for an idempotent listing update", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const firstCompanyId = await upsertCompany({
    symbol: "ACME",
    name: "Acme Holdings",
    exchange: "NASDAQ",
    assetClass: "equity",
    source: "test_provider",
  });
  const db = getDb();
  const [firstListing] = await db.select().from(companyListings);
  const [firstSecurity] = await db.select().from(securities);

  assert.equal(firstListing.companyId, firstCompanyId);
  assert.equal(firstListing.securityId, firstSecurity.id);
  assert.equal(firstSecurity.companyId, firstCompanyId);
  assert.equal(firstSecurity.shareClass, null);
  assert.equal(firstSecurity.assetClass, "equity");

  const secondCompanyId = await upsertCompany({
    symbol: "ACME",
    name: "Acme Holdings Renamed",
    exchange: "NASDAQ",
    assetClass: "equity",
    source: "test_provider",
  });
  const listings = await db.select().from(companyListings);
  const securityRows = await db.select().from(securities);

  assert.equal(secondCompanyId, firstCompanyId);
  assert.equal(listings.length, 1);
  assert.equal(securityRows.length, 1);
  assert.equal(listings[0].securityId, securityRows[0].id);
  assert.equal(securityRows[0].name, "Acme Holdings Renamed");

  const [candidate] = await loadPersistedInstrumentCandidates({ ticker: "ACME" });
  assert.equal(candidate.entityId, `lios:entity:${firstCompanyId}`);
  assert.equal(candidate.securityId, `lios:security:${securityRows[0].id}`);
  assert.equal(candidate.listingId, `lios:listing:${listings[0].id}`);

  // Regression for LV4-04-01/02: providers commonly surface Alphabet's
  // Class A (GOOGL) and Class C (GOOG) as different listing symbols but the
  // same CIK. They must share the issuer while receiving distinct security
  // identities -- never become two companies merely because their tickers
  // differ. Deliberately issue both writes together: the CIK uniqueness
  // constraint plus conflict-reuse path must defeat the first-seen race.
  const [classACompanyId, classCCompanyId] = await Promise.all([
    upsertCompany({
      symbol: "GOOGL",
      name: "Alphabet Inc.",
      cik: "0001652044",
      exchange: "NASDAQ",
      assetClass: "equity",
      shareClass: "A",
      source: "test_provider",
    }),
    upsertCompany({
      symbol: "GOOG",
      name: "Alphabet Inc.",
      cik: "0001652044",
      exchange: "NASDAQ",
      assetClass: "equity",
      shareClass: "C",
      source: "test_provider",
    }),
  ]);
  const alphabetListings = (await db.select().from(companyListings))
    .filter((listing) => listing.companyId === classACompanyId);
  const alphabetSecurities = (await db.select().from(securities))
    .filter((security) => security.companyId === classACompanyId);

  assert.equal(classCCompanyId, classACompanyId);
  assert.deepEqual(new Set(alphabetListings.map((listing) => listing.symbol)), new Set(["GOOGL", "GOOG"]));
  assert.deepEqual(new Set(alphabetSecurities.map((security) => security.shareClass)), new Set(["A", "C"]));
  assert.equal(new Set(alphabetListings.map((listing) => listing.securityId)).size, 2);

  const [googCandidate] = await loadPersistedInstrumentCandidates({ ticker: "GOOG" });
  assert.equal(googCandidate.entityId, `lios:entity:${classACompanyId}`);
  assert.notEqual(googCandidate.securityId, "lios:security:undefined");
});
