import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// db.ts freezes its PGLITE_DIR the instant it's first imported, including
// transitively through a static import of factorRiskModel.ts/
// factorRiskSnapshotStore.ts at this file's own top level -- same
// isolation requirement documented in calculationJobService.test.ts.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-factor-risk-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const {
  clearFactorRiskSnapshotCache,
  configureFactorRiskSnapshotStore,
  getFactorRiskSnapshot,
  resetFactorRiskSnapshotStore,
} = await import("./factorRiskModel");
const { createFactorRiskSnapshotStore } = await import("./factorRiskSnapshotStore");
const { runWithRequestIdentity } = await import("./requestContext");
const { initDb, closeDb, getDb } = await import("./db");
const { organizations, users } = await import("@shared/schema");

function sampleSnapshot(): Record<string, unknown> {
  return {
    snapshotId: "factor-risk-content-addressed",
    contentHash: "a".repeat(64),
    request: { symbols: ["AAA"], benchmarkSymbol: "^GSPC", range: "5Y", asOf: "2026-01-01", scope: "local" },
    capturedAt: "2026-01-02T00:00:00.000Z",
    retrievalStartedAt: "2026-01-01T23:59:00.000Z",
    retrievalCompletedAt: "2026-01-02T00:00:00.000Z",
    cache: "miss",
    sources: { benchmark: { symbol: "^GSPC", provider: "marketData", status: "available", source: "fixture", retrievedAt: "2026-01-02T00:00:00.000Z" }, securities: {} },
    provenance: { benchmark: {}, securities: {} },
    factors: [],
    securities: [],
    estimation: { factorReturnSeries: [], factorCovariance: [], specificVariances: {} },
    estimator: { factorReturnSeries: [], factorCovariance: [], specificVariances: {} },
    excluded: [],
    limitations: [],
  };
}

