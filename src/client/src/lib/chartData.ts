/**
 * Chart & Dashboard Builder -- turns a rectangular range on the sheet into
 * chart-ready data, and a saved ChartConfig into something a model can
 * persist and re-render. Deliberately reads data live off the grid every
 * time (not a frozen snapshot at chart-creation time), so a saved chart
 * stays correct as the model's assumptions change -- the whole point of a
 * chart built INTO a live model instead of pasted as a static image.
 *
 * Range convention: the top row of the range is a header (column A's
 * header cell is ignored; columns B onward name a data series), and column
 * A of every row below that is the category label for that row -- exactly
 * how every template built this session already lays out its tables
 * (a header row, a label column, data columns), so charting a template's
 * own output needs no special preparation.
 */
import { type SpreadsheetGrid, parseCellRef, cellRefToString } from "./spreadsheetEngine";

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartDataResult {
  categories: string[];
  series: ChartSeries[];
}

export type ChartType = "bar" | "line" | "pie";

export interface ChartConfig {
  id: string;
  title: string;
  type: ChartType;
  rangeRef: string; // e.g. "A3:E7"
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Parses "A3:E7" into inclusive 0-based {col,row} bounds. Throws a descriptive error for anything else, since a malformed range is a user-input mistake worth surfacing, not silently ignoring. */
export function parseRange(rangeRef: string): { startCol: number; startRow: number; endCol: number; endRow: number } {
  const [startRef, endRef] = rangeRef.trim().toUpperCase().split(":");
  const start = startRef ? parseCellRef(startRef) : null;
  const end = endRef ? parseCellRef(endRef) : null;
  if (!start || !end) throw new Error(`"${rangeRef}" isn't a valid range -- use the form A3:E7.`);
  return {
    startCol: Math.min(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endCol: Math.max(start.col, end.col),
    endRow: Math.max(start.row, end.row),
  };
}

export function extractChartData(grid: SpreadsheetGrid, rangeRef: string): ChartDataResult {
  const { startCol, startRow, endCol, endRow } = parseRange(rangeRef);
  if (endCol <= startCol) throw new Error("A chart range needs at least one label column and one data column (e.g. A3:E7).");
  if (endRow <= startRow) throw new Error("A chart range needs a header row and at least one data row (e.g. A3:E7).");

  // A blank header cell is treated as a spacer column, not a data series --
  // financial-model tables routinely leave a narrow blank column between a
  // label and its data (every template built this session does), and
  // charting the table's natural visible range shouldn't produce a bogus
  // all-zero series for it.
  const seriesCols: number[] = [];
  const seriesNames: string[] = [];
  for (let c = startCol + 1; c <= endCol; c++) {
    const cell = grid.getCell(cellRefToString(c, startRow));
    if (cell.value === null || cell.value === "") continue;
    seriesCols.push(c);
    seriesNames.push(String(cell.value));
  }
  if (seriesNames.length === 0) throw new Error("No column in this range has a header value to name a data series.");

  const categories: string[] = [];
  const series: ChartSeries[] = seriesNames.map((name) => ({ name, values: [] }));

  for (let r = startRow + 1; r <= endRow; r++) {
    const labelCell = grid.getCell(cellRefToString(startCol, r));
    categories.push(labelCell.value !== null && labelCell.value !== "" ? String(labelCell.value) : `Row ${r + 1}`);
    for (let i = 0; i < seriesCols.length; i++) {
      const cell = grid.getCell(cellRefToString(seriesCols[i], r));
      series[i].values.push(toNumber(cell.value));
    }
  }

  return { categories, series };
}

/** Reshapes ChartDataResult into recharts' preferred [{name, seriesA, seriesB, ...}] row format. */
export function toRechartsRows(data: ChartDataResult): Record<string, string | number>[] {
  return data.categories.map((category, i) => {
    const row: Record<string, string | number> = { name: category };
    for (const s of data.series) row[s.name] = s.values[i];
    return row;
  });
}
