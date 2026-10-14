import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p6-personal-fx-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb } = await import("./db");
const { recordFxRate } = await import("./fxRateStore");
const { runP6PersonalFinance } = await import("./p6FinanceRoutes");
const { p6PersonalFinanceRequestSchema } = await import("@shared/p6FinanceContracts");

test("P6 authenticated-runner calculation composes real persisted FX source/date without a provider fetch", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await recordFxRate({
    baseCurrency: "EUR", quoteCurrency: "USD",
    rateDate: "2026-10-01", rate: 1.2, source: "fixture-only-rate-source",
  });
  const input = p6PersonalFinanceRequestSchema.parse({
    schemaVersion: "1", asOf: "2026-10-11",
    accounts: [
      { id: "dollars", kind: "bank", balance: 100, currency: "USD" },
      { id: "euros", kind: "investment", balance: 100, currency: "EUR" },
    ],
    transactions: [
      { id: "expense", at: "2026-10-02", accountId: "euros", amount: -10, category: "groceries" },
    ],
    fxNormalization: { reportingCurrency: "USD" },
  });
  const out = await runP6PersonalFinance(input);
  assert.equal(out.fxNormalized?.status, "complete");
  assert.equal(out.fxNormalized?.assets, 220);
  assert.equal(out.fxNormalized?.netWorth, 220);
  assert.equal(out.fxNormalized?.budget?.totalExpenses, 12);
  assert.equal(out.fxNormalized?.rateReceipts.find((x) => x.id === "expense")?.source, "fixture-only-rate-source");
  assert.equal(out.fxNormalized?.rateReceipts.find((x) => x.id === "expense")?.effectiveRateDate, "2026-10-01");
  assert.ok(out.warnings.some((x) => x.includes("legacy base snapshot")));
  assert.equal(out.assets, 200, "legacy nominal result remains distinct and unconverted");

  await assert.rejects(
    async () => runP6PersonalFinance({
      ...input, fxNormalization: { reportingCurrency: "ZZZ" },
    }),
    /active registered currency/,
  );
  const backwardCompatible = runP6PersonalFinance({ ...input, fxNormalization: undefined });
  assert.equal(backwardCompatible instanceof Promise, false, "historical no-FX runner stays synchronous");
  assert.equal((await backwardCompatible).fxNormalized, undefined);
});
