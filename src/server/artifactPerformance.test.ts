import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { applySpreadsheetDiffs, compareArtifactContents } from "./artifactDiff";
import { toEChartsOptionProjection, toPerspectiveProjection, toUniverWorkbookProjection } from "@shared/artifactBridges";
import type { ArtifactContent, SpreadsheetCellDiff } from "@shared/artifactContracts";

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const rem = (value - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function largeSpreadsheet(cellCount = 10_000): Extract<ArtifactContent, { kind: "spreadsheet" }> {
  const cells: Record<string, { raw: string; format: string | null }> = {};
  const cols = 100;
  for (let i = 0; i < cellCount; i++) {
    const row = Math.floor(i / cols) + 1;
    const col = i % cols;
    cells[`${columnName(col)}${row}`] = { raw: String(i), format: null };
  }
  return {
    kind: "spreadsheet",
    sheets: [{ id: "sheet-1", name: "Model", cells, names: {}, rowCount: Math.ceil(cellCount / cols), columnCount: cols }],
    activeSheetId: "sheet-1",
    rendererPreference: "builtin",
    calculationMode: "automatic",
  };
}

test("P4 10k-cell spreadsheet diff/apply stays within bounded desktop interaction budget", () => {
  const left = largeSpreadsheet();
  const diffs: SpreadsheetCellDiff[] = Array.from({ length: 100 }, (_, i) => {
    const ref = `A${i + 1}`;
    return { sheetId: "sheet-1", ref, before: left.sheets[0].cells[ref], after: { raw: String(100_000 + i), format: null } };
  });
  const started = performance.now();
  const right = applySpreadsheetDiffs(left, diffs);
  const compared = compareArtifactContents({ artifactId: "artifact:benchmark", leftVersion: 1, rightVersion: 2, left, right });
  const elapsed = performance.now() - started;
  assert.equal(compared.spreadsheetDiffs.length, 100);
  assert.ok(elapsed < 10_000, `10k-cell artifact diff/apply took ${elapsed.toFixed(1)}ms`);
});

test("P4 renderer projections remain bounded on professional-sized previews", () => {
  const spreadsheet = largeSpreadsheet();
  const chart: ArtifactContent = {
    kind: "chart",
    rendererPreference: "echarts",
    chartType: "line",
    series: [{ id: "s1", label: "Series", points: Array.from({ length: 50_000 }, (_, i) => ({ x: i, y: Math.sin(i / 100) })) }],
    options: {},
  };
  const data: ArtifactContent = {
    kind: "data",
    columns: [{ name: "id", type: "integer" }, { name: "value", type: "double" }],
    previewRows: Array.from({ length: 10_000 }, (_, i) => ({ id: i, value: i / 10 })),
    rowCount: 1_000_000,
    columnarArtifactId: "columnar:benchmark",
    rendererPreference: "perspective",
  };
  const started = performance.now();
  const workbook = toUniverWorkbookProjection(spreadsheet);
  const chartProjection = toEChartsOptionProjection(chart);
  const dataProjection = toPerspectiveProjection(data);
  const elapsed = performance.now() - started;
  assert.equal(workbook.sheetOrder.length, 1);
  assert.equal(chartProjection.series[0].data.length, 50_000);
  assert.equal(dataProjection.rows.length, 10_000);
  assert.ok(elapsed < 10_000, `renderer projection benchmark took ${elapsed.toFixed(1)}ms`);
});
