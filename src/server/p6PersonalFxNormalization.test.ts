import assert from "node:assert/strict";
import test from "node:test";
import { normalizeP6PersonalFinanceFx, type P6FxRateEvidenceLookup } from "./p6PersonalFxNormalization";
import { p6PersonalFinanceRequestSchema } from "@shared/p6FinanceContracts";

const base = p6PersonalFinanceRequestSchema.parse({
  schemaVersion: "1", asOf: "2026-10-11",
  accounts: [
    { id: "cash", kind: "bank", balance: 100, currency: "USD" },
    { id: "eur", kind: "investment", balance: 100, currency: "EUR" },
    { id: "debt", kind: "loan", balance: -50, currency: "EUR" },
  ],
  transactions: [
    { id: "salary", at: "2026-10-01", amount: 100, category: "salary", accountId: "eur" },
    { id: "food", at: "2026-10-03", amount: -25, category: "groceries", accountId: "eur" },
    { id: "rent", at: "2026-10-04", amount: -10, category: "rent", accountId: "cash" },
  ],
  retirement: null,
});
const usd = { code: "USD", minorUnit: 2 };
const eurUsd: P6FxRateEvidenceLookup = (from, to, asOf) =>
  from === "EUR" && to === "USD" && asOf >= "2026-09-30"
    ? { rate: 1.2, rateDate: "2026-09-30", source: "test-central-bank" } : null;

test("P6 FX: independently hand-summed mixed balances and budget, source and dates retained", async () => {
  const out = await normalizeP6PersonalFinanceFx(base, usd, eurUsd);
  assert.equal(out.status, "complete");
  assert.deepEqual(out.gaps, []);
  assert.equal(out.assets, 220);     // USD100 + EUR100*1.2
  assert.equal(out.liabilities, 60);  // EUR50*1.2
  assert.equal(out.netWorth, 160);
  assert.equal(out.trailingMonthlyIncome, 120);
  assert.equal(out.trailingMonthlyExpenses, 40);
  assert.equal(out.trailingMonthlyCashFlow, 80);
  assert.equal(out.budget?.totalExpenses, 40);
  assert.deepEqual(out.budget?.categories.map(({ category, expenses }) => ({ category, expenses })),
    [{ category: "groceries", expenses: 30 }, { category: "rent", expenses: 10 }]);
  assert.equal(out.rateReceipts.length, 6);
  const converted = out.rateReceipts.find((x) => x.id === "food");
  assert.equal(converted?.direction, "direct");
  assert.equal(converted?.source, "test-central-bank");
  assert.equal(converted?.effectiveRateDate, "2026-09-30");
  assert.equal(converted?.requestedAsOf, "2026-10-03");
  assert.equal(converted?.evidenceClass, "stored_rate_source_unverified_publication_clock");
  const identity = out.rateReceipts.find((x) => x.id === "cash");
  assert.equal(identity?.direction, "identity");
  assert.equal(identity?.source, "identity_conversion");
  assert.match(out.limitation, /not verified publication/i);
});

test("P6 FX: inverse pair only and target currency minor-unit precision", async () => {
  const inverse: P6FxRateEvidenceLookup = (base, quote) =>
    base === "USD" && quote === "EUR"
      ? { rate: 0.8, rateDate: "2026-09-29", source: "test-inverse" } : null;
  const out = await normalizeP6PersonalFinanceFx(base, usd, inverse);
  assert.equal(out.status, "complete");
  assert.equal(out.assets, 225);
  assert.equal(out.liabilities, 62.5);
  assert.equal(out.rateReceipts.find((x) => x.id === "eur")?.direction, "inverse");
  assert.equal(out.rateReceipts.find((x) => x.id === "eur")?.source, "test-inverse");
});

