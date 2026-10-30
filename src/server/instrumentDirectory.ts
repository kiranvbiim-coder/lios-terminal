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

// ─── Deterministic relevance ranking ───────────────────────────────────────
// A 300k-listing reference universe repeats the same issuer on dozens of
// venues (Frankfurt, Berlin, OTC, GDRs…). Search must put the security a user
// means first: exact ticker (incl. base ticker before a venue suffix such as
// RELIANCE.NS) > name prefix > home-country primary exchange > market-cap tier
// > equity before fund/index > alphabetical. Order is fully deterministic.

/** Primary exchanges (ISO MIC) by issuer country; earlier tiers rank higher. */
const PRIMARY_MICS_BY_COUNTRY: Record<string, readonly (readonly string[])[]> = {
  US: [["XNAS", "XNYS"], ["XASE", "ARCX", "BATS"]],
  IN: [["XNSE"], ["XBOM"]],
  GB: [["XLON"]], JP: [["XJPX", "XTKS"]], HK: [["XHKG"]], CN: [["XSHG", "XSHE"]],
  DE: [["XETR"], ["XFRA"]], CA: [["XTSE"], ["XTSX", "NEOE", "XCNQ"]], AU: [["XASX"]],
  FR: [["XPAR"]], NL: [["XAMS"]], BE: [["XBRU"]], IT: [["XMIL"]], ES: [["XMAD"]],
  CH: [["XSWX"]], SE: [["XSTO"]], NO: [["XOSL"]], DK: [["XCSE"]], FI: [["XHEL"]],
  IE: [["XDUB"]], PT: [["XLIS"]], AT: [["XWBO"]], GR: [["ASEX"]], PL: [["XWAR"]],
  KR: [["XKRX"], ["XKOS"]], TW: [["XTAI"], ["ROCO"]], SG: [["XSES"]], MY: [["XKLS"]],
  TH: [["XBKK"]], ID: [["XIDX"]], BR: [["BVMF"]], MX: [["XMEX"]], AR: [["XBUE"]],
  CL: [["XSGO"]], ZA: [["XJSE"]], IL: [["XTAE"]], TR: [["XIST"]], SA: [["XSAU"]],
  RU: [["MISX"]], NZ: [["XNZE"]], QA: [["DSMD"]], EG: [["XCAI"]], HU: [["XBUD"]], CZ: [["XPRA"]],
};
const TOP_TIER_MICS = new Set(Object.values(PRIMARY_MICS_BY_COUNTRY).map(tiers => tiers[0]).flat());
const LISTED_MICS = new Set(Object.values(PRIMARY_MICS_BY_COUNTRY).flat(2));
/** Venue-code fallback for rows that carry no MIC (legacy/provider rows). */
const EXCHANGE_CODE_MIC: Record<string, string> = {
  NMS: "XNAS", NGM: "XNAS", NCM: "XNAS", NASDAQ: "XNAS", NYQ: "XNYS", NYSE: "XNYS", NYS: "XNYS",
  ASE: "XASE", AMEX: "XASE", PCX: "ARCX", BTS: "BATS", NSE: "XNSE", NSI: "XNSE", BSE: "XBOM",
  BOM: "XBOM", LSE: "XLON", JPX: "XJPX", TSE: "XJPX", HKG: "XHKG", HKEX: "XHKG", SHH: "XSHG",
  SHZ: "XSHE", GER: "XETR", XETRA: "XETR", TOR: "XTSE", TSX: "XTSE", ASX: "XASX",
};
/** Markets tabs → venue MICs, so a tab works for every catalog's venue codes. */
const EXCHANGE_TAB_MICS: Record<string, readonly string[]> = {
  US: ["XNAS", "XNYS", "XASE", "ARCX", "BATS"], NSE: ["XNSE"], BSE: ["XBOM"], TSE: ["XJPX", "XTKS"],
  HKEX: ["XHKG"], LSE: ["XLON"], XETRA: ["XETR"], TSX: ["XTSE"], ASX: ["XASX"], SGX: ["XSES"],
  EURONEXT: ["XPAR", "XAMS", "XBRU", "XLIS", "XDUB", "XOSL"], TWSE: ["XTAI"], KRX: ["XKRX", "XKOS"],
  SSE: ["XSHG"], SZSE: ["XSHE"], B3: ["BVMF"], BURSA: ["XKLS"],
};
/** Asset-class tabs are classes, not venues: they never constrain exchange. */
const ASSET_CLASS_TABS = new Set(["INDEX", "COMMODITY", "FOREX", "CRYPTO"]);
/** US tab venue codes for MIC-less rows; NAS/NIM are FinanceDatabase US mutual-fund venues. */
const US_VENUE_CODES = new Set(["NASDAQ", "NYSE", "NMS", "NYQ", "NGM", "NCM", "ASE", "NAS", "NIM"]);
const ASSET_CLASS_ALIASES: Record<string, readonly string[]> = {
  forex: ["forex", "currency"],
  mutual_fund: ["mutual_fund", "fund", "money_market"],
};
const CAP_RANK: Record<string, number> = {
  "mega cap": 0, "large cap": 1, "mid cap": 2, "small cap": 3, "micro cap": 4, "nano cap": 5,
};
const ASSET_RANK: Record<string, number> = { equity: 0, etf: 1, fund: 2, mutual_fund: 2, index: 3 };

