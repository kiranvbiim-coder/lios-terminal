import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { computeModelHealthScore } from "./modelHealthScore";

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

test("computeModelHealthScore: a clean sheet with no errors, no stray hardcodes, and no orphaned names scores 100 / Excellent", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "10", A2: "20", A3: "=A1+A2" });
  const report = computeModelHealthScore(g);
  assert.equal(report.score, 100);
  assert.equal(report.label, "Excellent");
  assert.equal(report.errorCount, 0);
  assert.deepEqual(report.hardcodedInFormulaRows, []);
  assert.deepEqual(report.orphanedNames, []);
});

test("computeModelHealthScore: error cells deduct from the score and are broken down by error type", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "0", B1: "=1/A1", C1: "=UNDEFINED_NAME_XYZ" });
  const report = computeModelHealthScore(g);
  assert.ok(report.errorCount >= 2);
  assert.ok(report.score < 100);
  assert.ok(report.errorBreakdown["#DIV/0!"] >= 1);
});

test("computeModelHealthScore: a literal number sitting among formula cells in the same row is flagged as a hardcoded finding", () => {
  const g = new SpreadsheetGrid();
  // Row 5 reads as a formula row (2 formula cells) with a literal breaking the pattern in the middle.
  feed(g, { A5: "=1+1", B5: "999", C5: "=2+2" });
  const report = computeModelHealthScore(g);
  assert.equal(report.hardcodedInFormulaRows.length, 1);
  assert.equal(report.hardcodedInFormulaRows[0].ref, "B5");
  assert.equal(report.hardcodedInFormulaRows[0].row, 5);
});

test("computeModelHealthScore: a lone literal in a row with fewer than 2 formula cells is NOT flagged -- one formula next to a label/input isn't a broken pattern", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "Revenue", C1: "100", D1: "=C1*2" }); // only 1 formula cell on this row
  const report = computeModelHealthScore(g);
  assert.deepEqual(report.hardcodedInFormulaRows, []);
});

test("computeModelHealthScore: a named range nobody's formula references is flagged as orphaned", () => {
  const g = new SpreadsheetGrid();
  g.setCell("C1", "8");
  g.defineName("WACC", "$C$1");
  g.defineName("UNUSED_RATE", "5");
  feed(g, { A1: "=WACC*2" }); // only WACC is actually referenced
  const report = computeModelHealthScore(g);
  assert.deepEqual(report.orphanedNames, ["UNUSED_RATE"]);
});

test("computeModelHealthScore: a heavily-flawed sheet lands in the Critical band, and findings explain why", () => {
  const g = new SpreadsheetGrid();
  feed(g, {
    A1: "0", B1: "=1/A1", C1: "=1/A1", D1: "=1/A1", E1: "=1/A1", F1: "=1/A1", G1: "=1/A1", H1: "=1/A1", I1: "=1/A1",
  });
  const report = computeModelHealthScore(g);
  assert.equal(report.label, "Critical");
  assert.ok(report.score <= 50);
  assert.ok(report.findings.some((f) => f.includes("error")));
});
