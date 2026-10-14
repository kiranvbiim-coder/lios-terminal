import * as XLSX from "xlsx";
import { strToU8, unzipSync, zipSync } from "fflate";
import { registerLocalExportCustody } from "./exportCustody";

export type ExportCellRole = "header" | "label" | "input" | "formula" | "output" | "source";
export type ExportNumberFormat = "general" | "integer" | "number" | "percent" | "currency";

export interface ExportCell {
  value: string | number;
  formula?: string;
  role: ExportCellRole;
  numberFormat?: ExportNumberFormat;
}

export type ExportCellValue = string | number | ExportCell;

export function inputCell(
  value: string | number,
  numberFormat: ExportNumberFormat = "general",
): ExportCell {
  return { value, role: "input", numberFormat };
}

export function formulaCell(
  formula: string,
  value: number,
  numberFormat: ExportNumberFormat = "general",
  role: "formula" | "output" = "formula",
): ExportCell {
  return { value, formula, role, numberFormat };
}

export function outputCell(
  formula: string,
  value: number,
  numberFormat: ExportNumberFormat = "general",
): ExportCell {
  return formulaCell(formula, value, numberFormat, "output");
}

export interface ExportSheet {
  name: string;
  rows: ExportCellValue[][];
}

export interface ExportContext {
  model?: string;
  scenario?: string;
  assumptions?: Record<string, string | number | boolean | null>;
  provenance?: string[];
  modelHash?: string;
  generatedAt?: string;
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
}

export type ExportResult =
  | { ok: true; filename: string; sheetNames: string[] }
  | { ok: false; filename: string; error: string };

const EXCEL_SHEET_NAME_LIMIT = 31;
const METADATA_SHEET_NAME = "__Export Metadata";

type LayoutNote = {
  name: string;
  rowsTruncated: number;
  columnsTruncated: number;
};

/**
 * Produces stable, Excel-safe names without mutating caller-owned sheets.
 * Duplicate names are suffixed in encounter order, case-insensitively.
 */
