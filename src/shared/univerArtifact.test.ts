import assert from "node:assert/strict";
import test from "node:test";
import { spreadsheetArtifactContentSchema } from "./artifactContracts";
import { fromUniverCellData, fromUniverWorkbookSnapshot, toUniverWorkbookProjection } from "./univerArtifact";
import { deriveSpreadsheetCellLineageStatus } from "./spreadsheetCellLineage";
import { createRequire } from "node:module";
import type { IWorkbookData, Workbook } from "@univerjs/core";
import type * as UniverCore from "@univerjs/core";
import type * as UniverFormula from "@univerjs/engine-formula";
import type * as UniverSheets from "@univerjs/sheets";

// Node uses the donor's declared CommonJS entry; keep all DI tokens/plugins on that same module graph.
const require = createRequire(import.meta.url);
const { IResourceLoaderService, Univer, UniverInstanceType } = require("@univerjs/core") as typeof UniverCore;
const { IDefinedNamesService, UniverFormulaEnginePlugin } = require("@univerjs/engine-formula") as typeof UniverFormula;
const { UniverSheetsPlugin } = require("@univerjs/sheets") as typeof UniverSheets;

const content = spreadsheetArtifactContentSchema.parse({
  kind: "spreadsheet", rendererPreference: "univer", activeSheetId: "model",
  sheets: [{ id: "model", name: "Model", rowCount: 500, columnCount: 50, names: { Sales: "B4" }, cells: {
    B4: { raw: "123.00", format: "#,##0.00" }, AA101: { raw: "=SUM(B4:B5)", format: "0.00" },
    A2: { raw: "001", format: null }, C3: { raw: "TRUE", format: null },
  } }, { id: "sources", name: "Sources", rowCount: 10, columnCount: 5, cells: { A1: { raw: "Source evidence", format: null } } }],
});

test("real Univer snapshot coordinates roundtrip formulas, untouched raw values, formats, multi-sheet content and names", () => {
  const projected = toUniverWorkbookProjection(content);
  assert.equal(projected.sheets.model.cellData?.[100]?.[26]?.f, "=SUM(B4:B5)");
  assert.equal(projected.sheets.model.cellData?.[3]?.[1]?.v, 123);
  assert.equal(projected.sheets.model.cellData?.[1]?.[0]?.v, "001");
  assert.deepEqual(fromUniverWorkbookSnapshot(projected, content, "model"), content);
});

test("edits and cleared cells are serialized, formula caches never replace source formulas", () => {
  const projected = toUniverWorkbookProjection(content);
  projected.sheets.model.cellData![3]![1]!.v = 456;
  projected.sheets.model.cellData![100]![26]!.v = 579;
  projected.sheets.model.cellData![1]![0] = { v: null };
  const saved = fromUniverWorkbookSnapshot(projected, content, "sources");
  assert.equal(saved.activeSheetId, "sources");
  assert.equal(saved.sheets[0]!.cells.B4.raw, "456");
  assert.equal(saved.sheets[0]!.cells.AA101.raw, "=SUM(B4:B5)");
  assert.equal(saved.sheets[0]!.cells.A2, undefined);
  assert.equal(saved.sheets[1]!.cells.A1.raw, "Source evidence");
});

test("style-table number formats are retained on saves", () => {
  const projected = toUniverWorkbookProjection(content);
  projected.styles.money = { n: { pattern: "$#,##0.00" } };
  projected.sheets.model.cellData![3]![1]!.s = "money";
  const saved = fromUniverWorkbookSnapshot(projected, content, "model");
  assert.equal(saved.sheets[0]!.cells.B4.format, "$#,##0.00");
});

test("malformed cell references and dimensions fail before creating an editable workbook", () => {
  assert.throws(() => toUniverWorkbookProjection({ ...content, sheets: [{ ...content.sheets[0], cells: { A0: { raw: "x" } } }] }), /reference/);
  assert.throws(() => toUniverWorkbookProjection({ ...content, sheets: [{ ...content.sheets[0], rowCount: 1 }] }), /dimensions/);
});

