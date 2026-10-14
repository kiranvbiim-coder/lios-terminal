import { z } from "zod";

/** The provenance class of rows in a provider-neutral dataset page. */
export const datasetClassificationSchema = z.enum(["live", "cached", "manual", "synthetic"]);
export type DatasetClassification = z.infer<typeof datasetClassificationSchema>;

const fieldTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "timestamp",
  "currency_amount",
  "percentage",
  "ratio",
  "array",
  "object",
]);

export const datasetFieldSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: fieldTypeSchema,
  description: z.string().trim().max(1_000).optional(),
  unit: z.string().trim().min(1).max(120).nullable().default(null),
}).strict();
export type DatasetField = z.infer<typeof datasetFieldSchema>;

const cursorSchema = z.string().regex(/^[A-Za-z0-9._~+/=-]{1,512}$/, "Cursor must be a non-empty opaque token");
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 content hash");
const sourceReferenceSchema = z.string().trim().min(1).max(2_000).refine(isSafeDatasetReference, "Source references must not contain credentials");
const asOfSchema = z.union([z.string().date(), z.string().datetime({ offset: true })]);

const pageNumberSchema = z.preprocess(
  (value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive().max(1_000_000),
);
const pageLimitSchema = z.preprocess(
  (value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().positive().max(1_000),
);

export const datasetPageRequestSchema = z.object({
  page: pageNumberSchema.default(1),
  limit: pageLimitSchema.default(100),
  cursor: cursorSchema.nullable().default(null),
}).strict();
export type DatasetPageRequest = z.infer<typeof datasetPageRequestSchema>;

export function parseDatasetPageRequest(input: unknown): DatasetPageRequest | null {
  const parsed = datasetPageRequestSchema.safeParse(input ?? {});
  return parsed.success ? parsed.data : null;
}

export const datasetProvenanceSchema = z.object({
  classification: datasetClassificationSchema,
  provider: z.string().trim().min(1).max(160),
  sourceReference: sourceReferenceSchema,
  asOf: asOfSchema.nullable(),
  retrievedAt: z.string().datetime({ offset: true }),
  freshness: z.enum(["current", "delayed", "daily", "reference", "feed", "schedule", "snapshot", "manual", "ai_generated"]),
  cacheStatus: z.enum(["live", "cached", "stale", "manual", "not_cached"]),
  fallback: z.object({
    used: z.boolean(),
    provider: z.string().trim().min(1).max(160).nullable().default(null),
  }).strict(),
  snapshotId: z.string().trim().min(1).max(240).nullable(),
  contentHash: contentHashSchema,
}).strict().superRefine((value, ctx) => {
  if (value.fallback.used && !value.fallback.provider) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fallback", "provider"], message: "Fallback provider is required when fallback is used" });
  }
  if (!value.fallback.used && value.fallback.provider) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fallback", "provider"], message: "Fallback provider requires fallback.used=true" });
  }
  if (value.classification === "live" && value.asOf === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["asOf"], message: "Live data must include an as-of timestamp or date" });
  }
  if (value.classification === "live" && !["live", "not_cached"].includes(value.cacheStatus)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cacheStatus"], message: "Live data cannot be marked cached or manual" });
  }
  if (value.classification === "cached" && !["cached", "stale"].includes(value.cacheStatus)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cacheStatus"], message: "Cached data must identify its cache status" });
  }
  if (value.classification === "manual" && value.cacheStatus !== "manual") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cacheStatus"], message: "Manual data must use manual cache status" });
  }
  if (value.classification === "synthetic" && value.cacheStatus !== "not_cached") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cacheStatus"], message: "Synthetic data cannot claim a provider cache" });
  }
  if (value.cacheStatus === "cached" || value.cacheStatus === "stale") {
    if (value.snapshotId === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["snapshotId"], message: "Cached data must identify its snapshot" });
    }
  }
  if (value.cacheStatus === "manual" && value.freshness !== "manual") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["freshness"], message: "Manual cache status must use manual freshness" });
  }
});
export type DatasetProvenance = z.infer<typeof datasetProvenanceSchema>;

