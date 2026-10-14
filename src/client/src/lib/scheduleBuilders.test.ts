import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { buildDebtSchedule, buildWorkingCapitalSchedule } from "./scheduleBuilders";

function approxEqual(a: number, b: number, tol = 1e-6) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

function feedCells(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

test("buildDebtSchedule: with no cash sweep available, the balance only amortizes by the mandatory percentage each period", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  g.setCell("A1", "1000"); // beginning debt
  g.setCell("A2", "8");    // interest rate %
  // Cash available for sweep is exactly 0 every period (row 20) -- FCF fully consumed elsewhere.
  g.setCell("C20", "0"); g.setCell("D20", "0"); g.setCell("E20", "0");

  const result = buildDebtSchedule({
    startRow: 5,
    axis: { firstDataCol: 2, nHistCols: 0, nProjCols: 3 }, // C,D,E all projected
    beginningBalanceCell: "$A$1",
    interestRateCell: "$A$2",
    cashAvailableForSweepRow: 20,
    mandatoryAmortizationPct: 10, // 10% of original principal per period
  });
  feedCells(g, result.cells);

  approxEqual(g.getCell(`C${result.beginningBalanceRow}`).value as number, 1000);
  approxEqual(g.getCell(`C${result.endingBalanceRow}`).value as number, 900); // 1000 - 10% mandatory, no sweep
  approxEqual(g.getCell(`D${result.beginningBalanceRow}`).value as number, 900);
  approxEqual(g.getCell(`D${result.endingBalanceRow}`).value as number, 800);
  approxEqual(g.getCell(`E${result.endingBalanceRow}`).value as number, 700);
});

test("buildDebtSchedule: a real cash sweep pays the balance down faster than mandatory amortization alone", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  g.setCell("A1", "1000");
  g.setCell("A2", "8");
  g.setCell("C20", "300"); // plenty of cash available to sweep

  const result = buildDebtSchedule({
    startRow: 5,
    axis: { firstDataCol: 2, nHistCols: 0, nProjCols: 1 },
    beginningBalanceCell: "$A$1",
    interestRateCell: "$A$2",
    cashAvailableForSweepRow: 20,
    mandatoryAmortizationPct: 0, // pure cash-sweep structure, no mandatory amort
  });
  feedCells(g, result.cells);

  const ending = g.getCell(`C${result.endingBalanceRow}`).value as number;
  const interest = g.getCell(`C${result.interestExpenseRow}`).value as number;
  assert.equal(g.getCell(`C${result.endingBalanceRow}`).error, null, "the circular chain should converge, not show #CIRCULAR!/#DIVERGED!");
  // Closed form: sweep = 300 - interest, ending = 1000 - sweep = 700 + interest;
  // interest = avg(1000, ending) * 0.08 = (1000+700+interest)/2 * 0.08 -> solve the small linear system.
  // avg = (1000 + (700+interest))/2 = 850 + interest/2; interest = (850+interest/2)*0.08 = 68 + 0.04*interest
  // 0.96*interest = 68 -> interest = 70.8333; ending = 700 + interest = 770.8333
  approxEqual(interest, 68 / 0.96, 1e-2);
  approxEqual(ending, 700 + 68 / 0.96, 1e-2);
});

test("buildDebtSchedule: the sweep never pushes the ending balance negative, even when cash available exceeds the remaining balance", () => {
  const g = new SpreadsheetGrid();
  g.setIterativeMode(true);
  g.setCell("A1", "100"); // small balance
  g.setCell("A2", "5");
  g.setCell("C20", "10000"); // way more cash than needed to retire the whole balance

  const result = buildDebtSchedule({
    startRow: 5,
    axis: { firstDataCol: 2, nHistCols: 0, nProjCols: 1 },
    beginningBalanceCell: "$A$1",
    interestRateCell: "$A$2",
    cashAvailableForSweepRow: 20,
    mandatoryAmortizationPct: 0,
  });
  feedCells(g, result.cells);

  const ending = g.getCell(`C${result.endingBalanceRow}`).value as number;
  assert.ok(ending >= -1e-6, `ending balance should never go negative, got ${ending}`);
  approxEqual(ending, 0, 1e-2);
});

test("buildWorkingCapitalSchedule: AR/Inventory/AP are driven by DSO/DIO/DPO days-outstanding assumptions applied to Revenue/COGS", () => {
  const g = new SpreadsheetGrid();
  g.setCell("D1", "10");  // DSO
  g.setCell("D2", "15");  // DIO
  g.setCell("D3", "20");  // DPO
  g.setCell("C10", "3650"); // Revenue (period 1) -- chosen so /365*DSO is a clean number
  g.setCell("C11", "1825"); // COGS (period 1)

  const result = buildWorkingCapitalSchedule({
    startRow: 20,
    axis: { firstDataCol: 2, nHistCols: 0, nProjCols: 1 },
    revenueRow: 10,
    cogsRow: 11,
    dsoCell: "$D$1",
    dioCell: "$D$2",
    dpoCell: "$D$3",
  });
  const cells = { ...result.cells };
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);

  approxEqual(g.getCell(`C${result.accountsReceivableRow}`).value as number, 3650 / 365 * 10); // = 100
  approxEqual(g.getCell(`C${result.inventoryRow}`).value as number, 1825 / 365 * 15); // = 75
  approxEqual(g.getCell(`C${result.accountsPayableRow}`).value as number, 1825 / 365 * 20); // = 100
});

test("buildWorkingCapitalSchedule: the change-in-NWC row is 0 in the first period and the true period-over-period delta afterward", () => {
  const g = new SpreadsheetGrid();
  g.setCell("D1", "10"); g.setCell("D2", "0"); g.setCell("D3", "0"); // isolate to AR only for a clean delta
  g.setCell("C10", "3650"); g.setCell("D10", "7300"); // revenue doubles period 2 -> AR doubles
  g.setCell("C11", "0"); g.setCell("D11", "0");

  const result = buildWorkingCapitalSchedule({
    startRow: 20,
    axis: { firstDataCol: 2, nHistCols: 0, nProjCols: 2 },
    revenueRow: 10,
    cogsRow: 11,
    dsoCell: "$D$1",
    dioCell: "$D$2",
    dpoCell: "$D$3",
  });
  for (const [ref, raw] of Object.entries(result.cells)) g.setCell(ref, raw);

  assert.equal(g.getCell(`C${result.changeInNwcRow}`).value, 0, "no prior period to diff against yet");
  const period1Ar = g.getCell(`C${result.accountsReceivableRow}`).value as number; // 100
  const period2Ar = g.getCell(`D${result.accountsReceivableRow}`).value as number; // 200
  approxEqual(g.getCell(`D${result.changeInNwcRow}`).value as number, period2Ar - period1Ar);
});
