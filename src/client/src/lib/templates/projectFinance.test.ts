import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildProjectFinanceModel, DEFAULT_PROJECT_FINANCE_INPUTS } from "./projectFinance";

function approxEqual(a: number, b: number, tol = 1e-6) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

function colLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

function simulateSourcesUses(inputs: typeof DEFAULT_PROJECT_FINANCE_INPUTS) {
  const baseUses = inputs.constructionCost * (1 + inputs.contingencyPct / 100);
  const debt = baseUses * (inputs.gearingPct / 100);
  const idc = debt * (inputs.interestRatePct / 100) * (inputs.constructionMonths / 12) * 0.5;
  const fees = debt * (inputs.financingFeesPct / 100);
  const totalUses = baseUses + idc + fees;
  const equity = totalUses - debt;
  return { baseUses, debt, idc, fees, totalUses, equity };
}

function simulateDscr(inputs: typeof DEFAULT_PROJECT_FINANCE_INPUTS, debt: number) {
  const years: { revenue: number; opex: number; cfads: number; beginBal: number; principal: number; interest: number; debtService: number; endBal: number; dscr: number }[] = [];
  let revenue = inputs.annualRevenueYear1;
  let opex = inputs.annualOpexYear1;
  let beginBal = debt;
  for (let i = 0; i < inputs.operatingYears; i++) {
    if (i > 0) { revenue *= 1 + inputs.revenueGrowthPct / 100; opex *= 1 + inputs.opexGrowthPct / 100; }
    const cfads = revenue - opex;
    const principal = Math.min(beginBal, debt / inputs.debtTenorYears);
    const interest = beginBal * (inputs.interestRatePct / 100);
    const debtService = principal + interest;
    const endBal = beginBal - principal;
    const dscr = cfads / debtService;
    years.push({ revenue, opex, cfads, beginBal, principal, interest, debtService, endBal, dscr });
    beginBal = endBal;
  }
  return years;
}

test("Project Finance template: no cell on the sheet errors out", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildProjectFinanceModel(DEFAULT_PROJECT_FINANCE_INPUTS));
  assert.deepEqual(g.getErrorCells(), []);
});

test("Project Finance template: Sources & Uses sizes debt off base construction cost and plugs equity for the remainder", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildProjectFinanceModel(DEFAULT_PROJECT_FINANCE_INPUTS));
  const su = simulateSourcesUses(DEFAULT_PROJECT_FINANCE_INPUTS);

  approxEqual(g.getCell("C20").value as number, su.baseUses); // 880
  approxEqual(g.getCell("C21").value as number, su.debt);     // 616
  approxEqual(g.getCell("C22").value as number, su.idc);
  approxEqual(g.getCell("C23").value as number, su.fees);
  approxEqual(g.getCell("C24").value as number, su.totalUses);
  approxEqual(g.getCell("C25").value as number, su.equity);
  // Sources must equal uses: Debt + Equity = Total Uses.
  approxEqual(su.debt + su.equity, su.totalUses);
});

test("Project Finance template: the operating-period debt schedule and DSCR match an independent year-by-year simulation", () => {
  const g = new SpreadsheetGrid();
  const inputs = DEFAULT_PROJECT_FINANCE_INPUTS;
  feed(g, buildProjectFinanceModel(inputs));
  const su = simulateSourcesUses(inputs);
  const years = simulateDscr(inputs, su.debt);

  for (let i = 0; i < inputs.operatingYears; i++) {
    const col = colLetter(2 + i);
    approxEqual(g.getCell(`${col}28`).value as number, years[i].revenue, 1e-4);
    approxEqual(g.getCell(`${col}30`).value as number, years[i].cfads, 1e-4);
    approxEqual(g.getCell(`${col}34`).value as number, years[i].debtService, 1e-4);
    approxEqual(g.getCell(`${col}36`).value as number, years[i].dscr, 1e-4);
  }
  // Debt fully amortizes by the end of its tenor.
  const lastCol = colLetter(2 + inputs.operatingYears - 1);
  approxEqual(g.getCell(`${lastCol}35`).value as number, 0, 1e-6);
});

test("Project Finance template: minimum DSCR is the worst single year, and the covenant test passes when it clears the minimum covenant", () => {
  const g = new SpreadsheetGrid();
  const inputs = DEFAULT_PROJECT_FINANCE_INPUTS;
  feed(g, buildProjectFinanceModel(inputs));
  const su = simulateSourcesUses(inputs);
  const years = simulateDscr(inputs, su.debt);

  const expectedMinDscr = Math.min(...years.map((y) => y.dscr));
  approxEqual(g.getCell("C38").value as number, expectedMinDscr);
  assert.equal(g.getCell("C39").value, expectedMinDscr >= inputs.minDscrCovenant ? "PASS" : "FAIL");
  assert.equal(g.getCell("C39").value, "PASS", "the default scenario is designed to comfortably clear its own covenant");
});

test("Project Finance template: a much thinner-margin project fails its own DSCR covenant", () => {
  const g = new SpreadsheetGrid();
  const thin = { ...DEFAULT_PROJECT_FINANCE_INPUTS, annualRevenueYear1: 160, annualOpexYear1: 100 };
  feed(g, buildProjectFinanceModel(thin));
  const su = simulateSourcesUses(thin);
  const years = simulateDscr(thin, su.debt);
  const expectedMinDscr = Math.min(...years.map((y) => y.dscr));
  assert.ok(expectedMinDscr < thin.minDscrCovenant);
  assert.equal(g.getCell("C39").value, "FAIL");
});
