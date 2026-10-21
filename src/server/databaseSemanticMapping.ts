import type { DataTransform } from "@shared/dataMapping";
import { dataMappingStore, type DataMappingScope, type StoredDataMapping } from "./dataMappingStore";

function transformValue(value: unknown, transform: DataTransform): unknown {
  if (value === null || value === undefined || transform === "identity") return value;
  if (transform === "uppercase" || transform === "lowercase") {
    if (typeof value !== "string") throw new Error(`Confirmed ${transform} mapping requires a string.`);
    return transform === "uppercase" ? value.toUpperCase() : value.toLowerCase();
  }
  if (transform === "date_iso") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
      throw new Error("Confirmed date_iso mapping requires an ISO date.");
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Confirmed date_iso mapping contains an invalid date.");
    return date.toISOString();
  }
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) throw new Error(`Confirmed ${transform} mapping requires a finite number.`);
  const factor = { percentage_to_decimal: 0.01, decimal_to_percentage: 100, thousands_to_units: 1_000, millions_to_units: 1_000_000 }[transform];
  const result = numeric * factor;
  if (!Number.isFinite(result)) throw new Error("Confirmed numeric mapping overflowed.");
  return result;
}

/** Execute only owner-confirmed mappings for the exact connected dataset. Raw rows remain unchanged. */
export async function mapConfirmedDatabaseRecords(
  scope: DataMappingScope,
  connectionId: number,
  datasetKey: string,
  rows: readonly Record<string, unknown>[],
  store: Pick<typeof dataMappingStore, "list"> = dataMappingStore,
): Promise<{ semanticRecords: Record<string, unknown>[]; mappings: StoredDataMapping[] }> {
  const providerId = `source-connection:${connectionId}`;
  const mappings = (await store.list(scope)).filter(mapping =>
    mapping.active && mapping.executable && mapping.ownerUserId === scope.ownerUserId &&
    mapping.organizationId === scope.organizationId && mapping.providerId === providerId && mapping.datasetKey === datasetKey);
  if (mappings.length === 0) throw new Error("No confirmed semantic mappings exist for this connected database dataset.");
  const targets = new Set<string>();
  for (const mapping of mappings) {
    if (targets.has(mapping.targetFieldId)) throw new Error("Confirmed database mappings contain duplicate semantic targets.");
    targets.add(mapping.targetFieldId);
  }
  const semanticRecords = rows.map(row => {
    const mapped: Record<string, unknown> = Object.create(null);
    for (const mapping of mappings) {
      if (!Object.prototype.hasOwnProperty.call(row, mapping.providerField)) {
        throw new Error(`Database result is missing confirmed field "${mapping.providerField}".`);
      }
      mapped[mapping.targetFieldId] = transformValue(row[mapping.providerField], mapping.transform);
    }
    return mapped;
  });
  return { semanticRecords, mappings };
}
