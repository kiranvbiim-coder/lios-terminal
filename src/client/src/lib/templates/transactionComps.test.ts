import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildTransactionCompsModel, DEFAULT_TRANSACTION_COMPS_INPUTS } from "./transactionComps";

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

function median(vals: number[]): number {
  const v = vals.slice().sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

test("Transaction Comps template: no cell on the sheet errors out", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildTransactionCompsModel(DEFAULT_TRANSACTION_COMPS_INPUTS));
  assert.deepEqual(g.getErrorCells(), []);
});

test("Transaction Comps template: each deal's EV/Revenue and EV/EBITDA multiples are computed from its own EV, revenue, and EBITDA", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildTransactionCompsModel(DEFAULT_TRANSACTION_COMPS_INPUTS));

  const firstDeal = DEFAULT_TRANSACTION_COMPS_INPUTS.deals[0];
  // The deal table starts at row 4 (row 3 is the header).
  approxEqual(g.getCell("F4").value as number, firstDeal.dealEv / firstDeal.targetRevenue);
  approxEqual(g.getCell("G4").value as number, firstDeal.dealEv / firstDeal.targetEbitda);
});

test("Transaction Comps template: median EV/Revenue and EV/EBITDA multiples match an independent median calculation across all deals", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildTransactionCompsModel(DEFAULT_TRANSACTION_COMPS_INPUTS));

  const revMultiples = DEFAULT_TRANSACTION_COMPS_INPUTS.deals.map((d) => d.dealEv / d.targetRevenue);
  const ebitdaMultiples = DEFAULT_TRANSACTION_COMPS_INPUTS.deals.map((d) => d.dealEv / d.targetEbitda);

  const rMedian = findRow(g, "Median");
  approxEqual(g.getCell(`F${rMedian}`).value as number, median(revMultiples));
  approxEqual(g.getCell(`G${rMedian}`).value as number, median(ebitdaMultiples));
});

test("Transaction Comps template: implied equity value applies the median multiples to the target's own revenue/EBITDA, blends the two bases, and subtracts net debt", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildTransactionCompsModel(DEFAULT_TRANSACTION_COMPS_INPUTS));

  const revMultiples = DEFAULT_TRANSACTION_COMPS_INPUTS.deals.map((d) => d.dealEv / d.targetRevenue);
  const ebitdaMultiples = DEFAULT_TRANSACTION_COMPS_INPUTS.deals.map((d) => d.dealEv / d.targetEbitda);
  const { ownRevenue, ownEbitda, netDebt } = DEFAULT_TRANSACTION_COMPS_INPUTS;

  const impliedEvRevenue = ownRevenue * median(revMultiples);
  const impliedEvEbitda = ownEbitda * median(ebitdaMultiples);
  const impliedEvBlended = (impliedEvRevenue + impliedEvEbitda) / 2;
  const expectedEquity = impliedEvBlended - netDebt;

  const rEquity = findRow(g, "IMPLIED EQUITY VALUE");
  approxEqual(g.getCell(`C${rEquity}`).value as number, expectedEquity);
});
