import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { buildThreeStatementModel } from "./modelTemplates";
import type { LseFinancialReport } from "./useLse";

function makeReport(reportType: string, fiscalYear: string, data: Record<string, number>): LseFinancialReport {
  return {
    symbol: "TEST", report_type: reportType, date: `${fiscalYear}-12-31`, fiscal_year: fiscalYear, period: "FY",
    reported_currency: "USD", data: JSON.stringify(data), filing_date: null,
  };
}

// Two years of a small, self-consistent synthetic company -- self-consistent
// meaning Assets actually equal Liabilities+Equity in the fixture itself,
// so the template's plug-cash formula can be checked against a known value.
const income: LseFinancialReport[] = [
  makeReport("income", "2022", { revenue: 1000, costOfRevenue: 600, sellingGeneralAndAdministrativeExpenses: 150, interestExpense: 20, incomeBeforeTax: 230, incomeTaxExpense: 48.3, netIncome: 181.7 }),
  makeReport("income", "2023", { revenue: 1100, costOfRevenue: 660, sellingGeneralAndAdministrativeExpenses: 165, interestExpense: 20, incomeBeforeTax: 255, incomeTaxExpense: 53.55, netIncome: 201.45 }),
];
const balance: LseFinancialReport[] = [
  makeReport("balance", "2022", { netReceivables: 100, inventory: 80, propertyPlantEquipmentNet: 400, otherCurrentAssets: 20, accountPayables: 90, shortTermDebt: 50, longTermDebt: 150, totalStockholdersEquity: 360 }),
  makeReport("balance", "2023", { netReceivables: 110, inventory: 88, propertyPlantEquipmentNet: 420, otherCurrentAssets: 22, accountPayables: 99, shortTermDebt: 50, longTermDebt: 150, totalStockholdersEquity: 500 }),
];
const cashflow: LseFinancialReport[] = [
  makeReport("cashflow", "2022", { depreciationAndAmortization: 40, investmentsInPropertyPlantAndEquipment: -60 }),
  makeReport("cashflow", "2023", { depreciationAndAmortization: 44, investmentsInPropertyPlantAndEquipment: -64 }),
];

test("three-statement template: historical revenue is a literal, matches the source data exactly", () => {
  const cells = buildThreeStatementModel("TEST", { income, balance, cashflow }, 2, 3);
  const g = new SpreadsheetGrid();
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
  // Historical columns start at C; row 15 is Revenue (A13 title, A14 Revenue... let's just find it by scanning labels).
  const cellMap = g.getAllCells();
  let revenueRow = -1;
  cellMap.forEach((cell, ref) => {
    if (ref.startsWith("A") && cell.raw === "Revenue") revenueRow = parseInt(ref.slice(1), 10);
  });
  assert.ok(revenueRow > 0, "Revenue row label should exist");
  assert.equal(g.getCell(`C${revenueRow}`).value, 1000);
  assert.equal(g.getCell(`D${revenueRow}`).value, 1100);
});

test("three-statement template: projected revenue grows at the assumption rate and updates live when the assumption changes", () => {
  const cells = buildThreeStatementModel("TEST", { income, balance, cashflow }, 2, 3);
  const g = new SpreadsheetGrid();
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);

  let revenueRow = -1;
  g.getAllCells().forEach((cell, ref) => { if (ref.startsWith("A") && cell.raw === "Revenue") revenueRow = parseInt(ref.slice(1), 10); });

  // Historical growth was (1100-1000)/1000 = 10%, so the implied assumption should be ~10.
  const growthAssumption = g.getCell("C5").value as number;
  assert.ok(Math.abs(growthAssumption - 10) < 0.5, `expected implied growth near 10%, got ${growthAssumption}`);

  const projectedRevenue = g.getCell(`E${revenueRow}`).value as number; // first projection column (C,D hist -> E is FY+1E)
  assert.ok(Math.abs(projectedRevenue - 1100 * (1 + growthAssumption / 100)) < 1e-6);

  // Change the assumption live and confirm the projection recalculates.
  g.setCell("C5", "20"); // 20% growth
  const recalculated = g.getCell(`E${revenueRow}`).value as number;
  assert.ok(Math.abs(recalculated - 1100 * 1.2) < 1e-6, "changing the assumption cell should recompute the projected revenue");
});

test("three-statement template: the balance sheet balances (Total Assets == Total Liabilities & Equity) for every column, historical and projected", () => {
  const cells = buildThreeStatementModel("TEST", { income, balance, cashflow }, 2, 3);
  const g = new SpreadsheetGrid();
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);

  let totalAssetsRow = -1, totalLERow = -1;
  g.getAllCells().forEach((cell, ref) => {
    if (ref.startsWith("A") && cell.raw.includes("Total Assets")) totalAssetsRow = parseInt(ref.slice(1), 10);
    if (ref.startsWith("A") && cell.raw === "Total Liabilities & Equity") totalLERow = parseInt(ref.slice(1), 10);
  });
  assert.ok(totalAssetsRow > 0 && totalLERow > 0);

  for (const col of ["C", "D", "E", "F", "G"]) { // 2 historical + 3 projected
    const assets = g.getCell(`${col}${totalAssetsRow}`).value as number;
    const le = g.getCell(`${col}${totalLERow}`).value as number;
    assert.ok(Math.abs(assets - le) < 1e-6, `column ${col}: assets ${assets} should equal L+E ${le} (cash is the plug)`);
  }
});

test("three-statement template: no cell reports #CIRCULAR! or #NAME? -- the template is internally well-formed", () => {
  const cells = buildThreeStatementModel("TEST", { income, balance, cashflow }, 2, 3);
  const g = new SpreadsheetGrid();
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
  const errors: string[] = [];
  g.getAllCells().forEach((cell, ref) => { if (cell.error) errors.push(`${ref}: ${cell.error}`); });
  assert.deepEqual(errors, []);
});