test("P6 FX: each transaction uses rate available at its date; balance uses snapshot as-of", async () => {
  const dated: P6FxRateEvidenceLookup = (from, to, asOf) => {
    if (from !== "EUR" || to !== "USD") return null;
    return asOf < "2026-10-02"
      ? { rate: 1.1, rateDate: "2026-10-01", source: "source-A" }
      : { rate: 1.3, rateDate: "2026-10-02", source: "source-B" };
  };
  const out = await normalizeP6PersonalFinanceFx(base, usd, dated);
  assert.equal(out.status, "complete");
  assert.equal(out.assets, 230);
  assert.equal(out.trailingMonthlyIncome, 110);  // transaction day 1
  assert.equal(out.budget?.categories.find((x) => x.category === "groceries")?.expenses, 32.5);
  assert.equal(out.rateReceipts.find((x) => x.id === "salary")?.source, "source-A");
  assert.equal(out.rateReceipts.find((x) => x.id === "food")?.source, "source-B");
});

test("P6 FX: missing rate gives null aggregates, never adds incomparable nominal amounts", async () => {
  const out = await normalizeP6PersonalFinanceFx(base, usd, () => null);
  assert.equal(out.status, "data_gap");
  assert.equal(out.assets, null);
  assert.equal(out.netWorth, null);
  assert.equal(out.budget, null);
  assert.equal(out.trailingMonthlyCashFlow, null);
  assert.ok(out.gaps.some((x) => x.kind === "account" && x.id === "eur" && x.reason === "unavailable_rate"));
  assert.ok(out.rateReceipts.some((x) => x.direction === "identity"));
});

test("P6 FX: future observation or missing provenance is not accepted as historic FX", async () => {
  for (const invalid of [
    { rate: 1.2, rateDate: "2026-12-01", source: "future" },
    { rate: 1.2, rateDate: "2026-10-01", source: "" },
    { rate: Number.POSITIVE_INFINITY, rateDate: "2026-09-30", source: "bad" },
    { rate: 0, rateDate: "2026-09-30", source: "bad" },
  ]) {
    const out = await normalizeP6PersonalFinanceFx(base, usd, () => invalid);
    assert.equal(out.status, "data_gap");
    assert.equal(out.assets, null);
    assert.ok(out.gaps.some((x) => x.reason === "invalid_rate_evidence"));
  }
});

test("P6 FX: unknown account, missing profile and malformed currency fail closed", async () => {
  const withUnknown = { ...base, transactions: [
    ...base.transactions, { id: "orphan", accountId: "gone", at: "2026-10-04", amount: -20, category: "fee" },
  ] };
  const out = await normalizeP6PersonalFinanceFx(withUnknown, usd, eurUsd);
  assert.equal(out.status, "data_gap");
  assert.ok(out.gaps.some((x) => x.id === "orphan" && x.reason === "missing_account"));
  const noProfile = await normalizeP6PersonalFinanceFx({ ...base, accounts: [], transactions: [] }, usd, eurUsd);
  assert.equal(noProfile.status, "data_gap");
  assert.equal(noProfile.assets, null);
  await assert.rejects(() => normalizeP6PersonalFinanceFx(base, { code: "xxx", minorUnit: 2 }, eurUsd), /verified ISO/);
});

test("P6 FX: refuses unbounded fanout and normalizes only transactions on or before as-of", async () => {
  await assert.rejects(
    () => normalizeP6PersonalFinanceFx({ ...base, transactions: Array.from({ length: 5_001 }, (_, i) => ({
      id: String(i), at: "2026-10-01", amount: 1, accountId: "cash", category: "other",
    })) }, usd, eurUsd),
    /bounded/,
  );
  const future = { ...base, transactions: [
    ...base.transactions, { id: "future", accountId: "cash", at: "2026-11-01", amount: -9999, category: "future" },
  ] };
  const out = await normalizeP6PersonalFinanceFx(future, usd, eurUsd);
  assert.equal(out.status, "complete");
  assert.equal(out.budget?.totalExpenses, 40);
  assert.ok(!out.rateReceipts.some((x) => x.id === "future"));
});
