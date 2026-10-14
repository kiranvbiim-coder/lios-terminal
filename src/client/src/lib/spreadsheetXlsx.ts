/**
 * Spreadsheet Studio's .xlsx bridge -- built on the already-bundled SheetJS.
 * Spreadsheet Artifacts keep LiOS/P4 as state authority; SheetJS is used only
 * for file-format import/export.
 */
import * as XLSX from "xlsx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import {
  SPREADSHEET_LINEAGE_APPENDIX_MARKER,
  SPREADSHEET_LINEAGE_APPENDIX_COLUMNS,
  deriveSpreadsheetCellLineageStatus,
} from "@shared/spreadsheetCellLineage";
import { SpreadsheetGrid, colIndexToLetters } from "./spreadsheetEngine";
import { exactExcelNumber } from "@shared/spreadsheetNativeRaw";

type SpreadsheetArtifactContent = Extract<ArtifactContent, { kind: "spreadsheet" }>;


function artifactCellToXlsxCell(raw: string, format: string | null): XLSX.CellObject {
  const trimmed = raw.trim();
  const numeric = format === "@" ? null : exactExcelNumber(raw);
  let cell: XLSX.CellObject;
  if (raw.startsWith("=")) {
    // No cached result exists in P4. SheetJS emits numeric undefined values as
    // errors; its value-less string path emits the formula without a cache/type.
    cell = { t: "s", f: raw.slice(1) };
  } else if (format === "@") {
    cell = { t: "s", v: raw };
  } else if (/^(?:TRUE|FALSE)$/i.test(trimmed)) {
    cell = { t: "b", v: /^TRUE$/i.test(trimmed) };
  } else if (numeric !== null) {
    cell = { t: "n", v: numeric };
  } else {
    cell = { t: "s", v: raw };
  }
  if (format) cell.z = format;
  return cell;
}

function artifactSheetToXlsxWorksheet(sheet: SpreadsheetArtifactContent["sheets"][number]): XLSX.WorkSheet {
  const worksheet: XLSX.WorkSheet = {};
  let maxRow = Math.max(0, sheet.rowCount - 1);
  let maxColumn = Math.max(0, sheet.columnCount - 1);

  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const decoded = XLSX.utils.decode_cell(ref);
    maxRow = Math.max(maxRow, decoded.r);
    maxColumn = Math.max(maxColumn, decoded.c);
    worksheet[ref] = artifactCellToXlsxCell(cell.raw, cell.format);
  }

  worksheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow, c: maxColumn },
  });
  return worksheet;
}

function namedRangeReference(sheetName: string, target: string): string {
  const range = /^(\$?[A-Z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Z]{1,3}\$?[1-9]\d*))?$/i;
  const qualified = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(target);
  const reference = qualified?.[3] ?? target;
  const match = range.exec(reference);
  // P4 can also record named expressions. Do not manufacture a range for them.
  if (!match || (qualified && (qualified[1] ?? qualified[2]).includes("["))) return target;
  const owner = qualified ? (qualified[1]?.replaceAll("''", "'") ?? qualified[2]) : sheetName;
  const cells = [match[1], ...(match[2] ? [match[2]] : [])].map((cell) =>
    cell.replace(/\$?([A-Z]+)\$?(\d+)/i, (_, col: string, row: string) => `$${col.toUpperCase()}$${row}`));
  return `'${owner.replaceAll("'", "''")}'!${cells.join(":")}`;
}

function appendProvenanceSheet(workbook: XLSX.WorkBook, content: SpreadsheetArtifactContent, plan?: ArtifactExportPlan): void {
  const base = "__LiOS Provenance";
  const usedNames = new Set(workbook.SheetNames.map((name) => name.toLowerCase()));
  let name = base;
  for (let suffix = 2; usedNames.has(name.toLowerCase()); suffix++) name = `${base} (${suffix})`;
  const rows: string[][] = plan ? [
    ["LiOS P4 export provenance", "Metadata only; not an analytical sheet"],
    ["P4 Artifact ID", plan.artifactId],
    ["Artifact version", String(plan.version)],
    ["Content SHA-256", plan.contentHash],
    ["Source references", "Recorded in the canonical Artifact export plan"],
    ...plan.sourceRefs.map((ref, index) => [`Source ${index + 1}`, ref]),
  ] : [["LiOS P4 spreadsheet metadata", "Metadata only; not an analytical sheet"]];
  if (content.sheets.some((sheet) => Object.values(sheet.cells).some((cell) => cell.lineage))) {
    rows.push([], [SPREADSHEET_LINEAGE_APPENDIX_MARKER,
      "Historical declarations only on file import; not a verified dataset or run association."],
    [...SPREADSHEET_LINEAGE_APPENDIX_COLUMNS]);
    for (const sheet of content.sheets) for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (!cell.lineage) continue;
      const status = deriveSpreadsheetCellLineageStatus(cell);
      for (const [field, value] of Object.entries({ ...cell.lineage, currentRaw: cell.raw, currentFormat: cell.format })) {
        // Excel limits individual strings to 32,767 characters. JSON preserves
        // exact strings, arrays, nulls and raw formulas without evaluating them.
        const serialized = JSON.stringify(value);
        const chunks: string[] = [];
        for (let start = 0; start < serialized.length;) {
          let end = Math.min(start + 32_000, serialized.length);
          if (end < serialized.length && /[\uD800-\uDBFF]/.test(serialized[end - 1])) end--;
          chunks.push(serialized.slice(start, end));
          start = end;
        }
        for (let part = 0; part < chunks.length; part++) rows.push([
          sheet.id, sheet.name, ref, status, field, String(part + 1), String(chunks.length),
          chunks[part],
        ]);
      }
    }
  }
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 28 }, { wch: 40 }, { wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 8 }, { wch: 8 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

export function artifactSpreadsheetToXlsxWorkbook(content: SpreadsheetArtifactContent, plan?: ArtifactExportPlan): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const names: XLSX.DefinedName[] = [];
  content.sheets.forEach((sheet, index) => {
    XLSX.utils.book_append_sheet(workbook, artifactSheetToXlsxWorksheet(sheet), sheet.name);
    for (const [name, target] of Object.entries(sheet.names)) {
      names.push({ Name: name, Sheet: index, Ref: namedRangeReference(sheet.name, target) });
    }
  });
  workbook.Workbook = { Names: names };
  if (plan || content.sheets.some((sheet) => Object.values(sheet.cells).some((cell) => cell.lineage))) {
    appendProvenanceSheet(workbook, content, plan);
  }
  return workbook;
}

