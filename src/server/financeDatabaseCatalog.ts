/**
 * P5 optional broad reference universe: FinanceDatabase CSV import in the
 * canonical *user-owned* LiOS data root. Not a second identity authority.
 * Absence is permitted; search then uses persisted and other permitted data.
 */
import fs from "node:fs";
import { dataPath } from "./dataRoot";
import {
  adaptLegacySymbolCatalogRow,
  type InstrumentMasterCandidate,
  type LegacySymbolCatalogRow,
} from "@shared/globalInstrumentMaster";

interface FinanceDatabaseRow extends LegacySymbolCatalogRow {
  isin?: string;
  figi?: string;
  compositeFigi?: string;
  shareClassFigi?: string;
  assetClass?: string;
}
let cached: InstrumentMasterCandidate[] | null = null;

export function financeDatabaseCatalogPath(): string {
  return dataPath("instrument-catalogs", "financedatabase_universe.json");
}

export function loadFinanceDatabaseCatalog(): InstrumentMasterCandidate[] {
  if (cached !== null) return cached;
  const file = financeDatabaseCatalogPath();
  if (!fs.existsSync(file)) return (cached = []);
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Expected a provider-row JSON array");
    const candidates: InstrumentMasterCandidate[] = [];
    for (const record of parsed) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const row = record as FinanceDatabaseRow;
      if (!row.symbol || typeof row.symbol !== "string" ||
          !row.symbol.trim() || /^FILE CREATION TIME:/i.test(row.symbol) ||
          !row.name || typeof row.name !== "string" || !row.name.trim() ||
          row.provider !== "financedatabase") continue;
      const candidate = adaptLegacySymbolCatalogRow(row);
      // Enrichment never elevates a provisional row to canonical identity:
      // ISIN/FIGIs are supplied (not inferred) and must still be resolved.
      for (const [key, type] of [
        ["isin", "isin"], ["figi", "figi"],
        ["compositeFigi", "composite_figi"], ["shareClassFigi", "share_class_figi"],
      ] as const) {
        const value = row[key];
        const valid = type === "isin"
          ? typeof value === "string" && /^[A-Z]{2}[A-Z0-9]{9}[0-9}$/i.test(value)
          : typeof value === "string" && /^[A-Z0-9]{12}$/.test(value);
        if (valid) candidate.identifiers.push({ type, value: value!.toUpperCase(), provider: "financedatabase" });
      }
      candidates.push(candidate);
    }
    cached = candidates;
  } catch (error) {
    console.error("FinanceDatabase user catalog unavailable:", error instanceof Error ? error.message : error);
    cached = [];
  }
  return cached;
}

export function resetFinanceDatabaseCatalogCache(): void { cached = null; }
