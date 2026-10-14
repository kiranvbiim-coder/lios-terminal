import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "@/lib/spreadsheetEngine";
import { buildSotpModel, DEFAULT_SOTP_INPUTS } from "./sotp";

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

test("SOTP template: no cell on the sheet errors out", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildSotpModel(DEFAULT_SOTP_INPUTS));
  assert.deepEqual(g.getErrorCells(), []);
});

test("SOTP template: total enterprise value is the sum of each segment's own EBITDA x its own multiple", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildSotpModel(DEFAULT_SOTP_INPUTS));

  const expectedTotalEv = DEFAULT_SOTP_INPUTS.segments.reduce((sum, s) => sum + s.ebitda * s.multiple, 0);
  const rTotalEv = findRow(g, "TOTAL ENTERPRISE VALUE");
  approxEqual(g.getCell(`E${rTotalEv}`).value as number, expectedTotalEv); // 2660
});

test("SOTP template: equity value bridges from EV through net debt, minority interest, and non-operating assets", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildSotpModel(DEFAULT_SOTP_INPUTS));

  const { netDebt, minorityInterest, nonOperatingAssets } = DEFAULT_SOTP_INPUTS;
  const rTotalEv = findRow(g, "TOTAL ENTERPRISE VALUE");
  const rEquityValue = findRow(g, "IMPLIED EQUITY VALUE");
  const totalEv = g.getCell(`E${rTotalEv}`).value as number;
  const expectedEquity = totalEv - netDebt - minorityInterest + nonOperatingAssets;
  approxEqual(g.getCell(`E${rEquityValue}`).value as number, expectedEquity); // 2350
});

test("SOTP template: implied value per share divides equity value by diluted shares", () => {
  const g = new SpreadsheetGrid();
  feed(g, buildSotpModel(DEFAULT_SOTP_INPUTS));

  const rEquityValue = findRow(g, "IMPLIED EQUITY VALUE");
  const rValuePerShare = findRow(g, "IMPLIED VALUE PER SHARE ($)");
  const equity = g.getCell(`E${rEquityValue}`).value as number;
  approxEqual(g.getCell(`E${rValuePerShare}`).value as number, equity / DEFAULT_SOTP_INPUTS.dilutedShares); // 23.5
});
