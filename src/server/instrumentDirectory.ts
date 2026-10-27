/**
 * One P5-facing read model for the existing Finance Directory and autocomplete.
 * Every row is source-attributed and non-canonical until resolved in P5.
 * The source catalog is user-owned; do not persist a second instrument master.
 */
import fs from "node:fs";
import path from "node:path";
import {
  financeDatabaseCatalogPath, financeDatabaseManifestPath, financeDatabaseCatalogStatus,
  financeDatabaseCountryCode, loadFinanceDatabaseRows,
} from "./financeDatabaseCatalog";
import { providerIngestedUniversePath } from "./providerIngestedCatalog";
import { isUsableCatalogIdentityRow } from "@shared/catalogIdentityRows";

export interface DirectoryInstrument {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  assetClass: string;
  region?: string;
  currency?: string;
  mic?: string;
  isin?: string;
  figi?: string;
  industry?: string;
  category?: string;
  family?: string;
  market?: string;
  marketCapTier?: string;
  source: string;
  active: boolean;
  isPrimaryListing?: boolean;
}
export interface DirectoryFilters {
  q?: string;
  exchange?: string;
  sector?: string;
  assetClass?: string;
  region?: string;
  primaryListingOnly?: boolean;
  includeHistorical?: boolean;
  page?: number;
  limit?: number;
}
export interface DirectoryPage {
  items: DirectoryInstrument[];
  total: number;
  page: number;
  totalPages: number;
}
interface DirectorySnapshot {
  items: readonly DirectoryInstrument[];
  sources: Record<string, number>;
  uniqueListingCount: number;
  uniqueSymbolCount: number;
  legacyPath: string;
}
let cachedSnapshot: DirectorySnapshot | null = null;
let previousFingerprint = "";

const ASSET_CLASSES: Record<string, string> = {
  equities: "equity",
  etfs: "etf",
  funds: "fund",
  indices: "index",
  cryptos: "crypto",
  currencies: "currency",
  moneymarkets: "money_market",
};
function value(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function validSymbolAndName(raw: Record<string, unknown>): boolean {
  return isUsableCatalogIdentityRow(raw);
}
function legacyFilePath(): string {
  const ep = process as NodeJS.Process & { resourcesPath?: string };
  const resourcesBase = ep.resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  return resourcesBase
    ? path.resolve(resourcesBase, "server", "data", "tickers.json")
    : path.resolve(process.cwd(), "server", "data", "tickers.json");
}
function stamp(file: string): string {
  try {
    const st = fs.statSync(file);
    return st.size + ":" + st.mtimeMs;
  } catch { return "absent"; }
}
function directoryFingerprint(): string {
  return [legacyFilePath(), stamp(legacyFilePath()), stamp(providerIngestedUniversePath()),
    stamp(financeDatabaseCatalogPath()), stamp(financeDatabaseManifestPath())].join("|");
}
function readJsonArray(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  try {
    const rows: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(rows)) throw new Error("Expected array");
    return rows.filter((r): r is Record<string, unknown> =>
      Boolean(r) && typeof r === "object" && !Array.isArray(r));
  } catch (error) {
    console.error("P5 directory source unreadable:", path.basename(file), error);
    return [];
  }
}

