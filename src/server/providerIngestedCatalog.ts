/**
 * P0.4: loads the bundled provider-ingested universe file
 * (server/data/provider_ingested_universe.json), produced by
 * script/ingest_instrument_universe.ts from real SEC EDGAR/NASDAQ
 * Trader/CoinGecko data (instrumentUniverseIngestion.ts) and checked into
 * the repo the same way server/data/tickers.json already is.
 *
 * Deliberately a separate bundled file and loader from
 * legacyTickerCatalog.ts's ~67k tickers.json, not merged into it: this
 * file's rows carry their REAL originating provider per row (sec_edgar /
 * nasdaq_trader / coingecko), whereas every tickers.json row is tagged
 * "legacy67k" regardless of its true original source (lost to history).
 * Keeping them separate preserves that real source-provider metadata for
 * P0.4's own requirement ("preserve ... source-provider metadata") instead
 * of collapsing newly-ingested rows into the same opaque legacy label.
 *
 * Same canonical:false posture as legacyTickerCatalog.ts: every row here
 * is a provisional, provider-only identity, searchable immediately but
 * not yet linked to a durable LiOS entity/security/listing id. SEC rows
 * among them ARE additionally promoted into the canonical
 * companies/companyListings tables by the ingestion script (they carry a
 * real CIK) -- that promotion is a separate, additive step; this loader's
 * job is only to make every ingested row searchable, promoted or not.
 */
import fs from "node:fs";
import path from "node:path";
import { adaptLegacySymbolCatalog, type InstrumentMasterCandidate, type LegacySymbolCatalogRow } from "@shared/globalInstrumentMaster";

let cachedCandidates: InstrumentMasterCandidate[] | null = null;

export function providerIngestedUniversePath(): string {
  const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
  const resourcesBase = electronProcess.resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  return resourcesBase
    ? path.resolve(resourcesBase, "server", "data", "provider_ingested_universe.json")
    : path.resolve(process.cwd(), "server", "data", "provider_ingested_universe.json");
}

export function loadProviderIngestedCatalog(): InstrumentMasterCandidate[] {
  if (cachedCandidates) return cachedCandidates;

  const filePath = providerIngestedUniversePath();
  if (!fs.existsSync(filePath)) {
    cachedCandidates = [];
    return cachedCandidates;
  }

  try {
    const rows = JSON.parse(fs.readFileSync(filePath, "utf8")) as LegacySymbolCatalogRow[];
    cachedCandidates = adaptLegacySymbolCatalog(rows);
  } catch (error) {
    console.error("providerIngestedCatalog: failed to load provider_ingested_universe.json:", error instanceof Error ? error.message : error);
    cachedCandidates = [];
  }

  return cachedCandidates;
}

export function resetProviderIngestedCatalogCache(): void {
  cachedCandidates = null;
}
