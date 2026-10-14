import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same LIMURIA_DATA_DIR-before-./db-import ordering requirement as
// billingSubscriptionProjection.test.ts -- see that file's comment for the
// full rationale.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-currency-master-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const {
  listCurrencies,
  resolvePersistedCurrency,
  isPersistedCurrencyCode,
  resetCurrencyMasterCache,
} = await import("./currencyMasterStore");
const { currencies } = await import("@shared/schema");

test("currencyMasterStore", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const db = getDb();

  await t.test("listCurrencies returns the seeded currency master, including zero-decimal currencies", async () => {
    const rows = await listCurrencies();
    assert.equal(rows.length >= 30, true, "expected at least the 30 seeded currencies");
    const usd = rows.find((row) => row.code === "USD");
    assert.equal(usd?.minorUnit, 2);
    assert.equal(usd?.symbol, "$");
    const jpy = rows.find((row) => row.code === "JPY");
    assert.equal(jpy?.minorUnit, 0, "JPY has no minor unit");
  });

  await t.test("resolvePersistedCurrency resolves by code and canonical name, case-insensitively", async () => {
    assert.equal((await resolvePersistedCurrency("usd"))?.code, "USD");
    assert.equal((await resolvePersistedCurrency("Indian Rupee"))?.code, "INR");
    assert.equal(await resolvePersistedCurrency("Atlantis Credits"), null);
  });

  await t.test("isPersistedCurrencyCode validates a free-text currency value without guessing", async () => {
    assert.equal(await isPersistedCurrencyCode("EUR"), true);
    assert.equal(await isPersistedCurrencyCode("eur"), true);
    assert.equal(await isPersistedCurrencyCode("XYZ"), false);
    assert.equal(await isPersistedCurrencyCode(null), false);
  });

  await t.test("resetCurrencyMasterCache makes a newly inserted currency visible on the next read", async () => {
    assert.equal(await isPersistedCurrencyCode("XTS"), false, "not yet inserted");
    await db.insert(currencies).values({ code: "XTS", name: "Codes specifically reserved for testing purposes", minorUnit: 2 });
    assert.equal(await isPersistedCurrencyCode("XTS"), false, "cache not yet invalidated");
    resetCurrencyMasterCache();
    assert.equal(await isPersistedCurrencyCode("XTS"), true, "cache invalidated, row now visible");
  });
});
