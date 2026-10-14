import assert from "node:assert/strict";
import test from "node:test";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { deriveSpreadsheetCellLineageStatus } from "@shared/spreadsheetCellLineage";
import { artifactSheetToGrid, gridToArtifactSheet } from "./artifactSpreadsheet";

const content = spreadsheetArtifactContentSchema.parse({
  kind: "spreadsheet", activeSheetId: "model", rendererPreference: "builtin",
  sheets: [{
    id: "model", name: "Model", rowCount: 30, columnCount: 12, names: { Revenue: "B4" },
    cells: {
      B4: { raw: "123.00", format: "#,##0.00", lineage: {
        kind: "reported_actual", custody: "server_projection", capturedRaw: "123.00", capturedFormat: "#,##0.00",
        datasetSnapshotId: "11111111-1111-4111-8111-111111111111", contentHash: "a".repeat(64),
        statement: "income", canonicalKey: "revenue", sourcePath: "financials.income[0].revenue",
        sourceRefs: ["filing:annual-2025"], period: "FY2025",
      } },
      C4: { raw: "=B4*(1+0.15)", format: "0.00", lineage: {
        kind: "engine_output", custody: "server_projection", capturedRaw: "=B4*(1+0.15)", capturedFormat: "0.00",
        modelRunId: "22222222-2222-4222-8222-222222222222", resultHash: "b".repeat(64),
        resultPath: "outputs.projectedRevenue", sourceRefs: ["run:valuation"],
      } },
      A1: { raw: "", format: "@" },
      A2: { raw: "", format: null, lineage: {
        kind: "user_assumption", custody: "user_authored", assumptionOrigin: "user_authored",
        capturedRaw: "", capturedFormat: null, sourceRefs: [],
      } },
    },
  }, { id: "sources", name: "Sources", cells: { B4: { raw: "Other sheet", format: null } } }],
});

test("builtin grid view/save preserves exact source lineage, blank formats and other sheets", () => {
  const grid = artifactSheetToGrid(content);
  const saved = gridToArtifactSheet(content, grid);
  assert.deepEqual(saved, content);
  assert.equal(deriveSpreadsheetCellLineageStatus(saved.sheets[0].cells.B4), "current");
  assert.equal(deriveSpreadsheetCellLineageStatus(saved.sheets[0].cells.A2), "authored_unverified");
  assert.equal(saved.sheets[1].cells.B4.lineage, undefined);
});

test("builtin raw and formula edits retain historical lineage and expose edited status", () => {
  const grid = artifactSheetToGrid(content);
  grid.setCell("B4", "456.00");
  grid.setCell("C4", "=B4*(1+0.20)");
  const saved = gridToArtifactSheet(content, grid);
  assert.equal(saved.sheets[0].cells.B4.raw, "456.00");
  assert.equal(saved.sheets[0].cells.C4.raw, "=B4*(1+0.20)");
  for (const ref of ["B4", "C4"]) {
    assert.deepEqual(saved.sheets[0].cells[ref].lineage, content.sheets[0].cells[ref].lineage);
    assert.equal(deriveSpreadsheetCellLineageStatus(saved.sheets[0].cells[ref]), "edited_unverified");
  }
  assert.equal(content.sheets[0].cells.B4.raw, "123.00", "baseline must remain immutable");
});

test("builtin format-only and cleared-cell edits do not drop recorded source history", () => {
  const grid = artifactSheetToGrid(content);
  grid.setFormat("B4", "0.0000");
  grid.setCell("C4", "");
  grid.setFormat("C4", null);
  grid.setFormat("D4", "0.0%");
  const saved = gridToArtifactSheet(content, grid);
  assert.equal(saved.sheets[0].cells.B4.raw, "123.00");
  assert.equal(saved.sheets[0].cells.B4.format, "0.0000");
  assert.equal(saved.sheets[0].cells.C4.raw, "");
  assert.equal(saved.sheets[0].cells.C4.format, null);
  assert.deepEqual(saved.sheets[0].cells.D4, { raw: "", format: "0.0%" });
  for (const ref of ["B4", "C4"]) {
    assert.deepEqual(saved.sheets[0].cells[ref].lineage, content.sheets[0].cells[ref].lineage);
    assert.equal(deriveSpreadsheetCellLineageStatus(saved.sheets[0].cells[ref]), "edited_unverified");
  }
  assert.deepEqual(gridToArtifactSheet(saved, artifactSheetToGrid(saved)), saved);
});

test("worksheet navigation flushes one P4 draft without losing either sheet's edits or source identity", () => {
  const source = spreadsheetArtifactContentSchema.parse({
    ...content,
    sheets: [
      { ...content.sheets[0], name: "HistoricalActuals" },
      { ...content.sheets[1], name: "Forecast", cells: {
        B4: { ...content.sheets[0].cells.C4, raw: "=100*(1+0.15)", lineage: {
          ...content.sheets[0].cells.C4.lineage, capturedRaw: "=100*(1+0.15)",
        } },
      } },
    ],
  });
  let draft = source;
  let grid = artifactSheetToGrid(draft);
  grid.setCell("B4", "456.00");
  draft = { ...gridToArtifactSheet(draft, grid), activeSheetId: "sources" };
  grid = artifactSheetToGrid(draft);
  assert.equal(grid.getCell("B4").raw, "=100*(1+0.15)", "same ref must read the selected worksheet");
  grid.setCell("B4", "=100*(1+0.20)");
  draft = { ...gridToArtifactSheet(draft, grid), activeSheetId: "model" };
  grid = artifactSheetToGrid(draft);
  assert.equal(grid.getCell("B4").raw, "456.00", "returning to a worksheet must restore its unsaved draft");
  grid.setFormat("B4", "0.0000");
  const saved = gridToArtifactSheet(draft, grid);
  assert.equal(saved.sheets[0].cells.B4.raw, "456.00");
  assert.equal(saved.sheets[0].cells.B4.format, "0.0000");
  assert.equal(saved.sheets[1].cells.B4.raw, "=100*(1+0.20)");
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(saved.sheets[index].cells.B4.lineage, source.sheets[index].cells.B4.lineage);
    assert.equal(deriveSpreadsheetCellLineageStatus(saved.sheets[index].cells.B4), "edited_unverified");
  }
  assert.equal(source.sheets[0].cells.B4.raw, "123.00");
  assert.equal(source.sheets[1].cells.B4.raw, "=100*(1+0.15)");
  assert.deepEqual(saved.sheets[0].names, { Revenue: "B4" });
});

test("builtin adapter preserves unchanged canonical name spelling while new and retargeted names use grid convention", () => {
  const grid = artifactSheetToGrid(content);
  grid.defineName("DiscountRate", "A2");
  let saved = gridToArtifactSheet(content, grid);
  assert.deepEqual(saved.sheets[0].names, { Revenue: "B4", DISCOUNTRATE: "A2" });
  grid.defineName("revenue", "B5");
  saved = gridToArtifactSheet(content, grid);
  assert.deepEqual(saved.sheets[0].names, { REVENUE: "B5", DISCOUNTRATE: "A2" });
});