function listingMic(row: DirectoryInstrument): string {
  return (row.mic || EXCHANGE_CODE_MIC[row.exchange.toUpperCase()] || "").toUpperCase();
}
function issuerCountry(row: DirectoryInstrument): string {
  const region = (row.region || "").toUpperCase();
  if (/^[A-Z]{2}$/.test(region)) return region;
  const isinCountry = (row.isin || "").slice(0, 2).toUpperCase();
  return /^[A-Z]{2}$/.test(isinCountry) && isinCountry !== "XS" && isinCountry !== "EU" ? isinCountry : "";
}
/** 0 = home primary venue … 3 = secondary/OTC/foreign regional venue. */
export function primaryListingRank(row: DirectoryInstrument): number {
  if (row.isPrimaryListing === true) return 0;
  if (row.isPrimaryListing === false) return 3;
  const mic = listingMic(row);
  if (!mic) return 3;
  const tiers = PRIMARY_MICS_BY_COUNTRY[issuerCountry(row)];
  if (tiers) {
    const tier = tiers.findIndex(group => group.includes(mic));
    if (tier >= 0) return Math.min(tier, 1);
    return LISTED_MICS.has(mic) ? 2 : 3; // e.g. an ADR on NYSE for a foreign issuer
  }
  return TOP_TIER_MICS.has(mic) ? 1 : LISTED_MICS.has(mic) ? 2 : 3;
}
function staticRank(row: DirectoryInstrument): number {
  return primaryListingRank(row) * 100 +
    (CAP_RANK[(row.marketCapTier || "").toLowerCase()] ?? 6) * 10 +
    (ASSET_RANK[row.assetClass.toLowerCase()] ?? 4);
}

interface RankedRow {
  row: DirectoryInstrument;
  symbol: string;
  base: string;
  name: string;
  extra: string;
  assetClass: string;
}
/** One sort per snapshot; every query then scans in ranked order in O(n). */
const rankedCache = new WeakMap<readonly DirectoryInstrument[], readonly RankedRow[]>();
function rankedRows(rows: readonly DirectoryInstrument[]): readonly RankedRow[] {
  const cached = rankedCache.get(rows);
  if (cached) return cached;
  const keyed = rows.map(row => {
    const symbol = row.symbol.toLowerCase();
    const dot = symbol.indexOf(".");
    return {
      rank: staticRank(row),
      entry: {
        row, symbol, base: dot > 0 ? symbol.slice(0, dot) : symbol, name: row.name.toLowerCase(),
        extra: [row.sector, row.industry, row.category, row.family].filter(Boolean).join("\u0000").toLowerCase(),
        assetClass: row.assetClass.toLowerCase(),
      } satisfies RankedRow,
    };
  });
  keyed.sort((a, b) => a.rank - b.rank ||
    (a.entry.symbol < b.entry.symbol ? -1 : a.entry.symbol > b.entry.symbol ? 1 : 0) ||
    (a.entry.row.exchange < b.entry.row.exchange ? -1 : a.entry.row.exchange > b.entry.row.exchange ? 1 : 0));
  const ranked = keyed.map(k => k.entry);
  rankedCache.set(rows, ranked);
  return ranked;
}
const MATCH_TIERS = 6;
/** -1 = no match; lower tiers are stronger matches. */
function matchTier(r: RankedRow, q: string): number {
  if (r.symbol === q || r.base === q) return 0;
  if (r.name.startsWith(q)) return 1;
  if (r.symbol.startsWith(q)) return 2;
  if (r.assetClass === q) return 3;
  if (r.name.includes(" " + q)) return 4;
  if (r.symbol.includes(q) || r.name.includes(q) || r.extra.includes(q)) return 5;
  return -1;
}

