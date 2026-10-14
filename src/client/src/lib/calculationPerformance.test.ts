import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { analyzeCalculationPerformance } from "./calculationPerformance";

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

test("analyzeCalculationPerformance: counts total and formula cells correctly", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "10", A2: "20", A3: "=A1+A2", A4: "label" });
  const report = analyzeCalculationPerformance(g);
  assert.equal(report.totalCells, 4);
  assert.equal(report.formulaCells, 1);
});

test("analyzeCalculationPerformance: every timing is non-negative and slowestEdits is sorted descending", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "1", B1: "=A1*2", C1: "=B1*2", D1: "=C1*2" });
  const report = analyzeCalculationPerformance(g);
  assert.ok(report.fullRebuildMs >= 0);
  assert.ok(report.totalCascadeMs >= 0);
  assert.ok(report.averageCascadeMs >= 0);
  for (const t of report.slowestEdits) assert.ok(t.ms >= 0);
  for (let i = 1; i < report.slowestEdits.length; i++) {
    assert.ok(report.slowestEdits[i - 1].ms >= report.slowestEdits[i].ms, "slowestEdits should be sorted descending by ms");
  }
});

test("analyzeCalculationPerformance: slowestEdits only lists formula cells, capped at topN", () => {
  const g = new SpreadsheetGrid();
  feed(g, {
    A1: "1", A2: "=A1+1", A3: "=A2+1", A4: "=A3+1", A5: "=A4+1", A6: "=A5+1",
  });
  const report = analyzeCalculationPerformance(g, 3);
  assert.ok(report.slowestEdits.length <= 3);
  for (const t of report.slowestEdits) assert.ok(t.ref.match(/^A[2-6]$/), `${t.ref} should be one of the formula cells`);
});

test("analyzeCalculationPerformance: analyzing the grid doesn't change any of its computed values", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "5", B1: "=A1*10" });
  const before = g.getCell("B1").value;
  analyzeCalculationPerformance(g);
  const after = g.getCell("B1").value;
  assert.equal(before, after);
});

test("analyzeCalculationPerformance: an empty grid reports zero cells without throwing", () => {
  const g = new SpreadsheetGrid();
  const report = analyzeCalculationPerformance(g);
  assert.equal(report.totalCells, 0);
  assert.equal(report.formulaCells, 0);
  assert.deepEqual(report.slowestEdits, []);
  assert.equal(report.averageCascadeMs, 0);
});
