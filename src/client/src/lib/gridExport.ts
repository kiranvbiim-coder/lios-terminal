/**
 * Output Studio -- the presentation-ready counterpart to the raw .xlsx
 * export every Spreadsheet Studio model already has. gridToExportSheet
 * converts a live grid into the same ExportSheet[] shape every other panel
 * already builds for exportXlsx.ts/exportPdf.ts, so a Spreadsheet Studio
 * model gets a clean, titled, paginated PDF for free from the PDF exporter
 * that already exists (jspdf + jspdf-autotable) -- no new export mechanism,
 * just a new source feeding the one every panel already shares.
 *
 * Deliberately renders the sheet AS a spreadsheet (column letters across
 * the top, row numbers down the left) rather than trying to auto-detect
 * "sections" and re-title them -- a model's visual structure (blank rows,
 * bolded section labels) is information a human reading the PDF can use
 * directly, and guessing at semantic section boundaries would be more
 * likely to mislabel a table than to help.
 */
import { type SpreadsheetGrid, parseCellRef, cellRefToString, colIndexToLetters, formatNumberPattern } from "./spreadsheetEngine";
import type { ExportSheet } from "./exportXlsx";

export function gridToExportSheet(grid: SpreadsheetGrid, sheetName: string): ExportSheet {
  let maxRow = -1;
  let maxCol = -1;
  grid.getAllCells().forEach((cell, ref) => {
    if (cell.raw === "") return;
    const parsed = parseCellRef(ref);
    if (!parsed) return;
    maxRow = Math.max(maxRow, parsed.row);
    maxCol = Math.max(maxCol, parsed.col);
  });

  if (maxRow < 0 || maxCol < 0) {
    return { name: sheetName.slice(0, 31), rows: [[""]] };
  }

  const header: (string | number)[] = ["", ...Array.from({ length: maxCol + 1 }, (_, c) => colIndexToLetters(c))];
  const rows: (string | number)[][] = [header];

  for (let r = 0; r <= maxRow; r++) {
    const row: (string | number)[] = [String(r + 1)];
    for (let c = 0; c <= maxCol; c++) {
      const ref = cellRefToString(c, r);
      const cell = grid.getCell(ref);
      if (cell.error) {
        row.push(cell.error);
        continue;
      }
      if (cell.value === null) {
        row.push("");
        continue;
      }
      if (typeof cell.value === "number") {
        const format = grid.getFormat(ref);
        row.push(format ? formatNumberPattern(cell.value, format) : cell.value);
      } else {
        row.push(cell.value);
      }
    }
    rows.push(row);
  }

  return { name: sheetName.slice(0, 31), rows };
}
