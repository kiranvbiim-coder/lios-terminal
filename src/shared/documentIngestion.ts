import type { FinancialMetricObservation } from "./financialMetricRegistry";
import type { StatementType } from "./financialFields";

export type DocumentIngestionConfidence = "high" | "medium" | "low";
export type DocumentIngestionSourceMethod = "deterministic" | "llm" | "unmatched";

export interface DocumentIngestionRow {
  readonly row: number;
  readonly statementType: StatementType;
  readonly fieldKey: string;
  readonly metricId: string | null;
  readonly value: number | null;
  readonly period: string;
  readonly currency: string | null;
  readonly rawText: string | null;
  readonly confidence: DocumentIngestionConfidence;
  readonly sourceMethod: DocumentIngestionSourceMethod;
}

export interface DocumentIngestionRejection {
  readonly row: number;
  readonly fieldKey: string;
  readonly reason: string;
}

export interface DocumentIngestionProvenance {
  readonly fileName: string;
  readonly symbol: string;
  readonly source: string;
  readonly provider: string;
  readonly parser: string;
  readonly parserVersion: string;
  readonly importedAt: string;
}

export interface DocumentIngestionResult {
  readonly rows: readonly DocumentIngestionRow[];
  readonly observations: readonly FinancialMetricObservation[];
  readonly rejected: readonly DocumentIngestionRejection[];
  readonly warnings: readonly string[];
  readonly provenance: DocumentIngestionProvenance;
}
