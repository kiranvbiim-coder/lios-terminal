import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import {
  buildExportMetadataRows,
  buildWorkbookBytes,
  exportWorkbook,
  formulaCell,
  normalizeExportSheets,
  inputCell,
  prepareExportSheets,
  type ExportContext,
  type ExportSheet,
} from "./exportXlsx";
import { exportPdfReport } from "./exportPdf";

test("normalizeExportSheets deduplicates names deterministically within Excel's 31-character limit", () => {
  const sheets: ExportSheet[] = [
    { name: "A".repeat(40), rows: [["value"]] },
    { name: "A".repeat(40), rows: [["value"]] },
    { name: "A".repeat(40), rows: [["value"]] },
  ];

  const normalized = normalizeExportSheets(sheets);

  assert.deepEqual(normalized.map((sheet) => sheet.name), [
    "A".repeat(31),
    `${"A".repeat(27)} (2)`,
    `${"A".repeat(27)} (3)`,
  ]);
});

test("buildExportMetadataRows emits stable context rows without inventing missing values", () => {
  const context: ExportContext = {
    model: "three-statement",
    scenario: "base",
    assumptions: { taxRate: 0.25, includeDebt: true },
    provenance: ["sec:10-k", "source:internal"],
    modelHash: "abc123",
    generatedAt: "2026-08-14T12:00:00.000Z",
  };

  assert.deepEqual(buildExportMetadataRows(context), [
    ["Key", "Value"],
    ["Model", "three-statement"],
    ["Scenario", "base"],
    ["Model Hash", "abc123"],
    ["Generated At", "2026-08-14T12:00:00.000Z"],
    ["Assumption: includeDebt", "true"],
    ["Assumption: taxRate", "0.25"],
    ["Provenance", "sec:10-k; source:internal"],
  ]);
});

test("buildExportMetadataRows omits absent optional context instead of adding fake defaults", () => {
  assert.deepEqual(buildExportMetadataRows({ scenario: "downside" }), [
    ["Key", "Value"],
    ["Scenario", "downside"],
  ]);
});

test("prepareExportSheets applies only explicit bounds and reports truncation", () => {
  const sheets: ExportSheet[] = [
    { name: "Forecast", rows: [["Year", "Revenue"], ["2026", 100], ["2027", 120]] },
  ];

  const prepared = prepareExportSheets(sheets, { maxRowsPerSheet: 2, maxColumnsPerSheet: 1 });

  assert.deepEqual(prepared.sheets, [
    { name: "Forecast", rows: [["Year"], ["2026"]] },
  ]);
  assert.deepEqual(prepared.notes, [
    { name: "Forecast", rowsTruncated: 1, columnsTruncated: 1 },
  ]);
  assert.deepEqual(sheets[0].rows, [["Year", "Revenue"], ["2026", 100], ["2027", 120]]);
});

test("prepareExportSheets rejects invalid bounds instead of silently falling back", () => {
  assert.throws(
    () => prepareExportSheets([{ name: "Forecast", rows: [["value"]] }], { maxRowsPerSheet: 0 }),
    /maxRowsPerSheet must be a positive integer/,
  );
});
test("exportWorkbook returns an explicit delivery failure for invalid input", () => {
  assert.deepEqual(exportWorkbook("", []), {
    ok: false,
    filename: "",
    error: "A filename is required",
  });
});

test("buildWorkbookBytes preserves live formulas and professional cell roles", () => {
  const bytes = buildWorkbookBytes([
    {
      name: "Model",
      rows: [
        ["Metric", "Value"],
        ["Revenue", inputCell(100)],
        ["EBITDA", formulaCell("B2*20%", 20)],
      ],
    },
  ]);
  const workbook = XLSX.read(bytes, { type: "array", cellFormula: true });
  assert.equal(workbook.Sheets.Model.B3.f, "B2*20%");
  assert.equal(workbook.Sheets.Model.B3.v, 20);

  const files = unzipSync(bytes);
  const styles = new TextDecoder().decode(files["xl/styles.xml"]);
  const sheet = new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]);
  assert.match(styles, /Arial/);
  assert.match(sheet, /<c r="B2"[^>]* s="3"/);
  assert.match(sheet, /<c r="B3"[^>]* s="4"/);
});

test("exportPdfReport returns an explicit delivery failure for invalid input", () => {
  assert.deepEqual(exportPdfReport("", "Report", []), {
    ok: false,
    filename: "",
    error: "A filename is required",
  });
});