export function collectInstrumentDirectoryRows(
  legacyRows: readonly Record<string, unknown>[],
  providerRows: readonly Record<string, unknown>[],
  financeRows: readonly Record<string, unknown>[],
): DirectorySnapshot {
  const items: DirectoryInstrument[] = [];
  const keys = new Set<string>();
  const sources: Record<string, number> = {};
  const uniqueSymbols = new Set<string>();

  const add = (raw: Record<string, unknown>, preferredSource: string, isFinance = false) => {
    if (!validSymbolAndName(raw)) return;
    const symbol = value(raw.symbol);
    const name = value(raw.name);
    const exchange = value(raw.exchange) || "UNKNOWN";
    const mic = value(raw.mic);
    const currency = value(raw.currency);
    const assetClass = isFinance
      ? ASSET_CLASSES[value(raw.assetClass)] || value(raw.assetClass)
      : preferredSource === "coingecko" || exchange.toUpperCase() === "CRYPTO"
        ? "crypto" : value(raw.assetClass) || "equity";
    const source = isFinance ? "financedatabase" : preferredSource;
    // Asset, listing venue and quote currency are part of identity. Never
    // drop a distinct venue because its bare ticker equals another security.
    const key = [assetClass.toUpperCase(), symbol.toUpperCase(),
      (mic || exchange).toUpperCase(), currency.toUpperCase()].join("|");
    if (keys.has(key)) return;
    keys.add(key);
    uniqueSymbols.add(symbol.toUpperCase());
    sources[source] = (sources[source] || 0) + 1;
    const active = raw.active !== false && value(raw.delisted).toLowerCase() !== "true";
    const isoRegion = isFinance ? financeDatabaseCountryCode(value(raw.countryName) || value(raw.countryCode)) : null;
    items.push({
      symbol, name, exchange, sector: value(raw.sector),
      assetClass, source, active,
      ...(mic ? { mic } : {}),
      ...(currency ? { currency } : {}),
      ...(value(raw.region) || isoRegion || value(raw.countryCode)
        ? { region: value(raw.region) || isoRegion || value(raw.countryCode) }
        : {}),
      ...(value(raw.isin) ? { isin: value(raw.isin) } : {}),
      ...(value(raw.figi) ? { figi: value(raw.figi) } : {}),
      ...(value(raw.industry) ? { industry: value(raw.industry) } : {}),
      ...(value(raw.category) ? { category: value(raw.category) } : {}),
      ...(value(raw.family) ? { family: value(raw.family) } : {}),
      ...(value(raw.market) ? { market: value(raw.market) } : {}),
      ...(value(raw.marketCapTier) ? { marketCapTier: value(raw.marketCapTier) } : {}),
      ...(typeof raw.isPrimaryListing === "boolean" ? { isPrimaryListing: raw.isPrimaryListing } : {}),
    });
  };
  // Priority: richer user-imported source, then legacy, then provider-ingested.
  // Provenance remains per-row; no source gains canonical identity here.
  for (const row of financeRows) add(row, "financedatabase", true);
  for (const row of legacyRows) add(row, "legacy67k");
  for (const row of providerRows) {
    const provider = value(row.provider) || "provider_ingested";
    add({
      ...row,
      exchange: value(row.exchange) || "UNKNOWN",
      name: value(row.name) || value(row.symbol),
      assetClass: provider === "coingecko" ? "crypto" : "equity",
    }, provider);
  }
  return { items, sources, uniqueListingCount: items.length,
    uniqueSymbolCount: uniqueSymbols.size, legacyPath: "" };
}

export function getInstrumentDirectorySnapshot(): DirectorySnapshot {
  const fingerprint = directoryFingerprint();
  if (cachedSnapshot && fingerprint === previousFingerprint) return cachedSnapshot;
  const legacy = legacyFilePath();
  // The FinanceDatabase row cache is already shared by common P5 search.
  cachedSnapshot = collectInstrumentDirectoryRows(
    readJsonArray(legacy), readJsonArray(providerIngestedUniversePath()),
    loadFinanceDatabaseRows() as unknown as readonly Record<string, unknown>[],
  );
  cachedSnapshot.legacyPath = legacy;
  previousFingerprint = fingerprint;
  return cachedSnapshot;
}
export function resetInstrumentDirectoryCache(): void {
  cachedSnapshot = null;
  previousFingerprint = "";
}

