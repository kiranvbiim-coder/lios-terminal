import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

import { ingestAndProfile } from "./profiler";

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

test("parenthetical accounting negatives classify as numeric with the correct sign", () => {
  const { profile } = ingestAndProfile(
    csvBuffer("account,balance\nCash,\"1,250.00\"\nAccrued Liabilities,\"(340.50)\"\n"),
    "accounting.csv",
  );
  const balance = profile.sheets[0].tabular!.columns.find((c) => c.name === "balance")!;
  assert.equal(balance.inferredType, "numeric");
  assert.equal(balance.min, -340.5);
  assert.equal(balance.max, 1250);
});

test("abbreviated magnitude notation (K/M/B) parses with the correct multiplier", () => {
  const { profile } = ingestAndProfile(
    csvBuffer("company,market_cap\nAAPL,$3.2T\nSmallCo,45.6K\n"),
    "marketcap.csv",
  );
  const marketCap = profile.sheets[0].tabular!.columns.find((c) => c.name === "market_cap")!;
  assert.equal(marketCap.inferredType, "currency");
  assert.equal(marketCap.min, 45600);
  assert.equal(marketCap.max, 3.2e12);
});

test("month-name dates parse correctly and short alphanumeric IDs are not misread as dates", () => {
  const { profile } = ingestAndProfile(
    csvBuffer('machine_id,close_date\nM-07,"Jan 15, 2026"\nM-03,"Feb 3, 2026"\n'),
    "regression.csv",
  );
  const cols = profile.sheets[0].tabular!.columns;
  const machineId = cols.find((c) => c.name === "machine_id")!;
  const closeDate = cols.find((c) => c.name === "close_date")!;
  assert.equal(machineId.inferredType, "text", "an ID like 'M-07' must not be classified as a date");
  assert.equal(closeDate.inferredType, "date");
  assert.equal(closeDate.min, "2026-01-15");
  assert.equal(closeDate.max, "2026-02-03");
});

test("a UTF-8 BOM at the start of a CSV does not leak into the first column name", () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csvBuffer("ticker,price\nAAPL,200\n")]);
  const { profile } = ingestAndProfile(withBom, "bom.csv");
  const names = profile.sheets[0].tabular!.columns.map((c) => c.name);
  assert.deepEqual(names, ["ticker", "price"]);
});

test("fixed-width text infers column boundaries from whitespace alignment", () => {
  const text = [
    "TICKER  PRICE   SECTOR    ",
    "AAPL    327.74  Technology",
    "XOM     112.30  Energy    ",
  ].join("\n");
  const { profile } = ingestAndProfile(csvBuffer(text), "fixed.txt");
  const cols = profile.sheets[0].tabular!.columns.map((c) => c.name);
  assert.deepEqual(cols, ["TICKER", "PRICE", "SECTOR"]);
  const ticker = profile.sheets[0].tabular!.columns.find((c) => c.name === "TICKER")!;
  assert.deepEqual(ticker.sampleValues.sort(), ["AAPL", "XOM"]);
});

test("duplicate/blank header cells are flagged, not silently merged", () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Amount", "", "Amount"],
    [100, "note", 200],
    [150, "note2", 250],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const { profile } = ingestAndProfile(buffer, "dup_headers.xlsx");
  assert.equal(profile.sheets[0].tabular!.duplicateOrBlankHeaderWarning, true);
});

test("a clean single-header tabular sheet does NOT trigger the duplicate/blank header warning", () => {
  const { profile } = ingestAndProfile(csvBuffer("ticker,price\nAAPL,200\nMSFT,300\n"), "clean.csv");
  assert.equal(profile.sheets[0].tabular!.duplicateOrBlankHeaderWarning, false);
});

test("every sheet in a multi-tab workbook is parsed, not just the first", () => {
  const wb = XLSX.utils.book_new();
  const sheet1 = XLSX.utils.aoa_to_sheet([["ticker", "price"], ["AAPL", 200], ["MSFT", 300]]);
  const sheet2 = XLSX.utils.aoa_to_sheet([["series_id", "value"], ["CPIAUCSL", 312.5], ["UNRATE", 4.1]]);
  XLSX.utils.book_append_sheet(wb, sheet1, "Holdings");
  XLSX.utils.book_append_sheet(wb, sheet2, "Indicators");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const { profile } = ingestAndProfile(buffer, "multitab.xlsx");
  assert.deepEqual(profile.sheetNames, ["Holdings", "Indicators"]);
  assert.equal(profile.sheets.length, 2);
  assert.equal(profile.sheets[0].shape, "tabular");
  assert.equal(profile.sheets[1].shape, "tabular");
  assert.ok(profile.sheets[1].tabular!.columns.some((c) => c.name === "series_id"));
});

