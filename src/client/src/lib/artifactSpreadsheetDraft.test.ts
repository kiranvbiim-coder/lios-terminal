import assert from "node:assert/strict";
import test from "node:test";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { fromUniverWorkbookSnapshot, toUniverWorkbookProjection } from "@shared/univerArtifact";
import { artifactSheetToGrid, gridToArtifactSheet } from "./artifactSpreadsheet";
import { spreadsheetDraftHasChanges } from "./artifactSpreadsheetDraft";

const content = spreadsheetArtifactContentSchema.parse({
  kind: "spreadsheet", activeSheetId: "model", rendererPreference: "builtin",
  sheets: [
    { id: "model", name: "Model", rowCount: 30, columnCount: 12, names: { Revenue: "B4" }, cells: {
      B4: { raw: "123.00", format: "0.00" }, C4: { raw: "=B4*(1+0.15)", format: "0.00" },
      A1: { raw: "", format: null },
    } },
    { id: "actuals", name: "HistoricalActuals", cells: { B4: { raw: "111.00", format: "0.00" } } },
  ],
});

test("draft guard ignores worksheet navigation, renderer choice, object-key order and calculation caches", () => {
  assert.equal(spreadsheetDraftHasChanges(content, { ...content, activeSheetId: "actuals", rendererPreference: "univer" }), false);
  const reordered = structuredClone(content);
  reordered.sheets[0].cells = { C4: reordered.sheets[0].cells.C4, B4: reordered.sheets[0].cells.B4 };
  assert.equal(spreadsheetDraftHasChanges(content, reordered), false, "empty unformatted cells and object order are not changes");
  const projection = toUniverWorkbookProjection(content);
  projection.sheets.model.cellData![3]![2]!.v = 141.45;
  const cached = fromUniverWorkbookSnapshot(projection, content, "actuals");
  assert.equal(spreadsheetDraftHasChanges(content, cached), false);
});

test("real raw, formula and number-format edits dirty the draft and reverting clears it", () => {
  const grid = artifactSheetToGrid(content);
  grid.setCell("B4", "456.00");
  assert.equal(spreadsheetDraftHasChanges(content, gridToArtifactSheet(content, grid)), true);
  grid.setCell("B4", "123.00");
  assert.equal(spreadsheetDraftHasChanges(content, gridToArtifactSheet(content, grid)), false);
  grid.setFormat("B4", "0.0000");
  assert.equal(spreadsheetDraftHasChanges(content, gridToArtifactSheet(content, grid)), true);
  grid.setFormat("B4", "0.00");
  grid.setCell("C4", "=B4*(1+0.20)");
  assert.equal(spreadsheetDraftHasChanges(content, gridToArtifactSheet(content, grid)), true);
  grid.setCell("C4", "=B4*(1+0.15)");
  assert.equal(spreadsheetDraftHasChanges(content, gridToArtifactSheet(content, grid)), false);
});

test("Univer direct edits and clears dirty the same canonical consumer draft", () => {
  const projection = toUniverWorkbookProjection(content);
  projection.sheets.model.cellData![3]![1]!.v = 456;
  assert.equal(spreadsheetDraftHasChanges(content, fromUniverWorkbookSnapshot(projection, content, "model")), true);
  projection.sheets.model.cellData![3]![1]!.v = 123;
  assert.equal(spreadsheetDraftHasChanges(content, fromUniverWorkbookSnapshot(projection, content, "actuals")), false);
  projection.sheets.model.cellData![3]![2]!.f = "=B4*(1+0.20)";
  assert.equal(spreadsheetDraftHasChanges(content, fromUniverWorkbookSnapshot(projection, content, "model")), true);
  projection.sheets.model.cellData![3]![2]!.f = "=B4*(1+0.15)";
  projection.sheets.model.cellData![3]![1] = null;
  assert.equal(spreadsheetDraftHasChanges(content, fromUniverWorkbookSnapshot(projection, content, "model")), true);
});

test("worksheet identity, order, dimensions, names and cell insertions/removals dirty the draft", () => {
  const rename = structuredClone(content);
  rename.sheets[1].name = "RenamedActuals";
  const resize = structuredClone(content);
  resize.sheets[0].rowCount++;
  const names = structuredClone(content);
  names.sheets[0].names.Revenue = "B5";
  const insert = structuredClone(content);
  insert.sheets[1].cells.C4 = { raw: "0.15", format: "0.0%" };
  const remove = structuredClone(content);
  delete remove.sheets[1].cells.B4;
  const reordered = { ...content, sheets: [content.sheets[1], content.sheets[0]] };
  const removedSheet = { ...content, sheets: [content.sheets[0]] };
  for (const next of [rename, resize, names, insert, remove, reordered, removedSheet]) {
    assert.equal(spreadsheetDraftHasChanges(content, next), true);
  }
  assert.equal(spreadsheetDraftHasChanges(content, { ...content, calculationMode: "manual" }), true);
});

test("unsaved edits remain dirty across native worksheet navigation until the complete saved baseline changes", () => {
  let draft = content;
  let grid = artifactSheetToGrid(draft);
  grid.setCell("B4", "456.00");
  draft = { ...gridToArtifactSheet(draft, grid), activeSheetId: "actuals" };
  grid = artifactSheetToGrid(draft);
  assert.equal(spreadsheetDraftHasChanges(content, gridToArtifactSheet(draft, grid)), true);
  grid.setCell("B4", "222.00");
  const saved = gridToArtifactSheet(draft, grid);
  assert.equal(spreadsheetDraftHasChanges(content, saved), true);
  assert.equal(spreadsheetDraftHasChanges(saved, gridToArtifactSheet(saved, artifactSheetToGrid(saved))), false);
});
