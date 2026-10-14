/**
 * Component Marketplace -- publishing/inserting a cell fragment, built on
 * the SAME relative-reference translation fillFormula/copy-paste already
 * use (translateFormula), not a new formula-shifting mechanism. A
 * published component is a range normalized so its top-left cell becomes
 * A1 (extractFragment); inserting it re-shifts every formula from that
 * A1-relative form out to wherever the user's cursor is (insertFragment).
 * The two are exact inverses of the same translation, which is what makes
 * "publish once, anyone can drop it in anywhere" correct instead of
 * accidentally rewriting someone else's formulas.
 */
import { type SpreadsheetGrid, parseCellRef, cellRefToString, translateFormula } from "./spreadsheetEngine";

export function extractFragment(grid: SpreadsheetGrid, minCol: number, minRow: number, maxCol: number, maxRow: number): Record<string, string> {
  const fragment: Record<string, string> = {};
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const cell = grid.getCell(cellRefToString(c, r));
      if (cell.raw === "") continue;
      const targetRef = cellRefToString(c - minCol, r - minRow);
      fragment[targetRef] = translateFormula(cell.raw, -minCol, -minRow);
    }
  }
  return fragment;
}

export function insertFragment(fragment: Record<string, string>, anchorCol: number, anchorRow: number): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const [ref, raw] of Object.entries(fragment)) {
    const parsed = parseCellRef(ref);
    if (!parsed) continue;
    const targetRef = cellRefToString(parsed.col + anchorCol, parsed.row + anchorRow);
    cells[targetRef] = translateFormula(raw, anchorCol, anchorRow);
  }
  return cells;
}
