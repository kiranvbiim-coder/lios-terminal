import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-capture-pair-"));
process.env.LIMURIA_DATA_DIR = root;
const [{ initDb, getDb, closeDb }, schema, { registerDataFabricRoutes }, market, economics, { stableSnapshotHash }] = await Promise.all([
  import("./db"), import("@shared/schema"), import("./dataFabricRoutes"), import("./marketDatasetStore"),
  import("./economicDatasetStore"), import("./pointInTimeDatasetStore"),
]);

test("both capture comparison routes refuse foreign or unlicensed source payloads", async t => {
  await initDb();
  const [owner, foreign] = await getDb().insert(schema.users).values([
    { email: `owner-${crypto.randomUUID()}@example.test`, name: "Capture owner", role: "internal_admin", passwordHash: "unused" },
    { email: `foreign-${crypto.randomUUID()}@example.test`, name: "Foreign owner", role: "internal_analyst", passwordHash: "unused" },
  ]).returning();
  const app = express();
  app.use((req, _res, next) => {
    req.user = owner;
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    next();
  });
  registerDataFabricRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback address");
  for (const dataClass of ["market_series", "economic_series"] as const) {
    const [policy] = await getDb().insert(schema.dataEntitlementPolicies).values({
      id: crypto.randomUUID(), provider: "fixture", dataClass, licenseType: "user_supplied",
      accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "derived_output"],
      effectiveFrom: new Date("2020-01-01"), contentHash: crypto.randomBytes(32).toString("hex"),
    }).returning();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const capturedAt = new Date(`2026-10-${10 + i}T12:00:00Z`);
      const normalized = dataClass === "market_series" ? market.buildMarketDatasetPayload({
        symbol: "TEST", currency: "USD", timezone: "UTC", calendar: "XNYS", priceBasis: "raw",
        bars: [{ date: "2026-01-02", open: 100, high: 110, low: 90, close: 100 + i, volume: 10 }],
      }) : economics.buildScalarSeriesPayload({
        seriesId: "TEST", name: "Recorded series", unit: "percent", category: "rates", retrievedAt: capturedAt.toISOString(),
        observations: [{ date: "2026-01-02", value: 5 + i }],
      });
      const lineage = {};
      const id = crypto.randomUUID(); ids.push(id);
      await getDb().insert(schema.datasetSnapshots).values({
        id, datasetKey: dataClass === "market_series" ? "market:TEST:1d" : "economic:TEST", entityKey: "TEST", dataClass,
        source: "fixture", provider: "fixture", schemaVersion: "1.0.0", frequency: "daily", timezone: "UTC",
        currency: dataClass === "market_series" ? "USD" : null, observationStart: "2026-01-02", observationEnd: "2026-01-02",
        effectiveAt: capturedAt, retrievedAt: capturedAt, availableAt: capturedAt,
        contentHash: stableSnapshotHash({ payload: normalized.payload, lineage }), quality: normalized.quality,
        lineage, payload: normalized.payload, createdByUserId: owner.id, entitlementPolicyId: policy.id,
      });
    }
    const url = `http://127.0.0.1:${address.port}/api/data-snapshots/${dataClass === "market_series" ? "markets" : "economics"}/TEST/compare?baselineId=${ids[0]}&currentId=${ids[1]}`;
    const accepted = await fetch(url);
    assert.equal(accepted.status, 200, await accepted.text());
    // A foreign baseline must fail before a malformed payload can be parsed.
    await getDb().update(schema.datasetSnapshots).set({ createdByUserId: foreign.id, payload: { privateValue: "must-not-be-read" } }).where(eq(schema.datasetSnapshots.id, ids[0]));
    const denied = await fetch(url);
    assert.equal(denied.status, 404);
    assert.equal((await denied.text()).includes("must-not-be-read"), false);
    // Owned captures still require current rights on BOTH versions.
    await getDb().update(schema.datasetSnapshots).set({ createdByUserId: owner.id }).where(eq(schema.datasetSnapshots.id, ids[0]));
    await getDb().update(schema.dataEntitlementPolicies).set({ permittedUses: ["display"] }).where(eq(schema.dataEntitlementPolicies.id, policy.id));
    assert.equal((await fetch(url)).status, 404);
    await getDb().update(schema.dataEntitlementPolicies).set({ permittedUses: ["display", "derived_output"], effectiveTo: new Date("2020-01-02") }).where(eq(schema.dataEntitlementPolicies.id, policy.id));
    assert.equal((await fetch(url)).status, 404);
    await getDb().update(schema.datasetSnapshots).set({ entitlementPolicyId: null }).where(eq(schema.datasetSnapshots.id, ids[1]));
    assert.equal((await fetch(url)).status, 404);
  }
});
