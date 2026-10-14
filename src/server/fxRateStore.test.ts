import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same LIMURIA_DATA_DIR-before-./db-import ordering requirement as
// currencyMasterStore.test.ts -- see billingSubscriptionProjection.test.ts
// for the full rationale.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-fx-rate-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb } = await import("./db");
const { recordFxRate, resolveFxRateAsOf, convertPersistedAmount } = await import("./fxRateStore");

test("fxRateStore", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test("recordFxRate persists an observation that resolveFxRateAsOf can then find", async () => {
    await recordFxRate({ baseCurrency: "EUR", quoteCurrency: "USD", rateDate: "2026-06-01", rate: 1.1, source: "test" });
    const resolved = await resolveFxRateAsOf("EUR", "USD", "2026-06-01");
    assert.deepEqual(resolved, { rate: 1.1, rateDate: "2026-06-01" });
  });

  await t.test("resolveFxRateAsOf returns null for a pair with no stored observation, rather than guessing", async () => {
    assert.equal(await resolveFxRateAsOf("EUR", "JPY", "2026-06-01"), null);
  });

  await t.test("resolveFxRateAsOf resolves the most recent observation on or before the requested date -- the core date-aware requirement", async () => {
    await recordFxRate({ baseCurrency: "GBP", quoteCurrency: "USD", rateDate: "2026-05-01", rate: 1.25, source: "test" });
    await recordFxRate({ baseCurrency: "GBP", quoteCurrency: "USD", rateDate: "2026-05-15", rate: 1.28, source: "test" });
    await recordFxRate({ baseCurrency: "GBP", quoteCurrency: "USD", rateDate: "2026-06-01", rate: 1.30, source: "test" });

    // Exactly between two observations (a weekend/holiday gap): must
    // resolve to the nearest PRIOR date, never a future one.
    assert.deepEqual(await resolveFxRateAsOf("GBP", "USD", "2026-05-20"), { rate: 1.28, rateDate: "2026-05-15" });
    // Exact match on a stored date.
    assert.deepEqual(await resolveFxRateAsOf("GBP", "USD", "2026-05-15"), { rate: 1.28, rateDate: "2026-05-15" });
    // Before any observation exists at all.
    assert.equal(await resolveFxRateAsOf("GBP", "USD", "2026-04-01"), null);
    // On or after the latest observation resolves to that latest row.
    assert.deepEqual(await resolveFxRateAsOf("GBP", "USD", "2026-12-31"), { rate: 1.30, rateDate: "2026-06-01" });
  });

  await t.test("recordFxRate upserts on (base, quote, date, source) instead of duplicating a revised observation", async () => {
    await recordFxRate({ baseCurrency: "CHF", quoteCurrency: "USD", rateDate: "2026-06-01", rate: 1.10, source: "test" });
    await recordFxRate({ baseCurrency: "CHF", quoteCurrency: "USD", rateDate: "2026-06-01", rate: 1.12, source: "test" });
    assert.deepEqual(await resolveFxRateAsOf("CHF", "USD", "2026-06-01"), { rate: 1.12, rateDate: "2026-06-01" });
  });

  await t.test("convertPersistedAmount composes the store into fxNormalization's convertAmount end-to-end (direct, inverse, and unavailable)", async () => {
    await recordFxRate({ baseCurrency: "JPY", quoteCurrency: "USD", rateDate: "2026-06-01", rate: 0.0067, source: "test" });

    const direct = await convertPersistedAmount({ amount: 10, fromCurrency: "JPY", toCurrency: "USD", asOfDate: "2026-06-01" }, { minorUnit: 2 });
    assert.equal(direct.converted, true);
    assert.equal(direct.direction, "direct");

    const inverse = await convertPersistedAmount({ amount: 10, fromCurrency: "USD", toCurrency: "JPY", asOfDate: "2026-06-01" }, { minorUnit: 0 });
    assert.equal(inverse.converted, true);
    assert.equal(inverse.direction, "inverse");

    const unavailable = await convertPersistedAmount({ amount: 10, fromCurrency: "USD", toCurrency: "AUD", asOfDate: "2026-06-01" }, { minorUnit: 2 });
    assert.deepEqual(unavailable, { converted: false, convertedAmount: null, rate: null, rateDate: null, direction: "unavailable" });
  });
});
