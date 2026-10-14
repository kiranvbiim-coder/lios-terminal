import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same isolation requirement as the other DB-touching tests: db.ts freezes
// its PGLITE_DIR on first import, including transitively through
// communityDataConsent.ts -> db.ts, so those imports are deferred until
// LIMURIA_DATA_DIR points at an isolated temp directory.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-runtime-pack-consent-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { unconsentedRuntimePacks, setCommunityConsent } = await import("./communityDataConsent");
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");

test("runtime pack installs are blocked until the matching community consent record exists", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [user] = await getDb().insert(users).values({
    email: "runtime-pack-consent@example.test", passwordHash: "test", role: "internal_admin", name: "Pack Consent Test",
  }).returning();

  await t.test("a core-only install needs no consent record", async () => {
    assert.deepEqual(await unconsentedRuntimePacks(user.id, ["core"]), []);
  });

  await t.test("packs with no community-data implication need no consent record", async () => {
    assert.deepEqual(await unconsentedRuntimePacks(user.id, ["core", "ml", "fixed-income", "optimization"]), []);
  });

  await t.test("the community-yahoo pack is blocked before consent is accepted", async () => {
    const blocked = await unconsentedRuntimePacks(user.id, ["core", "community-yahoo"]);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].packId, "community-yahoo");
    assert.equal(blocked[0].scope, "yahoo_community", "the pack must resolve to the very consent record the connector reads");
  });

  await t.test("accepting the connector's yahoo_community consent unblocks the runtime pack -- one record governs both", async () => {
    await setCommunityConsent(user.id, "yahoo_community", true, "v1");
    assert.deepEqual(await unconsentedRuntimePacks(user.id, ["core", "community-yahoo"]), []);
  });

  await t.test("revoking that consent re-blocks the pack", async () => {
    await setCommunityConsent(user.id, "yahoo_community", false, "v1");
    const blocked = await unconsentedRuntimePacks(user.id, ["community-yahoo"]);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].packId, "community-yahoo");
  });

  await t.test("public_filler consent does not stand in for yahoo_community", async () => {
    await setCommunityConsent(user.id, "public_filler", true, "v1");
    const blocked = await unconsentedRuntimePacks(user.id, ["community-yahoo"]);
    assert.equal(blocked.length, 1, "the two scopes govern different real capabilities and must not substitute for each other");
  });
});
