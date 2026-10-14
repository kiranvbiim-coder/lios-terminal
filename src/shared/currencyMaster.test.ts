import assert from "node:assert/strict";
import test from "node:test";
import {
  findCurrency,
  isKnownCurrencyCode,
  matchesCurrency,
  roundToCurrencyPrecision,
  type MasterCurrency,
} from "./currencyMaster";

const USD: MasterCurrency = { code: "USD", name: "US Dollar", minorUnit: 2, symbol: "$", active: true };
const JPY: MasterCurrency = { code: "JPY", name: "Yen", minorUnit: 0, symbol: "\u00A5", active: true };
const CURRENCIES = [USD, JPY];

test("matchesCurrency accepts code and canonical name, case/whitespace-insensitively", () => {
  assert.equal(matchesCurrency(USD, "USD"), true);
  assert.equal(matchesCurrency(USD, "usd"), true);
  assert.equal(matchesCurrency(USD, " US Dollar "), true);
  assert.equal(matchesCurrency(USD, "JPY"), false);
  assert.equal(matchesCurrency(USD, "US"), false, "prefix matches are deliberately rejected");
});

test("findCurrency returns null instead of guessing on an unknown input", () => {
  assert.equal(findCurrency(CURRENCIES, "USD"), USD);
  assert.equal(findCurrency(CURRENCIES, "Yen"), JPY);
  assert.equal(findCurrency(CURRENCIES, "XYZ"), null);
});

test("isKnownCurrencyCode validates an existing free-text currency column value without guessing", () => {
  assert.equal(isKnownCurrencyCode(CURRENCIES, "usd"), true, "case-insensitive");
  assert.equal(isKnownCurrencyCode(CURRENCIES, "XYZ"), false);
  assert.equal(isKnownCurrencyCode(CURRENCIES, null), false);
  assert.equal(isKnownCurrencyCode(CURRENCIES, undefined), false);
  assert.equal(isKnownCurrencyCode(CURRENCIES, ""), false);
});

// Every case below is a verified floating-point rounding trap: naive
// `Math.round(amount * 10 ** minorUnit) / 10 ** minorUnit` fails on the
// entries marked "the trap" because 1.005 is not exactly representable as
// a double (it is stored as 1.00499999999999989...), so scaling by 100
// produces 100.49999999999999 and rounds down instead of up.
const CASES: Array<[amount: number, minorUnit: number, expected: number]> = [
  [1.005, 2, 1.01], // the trap
  [-1.005, 2, -1.01], // the trap, negative
  [1.015, 2, 1.02], // the trap
  [1234.5, 0, 1235],
  [-1234.5, 0, -1235], // JS Math.round(-1234.5) alone gives -1234 (rounds toward +Infinity)
  [-1.5, 0, -2],
  [10.345, 2, 10.35],
  [0.1 + 0.2, 2, 0.3],
  [100, 2, 100],
  [0, 2, 0],
  [123.456, 3, 123.456],
  [999999.995, 2, 1000000],
];

for (const [amount, minorUnit, expected] of CASES) {
  test(`roundToCurrencyPrecision(${amount}, minorUnit=${minorUnit}) === ${expected}`, () => {
    assert.equal(roundToCurrencyPrecision(amount, { minorUnit }), expected);
  });
}

test("roundToCurrencyPrecision rounds a JPY amount to a whole number of yen (minorUnit 0)", () => {
  assert.equal(roundToCurrencyPrecision(1234.6, JPY), 1235);
});

test("roundToCurrencyPrecision preserves a USD amount already at 2 decimal places", () => {
  assert.equal(roundToCurrencyPrecision(19.99, USD), 19.99);
});

test("roundToCurrencyPrecision normalizes a negative amount that rounds to zero magnitude, instead of returning -0", () => {
  const result = roundToCurrencyPrecision(-0.001, USD);
  assert.equal(result, 0);
  assert.equal(Object.is(result, -0), false, "must not be negative zero -- fails strict/SameValue checks and can display as -$0.00");
  assert.equal(Object.is(result, 0), true);
});

test("roundToCurrencyPrecision throws instead of returning NaN for a non-finite amount", () => {
  assert.throws(() => roundToCurrencyPrecision(NaN, USD), RangeError);
  assert.throws(() => roundToCurrencyPrecision(Infinity, USD), RangeError);
  assert.throws(() => roundToCurrencyPrecision(-Infinity, USD), RangeError);
});

test("roundToCurrencyPrecision throws instead of returning NaN when the input magnitude would flip to exponential notation", () => {
  assert.throws(() => roundToCurrencyPrecision(1e21, { minorUnit: 0 }), RangeError);
  assert.throws(() => roundToCurrencyPrecision(1.005e-10, USD), RangeError, "below the 1e-6 threshold");
});

test("roundToCurrencyPrecision throws when the *scaled* amount (input magnitude x minorUnit) would overflow, even if the raw input alone would not", () => {
  // 9.9999e20 alone prints without exponential notation, but scaled by
  // minorUnit 2 (x100) it becomes ~1e23, which prints in exponential
  // notation and corrupts the reassembly string -- a magnitude check on
  // only the raw input misses this.
  assert.throws(() => roundToCurrencyPrecision(9.9999e20, USD), RangeError);
  assert.equal(roundToCurrencyPrecision(9.9999e20, JPY), 9.9999e20, "same magnitude is fine at minorUnit 0 (scale 1)");
});
