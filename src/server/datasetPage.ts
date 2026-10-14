import crypto from "node:crypto";
import {
  buildDatasetPage as buildSharedDatasetPage,
  parseDatasetPageRequest,
  redactDatasetReference,
  type DatasetPage,
  type DatasetPageInput,
  type DatasetProvenance,
  type DatasetRow,
} from "@shared/datasetPage";

function stableSerialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSerialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stableSerialize(entry)]));
  }
  return value;
}

/** Hash the returned rows without retaining the rows or exposing source credentials. */
export function hashDatasetRows(rows: readonly DatasetRow[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(stableSerialize(rows))).digest("hex");
}

type ServerProvenanceInput = Omit<DatasetProvenance, "contentHash" | "sourceReference"> & {
  sourceReference: string;
  contentHash?: string;
};

export type ServerDatasetPageInput<T extends DatasetRow = DatasetRow> = Omit<DatasetPageInput<T>, "provenance"> & {
  provenance: ServerProvenanceInput;
};

/**
 * Build the response envelope used by dataset browsers. Server-side sources
 * may omit the page hash; it is derived from the returned rows. References
 * are redacted before validation so API keys cannot enter the response.
 */
export function buildDatasetPage<T extends DatasetRow>(input: ServerDatasetPageInput<T>): DatasetPage<T> {
  const provenance = {
    ...input.provenance,
    sourceReference: redactDatasetReference(input.provenance.sourceReference),
    contentHash: input.provenance.contentHash ?? hashDatasetRows(input.rows),
  };
  return buildSharedDatasetPage({ ...input, provenance });
}

export interface DatasetPageWindow<T extends DatasetRow = DatasetRow> {
  rows: T[];
  rowCountReturned: number;
  totalRows: number;
  hasMore: boolean;
  page: number;
  limit: number;
  cursor: string | null;
  nextCursor: string | null;
}

/** Apply bounded page pagination before constructing the response envelope. */
export function paginateDatasetRows<T extends DatasetRow>(rows: readonly T[], request: unknown = {}): DatasetPageWindow<T> {
  const parsed = parseDatasetPageRequest(request);
  if (!parsed) throw new Error("Invalid dataset page request");
  const offset = (parsed.page - 1) * parsed.limit;
  const pageRows = rows.slice(offset, offset + parsed.limit);
  const hasMore = offset + pageRows.length < rows.length;
  return {
    rows: pageRows,
    rowCountReturned: pageRows.length,
    totalRows: rows.length,
    hasMore,
    page: parsed.page,
    limit: parsed.limit,
    cursor: parsed.cursor,
    nextCursor: hasMore ? String(parsed.page + 1) : null,
  };
}

