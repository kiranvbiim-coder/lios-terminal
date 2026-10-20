// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { formatReadableNumber, heatBackground, heatIntensity, type ReadableFormatOptions } from "@/lib/artifactReadableFormat";
import { ReadableCell } from "./ReadableValueTable";

export interface SensitivityGridData {
  rowValues: number[];
  columnValues: number[];
  /** matrix[row][column] */
  matrix: number[][];
}

/** Returns a typed grid only when the recorded sensitivity has consistent numeric axes and cells. */
export function parseSensitivityGrid(value: unknown): (SensitivityGridData & { rowKey: string; columnKey: string; valueKey: string }) | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const matrixKey = Object.keys(record).find(key => /Matrix$/.test(key));
  if (!matrixKey) return null;
  const axes = Object.keys(record).filter(key => key !== matrixKey && Array.isArray(record[key]));
  if (axes.length !== 2) return null;
  // The engine's matrix is indexed [WACC][terminal growth]; keep that orientation even if axis keys were reordered.
  const [rowKey, columnKey] = axes.includes("waccPct") && axes[0] !== "waccPct" ? [axes[1], axes[0]] : axes;
  const rowValues = record[rowKey] as unknown[];
  const columnValues = record[columnKey] as unknown[];
  const matrix = record[matrixKey] as unknown[];
  const finite = (item: unknown): item is number => typeof item === "number" && Number.isFinite(item);
  if (!rowValues.length || !columnValues.length || !rowValues.every(finite) || !columnValues.every(finite)) return null;
  if (matrix.length !== rowValues.length) return null;
  const rows: number[][] = [];
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== columnValues.length || !row.every(finite)) return null;
    rows.push(row);
  }
  return { rowValues, columnValues, matrix: rows, rowKey, columnKey, valueKey: matrixKey.replace(/Matrix$/, "") };
}

/** Readable sensitivity table with heat shading. Shading is redundant with the printed numbers. */
export function SensitivityGridTable({ title, grid, rowLabel, columnLabel, valueLabel, rowKey, columnKey, valueKey, base, options = {} }: {
  title: string; grid: SensitivityGridData; rowLabel: string; columnLabel: string; valueLabel: string;
  rowKey: string; columnKey: string; valueKey: string;
  /** Matching row/column input of the base case so it can be marked. */
  base?: { row: number | null; column: number | null };
  options?: ReadableFormatOptions;
}) {
  const flat = grid.matrix.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const axis = (key: string, value: number) => formatReadableNumber(key, value, options);
  return <section aria-label={title} className="rounded-lg border border-border/50 p-3">
    <h3 className="mb-1 font-ui text-[14px] font-semibold">{title}</h3>
    <p className="mb-2 font-ui text-[12px] text-muted-foreground">
      {valueLabel} for each {rowLabel} (rows) and {columnLabel} (columns) combination. Darker shading means a higher value; every number is printed.
      {base && base.row !== null && base.column !== null ? " ◆ marks the base case." : ""}
    </p>
    <div className="overflow-x-auto" tabIndex={0} aria-label={`${title} table`}>
      <table className="w-full border-collapse text-right font-ui text-[13px]">
        <caption className="sr-only">{title}: {valueLabel} by {rowLabel} and {columnLabel}</caption>
        <thead><tr>
          <th scope="col" className="border-b border-border p-2 text-left font-semibold">{rowLabel} ↓ / {columnLabel} →</th>
          {grid.columnValues.map((column, index) => { const f = axis(columnKey, column); return <th key={index} scope="col" className="border-b border-border p-2 font-semibold"><ReadableCell text={f.text} exact={f.exact} /></th>; })}
        </tr></thead>
        <tbody>{grid.matrix.map((row, rowIndex) => <tr key={rowIndex}>
          <th scope="row" className="border-b border-border/30 p-2 text-left font-semibold"><ReadableCell {...axis(rowKey, grid.rowValues[rowIndex])} align="left" /></th>
          {row.map((cell, columnIndex) => {
            const f = formatReadableNumber(valueKey, cell, { ...options, bare: true });
            const isBase = base?.row === rowIndex && base?.column === columnIndex;
            return <td key={columnIndex} data-base-case={isBase ? "true" : undefined} data-heat={heatIntensity(cell, min, max).toFixed(3)}
              style={{ backgroundColor: heatBackground(heatIntensity(cell, min, max)) }}
              className={`border-b border-border/30 p-2 ${isBase ? "font-semibold outline outline-1 outline-amber-300" : ""}`}>
              {isBase && <span aria-label="Base case" className="mr-1 text-amber-200">◆</span>}<ReadableCell text={f.text} exact={f.exact} />
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <div aria-hidden="true" className="mt-2 flex items-center gap-2 font-ui text-[12px] text-muted-foreground">
      <span>Lower</span><span className="h-2 w-24 rounded" style={{ background: `linear-gradient(90deg, ${heatBackground(0)}, ${heatBackground(1)})` }} /><span>Higher</span>
    </div>
  </section>;
}