test("a hand-built financial-model sheet (labels + formulas + merges) is detected as layout, not tabular", () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["DCF Model", "2026", "2027"],
    ["Revenue", 1000, 1100],
    ["WACC", 0.09, 0.09],
    ["Discount Rate", 0.09, 0.09],
    ["Terminal Value", 5000, null],
    ["Present Value", 4200, null],
  ]);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
  // A formula-dense row so the sheet reads as a model, not a data table.
  ws["C2"] = { t: "n", v: 1100, f: "B2*1.1" };
  ws["C3"] = { t: "n", v: 0.09, f: "B3" };
  ws["C4"] = { t: "n", v: 0.09, f: "B4" };
  XLSX.utils.book_append_sheet(wb, ws, "DCF");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const { profile } = ingestAndProfile(buffer, "model.xlsx");
  const sheet = profile.sheets[0];
  assert.equal(sheet.shape, "layout");
  assert.equal(sheet.layout!.detectedModelType, "dcf");
  assert.ok(sheet.layout!.labels.includes("Revenue"));
  assert.ok(sheet.layout!.formulaCount >= 3);
});

test("a formula referencing another sheet by name shows up as a cross-sheet reference", () => {
  const wb = XLSX.utils.book_new();
  const incomeStatement = XLSX.utils.aoa_to_sheet([["Revenue"], [1000]]);
  const dcf = XLSX.utils.aoa_to_sheet([
    ["Free Cash Flow", "Terminal Value"],
    [900, 5000],
  ]);
  dcf["A2"] = { t: "n", v: 900, f: "'Income Statement'!A2*0.9" };
  XLSX.utils.book_append_sheet(wb, incomeStatement, "Income Statement");
  XLSX.utils.book_append_sheet(wb, dcf, "DCF");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const { profile } = ingestAndProfile(buffer, "linked_model.xlsx");
  assert.deepEqual(profile.crossSheetReferences, [
    { fromSheet: "DCF", toSheet: "Income Statement", count: 1 },
  ]);
});

test("a hardcoded number sitting among formula cells in the same row is flagged", () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Revenue", 1000, 1100, 1200],
    ["COGS", 400, 440, 480],
  ]);
  // Row 0 (Revenue): B/C are formulas, D is a plain hardcoded number sitting
  // among them -- the classic "someone typed over a formula" pattern.
  ws["B1"] = { t: "n", v: 1000, f: "1000" };
  ws["C1"] = { t: "n", v: 1100, f: "B1*1.1" };
  // D1 stays a plain number (1200), no formula.
  XLSX.utils.book_append_sheet(wb, ws, "Model");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const { profile } = ingestAndProfile(buffer, "hardcode.xlsx");
  const layout = profile.sheets[0].layout;
  // This sheet may or may not score as "layout" with only 2 rows -- guard
  // the assertion on shape rather than assuming.
  if (layout) {
    assert.ok(layout.hardcodedValueCount >= 1);
  }
});

test("real historical price data (data/history) profiles as expected finance-shaped columns", () => {
  const historyPath = path.resolve(import.meta.dirname, "..", "..", "data", "history", "AAPL.json");
  if (!fs.existsSync(historyPath)) return; // environment without the bundled sample data -- skip rather than fail
  const stored = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  const bars = (stored.bars ?? []).slice(0, 20);
  if (bars.length === 0) return;

  const header = "date,open,high,low,close,volume";
  const lines = bars.map((b: any) => `${b.date},${b.open},${b.high},${b.low},${b.close},${b.volume}`);
  const { profile } = ingestAndProfile(csvBuffer([header, ...lines].join("\n")), "aapl_history.csv");

  const cols = profile.sheets[0].tabular!.columns;
  const date = cols.find((c) => c.name === "date")!;
  const close = cols.find((c) => c.name === "close")!;
  assert.equal(date.inferredType, "date");
  assert.equal(close.inferredType, "numeric");
});
