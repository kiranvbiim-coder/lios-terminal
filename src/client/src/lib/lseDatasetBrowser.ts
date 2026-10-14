import type { LseCatalogRow, LseOptionContract, LseSeriesPoint } from "./useLse";

export type DatasetKind = "economics" | "bonds";

export interface DatasetProvenance {
  provider?: string;
  source?: string;
  sourceReference?: string;
  asOf?: string;
  retrievedAt?: string;
  status?: string;
  freshness?: string;
  cache?: string;
  fallback?: boolean;
  snapshot?: string;
  hash?: string;
  units?: string;
}

export interface DatasetPage<T> extends DatasetProvenance {
  rows: T[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string | null;
  total?: number;
  provenance?: DatasetProvenance;
}

export function datasetSearchPath(kind: DatasetKind, params: { query?: string; country?: string; category?: string; page?: number; limit?: number }): string {
  const base = kind === "bonds" ? "/api/lse/bonds/search" : "/api/lse/economics/search";
  const query = new URLSearchParams({ mode: "page" });
  if (params.query) query.set("q", params.query);
  if (params.country) query.set("country", params.country);
  if (params.category) query.set("category", params.category);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  return `${base}?${query.toString()}`;
}

export function datasetSeriesPath(kind: DatasetKind, symbol: string, params: { start?: string; end?: string; limit?: number; page?: number }): string {
  const base = kind === "bonds" ? "/api/lse/bonds/series" : "/api/lse/economics/series";
  const query = new URLSearchParams({ mode: "page" });
  if (params.start) query.set("start", params.start);
  if (params.end) query.set("end", params.end);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.page && params.page > 1) query.set("page", String(params.page));
  return `${base}/${encodeURIComponent(symbol)}?${query.toString()}`;
}

function isPage<T>(value: unknown): value is Partial<DatasetPage<T>> & { rows: T[] } {
  if (!value || typeof value !== "object" || !("rows" in value)) return false;
  return Array.isArray(value.rows);
}
function stringProperty(value: object, key: string): string | undefined {
  if (!(key in value)) return undefined;
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : undefined;
}

function booleanProperty(value: object, key: string): boolean | undefined {
  if (!(key in value)) return undefined;
  const property = Reflect.get(value, key);
  return typeof property === "boolean" ? property : undefined;
}

function numberProperty(value: object, key: string): number | undefined {
  if (!(key in value)) return undefined;
  const property = Reflect.get(value, key);
  return typeof property === "number" ? property : undefined;
}

export function normalizeDatasetPage<T>(value: unknown, fallbackLimit: number): DatasetPage<T> {
  if (Array.isArray(value)) return { rows: value as T[], page: 1, limit: fallbackLimit, hasMore: false };
  if (!isPage<T>(value)) return { rows: [], page: 1, limit: fallbackLimit, hasMore: false, status: "invalid-response" };
  const page = typeof value.page === "number" && value.page > 0 ? value.page : 1;
  const limit = typeof value.limit === "number" && value.limit > 0 ? value.limit : fallbackLimit;
  const rawProvenance = "provenance" in value && value.provenance && typeof value.provenance === "object" ? value.provenance : undefined;
  const provider = rawProvenance ? stringProperty(rawProvenance, "provider") : undefined;
  const source = rawProvenance ? stringProperty(rawProvenance, "source") ?? stringProperty(rawProvenance, "sourceReference") : undefined;
  const asOf = rawProvenance ? stringProperty(rawProvenance, "asOf") : undefined;
  const retrievedAt = rawProvenance ? stringProperty(rawProvenance, "retrievedAt") : undefined;
  const freshness = rawProvenance ? stringProperty(rawProvenance, "freshness") : undefined;
  const cache = rawProvenance ? stringProperty(rawProvenance, "cache") : undefined;
  const status = rawProvenance ? stringProperty(rawProvenance, "status") : undefined;
  return {
    ...value,
    rows: value.rows,
    page,
    limit,
    hasMore: Boolean(value.hasMore),
    provider: value.provider ?? provider,
    source: value.source ?? source,
    asOf: value.asOf ?? asOf,
    retrievedAt: value.retrievedAt ?? retrievedAt,
    freshness: value.freshness ?? freshness,
    cache: value.cache ?? cache,
    status: value.status ?? status,
    fallback: value.fallback ?? (rawProvenance ? booleanProperty(rawProvenance, "fallback") : undefined),
    total: value.total ?? (rawProvenance ? numberProperty(rawProvenance, "total") : undefined),
  };
}

export function catalogRows(value: unknown, fallbackLimit = 50): DatasetPage<LseCatalogRow> {
  return normalizeDatasetPage<LseCatalogRow>(value, fallbackLimit);
}

export function seriesRows(value: unknown, fallbackLimit = 240): DatasetPage<LseSeriesPoint> {
  return normalizeDatasetPage<LseSeriesPoint>(value, fallbackLimit);
}

export function filterCatalogRows(rows: LseCatalogRow[], filters: { query?: string; country?: string; category?: string }): LseCatalogRow[] {
  const query = filters.query?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.country && row.country !== filters.country) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (!query) return true;
    return [row.symbol, row.name, row.dataset, row.country_name, row.category].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
}

export function pageRows<T>(rows: T[], page: number, limit: number): { rows: T[]; page: number; limit: number; hasMore: boolean } {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 1));
  const safePage = Math.max(1, Math.floor(page) || 1);
  const start = (safePage - 1) * safeLimit;
  return { rows: rows.slice(start, start + safeLimit), page: safePage, limit: safeLimit, hasMore: start + safeLimit < rows.length };
}

export function observationsCsv(rows: LseSeriesPoint[]): string {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  return ["symbol,date,value", ...rows.map((row) => [row.symbol, row.date, row.value].map(escape).join(","))].join("\n");
}

export function optionRows(value: unknown, fallbackLimit = 50): DatasetPage<LseOptionContract> & { availableExpiries: string[] } {
  const page = normalizeDatasetPage<LseOptionContract>(value, fallbackLimit);
  let availableExpiries: string[] = [];
  if (value && typeof value === "object" && "availableExpiries" in value && Array.isArray(value.availableExpiries)) {
    availableExpiries = value.availableExpiries.filter((expiry): expiry is string => typeof expiry === "string");
  }
  if (!availableExpiries.length) availableExpiries = Array.from(new Set(page.rows.map((row) => row.expiry))).sort();
  return { ...page, availableExpiries };
}

export function formatSnapshotMessage(body: unknown, visibleCount: number): string {
  if (!body || typeof body !== "object") return "Snapshot request accepted; saved row count was not returned by the provider.";
  const created = "created" in body && body.created === true;
  const snapshotId = "snapshot" in body && body.snapshot && typeof body.snapshot === "object" && "id" in body.snapshot && typeof body.snapshot.id === "string" ? body.snapshot.id : null;
  const savedCount = "savedCount" in body && typeof body.savedCount === "number" ? body.savedCount : null;
  if (!created) return "Unchanged since the last snapshot — reused the existing record.";
  if (snapshotId && savedCount !== null) return `Saved new point-in-time snapshot ${snapshotId.slice(0, 8)} (${savedCount.toLocaleString()} contracts).`;
  if (snapshotId) return `Saved new point-in-time snapshot ${snapshotId.slice(0, 8)}; saved row count was not returned (visible page: ${visibleCount}).`;
  return `Snapshot request accepted; saved row count was not returned (visible page: ${visibleCount}).`;
}
