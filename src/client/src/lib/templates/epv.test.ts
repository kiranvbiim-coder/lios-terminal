import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildEpvModel, DEFAULT_EPV_INPUTS } from "./epv";

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

test("EPV template: no cell on the sheet errors out", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildEpvModel(DEFAULT_EPV_INPUTS));
  assert.deepEqual(g.getErrorCells(), []);
});

test("EPV template: EPV of operations capitalizes normalized NOPAT at WACC with zero growth", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildEpvModel(DEFAULT_EPV_INPUTS));

  const { normalizedRevenue, normalizedEbitMarginPct, taxRatePct, waccPct } = DEFAULT_EPV_INPUTS;
  const ebit = normalizedRevenue * (normalizedEbitMarginPct / 100);
  const nopat = ebit * (1 - taxRatePct / 100);
  const expectedEpvOps = nopat / (waccPct / 100);

  const rEpvOps = findRow(g, "EPV OF OPERATIONS (NOPAT / WACC, zero growth)");
  approxEqual(g.getCell(`C${rEpvOps}`).value as number, expectedEpvOps); // 1250
});

test("EPV template: EPV of equity subtracts net debt, and EPV per share divides by shares outstanding", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildEpvModel(DEFAULT_EPV_INPUTS));

  const rEpvOps = findRow(g, "EPV OF OPERATIONS (NOPAT / WACC, zero growth)");
  const rEpvEquity = findRow(g, "EPV OF EQUITY (EPV of Ops - Net Debt)");
  const rEpvPerShare = findRow(g, "EPV PER SHARE ($)");

  const epvOps = g.getCell(`C${rEpvOps}`).value as number;
  const expectedEquity = epvOps - DEFAULT_EPV_INPUTS.netDebt;
  approxEqual(g.getCell(`C${rEpvEquity}`).value as number, expectedEquity); // 1050
  approxEqual(g.getCell(`C${rEpvPerShare}`).value as number, expectedEquity / DEFAULT_EPV_INPUTS.sharesOutstanding); // 10.5
});

test("EPV template: franchise value is EPV of operations minus reproduction cost, and is positive in the default (moat) scenario", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildEpvModel(DEFAULT_EPV_INPUTS));

  const rEpvOps = findRow(g, "EPV OF OPERATIONS (NOPAT / WACC, zero growth)");
  const rFranchise = findRow(g, "Franchise (Moat) Value (EPV of Ops - Reproduction Cost)");
  const epvOps = g.getCell(`C${rEpvOps}`).value as number;
  const expected = epvOps - DEFAULT_EPV_INPUTS.reproductionCostOfAssets;
  approxEqual(g.getCell(`C${rFranchise}`).value as number, expected); // 350
  assert.ok(expected > 0);
});
