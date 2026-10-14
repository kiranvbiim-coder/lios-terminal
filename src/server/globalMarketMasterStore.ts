import { countries, exchanges } from "@shared/schema";
import {
  findCountry,
  findExchange,
  resolveMarketMetadata,
  type MarketMetadataResolution,
} from "@shared/globalMarketMaster";
import { getDb } from "./db";

let cachedCountries: (typeof countries.$inferSelect)[] | null = null;
let cachedExchanges: (typeof exchanges.$inferSelect)[] | null = null;

/**
 * Countries and exchanges are reference data that changes by data-only
 * migration (new INSERT), not at request time, so a process-lifetime cache
 * avoids a round trip on every listing/resolution lookup. Tests that mutate
 * these tables directly should call resetGlobalMarketMasterCache().
 */
async function loadCountries() {
  if (!cachedCountries) cachedCountries = await getDb().select().from(countries);
  return cachedCountries;
}

async function loadExchanges() {
  if (!cachedExchanges) cachedExchanges = await getDb().select().from(exchanges);
  return cachedExchanges;
}

export function resetGlobalMarketMasterCache(): void {
  cachedCountries = null;
  cachedExchanges = null;
}

export async function resolvePersistedCountry(input: string) {
  return findCountry(await loadCountries(), input);
}

export async function resolvePersistedExchange(input: string) {
  return findExchange(await loadExchanges(), input);
}

/**
 * The bridge from an existing companyListings-shaped free-text
 * (country, exchange) pair to canonical geography, without requiring the
 * caller to have migrated that row yet -- see globalMarketMaster.ts's
 * resolveMarketMetadata for what "not yet resolved" means and why it is
 * never conflated with "instrument does not exist".
 */
export async function resolvePersistedMarketMetadata(
  input: { country?: string | null; exchange?: string | null },
): Promise<MarketMetadataResolution> {
  const [countryRows, exchangeRows] = await Promise.all([loadCountries(), loadExchanges()]);
  return resolveMarketMetadata(countryRows, exchangeRows, input);
}

export async function listMarketCountries() {
  return loadCountries();
}

export async function listMarketExchanges(countryCode?: string) {
  const rows = await loadExchanges();
  if (!countryCode) return rows;
  const needle = countryCode.trim().toUpperCase();
  return rows.filter((exchange) => exchange.countryCode.toUpperCase() === needle);
}
