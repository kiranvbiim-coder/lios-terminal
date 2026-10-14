import assert from "node:assert/strict";
import test from "node:test";
import { convertAmount, type FxRateLookup, type ResolvedFxRate } from "./fxNormalization";

const USD = { minorUnit: 2 };
const JPY = { minorUnit: 0 };

function neverCalledLookup(): FxRateLookup {
  return () => {
    throw new Error("lookup must not be called for an identity conversion");
  };
}

test("convertAmount is an identity conversion when fromCurrency === toCurrency, without calling the lookup", async () => {
  const outcome = await convertAmount({ amount: 42.5, fromCurrency: "USD", toCurrency: "USD", asOfDate: "2026-06-01" }, neverCalledLookup(), USD);
  assert.deepEqual(outcome, { converted: true, convertedAmount: 42.5, rate: 1, rateDate: "2026-06-01", direction: "identity" });
});

test("convertAmount uses a direct rate when the lookup resolves the exact requested pair", async () => {
  const lookup: FxRateLookup = (base, quote, asOfDate) => {
    assert.equal(base, "EUR");
    assert.equal(quote, "USD");
    assert.equal(asOfDate, "2026-06-01");
    return { rate: 1.1, rateDate: "2026-06-01" };
  };
  const outcome = await convertAmount({ amount: 100, fromCurrency: "EUR", toCurrency: "USD", asOfDate: "2026-06-01" }, lookup, USD);
  assert.deepEqual(outcome, { converted: true, convertedAmount: 110, rate: 1.1, rateDate: "2026-06-01", direction: "direct" });
});

test("convertAmount falls back to the inverse pair when only that direction is stored", async () => {
  const lookup: FxRateLookup = (base, quote) => {
    if (base === "USD" && quote === "EUR") return { rate: 1.25, rateDate: "2026-05-28" };
    return null; // no EUR->USD row stored
  };
  const outcome = await convertAmount({ amount: 100, fromCurrency: "EUR", toCurrency: "USD", asOfDate: "2026-06-01" }, lookup, USD);
  assert.equal(outcome.converted, true);
  assert.equal(outcome.direction, "inverse");
  assert.equal(outcome.rate, 0.8, "1 / 1.25 = 0.8");
  assert.equal(outcome.convertedAmount, 80);
  assert.equal(outcome.rateDate, "2026-05-28", "reflects the resolved observation's actual date, not the requested asOfDate");
});

test("convertAmount returns converted:false, never a silent guess, when neither direction resolves", async () => {
  const lookup: FxRateLookup = () => null;
  const outcome = await convertAmount({ amount: 100, fromCurrency: "EUR", toCurrency: "USD", asOfDate: "2026-06-01" }, lookup, USD);
  assert.deepEqual(outcome, { converted: false, convertedAmount: null, rate: null, rateDate: null, direction: "unavailable" });
});

test("convertAmount rounds the converted amount to the target currency's minor unit, not the source's", async () => {
  const lookup: FxRateLookup = () => ({ rate: 150.345, rateDate: "2026-06-01" });
  const outcome = await convertAmount({ amount: 10, fromCurrency: "USD", toCurrency: "JPY", asOfDate: "2026-06-01" }, lookup, JPY);
  assert.equal(outcome.converted, true);
  assert.equal(outcome.convertedAmount, 1503, "10 * 150.345 = 1503.45, rounded to JPY's 0 decimal places");
});

test("convertAmount awaits an async lookup correctly", async () => {
  const lookup: FxRateLookup = async (base, quote): Promise<ResolvedFxRate | null> => {
    // Genuinely async (resolves via microtask, not immediately synchronous)
    // without a real wall-clock timer -- proves convertAmount awaits the
    // lookup rather than assuming a synchronous return.
    await Promise.resolve();
    return base === "GBP" && quote === "USD" ? { rate: 1.3, rateDate: "2026-06-01" } : null;
  };
  const outcome = await convertAmount({ amount: 10, fromCurrency: "GBP", toCurrency: "USD", asOfDate: "2026-06-01" }, lookup, USD);
  assert.equal(outcome.converted, true);
  assert.equal(outcome.convertedAmount, 13);
});
