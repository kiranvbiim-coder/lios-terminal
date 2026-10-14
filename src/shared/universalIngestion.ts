import { FINANCIAL_METRICS, getFinancialMetricDefinition, type FinancialMetricObservation, type FinancialMetricStatus } from "./financialMetricRegistry";

export type UniversalColumnMappingConfidence = "exact" | "normalized" | "alias" | "unmapped";

export interface UniversalColumnMapping {
  sourceColumn: string;
  metricId: string | null;
  confidence: UniversalColumnMappingConfidence;
}

export interface UniversalIngestionInput {
  symbol: string;
  records: readonly Record<string, unknown>[];
  source: string;
  provider: string;
  sourceUrl?: string;
  status?: Extract<FinancialMetricStatus, "live" | "filed" | "estimate" | "imported" | "manual">;
  defaultPeriod?: string;
  defaultCurrency?: string;
  retrievedAt?: string;
  columnMapping?: Readonly<Record<string, string | null>>;
}

export interface UniversalIngestionResult {
  observations: FinancialMetricObservation[];
  rejected: Array<{ row: number; reason: string }>;
  columnMappings: UniversalColumnMapping[];
  canonicalMetrics: Array<{ id: string; label: string }>;
  source: string;
  provider: string;
  retrievedAt: string;
}

const PERIOD_KEYS = ["period", "fiscal_period", "fiscalPeriod", "period_end", "periodEnd", "date"];
const AS_OF_KEYS = ["as_of", "asOf", "available_at", "availableAt", "retrieved_at", "retrievedAt", "date"];
const CURRENCY_KEYS = ["currency", "reported_currency", "reportedCurrency", "ccy"];
const METRIC_KEYS = ["metric", "metric_id", "metricId", "field", "name"];
const NON_METRIC_KEYS = new Set(["symbol", "ticker", "entity", "provider", "source", "sheet"]);

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[$€£₹,%\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeField(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

interface MetricEntry {
  rawMetric: string;
  rawValue: unknown;
  sourceColumn: string;
}

function metricEntries(record: Record<string, unknown>): MetricEntry[] {
  const explicitMetric = firstString(record, METRIC_KEYS);
  if (explicitMetric) {
    const valueKey = ["value", "amount", "observation", "metric_value"].find(key => key in record);
    return valueKey ? [{ rawMetric: explicitMetric, rawValue: record[valueKey], sourceColumn: explicitMetric }] : [];
  }
  return Object.entries(record)
    .filter(([key]) => !PERIOD_KEYS.includes(key) && !AS_OF_KEYS.includes(key) && !CURRENCY_KEYS.includes(key) && !NON_METRIC_KEYS.has(key))
    .map(([rawMetric, rawValue]) => ({ rawMetric, rawValue, sourceColumn: rawMetric }));
}

function automaticMapping(rawMetric: string): UniversalColumnMapping {
  const exact = FINANCIAL_METRICS.filter(metric => metric.id === rawMetric);
  if (exact.length === 1) return { sourceColumn: rawMetric, metricId: exact[0].id, confidence: "exact" };
  const normalized = normalizeField(rawMetric);
  const normalizedMatches = FINANCIAL_METRICS.filter(metric => normalizeField(metric.id) === normalized);
  if (normalizedMatches.length === 1) return { sourceColumn: rawMetric, metricId: normalizedMatches[0].id, confidence: "normalized" };
  const aliasMatches = FINANCIAL_METRICS.filter(metric =>
    [metric.label, metric.shortLabel, ...(metric.aliases ?? [])]
      .filter((value): value is string => Boolean(value))
      .some(alias => normalizeField(alias) === normalized),
  );
  if (aliasMatches.length === 1) return { sourceColumn: rawMetric, metricId: aliasMatches[0].id, confidence: "alias" };
  return { sourceColumn: rawMetric, metricId: null, confidence: "unmapped" };
}

function mappingForEntry(rawMetric: string, columnMapping: UniversalIngestionInput["columnMapping"]): UniversalColumnMapping {
  if (columnMapping && Object.prototype.hasOwnProperty.call(columnMapping, rawMetric)) {
    const selected = columnMapping[rawMetric];
    if (selected === null) return { sourceColumn: rawMetric, metricId: null, confidence: "unmapped" };
    const definition = selected ? getFinancialMetricDefinition(selected) : null;
    return definition
      ? { sourceColumn: rawMetric, metricId: definition.id, confidence: "exact" }
      : { sourceColumn: rawMetric, metricId: null, confidence: "unmapped" };
  }
  return automaticMapping(rawMetric);
}

export function normalizeUniversalFinanceRecords(input: UniversalIngestionInput): UniversalIngestionResult {
  const observations: FinancialMetricObservation[] = [];
  const rejected: Array<{ row: number; reason: string }> = [];
  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  const seenColumns = new Set<string>();
  for (const record of input.records) {
    for (const entry of metricEntries(record)) seenColumns.add(entry.sourceColumn);
  }
  const columnMappings = [...seenColumns].map(sourceColumn => mappingForEntry(sourceColumn, input.columnMapping));
  for (const [rowIndex, record] of input.records.entries()) {
    const period = firstString(record, PERIOD_KEYS) ?? input.defaultPeriod ?? "CURRENT";
    const asOf = firstString(record, AS_OF_KEYS) ?? retrievedAt;
    const currency = firstString(record, CURRENCY_KEYS) ?? input.defaultCurrency;
    const entries = metricEntries(record);
    if (!entries.length) {
      rejected.push({ row: rowIndex, reason: "No metric field and value were recognized." });
      continue;
    }
    let accepted = 0;
    let recognized = 0;
    for (const { rawMetric, rawValue, sourceColumn } of entries) {
      const mapping = mappingForEntry(sourceColumn, input.columnMapping);
      if (!mapping.metricId) continue;
      const definition = getFinancialMetricDefinition(mapping.metricId);
      if (!definition) continue;
      recognized += 1;
      const value = numericValue(rawValue);
      if (value === null) {
        rejected.push({ row: rowIndex, reason: `${rawMetric} is not a finite numeric value.` });
        continue;
      }
      observations.push({
        metricId: definition.id,
        value,
        status: input.status ?? "imported",
        period,
        asOf,
        source: input.source,
        sourceUrl: input.sourceUrl,
        currency,
        note: `Normalized from ${input.provider} universal ingestion row ${rowIndex + 1}.`,
      });
      accepted += 1;
    }
    if (!accepted && !recognized && entries.length) rejected.push({ row: rowIndex, reason: "No recognized canonical finance metric was present." });
  }
  return {
    observations,
    rejected,
    columnMappings,
    canonicalMetrics: FINANCIAL_METRICS.map(metric => ({ id: metric.id, label: metric.label })),
    source: input.source,
    provider: input.provider,
    retrievedAt,
  };
}
