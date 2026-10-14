/**
 * Idempotent, connector-driven listing ingestion into the canonical/searchable
 * instrument universe.
 *
 * Every source here is a real, free, no-authentication public endpoint --
 * no synthetic/generated rows, matching the same "no fabricated data" rule
 * P0.1 enforced for market/macro observations. Three sources, in order of
 * identity strength:
 *
 *   1. SEC EDGAR company_tickers.json -- reuses secEdgarData.ts's existing
 *      cached fetch. Carries a real CIK, which is genuine, durable legal
 *      identity (not just a symbol string) -- strong enough on its own to
 *      promote directly into the canonical companies/companyListings
 *      tables via companyStore.ts's upsertCompany, no cross-validation
 *      needed.
 *   2. NASDAQ Trader's nasdaqlisted.txt/otherlisted.txt symbol
 *      directories -- the official, free, no-key exchange-published
 *      listing files (the same public source most free stock-screener
 *      tools use for US listings). Real exchange-assigned symbols, but no
 *      CIK/legal-entity identity in this file alone -- ingested as
 *      provisional (canonical:false) rows, same posture
 *      legacyTickerCatalog.ts already gives the bundled ~67k catalog.
 *   3. CoinGecko's /coins/list -- free, no-key, returns every coin
 *      CoinGecko tracks (~20k+, far broader than the top-market-cap subset
 *      server/data/crypto_coingecko_ids.json already bundles for live
 *      quote routing). Also provisional: CoinGecko's own coin ids are
 *      real, but crypto assets have no equivalent of a CIK to promote
 *      against.
 *
 * "Idempotent": every function here is pure fetch-and-adapt with no
 * server-side mutation of its own; re-running against the same upstream
 * data always produces the same candidate set. The one place this reaches
 * the database is promoteSecTickersToCanonical, which goes through
 * upsertCompany's existing onConflictDoUpdate -- running it twice with the
 * same input updates the same rows rather than duplicating them.
 */
import { getAllSecCompanyTickers } from "./secEdgarData";
import { fetchWithRetry } from "./providerUtils";
import { upsertCompany } from "./companyStore";
import { adaptLegacySymbolCatalog, type LegacySymbolCatalogRow, type InstrumentMasterCandidate } from "@shared/globalInstrumentMaster";

export const INGESTION_PROVIDERS = {
  secEdgar: "sec_edgar",
  nasdaqTrader: "nasdaq_trader",
  coinGecko: "coingecko",
} as const;

// ── SEC EDGAR (canonical-eligible) ──────────────────────────────────────

export interface SecTickerRow {
  cik: string;
  ticker: string;
  name: string;
}

export async function fetchSecTickerUniverse(): Promise<SecTickerRow[]> {
  return getAllSecCompanyTickers();
}

/** SEC's own ticker isn't a full identity record -- symbol + legal name +
 * CIK is everything the free bulk file carries, so exchange/MIC/currency
 * are intentionally left for a listing-level source (NASDAQ/otherlisted,
 * or a live keyed provider once configured) to fill in later; a symbol
 * present in both this and the NASDAQ/otherlisted ingestion below is the
 * same security, promoted once and enriched, not two separate rows. */