/**
 * The bundled SheetJS writer supports defined names but omits calcPr and
 * arbitrary activeTab (xlsx.mjs/write_wb_xml). Adapt those two OOXML records
 * after serialization instead of assigning unsupported SheetJS options.
 * Formula bodies, caches, styles, and package relationships stay untouched.
 */
export function artifactSpreadsheetToXlsxBytes(content: SpreadsheetArtifactContent, plan?: ArtifactExportPlan): Uint8Array {
  const raw = XLSX.write(artifactSpreadsheetToXlsxWorkbook(content, plan), { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer | Uint8Array;
  const files = unzipSync(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
  const path = "xl/workbook.xml";
  if (!files[path]) throw new Error("SheetJS did not emit XLSX workbook metadata.");
  let xml = strFromU8(files[path]);
  const activeTab = content.sheets.findIndex((sheet) => sheet.id === content.activeSheetId);
  const views = `<bookViews><workbookView activeTab="${activeTab}" firstSheet="0"/></bookViews>`;
  xml = /<bookViews\b/.test(xml)
    ? xml.replace(/<bookViews\b[^>]*>[\s\S]*?<\/bookViews>/, views)
    : xml.replace("<sheets>", `${views}<sheets>`);
  const calc = `<calcPr calcMode="${content.calculationMode === "manual" ? "manual" : "auto"}"/>`;
  xml = /<calcPr\b/.test(xml)
    ? xml.replace(/<calcPr\b[^>]*(?:\/>|>[\s\S]*?<\/calcPr>)/, calc)
    : xml.replace("</workbook>", `${calc}</workbook>`);
  files[path] = strToU8(xml);
  return zipSync(files);
}

export function exportArtifactSpreadsheetToXlsx(content: SpreadsheetArtifactContent, filename: string, plan?: ArtifactExportPlan): void {
  const bytes = artifactSpreadsheetToXlsxBytes(content, plan);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  try {
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function exportGridToXlsx(grid: SpreadsheetGrid, filename: string, sheetName = "Model"): void {
  const ws: XLSX.WorkSheet = {};
  let maxCol = 0;
  let maxRow = 0;

  grid.getAllCells().forEach((cell, ref) => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
    if (!m) return;
    const col = XLSX.utils.decode_col(m[1]);
    const row = parseInt(m[2], 10) - 1;
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);

    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    ws[addr] = artifactCellToXlsxCell(cell.raw, grid.getFormat(ref) ?? null);
  });

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  wb.Workbook = { Names: Array.from(grid.getNames(), ([Name, target]) => ({ Name, Sheet: 0, Ref: namedRangeReference(wb.SheetNames[0], target) })) };
  XLSX.writeFile(wb, filename);
}

/** Loads the first sheet of an uploaded .xlsx into a fresh grid, preserving formulas. */
export async function importXlsxToGrid(file: File): Promise<SpreadsheetGrid> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellFormula: true, sheetStubs: true, cellNF: true });
  const grid = new SpreadsheetGrid();
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet || !sheet["!ref"]) return grid;

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      if (!cell) continue;
      const ref = `${colIndexToLetters(c)}${r + 1}`;
      if (cell.f) {
        grid.setCell(ref, `=${cell.f}`);
      } else if (cell.v !== undefined && cell.v !== null) {
        grid.setCell(ref, String(cell.v));
      }
      if (typeof cell.z === "string" && cell.z) grid.setFormat(ref, cell.z);
    }
  }
  return grid;
}
