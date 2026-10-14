export type SourceScalarType = "null" | "boolean" | "integer" | "number" | "date" | "datetime" | "string" | "object" | "array" | "mixed";

export interface SourceFieldProfile {
  name: string;
  type: SourceScalarType;
  nullable: boolean;
  observedCount: number;
  nullCount: number;
  sampleValues: unknown[];
}

export interface SourceSchemaPreview {
  fields: SourceFieldProfile[];
  previewRows: Array<Record<string, unknown>>;
  observedRows: number;
  truncated: boolean;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const SAFE_PATH_SEGMENT_RE = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;
const BLOCKED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function scalarType(value: unknown): SourceScalarType {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "mixed" : "datetime";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "mixed";
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (DATE_ONLY_RE.test(trimmed) && !Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))) return "date";
    if (DATETIME_RE.test(trimmed) && !Number.isNaN(Date.parse(trimmed.replace(" ", "T")))) return "datetime";
    return "string";
  }
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "mixed";
}

function mergeTypes(current: SourceScalarType | null, next: SourceScalarType): SourceScalarType {
  if (next === "null") return current ?? "null";
  if (!current || current === "null") return next;
  if (current === next) return current;
  if ((current === "integer" && next === "number") || (current === "number" && next === "integer")) return "number";
  if ((current === "date" && next === "datetime") || (current === "datetime" && next === "date")) return "datetime";
  return "mixed";
}

export function validateDiscoveryPath(path: string | undefined): { valid: true; segments: string[] } | { valid: false; reason: string } {
  if (!path?.trim()) return { valid: true, segments: [] };
  const segments = path.split(".").filter(Boolean);
  if (segments.length > 32) return { valid: false, reason: "Response path is too deep." };
  for (const segment of segments) {
    if (!SAFE_PATH_SEGMENT_RE.test(segment)) return { valid: false, reason: `Invalid response-path segment: ${segment}.` };
    if (BLOCKED_PATH_SEGMENTS.has(segment)) return { valid: false, reason: "Prototype-related response-path segments are not allowed." };
  }
  return { valid: true, segments };
}

export function selectDiscoveryValue(payload: unknown, path?: string): unknown {
  const validation = validateDiscoveryPath(path);
  if (!validation.valid) throw new Error(validation.reason);
  let current = payload;
  for (const segment of validation.segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function recordsFromDiscoveredValue(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
  }
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

export function profileSourceRecords(
  rows: readonly Record<string, unknown>[],
  options: { maxRows?: number; maxSamplesPerField?: number } = {},
): SourceSchemaPreview {
  const maxRows = Math.min(Math.max(Math.floor(options.maxRows ?? 100), 1), 1_000);
  const maxSamplesPerField = Math.min(Math.max(Math.floor(options.maxSamplesPerField ?? 3), 0), 10);
  const previewRows = rows.slice(0, maxRows).map(row => ({ ...row }));
  const orderedNames: string[] = [];
  const seen = new Set<string>();
  for (const row of previewRows) {
    for (const name of Object.keys(row)) {
      if (!seen.has(name)) {
        seen.add(name);
        orderedNames.push(name);
      }
    }
  }

  const fields = orderedNames.map<SourceFieldProfile>((name) => {
    let type: SourceScalarType | null = null;
    let nullCount = 0;
    let observedCount = 0;
    const sampleValues: unknown[] = [];
    for (const row of previewRows) {
      const value = Object.prototype.hasOwnProperty.call(row, name) ? row[name] : null;
      const nextType = scalarType(value);
      if (nextType === "null") nullCount += 1;
      else {
        observedCount += 1;
        if (sampleValues.length < maxSamplesPerField) sampleValues.push(value);
      }
      type = mergeTypes(type, nextType);
    }
    return {
      name,
      type: type ?? "null",
      nullable: nullCount > 0,
      observedCount,
      nullCount,
      sampleValues,
    };
  });

  return {
    fields,
    previewRows,
    observedRows: previewRows.length,
    truncated: rows.length > previewRows.length,
  };
}