export function normalizeExportSheets(sheets: ExportSheet[]): ExportSheet[] {
  const usedNames = new Set<string>();

  return sheets.map((sheet) => {
    const baseName = sheet.name.trim().slice(0, EXCEL_SHEET_NAME_LIMIT) || "Sheet";
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      const suffixText = ` (${suffix})`;
      name = `${baseName.slice(0, EXCEL_SHEET_NAME_LIMIT - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    usedNames.add(name.toLowerCase());
    return { name, rows: sheet.rows.map((row) => [...row]) };
  });
}

export function buildExportMetadataRows(context: ExportContext): ExportCellValue[][] {
  const rows: ExportCellValue[][] = [["Key", "Value"]];
  const add = (key: string, value: string | number | boolean | null | undefined) => {
    if (value === undefined || value === null || value === "") return;
    rows.push([key, String(value)]);
  };

  add("Model", context.model);
  add("Scenario", context.scenario);
  add("Model Hash", context.modelHash);
  add("Generated At", context.generatedAt);

  for (const key of Object.keys(context.assumptions ?? {}).sort()) {
    add(`Assumption: ${key}`, context.assumptions?.[key]);
  }
  if (context.provenance && context.provenance.length > 0) {
    add("Provenance", context.provenance.join("; "));
  }
  return rows;
}

function validateLimit(value: number | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) return `${label} must be a positive integer`;
  return undefined;
}

function applyLayoutBounds(sheets: ExportSheet[], context: ExportContext): {
  sheets: ExportSheet[];
  notes: LayoutNote[];
} {
  const maxRows = context.maxRowsPerSheet;
  const maxColumns = context.maxColumnsPerSheet;
  const notes: LayoutNote[] = [];
  const boundedSheets = sheets.map((sheet) => {
    const headerAndRows = maxRows === undefined ? sheet.rows : sheet.rows.slice(0, maxRows);
    const rowsTruncated = Math.max(0, sheet.rows.length - headerAndRows.length);
    const boundedRows = maxColumns === undefined
      ? headerAndRows.map((row) => [...row])
      : headerAndRows.map((row) => row.slice(0, maxColumns));
    const columnsTruncated = maxColumns === undefined
      ? 0
      : headerAndRows.reduce((count, row) => Math.max(count, row.length - maxColumns), 0);
    notes.push({ name: sheet.name, rowsTruncated, columnsTruncated });
    return { name: sheet.name, rows: boundedRows };
  });
  return { sheets: boundedSheets, notes };
}
export function prepareExportSheets(
  sheets: ExportSheet[],
  context: ExportContext = {},
): { sheets: ExportSheet[]; notes: LayoutNote[] } {
  const limitError = [
    validateLimit(context.maxRowsPerSheet, "maxRowsPerSheet"),
    validateLimit(context.maxColumnsPerSheet, "maxColumnsPerSheet"),
  ].find(Boolean);
  if (limitError) throw new Error(limitError);
  return applyLayoutBounds(normalizeExportSheets(sheets), context);
}

function buildMetadataSheet(context: ExportContext, notes: LayoutNote[]): ExportSheet {
  const rows = buildExportMetadataRows(context);
  rows.push(["Layout", "Rows/columns are bounded only when explicit limits were supplied."]);
  for (const note of notes) {
    if (note.rowsTruncated > 0 || note.columnsTruncated > 0) {
      rows.push([`Truncated: ${note.name}`, `rows=${note.rowsTruncated}; columns=${note.columnsTruncated}`]);
    }
  }
  return { name: METADATA_SHEET_NAME, rows };
}

const STYLE_BY_ROLE: Record<ExportCellRole, number> = {
  header: 1,
  label: 2,
  input: 3,
  formula: 4,
  output: 5,
  source: 6,
};

const NUMBER_FORMAT_OFFSET: Record<ExportNumberFormat, number> = {
  general: 0,
  integer: 0,
  number: 1,
  percent: 2,
  currency: 3,
};

function isExportCell(value: ExportCellValue | undefined): value is ExportCell {
  return typeof value === "object" && value !== null && "role" in value;
}

function styleIndex(cell: ExportCell): number {
  const base = STYLE_BY_ROLE[cell.role];
  if (
    !cell.numberFormat
    || cell.numberFormat === "general"
    || cell.role === "header"
    || cell.role === "label"
    || cell.role === "source"
  ) {
    return base;
  }
  const numericRoleOffset = cell.role === "input" ? 0 : cell.role === "formula" ? 1 : 2;
  return 7 + NUMBER_FORMAT_OFFSET[cell.numberFormat] * 3 + numericRoleOffset;
}

function toSheetValue(value: ExportCellValue): string | number {
  return isExportCell(value) ? value.value : value;
}

const WORKBOOK_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="164" formatCode="0"/>
    <numFmt numFmtId="165" formatCode="#,##0.00"/>
    <numFmt numFmtId="166" formatCode="0.0%"/>
    <numFmt numFmtId="167" formatCode="$#,##0.00;[Red]-$#,##0.00"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><color rgb="FF0000FF"/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FF000000"/><sz val="10"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="19">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    ${["164", "165", "166", "167"].flatMap((numFmtId) => [
      `<xf numFmtId="${numFmtId}" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>`,
      `<xf numFmtId="${numFmtId}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>`,
      `<xf numFmtId="${numFmtId}" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>`,
    ]).join("\n    ")}
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleMedium9"/>
</styleSheet>`;

function applyWorkbookPresentation(
  workbookBytes: Uint8Array,
  sheets: ExportSheet[],
): Uint8Array {
  const files = unzipSync(workbookBytes);
  files["xl/styles.xml"] = strToU8(WORKBOOK_STYLES_XML);

  sheets.forEach((sheet, sheetIndex) => {
    const path = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    const current = files[path];
    if (!current) return;
    let xml = new TextDecoder().decode(current);
    sheet.rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        const roleCell = isExportCell(cell)
          ? cell
          : rowIndex === 0
            ? ({ value: cell, role: "header" } as ExportCell)
            : columnIndex === 0
              ? ({ value: cell, role: "label" } as ExportCell)
              : null;
        if (!roleCell) return;
        const ref = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        xml = xml.replace(
          new RegExp(`<c r="${ref}"(?: s="\\d+")?`),
          `<c r="${ref}" s="${styleIndex(roleCell)}"`,
        );
      });
    });
    files[path] = strToU8(xml);
  });

  return zipSync(files, { level: 6 });
}

export function buildWorkbookBytes(
  sheets: ExportSheet[],
  context?: ExportContext,
): Uint8Array {
  const bounded = prepareExportSheets(sheets, context ?? {});
  const outputSheets = context
    ? normalizeExportSheets([buildMetadataSheet(context, bounded.notes), ...bounded.sheets])
    : bounded.sheets;
  if (outputSheets.length === 0) {
    throw new Error("Workbook requires at least one worksheet.");
  }

  const workbook = XLSX.utils.book_new();
  for (const sheet of outputSheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows.map((row) => row.map(toSheetValue)));
    sheet.rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (!isExportCell(cell) || !cell.formula) return;
        const ref = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        worksheet[ref] = { f: cell.formula, v: cell.value, t: "n" };
      });
    });
    const columnCount = Math.max(1, ...sheet.rows.map((row) => row.length));
    worksheet["!cols"] = Array.from({ length: columnCount }, (_, columnIndex) => ({
      wch: Math.min(
        42,
        Math.max(
          12,
          ...sheet.rows.map((row) => {
            const cell = row[columnIndex];
            return String(isExportCell(cell) ? cell.value : (cell ?? "")).length + 2;
          }),
        ),
      ),
    }));
    if (sheet.rows.length > 1 && columnCount > 1) {
      worksheet["!autofilter"] = {
        ref: `A1:${XLSX.utils.encode_col(columnCount - 1)}${sheet.rows.length}`,
      };
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  const rawBytes = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
    compression: true,
    cellStyles: true,
  }) as ArrayBuffer | Uint8Array;
  const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  return applyWorkbookPresentation(bytes, outputSheets);
}

// Builds a multi-sheet .xlsx workbook from plain array-of-arrays data (one
// array per sheet, first row treated as a header) and triggers a browser
// download. Context-aware calls add a deterministic metadata sheet.
export function exportWorkbook(
  filename: string,
  sheets: ExportSheet[],
  context?: ExportContext,
): ExportResult {
  if (!filename.trim()) return { ok: false, filename, error: "A filename is required" };
  if (sheets.length === 0) return { ok: false, filename, error: "At least one sheet is required" };
  if (!sheets.every((sheet) => sheet.name.trim())) {
    return { ok: false, filename, error: "Every sheet must have a name" };
  }
  for (const [value, label] of [
    [context?.maxRowsPerSheet, "maxRowsPerSheet"],
    [context?.maxColumnsPerSheet, "maxColumnsPerSheet"],
  ] as const) {
    const error = validateLimit(value, label);
    if (error) return { ok: false, filename, error };
  }

  try {
    const bytes = buildWorkbookBytes(sheets, context);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    void registerLocalExportCustody({ filename, format: "xlsx", bytes });
    const bounded = applyLayoutBounds(normalizeExportSheets(sheets), context ?? {});
    const outputSheets = context
      ? normalizeExportSheets([buildMetadataSheet(context, bounded.notes), ...bounded.sheets])
      : bounded.sheets;
    return { ok: true, filename, sheetNames: outputSheets.map((sheet) => sheet.name) };
  } catch (error) {
    return {
      ok: false,
      filename,
      error: error instanceof Error ? error.message : "Unable to deliver workbook",
    };
  }
}