export const datasetExportabilitySchema = z.object({
  enabled: z.boolean(),
  formats: z.array(z.enum(["json", "csv", "ndjson", "parquet"])).max(4),
  exportRef: z.string().trim().min(1).max(2_000).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && value.formats.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["formats"], message: "At least one export format is required when export is enabled" });
  }
  if (!value.enabled && (value.formats.length > 0 || value.exportRef !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enabled"], message: "Disabled exports cannot advertise formats or an export reference" });
  }
  if (value.exportRef && !isSafeDatasetReference(value.exportRef)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exportRef"], message: "Export references must not contain credentials" });
  }
});
export type DatasetExportability = z.infer<typeof datasetExportabilitySchema>;

const datasetRowSchema = z.record(z.unknown());

export const datasetPageSchema = z.object({
  schemaVersion: z.literal("1"),
  datasetKey: z.string().trim().min(1).max(240),
  provenance: datasetProvenanceSchema,
  fields: z.array(datasetFieldSchema).max(500),
  rows: z.array(datasetRowSchema).max(1_000),
  rowCountReturned: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(),
  page: z.number().int().positive().max(1_000_000),
  limit: z.number().int().positive().max(1_000),
  cursor: cursorSchema.nullable(),
  nextCursor: cursorSchema.nullable(),
  exportability: datasetExportabilitySchema,
}).strict().superRefine((value, ctx) => {
  if (value.rowCountReturned !== value.rows.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rowCountReturned"], message: "rowCountReturned must equal rows.length" });
  }
  if (value.totalRows !== null && value.totalRows < value.rowCountReturned) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalRows"], message: "totalRows cannot be less than rowCountReturned" });
  }
  const expectedHasMore = value.totalRows === null ? value.hasMore : value.page * value.limit < value.totalRows;
  if (value.totalRows !== null && value.hasMore !== expectedHasMore) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hasMore"], message: "hasMore conflicts with page, limit, and totalRows" });
  }
  if (value.hasMore && value.nextCursor === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nextCursor"], message: "A page with more rows must include nextCursor" });
  }
  if (!value.hasMore && value.nextCursor !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nextCursor"], message: "nextCursor must be null on the final page" });
  }
  const names = new Set<string>();
  value.fields.forEach((field, index) => {
    if (names.has(field.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "name"], message: "Field names must be unique" });
    }
    names.add(field.name);
  });
});

export type DatasetRow = z.infer<typeof datasetRowSchema>;
export type DatasetPage<T extends DatasetRow = DatasetRow> = Omit<z.infer<typeof datasetPageSchema>, "rows"> & { rows: T[] };
export type DatasetPageInput<T extends DatasetRow = DatasetRow> = Omit<DatasetPage<T>, "schemaVersion" | "rowCountReturned"> & {
  schemaVersion?: "1";
  rowCountReturned?: number;
};
/** Remove credentials from URLs and opaque source references before they enter a response. */
export function redactDatasetReference(reference: string): string {
  return reference.replace(/((?:^|[?&])(?:api[_-]?key|apikey|token|secret|password|authorization)\s*=\s*)[^&#\s]*/gi, "$1[REDACTED]");
}

function isSafeDatasetReference(reference: string): boolean {
  const credentialPattern = /(?:^|[?&])(?:api[_-]?key|apikey|token|secret|password|authorization)\s*=\s*([^&#\s]*)/i;
  const match = credentialPattern.exec(reference);
  if (!match) return true;
  try {
    return decodeURIComponent(match[1]) === "[REDACTED]";
  } catch {
    return false;
  }
}

/** Validate a page and return null rather than allowing malformed metadata through. */
export function parseDatasetPage<T extends DatasetRow = DatasetRow>(input: unknown): DatasetPage<T> | null {
  const parsed = datasetPageSchema.safeParse(input);
  return parsed.success ? parsed.data as DatasetPage<T> : null;
}

/** Build a page while retaining the strict wire contract and provenance checks. */
export function buildDatasetPage<T extends DatasetRow>(input: DatasetPageInput<T>): DatasetPage<T> {
  const page = {
    ...input,
    schemaVersion: input.schemaVersion ?? "1",
    rowCountReturned: input.rowCountReturned ?? input.rows.length,
  };
  const parsed = datasetPageSchema.safeParse(page);
  if (!parsed.success) {
    throw new Error(`Invalid dataset page: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return parsed.data as DatasetPage<T>;
}
