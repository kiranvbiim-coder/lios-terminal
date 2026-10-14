import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildApvModel, DEFAULT_APV_INPUTS } from "./apv";

function approxEqual(a: number, b: number, tol = 1e-6) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

function findRow(g: SpreadsheetGrid, label: string): number {
  let found = -1;
  g.getAllCells().forEach((cell, ref) => { if (ref.startsWith("A") && cell.raw === label) found = parseInt(ref.slice(1), 10); });
  return found;
}

test("APV template: no cell on the sheet errors out", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildApvModel(DEFAULT_APV_INPUTS));
  assert.deepEqual(g.getErrorCells(), []);
});

test("APV template: unlevered FCF grows at the assumed rate and each year's PV discounts correctly at Ku", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildApvModel(DEFAULT_APV_INPUTS));

  const rFcf = findRow(g, "Unlevered FCF");
  const rPv = findRow(g, "PV of Unlevered FCF");
  const { baseUnleveredFcf, fcfGrowthPct, unleveredCostOfEquityPct } = DEFAULT_APV_INPUTS;

  const fcfYear2 = baseUnleveredFcf * (1 + fcfGrowthPct / 100);
  approxEqual(g.getCell(`D${rFcf}`).value as number, fcfYear2);

  const pvYear1 = baseUnleveredFcf / (1 + unleveredCostOfEquityPct / 100);
  approxEqual(g.getCell(`C${rPv}`).value as number, pvYear1);
});

test("APV template: the interest tax shield equals Debt x Kd x Tax Rate every year (constant debt balance)", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildApvModel(DEFAULT_APV_INPUTS));

  const rShield = findRow(g, "Interest Tax Shield");
  const { debtBalance, costOfDebtPct, taxRatePct } = DEFAULT_APV_INPUTS;
  const expectedShield = debtBalance * (costOfDebtPct / 100) * (taxRatePct / 100);

  approxEqual(g.getCell(`C${rShield}`).value as number, expectedShield);
  approxEqual(g.getCell(`G${rShield}`).value as number, expectedShield); // constant every year
});

test("APV template: APV = unlevered value + PV of tax shield, and implied equity value subtracts net debt", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildApvModel(DEFAULT_APV_INPUTS));

  const rUnleveredValue = findRow(g, "UNLEVERED VALUE (PV of FCF + PV of TV)");
  const rApv = findRow(g, "APV = Unlevered Value + PV of Tax Shield");
  const rSumPvShield = findRow(g, "Sum PV of Tax Shield (explicit period)");
  const rEquity = findRow(g, "Implied Equity Value (APV - Net Debt)");

  const unleveredValue = g.getCell(`C${rUnleveredValue}`).value as number;
  const sumPvShield = g.getCell(`C${rSumPvShield}`).value as number;
  const apv = g.getCell(`C${rApv}`).value as number;
  approxEqual(apv, unleveredValue + sumPvShield);

  const equity = g.getCell(`C${rEquity}`).value as number;
  approxEqual(equity, apv - DEFAULT_APV_INPUTS.netDebt);
});
