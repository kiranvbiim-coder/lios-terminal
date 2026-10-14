import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildNavModel, DEFAULT_NAV_INPUTS } from "./nav";

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

test("NAV template: no cell on the sheet errors out", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildNavModel(DEFAULT_NAV_INPUTS));
  assert.deepEqual(g.getErrorCells(), []);
});

test("NAV template: total fair value of assets applies each asset's own fair-value adjustment to its book value", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildNavModel(DEFAULT_NAV_INPUTS));

  const expected = DEFAULT_NAV_INPUTS.assets.reduce((sum, a) => sum + a.bookValue * (1 + a.fairValueAdjPct / 100), 0);
  const rTotalAssets = findRow(g, "TOTAL FAIR VALUE OF ASSETS");
  approxEqual(g.getCell(`E${rTotalAssets}`).value as number, expected); // 1255
});

test("NAV template: NAV = total fair value of assets - total liabilities, and NAV per share divides by shares outstanding", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildNavModel(DEFAULT_NAV_INPUTS));

  const rTotalAssets = findRow(g, "TOTAL FAIR VALUE OF ASSETS");
  const rNav = findRow(g, "NET ASSET VALUE (NAV)");
  const rNavPerShare = findRow(g, "NAV PER SHARE ($)");

  const totalAssets = g.getCell(`E${rTotalAssets}`).value as number;
  const expectedNav = totalAssets - DEFAULT_NAV_INPUTS.totalLiabilities;
  approxEqual(g.getCell(`E${rNav}`).value as number, expectedNav); // 1005
  approxEqual(g.getCell(`E${rNavPerShare}`).value as number, expectedNav / DEFAULT_NAV_INPUTS.sharesOutstanding); // 10.05
});

test("NAV template: premium/(discount) to NAV compares market price against NAV per share", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildNavModel(DEFAULT_NAV_INPUTS));

  const rNavPerShare = findRow(g, "NAV PER SHARE ($)");
  const rPremDisc = findRow(g, "Premium / (Discount) to NAV %");
  const navPerShare = g.getCell(`E${rNavPerShare}`).value as number;
  const expected = (DEFAULT_NAV_INPUTS.marketPricePerShare - navPerShare) / navPerShare * 100;
  approxEqual(g.getCell(`E${rPremDisc}`).value as number, expected);
  assert.ok((g.getCell(`E${rPremDisc}`).value as number) < 0, "the default scenario should show a discount to NAV, the common real-world case this template screens for");
});