test("durable factor risk snapshot store", async (t) => {
  await initDb();
  t.after(async () => {
    resetFactorRiskSnapshotStore();
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // Factor-risk snapshots are org-scoped via datasetSnapshots.organizationId,
  // which carries a real FK to organizations.id -- these rows must exist
  // before any snapshot references them, exactly like production callers
  // (getRequestIdentity().organizationId always comes from a logged-in
  // session tied to a genuine organization row).
  const [orgSeventyOne] = await getDb().insert(organizations).values({ name: "Org 71", slug: "factor-risk-org-71" }).returning();
  const [orgSeventyTwo] = await getDb().insert(organizations).values({ name: "Org 72", slug: "factor-risk-org-72" }).returning();
  const [orgSeventyThree] = await getDb().insert(organizations).values({ name: "Org 73", slug: "factor-risk-org-73" }).returning();
  const [orgEighty] = await getDb().insert(organizations).values({ name: "Org 80", slug: "factor-risk-org-80" }).returning();

  await t.test("factor snapshots survive cache clear and a new store instance", async () => {
    const firstStore = createFactorRiskSnapshotStore();
    const snapshot = sampleSnapshot();
    await firstStore.save(snapshot, "request-key", Date.now() + 60_000);

    configureFactorRiskSnapshotStore(createFactorRiskSnapshotStore());
    await clearFactorRiskSnapshotCache();
    const loaded = await getFactorRiskSnapshot(String(snapshot.snapshotId));
    assert.deepEqual(loaded, snapshot);

    (loaded!.sources as { benchmark: { status: string } }).benchmark.status = "mutated";
    const reread = await getFactorRiskSnapshot(String(snapshot.snapshotId));
    assert.equal((reread!.sources as { benchmark: { status: string } }).benchmark.status, "available");
  });

  await t.test("content-addressed snapshots cannot be overwritten with mismatched content, and expired records are pruned", async () => {
    const store = createFactorRiskSnapshotStore();
    const snapshot = { ...sampleSnapshot(), snapshotId: "immutability-fixture", contentHash: "b".repeat(64) };
    await store.save(snapshot, "request-key-immutable", Date.now() + 60_000);
    await assert.rejects(
      store.save({ ...snapshot, contentHash: "c".repeat(64) }, "request-key-immutable", Date.now() + 60_000),
      /immutable/,
    );

    await store.save({ ...sampleSnapshot(), snapshotId: "expired-snapshot", contentHash: "d".repeat(64) }, "expired-key", Date.now() - 1);
    configureFactorRiskSnapshotStore(createFactorRiskSnapshotStore());
    await clearFactorRiskSnapshotCache();
    assert.equal(await getFactorRiskSnapshot("expired-snapshot"), null);
    assert.equal(await store.getBySnapshotId("expired-snapshot"), null, "an expired row must be pruned on read, not merely hidden");
  });

  await t.test("metadata listing is bounded, filterable, durable, and excludes model payload", async () => {
    const store = createFactorRiskSnapshotStore();
    const now = Date.now();
    const first = {
      ...sampleSnapshot(),
      snapshotId: "snapshot-a",
      contentHash: "e".repeat(64),
      capturedAt: "2026-01-03T00:00:00.000Z",
      request: { ...sampleSnapshot().request, symbols: ["AAA", "BBB"], asOf: "2026-01-02", scope: `organization:${orgSeventyOne.id}` },
      securities: [{ securityId: "AAA" }],
      excluded: [{ securityId: "BBB", reason: "missing fundamentals apiKey=SECRET" }],
      estimation: { factorReturnSeries: [{ periodEnd: "2026-01-01", returns: {} }], factorCovariance: [], specificVariances: {} },
    };
    const second = {
      ...sampleSnapshot(),
      snapshotId: "snapshot-b",
      contentHash: "f".repeat(64),
      request: { ...sampleSnapshot().request, symbols: ["CCC"], scope: `organization:${orgSeventyTwo.id}` },
    };
    await store.save(first, "request-a", now + 60_000);
    await store.save(second, "request-b", now + 60_000);

    const page = await store.list({ page: 1, limit: 1, organizationScope: `organization:${orgSeventyOne.id}`, symbol: "aaa", asOf: "2026-01-02", now });
    assert.equal(page.total, 1);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].snapshotId, "snapshot-a");
    assert.deepEqual(page.items[0].included, ["AAA"]);
    assert.deepEqual(page.items[0].excluded, [{ securityId: "BBB", reason: "missing fundamentals apiKey=[REDACTED]" }]);
    assert.equal(page.items[0].periodCount, 1);
    assert.equal("sources" in page.items[0], false);
    assert.equal("credentials" in page.items[0], false);

    const reloaded = await createFactorRiskSnapshotStore().list({ organizationScope: `organization:${orgSeventyTwo.id}`, now });
    assert.deepEqual(reloaded.items.map((item) => item.snapshotId), ["snapshot-b"]);
    await assert.rejects(store.list({ limit: 101 }), /limit/);
    await assert.rejects(store.list({ page: 10_001 }), /page/);
  });

  await t.test("organization scope prevents cross-tenant snapshot reads", async () => {
    const [owner, outsider] = await getDb().insert(users).values([
      {email:"factor-store-owner@example.test",name:"Synthetic store owner",passwordHash:"fixture",role:"internal_analyst",organizationId:orgSeventyThree.id},
      {email:"factor-store-outsider@example.test",name:"Synthetic outsider",passwordHash:"fixture",role:"internal_analyst",organizationId:orgEighty.id},
    ]).returning();
    const snapshot = {
      ...sampleSnapshot(),
      snapshotId: "factor-risk-org-scoped",
      contentHash: "07".repeat(32),
      request: { ...sampleSnapshot().request, scope: `organization:${orgSeventyThree.id}` },
    };
    const store = createFactorRiskSnapshotStore();
    await runWithRequestIdentity({userId:owner.id,organizationId:orgSeventyThree.id},()=>store.save(snapshot,"org-request-key",Date.now()+60_000));
    assert.equal(await runWithRequestIdentity({userId:outsider.id,organizationId:orgEighty.id},()=>store.getBySnapshotId(String(snapshot.snapshotId))),null);
    assert.deepEqual((await runWithRequestIdentity({userId:owner.id,organizationId:orgSeventyThree.id},()=>store.getBySnapshotId(String(snapshot.snapshotId))))?.snapshot,snapshot);
  });
});
