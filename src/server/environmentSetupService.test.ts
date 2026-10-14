import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same isolation requirement as financialStatementsConflictStore.test.ts:
// db.ts freezes its PGLITE_DIR the instant it's first imported, so every
// import touching ./db is deferred until LIMURIA_DATA_DIR points at an
// isolated temp directory. Exception to static-import: this test
// intentionally exercises module-load ordering against a fresh, isolated
// PGlite instance per file, so the module specifiers below cannot be
// hoisted above the LIMURIA_DATA_DIR assignment without breaking that
// isolation (same documented exception financialStatementsConflictStore.test.ts
// and companyStore.test.ts already rely on).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-environment-setup-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { addDataStackPin, removeDataStackPin, listDataStackPins } = await import("./environmentSetupService");
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");

test("data stack pin CRUD: create, list, dedup-on-same-target, and remove", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const db = getDb();
  const [fixtureUser] = await db.insert(users).values({
    email: "pin-crud-test@example.test", passwordHash: "test", role: "internal_admin", name: "Pin CRUD Test",
  }).returning();
  const actor = { id: fixtureUser.id, email: fixtureUser.email };

  await t.test("listDataStackPins returns an empty array when the user has no environment setup row yet", async () => {
    const pins = await listDataStackPins(fixtureUser.id);
    assert.deepEqual(pins, []);
  });

  await t.test("addDataStackPin creates a baseline setup row when none exists, and the pin round-trips through listDataStackPins", async () => {
    const pin = await addDataStackPin(fixtureUser.id, null, {
      scope: "symbol", family: "statements", symbol: "aapl", metric: null, providerId: "sec_edgar", reason: "EDGAR is authoritative for US filers.",
    }, actor);
    assert.equal(pin.scope, "symbol");
    assert.equal(pin.symbol, "AAPL", "symbol must be uppercased on write");
    assert.equal(pin.providerId, "sec_edgar");
    assert.equal(pin.createdByUserId, fixtureUser.id);
    assert.ok(pin.id);

    const pins = await listDataStackPins(fixtureUser.id);
    assert.equal(pins.length, 1);
    assert.equal(pins[0].id, pin.id);
  });

  await t.test("a second pin at a different target is appended, not replacing the first", async () => {
    await addDataStackPin(fixtureUser.id, null, {
      scope: "family", family: "quote", symbol: null, metric: null, providerId: "tiingo", reason: null,
    }, actor);
    const pins = await listDataStackPins(fixtureUser.id);
    assert.equal(pins.length, 2);
  });

  await t.test("a pin created at the exact same (scope, family, symbol, metric) target replaces the prior one instead of stacking", async () => {
    const before = await listDataStackPins(fixtureUser.id);
    const beforeCount = before.length;
    const replacement = await addDataStackPin(fixtureUser.id, null, {
      scope: "symbol", family: "statements", symbol: "AAPL", metric: null, providerId: "finnhub", reason: "Switched preference.",
    }, actor);
    const after = await listDataStackPins(fixtureUser.id);
    assert.equal(after.length, beforeCount, "replacing an existing target must not grow the pin count");
    const atTarget = after.filter((p) => p.scope === "symbol" && p.family === "statements" && p.symbol === "AAPL");
    assert.equal(atTarget.length, 1, "only one pin may exist per (scope, family, symbol, metric) target");
    assert.equal(atTarget[0].id, replacement.id);
    assert.equal(atTarget[0].providerId, "finnhub");
  });

  await t.test("removeDataStackPin removes an existing pin and returns true; a second removal of the same id returns false", async () => {
    const pins = await listDataStackPins(fixtureUser.id);
    const target = pins.find((p) => p.family === "quote")!;
    assert.ok(target);
    const removed = await removeDataStackPin(fixtureUser.id, target.id, actor);
    assert.equal(removed, true);
    const removedAgain = await removeDataStackPin(fixtureUser.id, target.id, actor);
    assert.equal(removedAgain, false);
    const remaining = await listDataStackPins(fixtureUser.id);
    assert.ok(!remaining.some((p) => p.id === target.id));
  });

  await t.test("removeDataStackPin returns false for a user with no environment setup row at all", async () => {
    const [otherUser] = await db.insert(users).values({
      email: "pin-crud-no-setup@example.test", passwordHash: "test", role: "internal_admin", name: "No Setup User",
    }).returning();
    const removed = await removeDataStackPin(otherUser.id, "does-not-exist", { id: otherUser.id, email: otherUser.email });
    assert.equal(removed, false);
  });
});