export function queryInstrumentDirectory(
  rows: readonly DirectoryInstrument[],
  opts: DirectoryFilters,
): DirectoryPage {
  const exchange = value(opts.exchange).toUpperCase();
  const q = value(opts.q).toLowerCase();
  const sector = value(opts.sector).toLowerCase();
  const assetClass = value(opts.assetClass).toLowerCase();
  const region = value(opts.region).toUpperCase();
  const page = Number.isSafeInteger(opts.page) ? Math.max(1, opts.page!) : 1;
  const limit = Number.isSafeInteger(opts.limit) ? Math.min(100, Math.max(1, opts.limit!)) : 20;
  const items: DirectoryInstrument[] = [];
  let total = 0;
  const start = (page - 1) * limit;
  for (const row of rows) {
    if (!opts.includeHistorical && !row.active) continue;
    if (exchange && exchange !== "ALL" && (exchange === "US"
      ? !["NASDAQ", "NYSE", "NMS", "NYQ", "NGM", "NCM", "ASE"].includes(row.exchange.toUpperCase())
      : row.exchange.toUpperCase() !== exchange)) continue;
    if (sector && sector !== "all" && row.sector.toLowerCase() !== sector) continue;
    if (assetClass && assetClass !== "all" && row.assetClass.toLowerCase() !== assetClass) continue;
    if (region && region !== "ALL" && (row.region || "").toUpperCase() !== region) continue;
    if (opts.primaryListingOnly && row.isPrimaryListing === false) continue;
    if (q && !row.symbol.toLowerCase().includes(q) && !row.name.toLowerCase().includes(q) &&
        !row.sector.toLowerCase().includes(q) &&
        !(row.industry || "").toLowerCase().includes(q) &&
        !(row.category || "").toLowerCase().includes(q) &&
        !(row.family || "").toLowerCase().includes(q)) continue;
    if (total >= start && items.length < limit) items.push(row);
    total++;
  }
  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

/** Constant-size output and bounded allocations even for "FUND" on 300k rows. */
export function searchInstrumentDirectory(
  rows: readonly DirectoryInstrument[], query: string, limit = 15,
): DirectoryInstrument[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact: DirectoryInstrument[] = [], prefix: DirectoryInstrument[] = [],
    category: DirectoryInstrument[] = [], names: DirectoryInstrument[] = [];
  for (const row of rows) {
    if (!row.active) continue;
    const symbol = row.symbol.toLowerCase();
    const target = symbol === q ? exact
      : symbol.startsWith(q) ? prefix
      : row.assetClass.toLowerCase() === q ? category
      : (row.name.toLowerCase().includes(q) || row.sector.toLowerCase().includes(q) ||
         (row.industry || "").toLowerCase().includes(q) ||
         (row.category || "").toLowerCase().includes(q)) ? names : null;
    if (target && target.length < limit) target.push(row);
  }
  return [...exact, ...prefix, ...category, ...names].slice(0, limit);
}
export function instrumentDirectoryRegions(rows: readonly DirectoryInstrument[]): string[] {
  return [...new Set(rows.filter(row => row.active).map(row => row.region).filter((v): v is string => !!v))].sort();
}
/** Live directory facets are based on imported truth, not prefilled options. */
export function instrumentDirectoryFacets(rows: readonly DirectoryInstrument[]) {
  const assetClass = new Map<string, number>();
  const exchange = new Map<string, number>();
  const sector = new Map<string, number>();
  const region = new Map<string, number>();
  const currency = new Map<string, number>();
  let active = 0, historical = 0;
  const increment = (map: Map<string, number>, key: string | undefined) => {
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const row of rows) {
    if (!row.active) { historical++; continue; }
    active++;
    increment(assetClass, row.assetClass);
    increment(exchange, row.exchange);
    increment(sector, row.sector);
    increment(region, row.region);
    increment(currency, row.currency);
  }
  const entries = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }));
  return {
    total: rows.length, active, historical,
    assetClasses: entries(assetClass),
    exchanges: entries(exchange),
    sectors: entries(sector),
    regions: entries(region),
    currencies: entries(currency),
    referenceOnly: true,
  };
}

export function instrumentDirectoryStatus() {
  const snapshot = getInstrumentDirectorySnapshot();
  return {
    referenceOnly: true,
    uniqueListingCount: snapshot.uniqueListingCount,
    uniqueSymbolCount: snapshot.uniqueSymbolCount,
    sources: snapshot.sources,
    financeDatabase: financeDatabaseCatalogStatus(),
    priceCoverage: "independently_reported_by_provider_status",
  };
}