test("precision-safe projection retains exact decimals and explicit text formats through editing snapshots", () => {
  const source = spreadsheetArtifactContentSchema.parse({
    ...content,
    sheets: [{ ...content.sheets[0], cells: {
      A1: { raw: "9007199254740993", format: null },
      A2: { raw: "12345678901234567890.123456789", format: "0.000000000" },
      A3: { raw: "0.10000000000000000001", format: null },
      A4: { raw: "1e-400", format: null },
      A5: { raw: "123.00", format: "@" },
      A6: { raw: "TRUE", format: "@" },
      A7: { raw: "123.00", format: "0.00" },
      A8: { raw: "=Revenue*(1+0.15)", format: "0.00" },
    } }],
  });
  const projection = toUniverWorkbookProjection(source);
  for (let row = 0; row < 6; row++) {
    assert.equal(projection.sheets.model.cellData?.[row]?.[0]?.t, 1);
    assert.equal(projection.sheets.model.cellData?.[row]?.[0]?.v, source.sheets[0].cells[`A${row + 1}`].raw);
  }
  assert.equal(projection.sheets.model.cellData?.[6]?.[0]?.v, 123);
  assert.deepEqual(fromUniverWorkbookSnapshot(projection, source, "model"), source);
  projection.sheets.model.cellData![6]![0]!.s = { n: { pattern: "0.0000" } };
  projection.sheets.model.cellData![7]![0]!.v = 115;
  const saved = fromUniverWorkbookSnapshot(projection, source, "model");
  assert.equal(saved.sheets[0].cells.A7.raw, "123.00", "format-only edits must not rewrite canonical decimal text");
  assert.equal(saved.sheets[0].cells.A8.raw, "=Revenue*(1+0.15)");
});

test("native Univer defined-name resources register local duplicate names and survive real donor save/reopen", () => {
  const source = spreadsheetArtifactContentSchema.parse({
    ...content,
    sheets: [
      { ...content.sheets[0], name: "Owner's Model", names: { Revenue: "B4:B5" } },
      { ...content.sheets[1], names: { Revenue: "A1" } },
    ],
  });
  const univer = new Univer();
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  try {
    const projection = toUniverWorkbookProjection(source);
    const workbook = univer.createUnit<IWorkbookData, Workbook>(UniverInstanceType.UNIVER_SHEET, projection);
    const service = univer.__getInjector().get(IDefinedNamesService);
    assert.equal(service.getValueByName(workbook.getUnitId(), "Revenue", "model")?.formulaOrRefString,
      "'Owner''s Model'!$B$4:$B$5");
    assert.equal(service.getValueByName(workbook.getUnitId(), "Revenue", "sources")?.formulaOrRefString,
      "'Sources'!$A$1");
    const existing = service.getValueByName(workbook.getUnitId(), "Revenue", "model")!;
    service.registerDefinedName(workbook.getUnitId(), { ...existing, name: "Sales", formulaOrRefString: "'Owner''s Model'!$B$4" });
    const saved = univer.__getInjector().get(IResourceLoaderService).saveUnit<IWorkbookData>(workbook.getUnitId());
    assert.ok(saved);
    const canonical = fromUniverWorkbookSnapshot(saved, source, "model");
    assert.deepEqual(canonical.sheets[0].names, { Sales: "B4" });
    assert.deepEqual(canonical.sheets[1].names, { Revenue: "A1" });
    assert.deepEqual(fromUniverWorkbookSnapshot(toUniverWorkbookProjection(canonical), canonical, "model"), canonical);
  } finally {
    univer.dispose();
  }
});

test("defined-name resource removals are canonical and unsupported workbook scopes fail visibly", () => {
  const projected = toUniverWorkbookProjection(content);
  projected.resources![0].data = "{}";
  assert.deepEqual(fromUniverWorkbookSnapshot(projected, content, "model").sheets[0].names, {});
  projected.resources![0].data = JSON.stringify({ global: { id: "global", name: "Sales", formulaOrRefString: "'Model'!$B$4" } });
  assert.throws(() => fromUniverWorkbookSnapshot(projected, content, "model"), /unsupported worksheet scope/);
});

const linkedContent = spreadsheetArtifactContentSchema.parse({
  ...content,
  sheets: [{
    ...content.sheets[0],
    cells: {
      B4: { raw: "123.00", format: "#,##0.00", lineage: {
        kind: "reported_actual", custody: "server_projection",
        capturedRaw: "123.00", capturedFormat: "#,##0.00", capturedValueHash: "a".repeat(64),
        datasetSnapshotId: "11111111-1111-4111-8111-111111111111", contentHash: "b".repeat(64),
        statement: "income", canonicalKey: "revenue", sourcePath: "financials.income[0].revenue",
        period: "FY2025", sourceRefs: ["filing:annual-2025"], currency: "USD", sourceUnit: "millions",
      } },
      AA101: { raw: "=SUM(B4:B5)", format: "0.00", lineage: {
        kind: "engine_output", custody: "server_projection", capturedRaw: "=SUM(B4:B5)", capturedFormat: "0.00",
        modelRunId: "22222222-2222-4222-8222-222222222222", resultHash: "c".repeat(64),
        resultPath: "outputs.projectedRevenue", sourceRefs: ["run:valuation"],
      } },
    },
  }, { ...content.sheets[1], cells: { B4: { raw: "Other sheet", format: null } } }],
});

