/**
 * Model Health Score -- rolls the sheet-wide signals a careful reviewer
 * checks for by hand (error cells, a hardcoded number sitting in an
 * otherwise-formula row, named ranges nobody's formula actually uses) into
 * one composite number, so "is this model in good shape" has a single
 * answer instead of requiring someone to scan every row. Every deduction
 * traces back to a concrete, clickable finding -- this is deliberately not
 * a black-box score with no explanation attached.
 */
import type { SpreadsheetGrid } from "./spreadsheetEngine";
import { isFormulaCell, parseCellRef } from "./spreadsheetEngine";

export interface HardcodedFinding {
  ref: string;
  row: number;
  value: string;
}

export interface ModelHealthReport {
  score: number;   // 0-100
  label: "Excellent" | "Good" | "Needs Attention" | "Critical";
  totalCells: number;
  formulaCells: number;
  errorCount: number;
  errorBreakdown: Record<string, number>; // error string -> count, e.g. "#DIV/0!": 2
  hardcodedInFormulaRows: HardcodedFinding[];
  orphanedNames: string[]; // defined but referenced by no formula on the sheet
  findings: string[]; // human-readable, one line per issue category that actually fired
}

/** The visible, 1-based row number (parseCellRef's own `row` is 0-based, an internal indexing convention that would misreport "row 4" for a finding on row 5 if surfaced as-is). */
function rowOf(ref: string): number {
  const parsed = parseCellRef(ref);
  return parsed ? parsed.row + 1 : -1;
}

/** A row "reads as a formula row" once it has at least 2 formula cells -- below that, a lone literal isn't a pattern break, it's just data. */
const MIN_FORMULA_CELLS_TO_ESTABLISH_ROW_PATTERN = 2;

export function computeModelHealthScore(grid: SpreadsheetGrid): ModelHealthReport {
  const cells = grid.getAllCells();
  const totalCells = cells.size;

  let formulaCells = 0;
  const rowFormulaCount = new Map<number, number>();
  const rowLiteralCells = new Map<number, { ref: string; raw: string }[]>();

  cells.forEach((cell, ref) => {
    if (isFormulaCell(cell.raw)) {
      formulaCells++;
      const r = rowOf(ref);
      rowFormulaCount.set(r, (rowFormulaCount.get(r) ?? 0) + 1);
    } else {
      const n = Number(cell.raw);
      if (cell.raw !== "" && !Number.isNaN(n)) {
        const r = rowOf(ref);
        const list = rowLiteralCells.get(r) ?? [];
        list.push({ ref, raw: cell.raw });
        rowLiteralCells.set(r, list);
      }
    }
  });

  const hardcodedInFormulaRows: HardcodedFinding[] = [];
  rowLiteralCells.forEach((literals, row) => {
    if ((rowFormulaCount.get(row) ?? 0) >= MIN_FORMULA_CELLS_TO_ESTABLISH_ROW_PATTERN) {
      for (const { ref, raw } of literals) hardcodedInFormulaRows.push({ ref, row, value: raw });
    }
  });

  const errorCells = grid.getErrorCells();
  const errorBreakdown: Record<string, number> = {};
  for (const { error } of errorCells) errorBreakdown[error] = (errorBreakdown[error] ?? 0) + 1;

  const names = grid.getNames();
  const orphanedNames: string[] = [];
  names.forEach((_target, name) => {
    const re = new RegExp(`\\b${name}\\b`, "i");
    let used = false;
    cells.forEach((cell) => { if (!used && isFormulaCell(cell.raw) && re.test(cell.raw)) used = true; });
    if (!used) orphanedNames.push(name);
  });

  let score = 100;
  score -= Math.min(60, errorCells.length * 8);
  score -= Math.min(20, hardcodedInFormulaRows.length * 2);
  score -= Math.min(10, orphanedNames.length * 2);
  score = Math.max(0, Math.min(100, score));

  const label: ModelHealthReport["label"] =
    score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 50 ? "Needs Attention" : "Critical";

  const findings: string[] = [];
  if (errorCells.length > 0) findings.push(`${errorCells.length} cell${errorCells.length === 1 ? "" : "s"} showing an error (${Object.entries(errorBreakdown).map(([e, c]) => `${c}x ${e}`).join(", ")}).`);
  if (hardcodedInFormulaRows.length > 0) findings.push(`${hardcodedInFormulaRows.length} hardcoded number${hardcodedInFormulaRows.length === 1 ? "" : "s"} sitting in an otherwise-formula row -- a common source of "someone typed over the formula" bugs.`);
  if (orphanedNames.length > 0) findings.push(`${orphanedNames.length} named range${orphanedNames.length === 1 ? "" : "s"} defined but not used in any formula on this sheet.`);
  if (findings.length === 0) findings.push("No issues found -- every formula resolved cleanly, no stray hardcodes in formula rows, and every named range is in use.");

  return { score, label, totalCells, formulaCells, errorCount: errorCells.length, errorBreakdown, hardcodedInFormulaRows, orphanedNames, findings };
}
