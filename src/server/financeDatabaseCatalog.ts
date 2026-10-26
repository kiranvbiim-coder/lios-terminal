/**
 * Optional FinanceDatabase reference catalog in the user-owned LiOS Data Root.
 * Search, the Finance Directory and coverage status share this single source.
 * It is never a second global security master: records are provisional.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { dataPath } from "./dataRoot";
import {
  adaptLegacySymbolCatalogRow,
  type InstrumentMasterCandidate,
  type LegacySymbolCatalogRow,
} from "@shared/globalInstrumentMaster";

export interface FinanceDatabaseRow extends LegacySymbolCatalogRow {
  provider: "financedatabase";
  assetClass: string;
  sector?: string | null;
  industry?: string | null;
  industryGroup?: string | null;
  market?: string | null;
  countryName?: string | null;
  marketCapTier?: string | null;
  family?: string | null;
  category?: string | null;
  categoryGroup?: string | null;
  isin?: string;
  cusip?: string;
  figi?: string;
  compositeFigi?: string;
  shareClassFigi?: string;
  cryptocurrency?: string | null;
  baseCurrency?: string | null;
  quoteCurrency?: string | null;
}

export interface FinanceDatabaseManifest {
  provider: string;
  upstreamCommit: string;
  importedAt: string;
  categories: string[];
  accepted: number;
  raw: number;
  skipped: number;
  duplicates: number;
  byCategory: Record<string, number>;
  catalogSha256?: string;
  files: { path: string; sha256: string }[];
}

let cachedRows: readonly FinanceDatabaseRow[] | null = null;
let cachedCandidates: InstrumentMasterCandidate[] | null = null;
let cacheStamp = "";

export function financeDatabaseCatalogPath(): string {
  return dataPath("instrument-catalogs", "financedatabase_universe.json");
}
export function financeDatabaseManifestPath(): string {
  return dataPath("instrument-catalogs", "financedatabase_manifest.json");
}

function statStamp(file: string): string {
  try {
    const stat = fs.statSync(file);
    return String(stat.size) + ":" + String(stat.mtimeMs);
  } catch { return "absent"; }
}
function refreshCacheStamp(): void {
  const stamp = statStamp(financeDatabaseCatalogPath()) + "|" + statStamp(financeDatabaseManifestPath());
  if (stamp !== cacheStamp) {
    cacheStamp = stamp;
    cachedRows = null;
    cachedCandidates = null;
  }
}

export function readFinanceDatabaseManifest(): FinanceDatabaseManifest | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(financeDatabaseManifestPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const manifest = parsed as FinanceDatabaseManifest;
    if (manifest.provider !== "JerBouma/FinanceDatabase" || !Number.isSafeInteger(manifest.accepted) ||
        !Array.isArray(manifest.categories) || !Array.isArray(manifest.files)) return null;
    return manifest;
  } catch { return null; }
}

function isFinanceDatabaseRow(raw: unknown): raw is FinanceDatabaseRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return r.provider === "financedatabase" &&
    typeof r.assetClass === "string" && r.assetClass.trim().length > 0 &&
    typeof r.symbol === "string" && r.symbol.trim().length > 0 &&
    !/^FILE CREATION TIME:/i.test(r.symbol) &&
    typeof r.name === "string" && r.name.trim().length > 0;
}

export function loadFinanceDatabaseRows(): readonly FinanceDatabaseRow[] {
  refreshCacheStamp();
  if (cachedRows !== null) return cachedRows;
  const file = financeDatabaseCatalogPath();
  if (!fs.existsSync(file)) return (cachedRows = []);
  try {
    const buffer = fs.readFileSync(file);
    const manifest = readFinanceDatabaseManifest();
    if (manifest?.catalogSha256) {
      const sha = crypto.createHash("sha256").update(buffer).digest("hex");
      if (sha !== manifest.catalogSha256) throw new Error("Downloaded catalog integrity mismatch");
    }
    const parsed: unknown = JSON.parse(buffer.toString("utf8"));
    if (!Array.isArray(parsed)) throw new Error("Expected a provider-row JSON array");
    const result = parsed.filter(isFinanceDatabaseRow);
    if (manifest && (manifest.accepted !== result.length || parsed.length !== result.length)) {
      throw new Error("Provider import manifest count does not match valid rows");
    }
    return (cachedRows = result);
  } catch (error) {
    console.error("FinanceDatabase catalog unavailable:", error instanceof Error ? error.message : error);
    return (cachedRows = []);
  }
}

const ISO_BY_NAME = new Map<string, string>();
function regionCodesByName(): Map<string, string> {
  if (ISO_BY_NAME.size) return ISO_BY_NAME;
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = names.of(code);
      if (name && name !== code) ISO_BY_NAME.set(name.toUpperCase(), code);
    }
  }
  // Common historical or provider display-name variants, never guessed from
  // a security symbol or exchange suffix.
  for (const [name, code] of Object.entries({
    "CZECH REPUBLIC": "CZ",
    "REPUBLIC OF KOREA": "KR",
    "SOUTH KOREA": "KR",
    "RUSSIAN FEDERATION": "RU",
    "VIET NAM": "VN",
    "TURKEY": "TR",
    "HONG KONG": "HK",
    "MACAU": "MO",
    "TAIWAN": "TW",
    "UNITED STATES OF AMERICA": "US",
    "UNITED KINGDOM": "GB",
    "UAE": "AE",
  })) ISO_BY_NAME.set(name, code);
  return ISO_BY_NAME;
}
export function financeDatabaseCountryCode(country: string | null | undefined): string | null {
  if (!country?.trim()) return null;
  const normalized = country.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  return regionCodesByName().get(normalized) ?? null;
}

export function loadFinanceDatabaseCatalog(): InstrumentMasterCandidate[] {
  refreshCacheStamp();
  if (cachedCandidates !== null) return cachedCandidates;
  cachedCandidates = loadFinanceDatabaseRows().map(row => {
    const candidate = adaptLegacySymbolCatalogRow({
      ...row,
      countryCode: row.countryCode || financeDatabaseCountryCode(row.countryName),
    });
    for (const [key, type, regex] of [
      ["isin", "isin", /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/],
      ["cusip", "cusip", /^[A-Z0-9]{9}$/],
      ["figi", "figi", /^[A-Z0-9]{12}$/],
      ["compositeFigi", "composite_figi", /^[A-Z0-9]{12}$/],
      ["shareClassFigi", "share_class_figi", /^[A-Z0-9]{12}$/],
    ] as const) {
      const value = row[key];
      if (typeof value === "string" && regex.test(value.toUpperCase())) {
        candidate.identifiers.push({ type, value: value.toUpperCase(), provider: "financedatabase" });
      }
    }
    return candidate;
  });
  return cachedCandidates;
}

export function financeDatabaseCatalogStatus() {
  const manifest = readFinanceDatabaseManifest();
  const rows = loadFinanceDatabaseRows();
  return {
    source: "JerBouma/FinanceDatabase",
    imported: rows.length > 0,
    referenceOnly: true,
    provisional: true,
    searchCount: rows.length,
    upstreamCommit: manifest?.upstreamCommit ?? null,
    importedAt: manifest?.importedAt ?? null,
    countsByAssetClass: manifest && rows.length === manifest.accepted ? manifest.byCategory : {},
    coverageKind: "reference_symbols_not_live_prices",
  };
}

export function resetFinanceDatabaseCatalogCache(): void {
  cacheStamp = "";
  cachedRows = null;
  cachedCandidates = null;
}
