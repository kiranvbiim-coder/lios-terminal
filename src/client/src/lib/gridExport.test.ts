import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { gridToExportSheet } from "./gridExport";

test("gridToExportSheet: an empty grid produces a single placeholder row, not an error", () => {
  const g = new SpreadsheetGrid();
  const sheet = gridToExportSheet(g, "Empty");
  assert.equal(sheet.name, "Empty");
  assert.deepEqual(sheet.rows, [[""]]);
});

test("gridToExportSheet: header row is a blank corner cell followed by column letters up to the used range", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "Revenue");
  g.setCell("C3", "100");
  const sheet = gridToExportSheet(g, "Model");
  assert.deepEqual(sheet.rows[0], ["", "A", "B", "C"]);
});

test("gridToExportSheet: each data row starts with its 1-based row number, and cell values/formulas resolve to their computed value", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "Revenue");
  g.setCell("B1", "100");
  g.setCell("B2", "=B1*2");
  const sheet = gridToExportSheet(g, "Model");
  // rows[0] is the header; rows[1] is spreadsheet row 1, rows[2] is row 2.
  assert.deepEqual(sheet.rows[1], ["1", "Revenue", 100]);
  assert.deepEqual(sheet.rows[2], ["2", "", 200]);
});

test("gridToExportSheet: an error cell surfaces its error string instead of a blank or a crash", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "0");
  g.setCell("B1", "=1/A1");
  const sheet = gridToExportSheet(g, "Model");
  assert.equal(sheet.rows[1][2], "#DIV/0!");
});

test("gridToExportSheet: a cell with a display format renders its formatted string, not the raw number", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "8.5");
  g.setFormat("A1", "0.0%");
  const sheet = gridToExportSheet(g, "Model");
  assert.equal(sheet.rows[1][1], "850.0%");
});

test("gridToExportSheet: sheet name is truncated to Excel/PDF's 31-character convention, matching exportXlsx", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "1");
  const longName = "A".repeat(50);
  const sheet = gridToExportSheet(g, longName);
  assert.equal(sheet.name.length, 31);
});
