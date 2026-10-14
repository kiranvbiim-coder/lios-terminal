import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildCreditAnalysisModel, DEFAULT_CREDIT_ANALYSIS_INPUTS } from "./creditAnalysis";

function approxEqual(a: number, b: number, tol = 1e-6) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

test("Credit Analysis template: no cell on the sheet errors out", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildCreditAnalysisModel(DEFAULT_CREDIT_ANALYSIS_INPUTS));
  assert.deepEqual(g.getErrorCells(), []);
});

test("Credit Analysis template: leverage and coverage ratios are computed correctly from the raw inputs", () => {
  const g = new SpreadsheetGrid();
  const { ebitda, totalDebt, cash, interestExpense, scheduledPrincipalRepayment, capex, cashTaxes } = DEFAULT_CREDIT_ANALYSIS_INPUTS;
  feed(g, buildCreditAnalysisModel(DEFAULT_CREDIT_ANALYSIS_INPUTS));

  approxEqual(g.getCell("C17").value as number, totalDebt / ebitda); // Total Debt / EBITDA
  approxEqual(g.getCell("C18").value as number, (totalDebt - cash) / ebitda); // Net Debt / EBITDA
  approxEqual(g.getCell("C21").value as number, ebitda / interestExpense); // EBITDA / Interest
  const debtService = interestExpense + scheduledPrincipalRepayment;
  const fcf = ebitda - capex - cashTaxes;
  approxEqual(g.getCell("C23").value as number, debtService);
  approxEqual(g.getCell("C24").value as number, fcf);
  approxEqual(g.getCell("C25").value as number, fcf / debtService);
});

test("Credit Analysis template: covenant headroom compares actual ratios against the covenant thresholds", () => {
  const g = new SpreadsheetGrid();
  const { ebitda, totalDebt, interestExpense, maxLeverageCovenant, minCoverageCovenant } = DEFAULT_CREDIT_ANALYSIS_INPUTS;
  feed(g, buildCreditAnalysisModel(DEFAULT_CREDIT_ANALYSIS_INPUTS));

  const leverage = totalDebt / ebitda;
  const coverage = ebitda / interestExpense;
  approxEqual(g.getCell("C28").value as number, maxLeverageCovenant - leverage); // leverage headroom, turns
  approxEqual(g.getCell("C30").value as number, coverage - minCoverageCovenant); // coverage headroom, turns
  assert.ok((g.getCell("C28").value as number) > 0, "default scenario should be covenant-compliant on leverage");
  assert.ok((g.getCell("C30").value as number) > 0, "default scenario should be covenant-compliant on coverage");
});

test("Credit Analysis template: the illustrative profile band reflects the actual leverage/coverage combination (3.0x leverage, ~5.6x coverage lands in BBB / Adequate)", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildCreditAnalysisModel(DEFAULT_CREDIT_ANALYSIS_INPUTS));
  assert.equal(g.getCell("C34").value, "BBB / Adequate");
});

test("Credit Analysis template: a much more leveraged, thinly-covered scenario drops into a weaker profile band", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildCreditAnalysisModel({ ...DEFAULT_CREDIT_ANALYSIS_INPUTS, totalDebt: 3000, interestExpense: 250 }));
  // Leverage = 3000/500 = 6.0x, Coverage = 500/250 = 2.0x -- fails every band, lands in the weakest.
  assert.equal(g.getCell("C34").value, "B or Below / High Risk");
});
