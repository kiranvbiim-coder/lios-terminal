import test from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapabilityObservation, CapabilityResolution } from "./capabilityBroker";
import type { LseFinancialReport } from "./lseData";
import { eq } from "drizzle-orm";
import { datasetSnapshots } from "@shared/schema";

// Same isolation requirement as entityResolver.test.ts: db.ts freezes its
// PGLITE_DIR the instant it's first imported, including transitively
// through a static `import { persistFinancialStatementsConflictResolution }
// from "./financialStatementsBroker"` at this file's own top level. Every
// import touching ./db is deferred until after LIMURIA_DATA_DIR points at
// an isolated temp directory, so this never collides with the real dev
// server's live PGlite ownership.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-conflict-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const {
  persistFinancialStatementsConflictResolution,
  getFinancialStatementsConflictSnapshot,
  listFinancialStatementsConflictSnapshots,
  getFinancialStatementsConflictSnapshotAsOf,
} = await import("./financialStatementsBroker");
const { initDb, closeDb } = await import("./db");

function report(overrides: Partial<LseFinancialReport> & { data: Record<string, number> }): LseFinancialReport {
  return {
    symbol: "AAPL", report_type: "income", date: "2024-09-28", fiscal_year: "2024", period: "FY",
    reported_currency: "USD", filing_date: "2024-11-01", ...overrides, data: JSON.stringify(overrides.data),
  } as unknown as LseFinancialReport;
}

function resolution(overrides: Partial<CapabilityResolution<LseFinancialReport[]>> & { entity: string }): CapabilityResolution<LseFinancialReport[]> {
  const observations: CapabilityObservation<LseFinancialReport[]>[] = overrides.observations ?? [
    { providerId: "sec_edgar", providerLabel: "SEC EDGAR", value: [report({ data: { revenue: 391_035_000_000 } })] },
    { providerId: "simfin", providerLabel: "SimFin", value: [report({ data: { revenue: 390_000_000_000 } })] },
  ];
  return {
    capability: "financial_statements",
    entity: overrides.entity,
    authoritative: overrides.authoritative !== undefined ? overrides.authoritative : observations[0] ?? null,
    observations,
    attemptedProviders: overrides.attemptedProviders ?? observations.map((o) => o.providerId),
    failures: overrides.failures ?? [],
    conflicts: overrides.conflicts ?? [{ key: "income:2024:FY", field: "revenue", values: [{ providerId: "sec_edgar", value: 391_035_000_000 }, { providerId: "simfin", value: 390_000_000_000 }] }],
    authoritativeReason: overrides.authoritativeReason !== undefined ? overrides.authoritativeReason : (observations[0] ? "Ranked highest in this capability's provider priority order." : null),
    resolvedAt: overrides.resolvedAt ?? new Date().toISOString(),
  };
}

