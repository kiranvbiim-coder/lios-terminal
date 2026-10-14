/**
 * LiOS V4 FX normalization contracts (LV4-05-02).
 *
 * Pure conversion logic over a caller-supplied rate lookup, so this module
 * is testable without a database and reusable from any storage layer.
 * server/fxRateStore.ts wires the real lookup against the fx_rates table.
 */
import { roundToCurrencyPrecision, type MasterCurrency } from "./currencyMaster";

export interface ResolvedFxRate {
  rate: number;
  /**
   * The observation's actual effective date, which may be earlier than
   * the requested asOfDate (e.g. a weekend/holiday gap resolves to the
   * nearest prior trading day's rate) -- callers must not assume this
   * equals the date they asked for. Same "don't conflate clocks"
   * discipline as datasetSnapshots' effectiveAt/retrievedAt split.
   */
  rateDate: string;
}

/**
 * One-directional rate lookup: "1 base = ? quote, as of asOfDate". Must
 * return null (never throw, never guess) when no observation exists on or
 * before asOfDate for that exact pair -- convertAmount tries the inverse
 * pair itself, so implementations must not attempt inversion themselves.
 */
export type FxRateLookup = (
  base: string,
  quote: string,
  asOfDate: string,
) => ResolvedFxRate | null | Promise<ResolvedFxRate | null>;

export interface FxConversionRequest {
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  asOfDate: string;
}

export type FxConversionOutcome =
  | { converted: true; convertedAmount: number; rate: number; rateDate: string; direction: "identity" | "direct" | "inverse" }
  | { converted: false; convertedAmount: null; rate: null; rateDate: null; direction: "unavailable" };

/**
 * Converts an amount between two currencies as of a specific date. Never
 * silently returns the unconverted amount when no rate is available --
 * same "never imply a fact that isn't established" discipline as
 * globalMarketMaster's MarketMetadataResolution and dataEntitlementStore's
 * separation of "instrument exists" from "entitlement granted": an
 * unresolved conversion returns an explicit `converted: false`, not a
 * best-effort guess or the raw unconverted amount.
 *
 * Tries the direct pair first, then the inverse pair (computing 1/rate) --
 * so a rate stored in only one direction (e.g. EUR->USD) still answers a
 * request for the other direction (USD->EUR) without requiring both
 * directions to be separately persisted.
 */
export async function convertAmount(
  request: FxConversionRequest,
  lookup: FxRateLookup,
  toCurrency: Pick<MasterCurrency, "minorUnit">,
): Promise<FxConversionOutcome> {
  const { amount, fromCurrency, toCurrency: toCode, asOfDate } = request;

  if (fromCurrency === toCode) {
    return {
      converted: true,
      convertedAmount: roundToCurrencyPrecision(amount, toCurrency),
      rate: 1,
      rateDate: asOfDate,
      direction: "identity",
    };
  }

  const direct = await lookup(fromCurrency, toCode, asOfDate);
  if (direct) {
    return {
      converted: true,
      convertedAmount: roundToCurrencyPrecision(amount * direct.rate, toCurrency),
      rate: direct.rate,
      rateDate: direct.rateDate,
      direction: "direct",
    };
  }

  const inverse = await lookup(toCode, fromCurrency, asOfDate);
  if (inverse) {
    const rate = 1 / inverse.rate;
    return {
      converted: true,
      convertedAmount: roundToCurrencyPrecision(amount * rate, toCurrency),
      rate,
      rateDate: inverse.rateDate,
      direction: "inverse",
    };
  }

  return { converted: false, convertedAmount: null, rate: null, rateDate: null, direction: "unavailable" };
}
