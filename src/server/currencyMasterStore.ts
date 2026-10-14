import { currencies } from "@shared/schema";
import { findCurrency, isKnownCurrencyCode, type MasterCurrency } from "@shared/currencyMaster";
import { getDb } from "./db";

let cachedCurrencies: (typeof currencies.$inferSelect)[] | null = null;

/**
 * Currencies are reference data that changes by data-only migration (new
 * INSERT), not at request time -- same process-lifetime cache rationale as
 * globalMarketMasterStore.ts's countries/exchanges cache. Tests that mutate
 * this table directly should call resetCurrencyMasterCache().
 */
async function loadCurrencies() {
  if (!cachedCurrencies) cachedCurrencies = await getDb().select().from(currencies);
  return cachedCurrencies;
}

export function resetCurrencyMasterCache(): void {
  cachedCurrencies = null;
}

export async function resolvePersistedCurrency(input: string): Promise<MasterCurrency | null> {
  return findCurrency(await loadCurrencies(), input);
}

export async function isPersistedCurrencyCode(code: string | null | undefined): Promise<boolean> {
  return isKnownCurrencyCode(await loadCurrencies(), code);
}

export async function listCurrencies() {
  return loadCurrencies();
}