export async function promoteSecTickersToCanonical(
  rows: readonly SecTickerRow[],
  source = INGESTION_PROVIDERS.secEdgar,
): Promise<{ attempted: number; promoted: number; failures: Array<{ ticker: string; message: string }> }> {
  let promoted = 0;
  const failures: Array<{ ticker: string; message: string }> = [];
  for (const row of rows) {
    if (!row.ticker.trim()) continue;
    try {
      await upsertCompany({
        symbol: row.ticker,
        name: row.name,
        cik: row.cik,
        exchange: "US",
        assetClass: "equity",
        source,
      });
      promoted += 1;
    } catch (error) {
      failures.push({ ticker: row.ticker, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { attempted: rows.length, promoted, failures };
}

// ── NASDAQ Trader symbol directories (provisional) ──────────────────────
// https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs -- official,
// free, no-key pipe-delimited directories NASDAQ publishes for exactly
// this purpose (every downstream free market-data tool bootstraps its US
// symbol list from these same two files).

const NASDAQ_EXCHANGE_LABELS: Record<string, string> = {
  N: "NYSE",
  A: "NYSE American",
  P: "NYSE Arca",
  Z: "Cboe BZX",
  V: "IEX",
};

function parsePipeDelimited(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("File Creation Time"))
    .map((line) => line.split("|"));
}

export async function fetchNasdaqListedRows(): Promise<LegacySymbolCatalogRow[]> {
  const text = await fetchWithRetry("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", {
    "User-Agent": "Limuria Terminal (internal research tool) contact@limuria-terminal.local",
  }).then((response) => response.text());
  const rows = parsePipeDelimited(text).slice(1); // header row
  const out: LegacySymbolCatalogRow[] = [];
  for (const parts of rows) {
    const [symbol, name, , testIssue, , , etf] = parts;
    if (!symbol?.trim() || testIssue === "Y") continue;
    out.push({ symbol, name, exchange: "NASDAQ", provider: INGESTION_PROVIDERS.nasdaqTrader });
    void etf; // asset-class distinction (equity vs ETF) not yet modeled on LegacySymbolCatalogRow; symbol-level dedup is what matters here.
  }
  return out;
}

export async function fetchOtherListedRows(): Promise<LegacySymbolCatalogRow[]> {
  const text = await fetchWithRetry("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", {
    "User-Agent": "Limuria Terminal (internal research tool) contact@limuria-terminal.local",
  }).then((response) => response.text());
  const rows = parsePipeDelimited(text).slice(1);
  const out: LegacySymbolCatalogRow[] = [];
  for (const parts of rows) {
    const [symbol, name, exchangeCode, , , , testIssue] = parts;
    if (!symbol?.trim() || testIssue === "Y") continue;
    out.push({ symbol, name, exchange: NASDAQ_EXCHANGE_LABELS[exchangeCode] ?? exchangeCode ?? "US", provider: INGESTION_PROVIDERS.nasdaqTrader });
  }
  return out;
}

// ── CoinGecko coin list (provisional) ───────────────────────────────────

interface CoinGeckoCoin {
  id: string;
  symbol: string;
  name: string;
}

export async function fetchCoinGeckoCoinList(): Promise<LegacySymbolCatalogRow[]> {
  const text = await fetchWithRetry("https://api.coingecko.com/api/v3/coins/list", {
    "User-Agent": "Limuria Terminal (internal research tool) contact@limuria-terminal.local",
    "Accept": "application/json",
  }).then((response) => response.text());
  const coins = JSON.parse(text) as CoinGeckoCoin[];
  const seenSymbols = new Set<string>();
  const out: LegacySymbolCatalogRow[] = [];
  for (const coin of coins) {
    const symbol = coin.symbol?.trim().toUpperCase();
    if (!symbol || seenSymbols.has(symbol)) continue; // CoinGecko lists many tokens sharing a ticker across chains; first (their own listing order) wins, same "one row per symbol" contract the rest of this pipeline keeps.
    seenSymbols.add(symbol);
    out.push({
      symbol,
      name: coin.name || symbol,
      exchange: "CRYPTO",
      countryCode: null,
      provider: INGESTION_PROVIDERS.coinGecko,
      providerId: coin.id,
    });
  }
  return out;
}

// ── Orchestration ────────────────────────────────────────────────────────

export interface UniverseIngestionSummary {
  provider: string;
  fetched: number;
  netNew: number;
}

/**
 * Pure dedup/merge core, deliberately separated from the network fetches
 * above so it's directly unit-testable without hitting SEC/NASDAQ/
 * CoinGecko live. Priority order matches identity strength: a symbol
 * present in more than one source keeps only the first (highest-priority)
 * source's row, dropping the rest rather than creating duplicate entries
 * for the same symbol.
 */
export function mergeProviderRows(
  existingSymbols: ReadonlySet<string>,
  sources: ReadonlyArray<{ provider: string; rows: LegacySymbolCatalogRow[] }>,
): { rows: LegacySymbolCatalogRow[]; summary: UniverseIngestionSummary[] } {
  const summary: UniverseIngestionSummary[] = [];
  const seen = new Set<string>();
  const rows: LegacySymbolCatalogRow[] = [];

  for (const { provider, rows: providerRows } of sources) {
    let netNew = 0;
    for (const row of providerRows) {
      const key = row.symbol.trim().toUpperCase();
      if (!key || existingSymbols.has(key) || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      netNew += 1;
    }
    summary.push({ provider, fetched: providerRows.length, netNew });
  }

  return { rows, summary };
}

/**
 * Fetches every free-source row above and returns only what isn't already
 * covered by `existingSymbols` (case-insensitive, symbol-only -- matching
 * how legacyTickerCatalog.ts's compatibility rows are keyed). Idempotent:
 * pass the same existingSymbols set (built from the currently bundled
 * catalog) and re-running produces the same net-new candidates, never
 * growing without bound on repeat runs once a symbol has been ingested
 * once and folded back into `existingSymbols` for the next run.
 */
export async function buildProviderIngestedUniverse(
  existingSymbols: ReadonlySet<string>,
): Promise<{ candidates: InstrumentMasterCandidate[]; summary: UniverseIngestionSummary[] }> {
  const [secRows, nasdaqRows, otherRows, coinGeckoRows] = await Promise.all([
    fetchSecTickerUniverse().then((rows) => rows.map((r): LegacySymbolCatalogRow => ({
      symbol: r.ticker, name: r.name, exchange: "US", provider: INGESTION_PROVIDERS.secEdgar, providerId: r.cik,
    }))),
    fetchNasdaqListedRows(),
    fetchOtherListedRows(),
    fetchCoinGeckoCoinList(),
  ]);

  // SEC first: it carries CIK identity, so when a symbol appears in both
  // SEC and NASDAQ/otherlisted the more-identified SEC row wins the single
  // slot this symbol gets in the provisional catalog.
  const { rows, summary } = mergeProviderRows(existingSymbols, [
    { provider: INGESTION_PROVIDERS.secEdgar, rows: secRows },
    { provider: INGESTION_PROVIDERS.nasdaqTrader, rows: [...nasdaqRows, ...otherRows] },
    { provider: INGESTION_PROVIDERS.coinGecko, rows: coinGeckoRows },
  ]);

  return { candidates: adaptLegacySymbolCatalog(rows), summary };
}