test("financial statements conflict snapshot persistence", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // createdByUserId has a real foreign-key constraint to users.id -- insert
  // a fixture user rather than an arbitrary literal, same as a real
  // authenticated caller (req.user!.id) would supply.
  const { users } = await import("@shared/schema");
  const db = (await import("./db")).getDb();
  const [fixtureUser] = await db.insert(users).values({
    email: "conflict-store-test@example.test", passwordHash: "test", role: "internal_admin", name: "Conflict Store Test",
  }).returning();
  const testUserId = fixtureUser.id;
  await t.test("persists a snapshot with the resolution's conflicts, providers, and authoritative pick", async () => {
    const result = await persistFinancialStatementsConflictResolution(resolution({ entity: "AAPL" }), "income", "FY", testUserId);
    assert.equal(result.created, true);
    assert.equal(result.snapshot.entityKey, "AAPL");
    assert.equal(result.snapshot.dataClass, "financial_statements_conflicts");
    assert.equal(result.snapshot.payload.authoritativeProviderId, "sec_edgar");
    assert.deepEqual(result.snapshot.payload.observationProviderIds, ["sec_edgar", "simfin"]);
    assert.equal(result.snapshot.payload.conflicts.length, 1);
    assert.equal(result.snapshot.quality.conflictCount, 1);
    assert.equal(result.snapshot.parentSnapshotId, null, "first snapshot for this key has no parent");
  });

  await t.test("re-persisting an identical resolution reuses the existing snapshot instead of duplicating it", async () => {
    const first = await persistFinancialStatementsConflictResolution(resolution({ entity: "MSFT" }), "income", "FY", testUserId);
    const second = await persistFinancialStatementsConflictResolution(resolution({ entity: "MSFT" }), "income", "FY", testUserId);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.snapshot.id, second.snapshot.id);
    const listed = await listFinancialStatementsConflictSnapshots("MSFT");
    assert.equal(listed.length, 1, "an unchanged re-resolution must not create a second row");
  });

  await t.test("getFinancialStatementsConflictSnapshotAsOf returns the most recent snapshot available at or before the given time", async () => {
    // Backdate the first snapshot's availableAt deterministically instead
    // of racing real wall-clock time between two back-to-back persist
    // calls (PGlite is fast enough that two sequential calls can land in
    // the same millisecond, which made this test flaky before this fix).
    const first = await persistFinancialStatementsConflictResolution(resolution({ entity: "NVDA" }), "income", "FY", testUserId);
    const backdatedAvailableAt = new Date("2020-01-01T00:00:00.000Z");
    await db.update(datasetSnapshots).set({ availableAt: backdatedAvailableAt }).where(eq(datasetSnapshots.id, first.snapshot.id));
    const between = new Date("2020-06-01T00:00:00.000Z");
    const second = await persistFinancialStatementsConflictResolution(resolution({
      entity: "NVDA",
      conflicts: [{ key: "income:2024:FY", field: "revenue", values: [{ providerId: "sec_edgar", value: 391_035_000_000 }, { providerId: "simfin", value: 200_000_000_000 }] }],
    }), "income", "FY", testUserId);
    assert.notEqual(first.snapshot.id, second.snapshot.id);

    const asOfBefore = await getFinancialStatementsConflictSnapshotAsOf("NVDA", "income", "FY", between);
    assert.equal(asOfBefore?.id, first.snapshot.id);
    const asOfLatest = await getFinancialStatementsConflictSnapshotAsOf("NVDA", "income", "FY", new Date());
    assert.equal(asOfLatest?.id, second.snapshot.id);
  });

  await t.test("a genuinely different resolution for the same key creates a new snapshot chained to the previous one as its parent", async () => {
    const first = await persistFinancialStatementsConflictResolution(resolution({ entity: "GOOGL" }), "income", "FY", testUserId);
    const changed = resolution({
      entity: "GOOGL",
      conflicts: [{ key: "income:2024:FY", field: "revenue", values: [{ providerId: "sec_edgar", value: 391_035_000_000 }, { providerId: "simfin", value: 388_000_000_000 }] }],
    });
    const second = await persistFinancialStatementsConflictResolution(changed, "income", "FY", testUserId);
    assert.equal(second.created, true);
    assert.notEqual(second.snapshot.id, first.snapshot.id);
    assert.equal(second.snapshot.parentSnapshotId, first.snapshot.id);
  });

  await t.test("getFinancialStatementsConflictSnapshot reads back by id, scoped to this dataClass", async () => {
    const captured = await persistFinancialStatementsConflictResolution(resolution({ entity: "TSLA" }), "income", "FY", testUserId);
    const fetched = await getFinancialStatementsConflictSnapshot(captured.snapshot.id);
    assert.ok(fetched);
    assert.equal(fetched?.entityKey, "TSLA");
    assert.equal(await getFinancialStatementsConflictSnapshot("00000000-0000-0000-0000-000000000000"), null);
  });

  await t.test("a resolution where nothing agreed still persists with zero conflicts recorded and a null authoritative pick when nobody answered", async () => {
    const result = await persistFinancialStatementsConflictResolution(resolution({
      entity: "NODATA", observations: [], authoritative: null, conflicts: [], attemptedProviders: ["sec_edgar", "finnhub"],
    }), "income", "FY", testUserId);
    assert.equal(result.snapshot.payload.authoritativeProviderId, null);
    assert.equal(result.snapshot.payload.conflicts.length, 0);
    assert.equal(result.snapshot.quality.score, 0);
    assert.match(result.snapshot.quality.warnings.join(" "), /No provider returned data/);
  });

  await t.test("reads back a pre-existing row whose payload predates the authoritativeReason field without crashing", async () => {
    // Regression test: authoritativeReason was added to
    // financialStatementsConflictPayloadSchema after this dataClass first
    // shipped snapshots. A row inserted before that field existed has no
    // key for it at all in its stored JSON (not even null) -- simulated
    // here by inserting a raw row directly, bypassing
    // persistFinancialStatementsConflictResolution (which always supplies
    // the field on new writes) the same way an old, already-persisted
    // production row would look today.
    const legacyPayload = {
      symbol: "LEGACY", reportType: "income", period: "FY",
      authoritativeProviderId: "sec_edgar",
      // authoritativeReason intentionally omitted.
      observationProviderIds: ["sec_edgar"], attemptedProviders: ["sec_edgar"], failedProviders: [], conflicts: [],
    };
    const [inserted] = await db.insert(datasetSnapshots).values({
      id: crypto.randomUUID(), datasetKey: "financial_statements_conflicts:LEGACY:income:FY", entityKey: "LEGACY",
      dataClass: "financial_statements_conflicts", schemaVersion: "1.0.0", source: "financial_statements_broker",
      provider: "sec_edgar", frequency: "annual", currency: null, timezone: "UTC", observationStart: null, observationEnd: null,
      effectiveAt: null, publishedAt: null, retrievedAt: new Date(), availableAt: new Date(),
      contentHash: "b".repeat(64), parentSnapshotId: null,
      quality: { score: 1, providersAttempted: 1, providersAnswered: 1, providersFailed: 0, conflictCount: 0, warnings: [] },
      lineage: {}, payload: legacyPayload, createdByUserId: testUserId,
    }).returning();

    const fetched = await getFinancialStatementsConflictSnapshot(inserted.id);
    assert.ok(fetched);
    assert.equal(fetched?.payload.authoritativeReason, null, "a missing field on an old row must read back as null, not throw");
  });
});
