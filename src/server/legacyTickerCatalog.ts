/**
 * LV4-04-08: wires the real bundled ~67k-ticker legacy directory
 * (server/data/tickers.json, already used by /api/finance/directory and
 * screenerIndia.ts's .BO name resolution) through the Global Instrument
 * Master's compatibility adapter (adaptLegacySymbolCatalog), so the same
 * 67k+ universe becomes part of the common searchable instrument universe
 * (instrumentSearchIndexStore.ts) rather than remaining reachable only
 * through the separate, older directory endpoint.
 *
 * Every row this file produces stays canonical:false -- adaptLegacySymbolCatalog
 * deliberately leaves entityId/listingId null. A row only becomes canonical
 * once it is linked into companies/companyListings
 * (globalInstrumentMasterStore.ts) through the existing onboarding/import
 * paths; this file performs no such linking.
 */
import fs from "node:fs";
import path from "node:path";
import {
  adaptLegacySymbolCatalog,
  type InstrumentMasterCandidate,
  type LegacySymbolCatalogRow,
} from "@shared/globalInstrumentMaster";

interface LegacyTickerRow {
  symbol: string;
  name: string;
  exchange: string;
  sector?: string;
  assetClass?: string;
  region?: string;
}

export const LEGACY_CATALOG_PROVIDER = "legacy67k";

function toLegacyCatalogRow(row: LegacyTickerRow): LegacySymbolCatalogRow {
  return {
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    countryCode: row.region ?? null,
    provider: LEGACY_CATALOG_PROVIDER,
  };
}

let cachedCandidates: InstrumentMasterCandidate[] | null = null;

/**
 * Loaded and adapted once per process lifetime -- the bundled directory file
 * never changes at runtime, same rationale as globalMarketMasterStore.ts's
 * reference-data cache. Call resetLegacyTickerCatalogCache() in tests that
 * need a fresh read.
 */
export function loadLegacyTickerCatalog(): InstrumentMasterCandidate[] {
  if (cachedCandidates) return cachedCandidates;

  // Same resourcesPath resolution already used for this exact file by
  // routes.ts's /api/finance/directory and screenerIndia.ts's
  // loadTickerNames(), so a packaged Electron build resolves it
  // identically. Electron augments `process` with `resourcesPath` when
  // packaged; the base Node types don't express this, so a named cast
  // (not an inline member access) reads it safely.
  const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
  const resourcesBase = electronProcess.resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  const tickersPath = resourcesBase
    ? path.resolve(resourcesBase, "server", "data", "tickers.json")
    : path.resolve(process.cwd(), "server", "data", "tickers.json");

  if (!fs.existsSync(tickersPath)) {
    cachedCandidates = [];
    return cachedCandidates;
  }

  try {
    const rows = JSON.parse(fs.readFileSync(tickersPath, "utf8")) as LegacyTickerRow[];
    cachedCandidates = adaptLegacySymbolCatalog(rows.map(toLegacyCatalogRow));
  } catch (error) {
    console.error(
      "legacyTickerCatalog: failed to load server/data/tickers.json:",
      error instanceof Error ? error.message : error,
    );
    cachedCandidates = [];
  }

  return cachedCandidates;
}

export function resetLegacyTickerCatalogCache(): void {
  cachedCandidates = null;
}
