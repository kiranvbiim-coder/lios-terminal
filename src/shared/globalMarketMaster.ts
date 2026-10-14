/**
 * LiOS V4 Global Market Master contracts (LV4-04-03/04).
 *
 * Canonical country and exchange/MIC reference. Existing free-text
 * "country"/"exchange"/"mic" columns on companies/companyListings are not
 * migrated by this module -- server/globalMarketMasterStore.ts resolves
 * between the two, so a listing's free-text exchange name ("NSE", "BSE")
 * can be looked up against the canonical MIC-keyed master without a data
 * migration. New code should resolve through here rather than comparing
 * raw exchange/country strings directly.
 */
import type { Country, Exchange } from "./schema";

export type MarketGeography = Pick<Country, "code" | "name" | "region" | "currencyCode" | "aliases">;
export type MarketVenue = Pick<Exchange, "mic" | "operatingMic" | "name" | "countryCode" | "currencyCode" | "timezone" | "aliases" | "active">;

/** Shared by shared/currencyMaster.ts so both master-data resolvers use the
 * same case/whitespace-insensitive matching rule. */
export function normalizeLookupKey(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Matches an input string against a country's code, canonical name, or
 * aliases. Case/whitespace-insensitive; exact match only (no fuzzy/prefix
 * matching -- geography lookups should not silently guess).
 */
export function matchesCountry(country: MarketGeography, input: string): boolean {
  const needle = normalizeLookupKey(input);
  if (normalizeLookupKey(country.code) === needle) return true;
  if (normalizeLookupKey(country.name) === needle) return true;
  return country.aliases.some((alias) => normalizeLookupKey(alias) === needle);
}

export function findCountry(countries: readonly MarketGeography[], input: string): MarketGeography | null {
  return countries.find((country) => matchesCountry(country, input)) ?? null;
}

/**
 * Matches an input string against an exchange's MIC, operating MIC, name,
 * or aliases -- so both a segment MIC lookup ("XNGS") and a common name
 * lookup ("NASDAQ") resolve to the same venue identity where the caller
 * only has the operating MIC row (segment MICs are not separately seeded
 * yet; matching against operatingMic keeps the door open when they are).
 */
export function matchesExchange(exchange: MarketVenue, input: string): boolean {
  const needle = normalizeLookupKey(input);
  if (normalizeLookupKey(exchange.mic) === needle) return true;
  if (exchange.operatingMic && normalizeLookupKey(exchange.operatingMic) === needle) return true;
  if (normalizeLookupKey(exchange.name) === needle) return true;
  return exchange.aliases.some((alias) => normalizeLookupKey(alias) === needle);
}

export function findExchange(exchanges: readonly MarketVenue[], input: string): MarketVenue | null {
  return exchanges.find((exchange) => matchesExchange(exchange, input)) ?? null;
}

export interface MarketMetadataResolution {
  /** True only when every supplied input resolved to a known master row. */
  fullyResolved: boolean;
  country: MarketGeography | null;
  exchange: MarketVenue | null;
  /** Populated when the exchange resolved but is not seeded as belonging to the given country. */
  countryExchangeMismatch: boolean;
}

/**
 * Resolves a free-text (country, exchange) pair from an existing
 * companyListings-shaped row against the canonical masters. Never throws on
 * an unknown venue/country -- existing data with a market LiOS has not yet
 * seeded must keep working; this only tells the caller what is and isn't
 * yet canonical, which is the LV4-04-08 legacy-compatibility contract:
 * "instrument exists" and "instrument has canonical geography" are separate
 * facts, and the absence of the second must never be presented as the
 * absence of the first.
 */
export function resolveMarketMetadata(
  countries: readonly MarketGeography[],
  exchanges: readonly MarketVenue[],
  input: { country?: string | null; exchange?: string | null },
): MarketMetadataResolution {
  const country = input.country ? findCountry(countries, input.country) : null;
  const exchange = input.exchange ? findExchange(exchanges, input.exchange) : null;

  const countryExchangeMismatch = Boolean(
    country && exchange && normalizeLookupKey(exchange.countryCode) !== normalizeLookupKey(country.code),
  );

  const fullyResolved = Boolean(
    (!input.country || country) && (!input.exchange || exchange) && !countryExchangeMismatch,
  );

  return { fullyResolved, country, exchange, countryExchangeMismatch };
}
