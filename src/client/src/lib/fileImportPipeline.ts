import * as XLSX from "xlsx";
import { profileSourceRecords, type SourceSchemaPreview } from "@shared/sourceDiscovery";

export type ImportFileFormat = "csv" | "tsv" | "xlsx" | "xls" | "ods" | "json" | "parquet" | "unknown";

export interface ImportFormatCapability {
  format: ImportFileFormat;
  supported: boolean;
  reason: string | null;
}

export interface FileImportPreview extends SourceSchemaPreview {
  fileName: string;
  format: ImportFileFormat;
  totalRows: number;
  sheetNames: string[];
  capability: ImportFormatCapability;
}

const PREVIEW_LIMIT = 500;
const FORMAT_BY_EXTENSION: Record<string, ImportFileFormat> = {
  csv: "csv",
  tsv: "tsv",
  xlsx: "xlsx",
  xls: "xls",
  ods: "ods",
  json: "json",
  parquet: "parquet",
};

export function detectImportFileFormat(fileName: string): ImportFileFormat {
  const extension = fileName.trim().toLowerCase().split(".").pop() ?? "";
  return FORMAT_BY_EXTENSION[extension] ?? "unknown";
}

export function importFormatCapability(format: ImportFileFormat): ImportFormatCapability {
  if (format === "parquet") {
    return {
      format,
      supported: false,
      reason: "Parquet is not decoded in the browser import path yet. LiOS includes a native DuckDB runtime, but a secure local-file bridge is required before this wizard can claim Parquet support.",
    };
  }
  if (format === "unknown") return { format, supported: false, reason: "Unsupported file type." };
  return { format, supported: true, reason: null };
}

function objectRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const candidate of ["data", "rows", "records", "results", "items"]) {
      if (Array.isArray(record[candidate])) {
        return (record[candidate] as unknown[]).filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
      }
    }
    return [record];
  }
  return [];
}

export function parseJsonImport(text: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("JSON file is not valid JSON.");
  }
  const rows = objectRows(parsed);
  if (!rows.length) throw new Error("JSON did not contain object records. Use an array of objects or a data/rows/records/results/items array.");
  return rows;
}

export function previewRowsForImport(
  fileName: string,
  format: ImportFileFormat,
  rows: Array<Record<string, unknown>>,
  sheetNames: string[] = [],
): FileImportPreview {
  const capability = importFormatCapability(format);
  if (!capability.supported) throw new Error(capability.reason ?? "Unsupported file type.");
  if (!rows.length) throw new Error("No tabular rows were found in the selected file.");
  const schema = profileSourceRecords(rows, { maxRows: PREVIEW_LIMIT, maxSamplesPerField: 3 });
  return {
    ...schema,
    fileName,
    format,
    totalRows: rows.length,
    sheetNames,
    capability,
  };
}

export async function inspectImportFile(file: File): Promise<FileImportPreview> {
  const format = detectImportFileFormat(file.name);
  const capability = importFormatCapability(format);
  if (!capability.supported) throw new Error(capability.reason ?? "Unsupported file type.");

  if (format === "json") {
    const rows = parseJsonImport(await file.text());
    return previewRowsForImport(file.name, format, rows);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    raw: true,
    dense: true,
  });
  const rows = workbook.SheetNames.flatMap(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true }).map(row => ({ ...row, sheet: sheetName }));
  });
  return previewRowsForImport(file.name, format, rows, workbook.SheetNames);
}

export const FILE_IMPORT_PREVIEW_LIMIT = PREVIEW_LIMIT;
