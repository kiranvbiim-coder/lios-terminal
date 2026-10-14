/**
 * LiOS V4 Currency Master contracts (LV4-05-01).
 *
 * Canonical ISO 4217 currency reference. Existing free-text "currency"
 * columns scattered across the schema (companyListings, financial
 * statement periods, consensus snapshots, ...) are not migrated by this
 * module -- same "resolve, don't force-migrate" convention as
 * globalMarketMaster.ts for country/exchange free text. New code that
 * needs to validate or round a currency amount should resolve through
 * here rather than assuming every amount has 2 decimal places.
 */
import type { Currency } from "./schema";
import { normalizeLookupKey } from "./globalMarketMaster";

export type MasterCurrency = Pick<Currency, "code" | "name" | "minorUnit" | "symbol" | "active">;

/**
 * Matches an input string against a currency's ISO code or canonical name.
 * Case/whitespace-insensitive; exact match only -- same discipline as
 * matchesCountry/matchesExchange, no fuzzy/prefix matching.
 */
export function matchesCurrency(currency: MasterCurrency, input: string): boolean {
  const needle = normalizeLookupKey(input);
  if (normalizeLookupKey(currency.code) === needle) return true;
  return normalizeLookupKey(currency.name) === needle;
}

export function findCurrency(currencies: readonly MasterCurrency[], input: string): MasterCurrency | null {
  return currencies.find((currency) => matchesCurrency(currency, input)) ?? null;
}

export function isKnownCurrencyCode(currencies: readonly MasterCurrency[], code: string | null | undefined): boolean {
  if (!code) return false;
  const needle = normalizeLookupKey(code);
  return currencies.some((currency) => normalizeLookupKey(currency.code) === needle);
}

/**
 * Rounds a monetary amount to a currency's actual minor-unit precision
 * (e.g. 2 decimal places for USD, 0 for JPY/KRW/VND) rather than assuming
 * every currency has 2 decimal places, which would silently corrupt
 * zero-decimal currency amounts (Y1234.5 is not a representable JPY
 * amount). Naive scale-then-Math.round (`Math.round(amount * scale) /
 * scale`) is a known trap: 1.005 is stored as the double closest to it,
 * 1.00499999999999989..., so `1.005 * 100` evaluates to 100.49999999999999
 * and rounds down to 1.00, not the intended 1.01. This instead
 * concatenates the decimal-shift into the *string* fed to Number() (the
 * standard "exponential notation" rounding trick), which reparses the
 * shifted decimal from scratch instead of compounding an existing
 * arithmetic error -- verified against a case matrix in
 * currencyMaster.test.ts, including negative halves, where JS's own
 * Math.round rounds toward +Infinity (round(-1.5) === -1) rather than the
 * "half away from zero" convention used here.
 *
 * Three edge cases guarded explicitly (found and fixed during LV4-05-01
 * review, all covered in currencyMaster.test.ts): a negative amount that
 * rounds to zero magnitude (e.g. -0.001 at 2 decimals) would otherwise
 * return -0, which fails strict/SameValue equality against 0 and can
 * surprise downstream sign checks or display as "-$0.00"; a non-finite
 * input (NaN/Infinity) would otherwise silently propagate as NaN; and an
 * amount whose *scaled* magnitude (abs * 10 ** minorUnit, not the raw
 * input alone -- an input just under 1e21 can still overflow once
 * shifted) reaches >= 1e21 or the raw input is < 1e-6 flips JS's default
 * number-to-string conversion into exponential notation (e.g.
 * `String(1e21) === "1e+21"`), which would corrupt the string
 * concatenation above into something like "1e+21e2" that Number() cannot
 * parse -- rather than silently returning NaN there, this throws so a
 * caller with an out-of-range amount (e.g. raw hyperinflation-currency
 * data) fails loudly instead of propagating NaN through downstream math.
 */
export function roundToCurrencyPrecision(amount: number, currency: Pick<MasterCurrency, "minorUnit">): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`roundToCurrencyPrecision: amount must be finite, got ${amount}`);
  }
  if (amount === 0) return 0;
  const abs = Math.abs(amount);
  // The guard checks abs *scaled by minorUnit*, not the raw input -- an
  // input just under 1e21 still overflows once shifted by a positive
  // minorUnit (e.g. 9.9999e20 at minorUnit 2 scales to ~1e23, which is
  // itself printed in exponential notation and corrupts the reassembly
  // string below), which a magnitude-only-on-the-input check would miss.
  const scale = 10 ** currency.minorUnit;
  if (abs < 1e-6 || abs * scale >= 1e21) {
    throw new RangeError(`roundToCurrencyPrecision: amount ${amount} at minorUnit ${currency.minorUnit} is outside the supported range`);
  }
  const sign = amount < 0 ? -1 : 1;
  const result = sign * Number(`${Math.round(Number(`${abs}e${currency.minorUnit}`))}e-${currency.minorUnit}`);
  return result === 0 ? 0 : result;
}
