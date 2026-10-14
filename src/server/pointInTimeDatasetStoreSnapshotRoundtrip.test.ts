import test from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same isolation requirement as financialStatementsConflictStore.test.ts:
// db.ts freezes its PGLITE_DIR the instant it's first imported, including
// transitively through a static `import ... from "./pointInTimeDatasetStore"`
// at this file's own top level. Every import touching ./db is deferred until
// after LIMURIA_DATA_DIR points at an isolated temp directory, so this never
// collides with the real dev server's live PGlite ownership or the shared
// default `data/pgdata` other unisolated tests fall back to.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-pit-snapshot-roundtrip-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { getDatasetSnapshot } = await import("./pointInTimeDatasetStore");
const { initDb, closeDb } = await import("./db");
const { datasetSnapshots, users } = await import("@shared/schema");

// This exercises the real DB round trip that unit tests of the pure
// buildFinancialDatasetPayload() normalizer never touch: a Postgres/PGlite
// `timestamp` column comes back from drizzle as a `Date` object, and
// rowToSnapshot() must convert every timestamp field -- including
// `createdAt`, which is populated by the column's own `.defaultNow()`
// rather than by application code -- before handing the row to
// pointInTimeDatasetSnapshotSchema, which requires ISO strings. Regression
// coverage for a real 502 where `createdAt` reached the schema as a `Date`.
test("captured financial snapshots read back through the real DB round trip", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const db = (await import("./db")).getDb();
  const [fixtureUser] = await db.insert(users).values({
    email: "pit-snapshot-roundtrip-test@example.test", passwordHash: "test", role: "internal_admin", name: "Snapshot Roundtrip Test",
  }).returning();

  const now = new Date();
  const [inserted] = await db.insert(datasetSnapshots).values({
    id: crypto.randomUUID(), datasetKey: "financials:AAPL:FY", entityKey: "AAPL",
    dataClass: "financial_statements", schemaVersion: "1.0.0", source: "financial_provider_waterfall",
    provider: "London Strategic Edge", frequency: "annual", currency: "USD", timezone: "UTC",
    observationStart: "2024-09-28", observationEnd: "2024-09-28",
    effectiveAt: now, publishedAt: now, retrievedAt: now, availableAt: now,
    contentHash: crypto.createHash("sha256").update("fixture").digest("hex"),
    parentSnapshotId: null,
    quality: { score: 1, statementCoverage: { income: 1, balance: 1, cashflow: 1 }, criticalFieldsPresent: 1, criticalFieldsExpected: 1, missingCriticalFields: [], warnings: [] },
    lineage: {},
    payload: {
      symbol: "AAPL",
      periods: [{
        fiscalYear: "2024", period: "FY", periodEnd: "2024-09-28", filingDate: "2024-11-01", availableAt: now.toISOString(),
        currency: "USD", income: { revenue: 391_035_000_000 }, balance: {}, cashflow: {},
        segments: {}, geographies: {}, sources: [{ statementType: "income", provider: "London Strategic Edge" }],
      }],
    },
    createdByUserId: fixtureUser.id,
    // createdAt intentionally omitted: the column's own `.defaultNow()`
    // populates it, the same as every real capture -- this is the exact
    // path that produced a `Date` instead of an application-supplied value.
  }).returning();

  assert.ok(inserted.createdAt instanceof Date, "fixture setup sanity check: the DB must hand back a Date, not a string, for this bug to be reproduced");

  const snapshot = await getDatasetSnapshot(inserted.id);
  assert.ok(snapshot, "a snapshot inserted with dataClass financial_statements must read back");
  assert.match(snapshot!.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "createdAt must be converted to an ISO datetime string, not left as a Date");
  assert.equal(snapshot!.payload.periods[0].income.revenue, 391_035_000_000);
});