test("Univer view/save and format edits retain exact P4 lineage keyed by sheet ID and cell ref", () => {
  const projected = toUniverWorkbookProjection(linkedContent);
  assert.deepEqual(fromUniverWorkbookSnapshot(projected, linkedContent, "model"), linkedContent);
  projected.sheets.model.cellData![3]![1]!.s = { n: { pattern: "$#,##0.00" } };
  const saved = fromUniverWorkbookSnapshot(projected, linkedContent, "model");
  const actual = saved.sheets[0].cells.B4;
  assert.equal(actual.raw, "123.00");
  assert.deepEqual(actual.lineage, linkedContent.sheets[0].cells.B4.lineage);
  assert.equal(deriveSpreadsheetCellLineageStatus(actual), "edited_unverified");
  assert.equal(saved.sheets[1].cells.B4.lineage, undefined, "same ref on another sheet must not acquire source lineage");
  assert.deepEqual(fromUniverWorkbookSnapshot(toUniverWorkbookProjection(saved), saved, "model"), saved);
});

test("direct raw/formula edits and formula caches retain historical bindings without claiming unchanged sources", () => {
  const projected = toUniverWorkbookProjection(linkedContent);
  const actualCell = projected.sheets.model.cellData![3]![1]!;
  actualCell.v = 456;
  const formulaCell = projected.sheets.model.cellData![100]![26]!;
  formulaCell.f = "=SUM(B4:B6)";
  formulaCell.v = 900;
  const saved = fromUniverWorkbookSnapshot(projected, linkedContent, "model");
  assert.equal(saved.sheets[0].cells.B4.raw, "456");
  assert.equal(saved.sheets[0].cells.AA101.raw, "=SUM(B4:B6)");
  for (const ref of ["B4", "AA101"]) {
    assert.deepEqual(saved.sheets[0].cells[ref].lineage, linkedContent.sheets[0].cells[ref].lineage);
    assert.equal(deriveSpreadsheetCellLineageStatus(saved.sheets[0].cells[ref]), "edited_unverified");
  }
  assert.deepEqual(fromUniverCellData(actualCell, linkedContent.sheets[0].cells.B4, "#,##0.00"), saved.sheets[0].cells.B4);
  assert.deepEqual(fromUniverCellData(formulaCell, linkedContent.sheets[0].cells.AA101, "0.00"), saved.sheets[0].cells.AA101);
  formulaCell.f = "=SUM(B4:B5)";
  const cached = fromUniverWorkbookSnapshot(projected, linkedContent, "model").sheets[0].cells.AA101;
  assert.equal(cached.raw, "=SUM(B4:B5)");
  assert.equal(deriveSpreadsheetCellLineageStatus(cached), "current");
});

test("cleared or absent Univer cells preserve historical lineage without restoring captured values", () => {
  const projected = toUniverWorkbookProjection(linkedContent);
  projected.sheets.model.cellData![3]![1] = null;
  delete projected.sheets.model.cellData![100]![26];
  const saved = fromUniverWorkbookSnapshot(projected, linkedContent, "model");
  for (const ref of ["B4", "AA101"]) {
    assert.equal(saved.sheets[0].cells[ref].raw, "");
    assert.equal(saved.sheets[0].cells[ref].format, null);
    assert.deepEqual(saved.sheets[0].cells[ref].lineage, linkedContent.sheets[0].cells[ref].lineage);
    assert.equal(deriveSpreadsheetCellLineageStatus(saved.sheets[0].cells[ref]), "edited_unverified");
  }
  assert.deepEqual(fromUniverWorkbookSnapshot(toUniverWorkbookProjection(saved), saved, "model"), saved);
});

test("donor custom metadata cannot mint or overwrite canonical P4 lineage", () => {
  const projected = toUniverWorkbookProjection(linkedContent);
  const actualCell = projected.sheets.model.cellData![3]![1]!;
  Object.assign(actualCell, { custom: { lineage: { ...linkedContent.sheets[0].cells.B4.lineage, capturedRaw: "forged" } } });
  projected.sheets.sources.cellData![3]![1] = { v: "Other sheet", custom: { lineage: linkedContent.sheets[0].cells.B4.lineage } };
  const saved = fromUniverWorkbookSnapshot(projected, linkedContent, "model");
  assert.deepEqual(saved.sheets[0].cells.B4.lineage, linkedContent.sheets[0].cells.B4.lineage);
  assert.equal(saved.sheets[1].cells.B4.lineage, undefined);
});

test("real donor workbook save/reopen preserves canonical source-linked cells without a donor lineage store", () => {
  const univer = new Univer();
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  try {
    const workbook = univer.createUnit<IWorkbookData, Workbook>(UniverInstanceType.UNIVER_SHEET, toUniverWorkbookProjection(linkedContent));
    const saved = univer.__getInjector().get(IResourceLoaderService).saveUnit<IWorkbookData>(workbook.getUnitId());
    assert.ok(saved);
    const canonical = fromUniverWorkbookSnapshot(saved, linkedContent, "model");
    assert.deepEqual(canonical, linkedContent);
    assert.deepEqual(fromUniverWorkbookSnapshot(toUniverWorkbookProjection(canonical), canonical, "model"), canonical);
  } finally {
    univer.dispose();
  }
});
