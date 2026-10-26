/**
 * Minimal truth gate for legacy/reference-data catalog identity rows.
 * A provider's file-creation timestamp is metadata, never an instrument.
 * Does not create or verify canonical entity/listing identities.
 */
export interface CatalogIdentityRow {
  symbol: string;
  name: string;
}

export function isUsableCatalogIdentityRow(row: unknown): row is CatalogIdentityRow {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const candidate = row as Record<string, unknown>;
  if (typeof candidate.symbol !== "string" || typeof candidate.name !== "string") return false;
  const symbol = candidate.symbol.trim();
  const name = candidate.name.trim();
  return Boolean(symbol && name) && !/^FILE CREATION TIME:/i.test(symbol);
}
