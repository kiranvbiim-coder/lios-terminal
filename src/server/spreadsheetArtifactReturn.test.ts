import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { artifactSpreadsheetToXlsxBytes } from "../client/src/lib/spreadsheetXlsx";
import { parseSpreadsheetArtifactImport } from "./spreadsheetArtifactImport";
import { reconcileReturnedSpreadsheet } from "./spreadsheetArtifactReturn";
import { hashLedgerValue } from "./ledgerStore";
const base = spreadsheetArtifactContentSchema.parse({ kind: "spreadsheet", activeSheetId: "model", sheets: [{ id: "model", name: "Model", rowCount: 30, columnCount: 12, cells: { A1: { raw: "1.2300", format: null }, B1: { raw: "=A1*2", format: "0.00" }, C1: { raw: "9007199254740993.25", format: "@" }, D1: { raw: "true", format: null } }, names: { Revenue: "A1" } }] });
const source = { artifactId: "artifact:owned:return", version: 3, contentHash: hashLedgerValue(base) };
const plan = { ...source, kind: "spreadsheet" as const, formats: ["xlsx" as const], filenameStem: "Owned model", sourceRefs: [] };
const bytes = () => artifactSpreadsheetToXlsxBytes(base, plan);
function parse(data: Uint8Array) { return parseSpreadsheetArtifactImport({ bytes: Buffer.from(data), originalName: "model.xlsx" }).content; }
test("unchanged real XLSX return retains raw decimal spellings, formulas, precision-sensitive text, names and dimensions", () => {
  assert.deepEqual(reconcileReturnedSpreadsheet(base, parse(bytes()), source), base);
});
test("actual native cell/formula/format changes return without accepting forged lineage or replacing the workbook identity", () => {
  const book = XLSX.read(bytes(), { type: "array", cellFormula: true, cellNF: true, sheetStubs: true });
  book.Sheets.Model.A1 = { t: "n", v: 2.5 };
  book.Sheets.Model.B1 = { t: "s", f: "A1*3", z: "0.000" };
  const returned = reconcileReturnedSpreadsheet(base, parse(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))), source);
  assert.equal(returned.sheets[0].id, "model");
  assert.equal(returned.sheets[0].cells.A1.raw, "2.5");
  assert.equal(returned.sheets[0].cells.B1.raw, "=A1*3");
  assert.equal(returned.sheets[0].cells.B1.format, "0.000");
  assert.equal(returned.sheets[0].cells.C1.raw, "9007199254740993.25");
  assert.throws(() => reconcileReturnedSpreadsheet(base, parse(bytes()), { ...source, version: 4 }));
  const missing = parse(bytes()); missing.sheets = missing.sheets.filter(sheet => sheet.name === "Model");
  assert.throws(() => reconcileReturnedSpreadsheet(base, missing, source));
});
