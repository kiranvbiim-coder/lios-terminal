import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { BLOCK_REGISTRY, getBlock } from "./blockRegistry";

function approxEqual(a: number, b: number, tol = 1e-6) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

test("getBlock: finds a registered block by id and returns undefined for an unknown one", () => {
  assert.equal(getBlock("debt-schedule")?.label, "Debt Schedule");
  assert.equal(getBlock("working-capital-schedule")?.label, "Working Capital Schedule (DSO/DIO/DPO)");
  assert.equal(getBlock("does-not-exist"), undefined);
});

test("every block in the registry declares fields with a key and label", () => {
  for (const block of BLOCK_REGISTRY) {
    assert.ok(block.fields.length > 0, `${block.id} should declare at least one field`);
    for (const field of block.fields) {
      assert.ok(field.key);
      assert.ok(field.label);
    }
  }
});

test("debt-schedule block: inserts a working, convergent debt schedule at the given cursor position when iterative mode is on", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  g.setCell("A1", "1000"); // beginning balance
  g.setCell("A2", "8");    // interest rate %
  g.setCell("C20", "0"); g.setCell("D20", "0"); g.setCell("E20", "0"); // cash available for sweep, per period

  const block = getBlock("debt-schedule")!;
  const result = block.build(
    { periods: "3", beginningBalanceCell: "$A$1", interestRateCell: "$A$2", cashAvailableRow: "20", mandatoryAmortPct: "10" },
    { startRow: 5, firstDataCol: 2 },
  );
  for (const [ref, raw] of Object.entries(result.cells)) g.setCell(ref, raw);

  // No cash swept (row 20 is all zero), so the balance only amortizes by the mandatory 10% of original principal each period.
  const endingRowMatch = result.summary.match(/row (\d+)/);
  assert.ok(endingRowMatch);
  const endingRow = Number(endingRowMatch![1]);
  approxEqual(g.getCell(`C${endingRow}`).value as number, 900);
  approxEqual(g.getCell(`D${endingRow}`).value as number, 800);
  approxEqual(g.getCell(`E${endingRow}`).value as number, 700);
});

test("debt-schedule block: without iterative mode on, the inserted block honestly shows #CIRCULAR! rather than silently faking a number", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "1000");
  g.setCell("A2", "8");
  g.setCell("C20", "50");

  const block = getBlock("debt-schedule")!;
  const result = block.build(
    { periods: "1", beginningBalanceCell: "$A$1", interestRateCell: "$A$2", cashAvailableRow: "20", mandatoryAmortPct: "0" },
    { startRow: 5, firstDataCol: 2 },
  );
  for (const [ref, raw] of Object.entries(result.cells)) g.setCell(ref, raw);
  assert.equal(getBlock("debt-schedule")!.requiresIterativeCalc, true);
  const errors = g.getErrorCells();
  assert.ok(errors.some((e) => e.error === "#CIRCULAR!"));
});

test("working-capital-schedule block: AR/Inventory/AP are driven by the DSO/DIO/DPO cells at the inserted position", () => {
  const g = new SpreadsheetGrid();
  g.setCell("D1", "10"); g.setCell("D2", "15"); g.setCell("D3", "20");
  g.setCell("C10", "3650"); g.setCell("C11", "1825");

  const block = getBlock("working-capital-schedule")!;
  const result = block.build(
    { periods: "1", revenueRow: "10", cogsRow: "11", dsoCell: "$D$1", dioCell: "$D$2", dpoCell: "$D$3" },
    { startRow: 20, firstDataCol: 2 },
  );
  for (const [ref, raw] of Object.entries(result.cells)) g.setCell(ref, raw);

  // AR/Inventory/AP land at startRow+1/+2/+3 (startRow itself is the block's title row).
  approxEqual(g.getCell("C21").value as number, 3650 / 365 * 10); // 100
  approxEqual(g.getCell("C22").value as number, 1825 / 365 * 15); // 75
  approxEqual(g.getCell("C23").value as number, 1825 / 365 * 20); // 100
});

test("both blocks respect a custom period count and land at the requested insertion column", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  g.setCell("A1", "500"); g.setCell("A2", "5"); g.setCell("F20", "0"); g.setCell("G20", "0");

  const block = getBlock("debt-schedule")!;
  // firstDataCol 5 = column F.
  const result = block.build(
    { periods: "2", beginningBalanceCell: "$A$1", interestRateCell: "$A$2", cashAvailableRow: "20", mandatoryAmortPct: "0" },
    { startRow: 5, firstDataCol: 5 },
  );
  for (const [ref, raw] of Object.entries(result.cells)) g.setCell(ref, raw);
  assert.ok(Object.keys(result.cells).some((ref) => ref.startsWith("F")));
  assert.ok(Object.keys(result.cells).some((ref) => ref.startsWith("G")));
  assert.ok(!Object.keys(result.cells).some((ref) => ref.startsWith("C") || ref.startsWith("D") || ref.startsWith("E")));
});
