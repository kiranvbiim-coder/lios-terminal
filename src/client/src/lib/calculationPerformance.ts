/**
 * Calculation Performance Analyzer -- answers the practical question a
 * large model eventually raises: "if I edit this cell, how expensive is
 * the recalculation that follows." Measured as pure black-box timing
 * through the engine's own public API (SpreadsheetGrid.setCell), not by
 * instrumenting spreadsheetEngine.ts internals -- the engine is small,
 * heavily tested, and doesn't need a profiling seam cut into it just for
 * this.
 *
 * Two numbers, both real wall-clock measurements: a cold full-rebuild cost
 * (replaying every cell into a fresh grid, the "how long does this model
 * take to load" number) and a per-cell edit-cascade cost (re-setting each
 * formula cell to its OWN current value on the live grid and timing that
 * single call, which captures the full recalculateFrom cascade it
 * triggers) -- ranked to surface which cells are the expensive ones to
 * touch, not just which formula looks complicated.
 */
import { SpreadsheetGrid, isFormulaCell } from "./spreadsheetEngine";

export interface CellTiming {
  ref: string;
  ms: number;
}

export interface PerformanceReport {
  totalCells: number;
  formulaCells: number;
  fullRebuildMs: number;
  totalCascadeMs: number;
  averageCascadeMs: number;
  slowestEdits: CellTiming[]; // sorted descending, capped at topN
}

export function analyzeCalculationPerformance(grid: SpreadsheetGrid, topN = 10): PerformanceReport {
  const cells = grid.getAllCells();
  const totalCells = cells.size;

  const formulaRefs: string[] = [];
  cells.forEach((cell, ref) => { if (isFormulaCell(cell.raw)) formulaRefs.push(ref); });

  const names = grid.getNames();
  const rebuildStart = performance.now();
  const fresh = new SpreadsheetGrid();
  names.forEach((target, name) => fresh.defineName(name, target));
  cells.forEach((cell, ref) => fresh.setCell(ref, cell.raw));
  const fullRebuildMs = performance.now() - rebuildStart;

  const timings: CellTiming[] = [];
  for (const ref of formulaRefs) {
    const raw = grid.getCell(ref).raw;
    const t0 = performance.now();
    grid.setCell(ref, raw);
    timings.push({ ref, ms: performance.now() - t0 });
  }
  timings.sort((a, b) => b.ms - a.ms);
  const totalCascadeMs = timings.reduce((sum, t) => sum + t.ms, 0);

  return {
    totalCells,
    formulaCells: formulaRefs.length,
    fullRebuildMs,
    totalCascadeMs,
    averageCascadeMs: timings.length ? totalCascadeMs / timings.length : 0,
    slowestEdits: timings.slice(0, topN),
  };
}
