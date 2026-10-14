import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";
import type {
  DocumentIngestionConfidence,
  DocumentIngestionResult,
  DocumentIngestionRejection,
  DocumentIngestionRow,
} from "@shared/documentIngestion";
import {
  normalizeFinancialStatementPeriod,
  STATEMENT_FIELD_METRIC_IDS,
} from "@shared/financialStatementResolver";
import { normalizeUniversalFinanceRecords } from "@shared/universalIngestion";
import type { ExtractedPeriodReport } from "./pdfStatementExtractor";

export interface ExtractedStatementReportsInput {
  readonly symbol: string;
  readonly fileName: string;
  readonly reports: readonly ExtractedPeriodReport[];
  readonly warnings?: readonly string[];
  readonly importedAt?: string;
}

const confidenceScore = (confidence: DocumentIngestionConfidence): number => {
  if (confidence === "high") return 0.95;
  if (confidence === "medium") return 0.7;
  return 0.4;
};

const periodForReport = (report: ExtractedPeriodReport): string =>
  normalizeFinancialStatementPeriod(report.periodLabel) ??
  normalizeFinancialStatementPeriod(report.fiscalYear) ??
  `${report.fiscalYear} FY`;

const rejectionForField = (
  row: number,
  fieldKey: string,
  reason: string,
): DocumentIngestionRejection => ({ row, fieldKey, reason });

export function normalizeExtractedStatementReports(
  input: ExtractedStatementReportsInput,
): DocumentIngestionResult {
  const rows: DocumentIngestionRow[] = [];
  const rejected: DocumentIngestionRejection[] = [];
  const candidateRecords: Record<string, unknown>[] = [];
  const fieldMetadata: Array<{
    readonly metricId: string;
    readonly confidence: DocumentIngestionConfidence;
    readonly sourceMethod: "deterministic" | "llm" | "unmatched";
    readonly rawText: string | null;
  }> = [];
  let rowNumber = 0;

  for (const report of input.reports) {
    const period = periodForReport(report);
    const mapping = STATEMENT_FIELD_METRIC_IDS[report.reportType];
    for (const field of report.fields) {
      const metricId = mapping[field.key] ?? null;
      const row = {
        row: rowNumber,
        statementType: report.reportType,
        fieldKey: field.key,
        metricId,
        value: field.value,
        period,
        currency: report.reportedCurrency,
        rawText: field.rawText,
        confidence: field.confidence,
        sourceMethod: field.sourceMethod,
      } satisfies DocumentIngestionRow;
      rows.push(row);

      if (!metricId) {
        rejected.push(rejectionForField(
          rowNumber,
          field.key,
          "No analytical metric mapping exists for the extracted field.",
        ));
      } else if (field.value === null || !Number.isFinite(field.value)) {
        rejected.push(rejectionForField(
          rowNumber,
          field.key,
          "The extractor returned no finite value.",
        ));
      } else {
        candidateRecords.push({
          metric: metricId,
          value: field.value,
          period,
          currency: report.reportedCurrency,
        });
        fieldMetadata.push({
          metricId,
          confidence: field.confidence,
          sourceMethod: field.sourceMethod,
          rawText: field.rawText,
        });
      }
      rowNumber += 1;
    }
  }

  const source = `document:${input.fileName}`;
  const normalized = normalizeUniversalFinanceRecords({
    symbol: input.symbol,
    records: candidateRecords,
    source,
    provider: "pdfStatementExtractor",
    status: "imported",
    retrievedAt: input.importedAt,
  });
  const observations: FinancialMetricObservation[] = normalized.observations.map((observation, index) => {
    const metadata = fieldMetadata[index];
    return {
      ...observation,
      note: metadata?.rawText
        ? `Imported from ${input.fileName}; extracted text: ${metadata.rawText}`
        : `Imported from ${input.fileName}.`,
      confidence: metadata ? confidenceScore(metadata.confidence) : observation.confidence,
      manualOverride: false,
    };
  });

  return {
    rows,
    observations,
    rejected: [
      ...rejected,
      ...normalized.rejected.map(({ row, reason }) => ({
        row,
        fieldKey: fieldMetadata[row]?.metricId ?? "unknown",
        reason,
      })),
    ],
    warnings: [...(input.warnings ?? [])],
    provenance: {
      fileName: input.fileName,
      symbol: input.symbol,
      source,
      provider: "pdfStatementExtractor",
      parser: "pdfStatementExtractor",
      parserVersion: "1",
      importedAt: normalized.retrievedAt,
    },
  };
}
