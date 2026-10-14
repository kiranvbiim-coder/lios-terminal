import {
  dataQualityReportSchema,
  type DataQualityReport,
} from "@shared/universalDataFabric";

export interface DatasetQualityInput {
  datasetRef: string;
  rows: Array<Record<string, unknown>>;
  requiredFields?: string[];
  uniqueKeyFields?: string[];
  expectedTypes?: Record<string, "string" | "number" | "boolean" | "date">;
  retrievedAt?: string | null;
  effectiveAtField?: string | null;
  publishedAtField?: string | null;
  availableAtField?: string | null;
  asKnownOn?: string | null;
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}
function dateValid(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function typeValid(value: unknown, type: NonNullable<DatasetQualityInput["expectedTypes"]>[string]): boolean {
  if (!present(value)) return true;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "date") return dateValid(value);
  return typeof value === "string";
}
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }

export function auditDatasetQuality(input: DatasetQualityInput): DataQualityReport {
  const rows = input.rows;
  const issues: DataQualityReport["issues"] = [];
  const required = input.requiredFields ?? [];
  const cells = Math.max(1, rows.length * Math.max(1, required.length));
  let presentCells = 0;
  for (const row of rows) for (const field of required) if (present(row[field])) presentCells += 1;
  const completeness = required.length ? presentCells / cells : 1;
  if (completeness < 1) issues.push({ code: "missing_required", severity: completeness < 0.8 ? "critical" : "warning", field: null, detail: `Required-field completeness is ${(completeness * 100).toFixed(1)}%.` });

  let typed = 0, typedValid = 0;
  for (const row of rows) for (const [field, type] of Object.entries(input.expectedTypes ?? {})) {
    typed += 1;
    if (typeValid(row[field], type)) typedValid += 1;
    else issues.push({ code: "invalid_type", severity: "warning", field, detail: `Value does not satisfy expected ${type} type.` });
  }
  const validity = typed ? typedValid / typed : 1;

  let uniqueness = 1;
  if (rows.length && input.uniqueKeyFields?.length) {
    const keys = rows.map((row) => input.uniqueKeyFields!.map((field) => String(row[field] ?? "")).join("\u001f"));
    uniqueness = new Set(keys).size / keys.length;
    if (uniqueness < 1) issues.push({ code: "duplicate_key", severity: "warning", field: input.uniqueKeyFields.join(","), detail: `${keys.length - new Set(keys).size} duplicate unique-key rows detected.` });
  }

  let consistency = 1;
  const effectiveField = input.effectiveAtField;
  const publishedField = input.publishedAtField;
  const availableField = input.availableAtField;
  if (effectiveField || publishedField || availableField) {
    let checked = 0, consistent = 0;
    for (const row of rows) {
      const effective = effectiveField && dateValid(row[effectiveField]) ? Date.parse(String(row[effectiveField])) : null;
      const published = publishedField && dateValid(row[publishedField]) ? Date.parse(String(row[publishedField])) : null;
      const available = availableField && dateValid(row[availableField]) ? Date.parse(String(row[availableField])) : null;
      if (effective !== null && published !== null) { checked += 1; if (published >= effective) consistent += 1; }
      if (published !== null && available !== null) { checked += 1; if (available >= published) consistent += 1; }
    }
    consistency = checked ? consistent / checked : 1;
    if (consistency < 1) issues.push({ code: "clock_order", severity: "critical", field: null, detail: "One or more records violate effective → published → available clock ordering." });
  }

  let freshness = 1;
  if (input.retrievedAt && dateValid(input.retrievedAt)) {
    const ageDays = Math.max(0, (Date.now() - Date.parse(input.retrievedAt)) / 86_400_000);
    freshness = clamp(1 - ageDays / 30);
    if (freshness < 0.5) issues.push({ code: "stale_retrieval", severity: "warning", field: null, detail: `Dataset was retrieved ${ageDays.toFixed(1)} days ago.` });
  }

  let pointInTimeIntegrity = 1;
  if (input.asKnownOn) {
    const cutoff = Date.parse(input.asKnownOn);
    if (!Number.isFinite(cutoff) || !availableField) pointInTimeIntegrity = 0;
    else {
      const dated = rows.filter((row) => dateValid(row[availableField]));
      pointInTimeIntegrity = dated.length ? dated.filter((row) => Date.parse(String(row[availableField])) <= cutoff).length / dated.length : 0;
    }
    if (pointInTimeIntegrity < 1) issues.push({ code: "lookahead_risk", severity: "critical", field: availableField ?? null, detail: "Dataset contains observations unavailable at the requested as-known-on time or lacks availability metadata." });
  }

  const score = clamp((completeness + validity + consistency + uniqueness + freshness + pointInTimeIntegrity) / 6);
  return dataQualityReportSchema.parse({
    schemaVersion: "1",
    datasetRef: input.datasetRef,
    score,
    dimensions: { completeness, validity, consistency, uniqueness, freshness, pointInTimeIntegrity },
    issues: issues.slice(0, 2_000),
    checkedAt: new Date().toISOString(),
  });
}
