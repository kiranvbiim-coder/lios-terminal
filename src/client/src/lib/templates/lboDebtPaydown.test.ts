import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildLboDebtPaydownModel, DEFAULT_LBO_INPUTS } from "./lboDebtPaydown";

function approxEqual(a: number, b: number, tol = 1e-6) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

test("LBO template: without iterative calculation enabled, the circular interest chain honestly fails as #CIRCULAR! rather than silently faking a flat number", () => {
  const g = new SpreadsheetGrid();
  const cells = buildLboDebtPaydownModel(DEFAULT_LBO_INPUTS);
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
  // Find the "Interest Expense" row from column A labels and confirm it's circular.
  let interestRow = -1;
  g.getAllCells().forEach((cell, ref) => { if (ref.startsWith("A") && cell.raw === "Interest Expense") interestRow = parseInt(ref.slice(1), 10); });
  assert.ok(interestRow > 0);
  assert.equal(g.getCell(`C${interestRow}`).error, "#CIRCULAR!");
});

test("LBO template: with iterative calculation on, every cell converges to a real number -- no #CIRCULAR!, #DIVERGED!, or #REF! anywhere on the sheet", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  const cells = buildLboDebtPaydownModel(DEFAULT_LBO_INPUTS);
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
  const errors = g.getErrorCells();
  assert.deepEqual(errors, [], `expected no flagged cells, got: ${JSON.stringify(errors)}`);
});

test("LBO template: entry debt is correctly derived from Entry EBIT x Entry Debt/EBIT multiple", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  const cells = buildLboDebtPaydownModel({ ...DEFAULT_LBO_INPUTS, entryEbit: 100, entryDebtMultiple: 5 });
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
  approxEqual(g.getCell("C13").value as number, 500); // 100 * 5.0x
});

test("LBO template: a real cash-generative deal (positive FCF every year) pays down debt -- leverage decreases monotonically over the projection", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  const cells = buildLboDebtPaydownModel(DEFAULT_LBO_INPUTS);
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);

  let leverageRow = -1;
  g.getAllCells().forEach((cell, ref) => { if (ref.startsWith("A") && cell.raw === "Debt / EBIT (x)") leverageRow = parseInt(ref.slice(1), 10); });
  assert.ok(leverageRow > 0);

  const cols = ["C", "D", "E", "F", "G"]; // 5 projection years
  const leverage = cols.map((c) => g.getCell(`${c}${leverageRow}`).value as number);
  for (let i = 1; i < leverage.length; i++) {
    assert.ok(leverage[i] < leverage[i - 1], `leverage should decrease each year with positive FCF and a real paydown structure: year ${i} (${leverage[i]}) should be < year ${i - 1} (${leverage[i - 1]})`);
  }
  // Cumulative paydown % should also be positive and increasing by the final year.
  let paydownRow = -1;
  g.getAllCells().forEach((cell, ref) => { if (ref.startsWith("A") && cell.raw === "Cumulative Paydown %") paydownRow = parseInt(ref.slice(1), 10); });
  const finalPaydownPct = g.getCell(`G${paydownRow}`).value as number;
  assert.ok(finalPaydownPct > 0, `expected meaningful debt paydown by year 5, got ${finalPaydownPct}%`);
});

test("LBO template: a zero-mandatory-amortization, low-cash-flow scenario still converges (doesn't diverge) even with a thin cash cushion", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  const cells = buildLboDebtPaydownModel({ ...DEFAULT_LBO_INPUTS, mandatoryAmortPct: 0, capexPctOfEbit: 40, daPctOfEbit: 5 });
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
  const errors = g.getErrorCells();
  assert.deepEqual(errors, []);
});
