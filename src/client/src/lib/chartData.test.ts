import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { parseRange, extractChartData, toRechartsRows } from "./chartData";

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

test("parseRange: parses a valid range into inclusive 0-based bounds, normalizing reversed corners", () => {
  assert.deepEqual(parseRange("A3:E7"), { startCol: 0, startRow: 2, endCol: 4, endRow: 6 });
  assert.deepEqual(parseRange("E7:A3"), { startCol: 0, startRow: 2, endCol: 4, endRow: 6 });
});

test("parseRange: throws a descriptive error for malformed input", () => {
  assert.throws(() => parseRange("not a range"), /valid range/);
  assert.throws(() => parseRange("A3"), /valid range/);
});

test("extractChartData: reads series names from the header row and category labels from the label column, matching a SOTP-style table", () => {
  const g = new SpreadsheetGrid();
  feed(g, {
    A3: "SEGMENT", C3: "EBITDA", D3: "MULTIPLE", E3: "IMPLIED EV",
    A4: "Core Products", C4: "200", D4: "9", E4: "=C4*D4",
    A5: "Services", C5: "80", D5: "7", E5: "=C5*D5",
  });
  const data = extractChartData(g, "A3:E5");
  assert.deepEqual(data.categories, ["Core Products", "Services"]);
  assert.equal(data.series.length, 3);
  assert.equal(data.series[0].name, "EBITDA");
  assert.deepEqual(data.series[0].values, [200, 80]);
  assert.equal(data.series[2].name, "IMPLIED EV");
  assert.deepEqual(data.series[2].values, [1800, 560]);
});

test("extractChartData: a live formula-driven series reflects the CURRENT value, not a frozen snapshot", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "Label", B1: "Value", A2: "Row A", B2: "=10*2" });
  const before = extractChartData(g, "A1:B2");
  assert.deepEqual(before.series[0].values, [20]);
  g.setCell("A2", "Row A"); // no-op, keep label
  g.setCell("B2", "=10*3"); // change the formula
  const after = extractChartData(g, "A1:B2");
  assert.deepEqual(after.series[0].values, [30]);
});

test("extractChartData: rejects a range with no data columns or no data rows", () => {
  const g = new SpreadsheetGrid();
  assert.throws(() => extractChartData(g, "A1:A5"), /label column and one data column/);
  assert.throws(() => extractChartData(g, "A1:E1"), /header row and at least one data row/);
});

test("toRechartsRows: reshapes categories/series into recharts' row-per-category format", () => {
  const g = new SpreadsheetGrid();
  feed(g, {
    A1: "Segment", B1: "Revenue", C1: "Margin",
    A2: "Core", B2: "100", C2: "20",
    A3: "New", B3: "50", C3: "10",
  });
  const data = extractChartData(g, "A1:C3");
  const rows = toRechartsRows(data);
  assert.deepEqual(rows, [
    { name: "Core", Revenue: 100, Margin: 20 },
    { name: "New", Revenue: 50, Margin: 10 },
  ]);
});
