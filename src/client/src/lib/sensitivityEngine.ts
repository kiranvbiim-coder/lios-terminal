/**
 * Sensitivity / Data Table engine -- Excel's What-If Data Table, built on
 * top of the existing SpreadsheetGrid rather than as a parallel calculation
 * path: an input cell is temporarily overwritten with each trial value
 * (setCell already cascades recalculation to every dependent, including
 * cells that reach the input only through a named range -- named ranges
 * splice their target's cell reference into the formula AT PARSE TIME, so
 * dependency tracking already resolves through them with no special-casing
 * needed here), the output cell's resulting value is captured, and the
 * input is restored to its original content once every trial has run. This
 * deliberately varies the underlying CELL a name points to, not the name
 * binding itself -- simpler, and correct for both name-bound-to-a-literal
 * and name-bound-to-a-cell-reference assumptions alike.
 *
 * Runs synchronously against the live grid. Callers doing this against a
 * grid the user is actively viewing should snapshot/restore around the
 * call (see SpreadsheetStudioPanel's snapshotGrid/restoreSnapshot) if they
 * want the UI to never flicker through intermediate trial values -- this
 * module itself guarantees only that the grid's cell CONTENT is restored,
 * not that no recalculation was ever visible while it ran.
 */
import type { SpreadsheetGrid } from "./spreadsheetEngine";

export interface SensitivityCell {
  value: number | string | null;
  error: string | null;
}

export interface OneWaySensitivityResult {
  inputValues: number[];
  outputs: SensitivityCell[];
}

export interface TwoWaySensitivityResult {
  rowValues: number[];
  colValues: number[];
  outputs: SensitivityCell[][]; // outputs[rowIndex][colIndex]
}

function readOutput(grid: SpreadsheetGrid, outputRef: string): SensitivityCell {
  const cell = grid.getCell(outputRef);
  return { value: cell.value, error: cell.error };
}

/** Generates an evenly-spaced input series -- the common "min, max, steps" data-table setup. */
export function buildInputRange(min: number, max: number, steps: number): number[] {
  if (steps <= 1) return [min];
  const values: number[] = [];
  for (let i = 0; i < steps; i++) values.push(min + ((max - min) * i) / (steps - 1));
  return values;
}

export function runOneWaySensitivity(
  grid: SpreadsheetGrid,
  inputRef: string,
  inputValues: number[],
  outputRef: string,
): OneWaySensitivityResult {
  const original = grid.getCell(inputRef).raw;
  const outputs: SensitivityCell[] = [];
  try {
    for (const v of inputValues) {
      grid.setCell(inputRef, String(v));
      outputs.push(readOutput(grid, outputRef));
    }
  } finally {
    grid.setCell(inputRef, original);
  }
  return { inputValues, outputs };
}

export function runTwoWaySensitivity(
  grid: SpreadsheetGrid,
  rowInputRef: string,
  rowValues: number[],
  colInputRef: string,
  colValues: number[],
  outputRef: string,
): TwoWaySensitivityResult {
  const originalRow = grid.getCell(rowInputRef).raw;
  const originalCol = grid.getCell(colInputRef).raw;
  const outputs: SensitivityCell[][] = [];
  try {
    for (const rv of rowValues) {
      grid.setCell(rowInputRef, String(rv));
      const rowOutputs: SensitivityCell[] = [];
      for (const cv of colValues) {
        grid.setCell(colInputRef, String(cv));
        rowOutputs.push(readOutput(grid, outputRef));
      }
      outputs.push(rowOutputs);
    }
  } finally {
    grid.setCell(rowInputRef, originalRow);
    grid.setCell(colInputRef, originalCol);
  }
  return { rowValues, colValues, outputs };
}

export interface TornadoInput {
  ref: string;
  label: string;
  lowValue: number;
  highValue: number;
}

export interface TornadoResult {
  label: string;
  ref: string;
  low: SensitivityCell;
  high: SensitivityCell;
  swing: number; // |high - low|, as a number -- NaN if either side errored (sorted last)
}

/**
 * Tornado sensitivity: for each input, holds every OTHER input at its
 * current sheet value and swings just this one between its low/high case,
 * ranked by swing magnitude (the standard "which assumption matters most"
 * view). Restores every input's original content when done, regardless of
 * how many inputs were tested or whether any of them errored.
 */
export function runTornadoSensitivity(
  grid: SpreadsheetGrid,
  inputs: TornadoInput[],
  outputRef: string,
): TornadoResult[] {
  const originals = inputs.map((inp) => grid.getCell(inp.ref).raw);
  const results: TornadoResult[] = [];
  try {
    for (const inp of inputs) {
      grid.setCell(inp.ref, String(inp.lowValue));
      const low = readOutput(grid, outputRef);
      grid.setCell(inp.ref, String(inp.highValue));
      const high = readOutput(grid, outputRef);
      const swing = typeof low.value === "number" && typeof high.value === "number" && !low.error && !high.error
        ? Math.abs(high.value - low.value)
        : NaN;
      results.push({ label: inp.label, ref: inp.ref, low, high, swing });
    }
  } finally {
    inputs.forEach((inp, i) => grid.setCell(inp.ref, originals[i]));
  }
  return results.sort((a, b) => {
    if (Number.isNaN(a.swing)) return 1;
    if (Number.isNaN(b.swing)) return -1;
    return b.swing - a.swing;
  });
}