export function queryInstrumentDirectory(
  rows: readonly DirectoryInstrument[],
  opts: DirectoryFilters,
): DirectoryPage {
  const exchange = value(opts.exchange).toUpperCase();
  const exchangeMics = EXCHANGE_TAB_MICS[exchange];
  const constrainExchange = !!exchange && exchange !== "ALL" && !ASSET_CLASS_TABS.has(exchange);
  const q = value(opts.q).toLowerCase();
  const sector = value(opts.sector).toLowerCase();
  const assetClass = value(opts.assetClass).toLowerCase();
  const assetClasses = ASSET_CLASS_ALIASES[assetClass] ?? [assetClass];
  const region = value(opts.region).toUpperCase();
  const page = Number.isSafeInteger(opts.page) ? Math.max(1, opts.page!) : 1;
  const limit = Number.isSafeInteger(opts.limit) ? Math.min(100, Math.max(1, opts.limit!)) : 20;
  const start = (page - 1) * limit;
  const buckets: DirectoryInstrument[][] = Array.from({ length: q ? MATCH_TIERS : 1 }, () => []);
  for (const ranked of rankedRows(rows)) {
    const row = ranked.row;
    if (!opts.includeHistorical && !row.active) continue;
    if (constrainExchange) {
      const code = row.exchange.toUpperCase();
      const venueMatch = code === exchange ||
        (exchange === "US" && US_VENUE_CODES.has(code)) ||
        (!!exchangeMics && exchangeMics.includes(listingMic(row)));
      if (!venueMatch) continue;
    }
    if (sector && sector !== "all" && row.sector.toLowerCase() !== sector) continue;
    if (assetClass && assetClass !== "all" && !assetClasses.includes(ranked.assetClass)) continue;
    if (region && region !== "ALL" && (row.region || "").toUpperCase() !== region) continue;
    if (opts.primaryListingOnly && row.isPrimaryListing === false) continue;
    const tier = q ? matchTier(ranked, q) : 0;
    if (tier < 0) continue;
    buckets[tier].push(row);
  }
  let total = 0;
  for (const bucket of buckets) total += bucket.length;
  const items: DirectoryInstrument[] = [];
  let offset = 0;
  for (const bucket of buckets) {
    if (items.length >= limit) break;
    const from = Math.max(0, start - offset);
    if (from < bucket.length) items.push(...bucket.slice(from, from + limit - items.length));
    offset += bucket.length;
  }
  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

/** Constant-size output and bounded allocations even for "FUND" on 300k rows. */
export function searchInstrumentDirectory(
  rows: readonly DirectoryInstrument[], query: string, limit = 15,
): DirectoryInstrument[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const buckets: DirectoryInstrument[][] = Array.from({ length: MATCH_TIERS }, () => []);
  for (const ranked of rankedRows(rows)) {
    if (!ranked.row.active) continue;
    const tier = matchTier(ranked, q);
    if (tier >= 0 && buckets[tier].length < limit) buckets[tier].push(ranked.row);
  }
  return buckets.flat().slice(0, limit);
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
