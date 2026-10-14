/**
 * Server-side glue that builds the local common-universe search
 * index (shared/instrumentSearchIndex.ts) from the real sources LiOS has --
 * the persisted canonical Global Instrument Master rows
 * (globalInstrumentMasterStore.ts), the bundled ~67k-ticker legacy
 * compatibility catalog (legacyTickerCatalog.ts), and the provider-ingested
 * universe (providerIngestedCatalog.ts) -- so one search
 * reaches all of them without the caller needing to know which source a
 * given instrument currently lives in.
 *
 * The federated fallback uses the existing searchInstruments() contract.
 * On a local miss, SEC EDGAR's ticker map is used rather than a keyed
 * commercial provider: it is free, requires no credential, and is the
 * authoritative source instrumentUniverseIngestion.ts promotes into
 * canonical identity. This is consistent whether a symbol was found via
 * the bundled snapshot or a fresh live SEC lookup. A keyed provider's symbol
 * search (Finnhub/FMP/...) can be layered in the same way once a
 * credential is configured; this fallback runs unconditionally since SEC
 * needs none.
 */
import {
  buildInstrumentSearchIndex,
  searchInstruments,
  type InstrumentSearchIndex,
  type InstrumentSearchOptions,
  type InstrumentSearchResult,
  type InstrumentSearchFederatedFallback,
} from "@shared/instrumentSearchIndex";
import type { InstrumentMasterCandidate } from "@shared/globalInstrumentMaster";
import { loadAllPersistedInstrumentCandidates } from "./globalInstrumentMasterStore";
import { loadLegacyTickerCatalog } from "./legacyTickerCatalog";
import { loadProviderIngestedCatalog } from "./providerIngestedCatalog";
import { fetchSecTickerUniverse } from "./instrumentUniverseIngestion";
import { openFigiCredential, searchOpenFigi } from "./openFigiConnector";
import { lseFederatedInstrumentFallback } from "./lseDataProvider";

let cachedIndex: InstrumentSearchIndex | null = null;

/**
 * Built once per process and cached, same rationale as
 * globalMarketMasterStore.ts's reference-data cache -- the legacy and
 * provider-ingested catalogs never change at runtime, and persisted
 * identity changes far less often than search reads happen. Call
 * resetCommonInstrumentSearchIndexCache() after a write that changes
 * companies/companyListings/companyIdentifiers and needs to be
 * immediately searchable.
 */
async function loadCommonInstrumentSearchIndex(): Promise<InstrumentSearchIndex> {
  if (cachedIndex) return cachedIndex;

  const [persisted, legacy, providerIngested] = await Promise.all([
    loadAllPersistedInstrumentCandidates(),
    Promise.resolve(loadLegacyTickerCatalog()),
    Promise.resolve(loadProviderIngestedCatalog()),
  ]);

  cachedIndex = buildInstrumentSearchIndex([...persisted, ...legacy, ...providerIngested]);
  return cachedIndex;
}

export function resetCommonInstrumentSearchIndexCache(): void {
  cachedIndex = null;
}

function matchesQuery(haystack: string, queryText: string): boolean {
  return haystack.includes(queryText);
}

/** Pure matching core, separated from the live SEC fetch so it's directly
 * unit-testable without network. Every result is canonical:false and
 * tagged source:"sec_edgar" -- a provisional hit exactly like any other
 * unlinked catalog row, not silently promoted to canonical identity just
 * because it came from a live lookup. */
export function matchSecTickers(
  tickers: ReadonlyArray<{ cik: string; ticker: string; name: string }>,
  queryText: string,
  options: InstrumentSearchOptions,
): InstrumentMasterCandidate[] {
  const normalizedQuery = queryText.trim().toUpperCase();
  if (!normalizedQuery) return [];
  const limit = options.limit ?? 20;
  const matches: InstrumentMasterCandidate[] = [];
  for (const row of tickers) {
    if (matches.length >= limit) break;
    if (!matchesQuery(row.ticker.toUpperCase(), normalizedQuery) && !matchesQuery(row.name.toUpperCase(), normalizedQuery)) continue;
    matches.push({
      entityId: null,
      listingId: null,
      name: row.name,
      symbol: row.ticker,
      exchange: "US",
      isPrimaryListing: false,
      lifecycleStatus: "active",
      identifiers: [
        { type: "ticker", value: row.ticker, provider: "sec_edgar" },
        { type: "provider_id", value: row.cik, provider: "sec_edgar" },
      ],
      aliases: [],
      source: "sec_edgar",
      canonical: false,
    });
  }
  return matches;
}

/** A real (not fabricated) federated fallback: SEC EDGAR's ticker map is
 * fetched live (through secEdgarData.ts's own cache, so a burst of misses
 * doesn't re-hit SEC per request), then matched via matchSecTickers. */
export const secEdgarFederatedFallback: InstrumentSearchFederatedFallback = {
  async search(queryText: string, options: InstrumentSearchOptions): Promise<InstrumentMasterCandidate[]> {
    const tickers = await fetchSecTickerUniverse();
    return matchSecTickers(tickers, queryText, options);
  },
};

function federatedCandidateKey(candidate: InstrumentMasterCandidate): string {
  const figi = candidate.identifiers.find((item) => item.type === "figi")?.value;
  return figi ? `figi:${figi}` : `${candidate.source ?? "unknown"}:${candidate.symbol ?? ""}:${candidate.exchange ?? ""}:${candidate.name}`;
}

export function mergeFederatedInstrumentCandidates(
  groups: InstrumentMasterCandidate[][],
  limit = 20,
): InstrumentMasterCandidate[] {
  const deduped = new Map<string, InstrumentMasterCandidate>();
  for (const group of groups) {
    for (const candidate of group) {
      const key = federatedCandidateKey(candidate);
      if (!deduped.has(key)) deduped.set(key, candidate);
      if (deduped.size >= limit) return [...deduped.values()];
    }
  }
  return [...deduped.values()].slice(0, limit);
}

export const p5FederatedInstrumentFallback: InstrumentSearchFederatedFallback = {
  async search(queryText, options) {
    const tasks: Array<Promise<InstrumentMasterCandidate[]>> = [];
    if (openFigiCredential()) {
      tasks.push(searchOpenFigi(queryText, options).then((result) => result.candidates).catch(() => []));
    }
    tasks.push(lseFederatedInstrumentFallback.search(queryText, options).catch(() => []));
    tasks.push(secEdgarFederatedFallback.search(queryText, options).catch(() => []));
    const groups = await Promise.all(tasks);
    return mergeFederatedInstrumentCandidates(groups, options.limit ?? 20);
  },
};

export async function searchCommonInstrumentUniverse(
  queryText: string,
  options: InstrumentSearchOptions = {},
): Promise<InstrumentSearchResult> {
  const index = await loadCommonInstrumentSearchIndex();
  return searchInstruments(index, queryText, options, p5FederatedInstrumentFallback);
}
