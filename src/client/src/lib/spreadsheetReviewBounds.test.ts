import assert from "node:assert/strict";
import test from "node:test";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { checkedSpreadsheetCellRef, prepareSpreadsheetCellReview } from "./spreadsheetReviewBounds";

const source = spreadsheetArtifactContentSchema.parse({
  kind: "spreadsheet", rendererPreference: "builtin", activeSheetId: "model",
  sheets: [
    { id: "model", name: "Model", rowCount: 4, columnCount: 3, cells: {
      B4: { raw: "=A4*1.15", format: "0.00", lineage: {
        kind: "user_assumption", custody: "user_authored", assumptionOrigin: "user_authored",
        capturedRaw: "=A4*1.15", capturedFormat: "0.00", sourceRefs: [],
      } },
    } },
    { id: "data", name: "Data", rowCount: 2, columnCount: 1, cells: { A1: { raw: "Original", format: null } } },
  ],
});

test("WS-38 review references normalize only valid cells inside exact worksheet bounds", () => {
  const sheet = source.sheets[0];
  assert.equal(checkedSpreadsheetCellRef(sheet, " b4 "), "B4");
  assert.equal(checkedSpreadsheetCellRef(sheet, "C4"), "C4");
  for (const ref of ["A0", "D1", "A5", "ZZ999", "B99999999", "A-1", "A1:B2", "B 4", "=B4", "", "XX"]) {
    assert.equal(checkedSpreadsheetCellRef(sheet, ref), null, ref);
  }
  assert.equal(checkedSpreadsheetCellRef(undefined, "A1"), null);
  assert.equal(checkedSpreadsheetCellRef(source.sheets[1], "B1"), null);
});

test("WS-38 review diff is based on canonical P4 before, not an in-memory displayed formula", () => {
  const review = prepareSpreadsheetCellReview(source, "model", " b4 ", "=A4*1.20");
  assert.equal(review.sheetId, "model");
  assert.equal(review.ref, "B4");
  assert.deepEqual(review.before, source.sheets[0].cells.B4);
  assert.deepEqual(review.after, { ...source.sheets[0].cells.B4, raw: "=A4*1.20" });
  assert.equal(review.after?.lineage?.capturedRaw, "=A4*1.15", "historical source identity must not be promoted to a new verification");
  assert.equal(source.sheets[0].cells.B4.raw, "=A4*1.15", "the canonical baseline is immutable");
  const newCell = prepareSpreadsheetCellReview(source, "model", "C1", "1.000");
  assert.equal(newCell.before, null);
  assert.deepEqual(newCell.after, { raw: "1.000", format: null });
  const otherSheet = prepareSpreadsheetCellReview(source, "data", "A1", "Changed");
  assert.equal(otherSheet.before?.raw, "Original");
  assert.equal(otherSheet.ref, "A1");
});

test("WS-38 refusal gives a readable error and cannot dispatch invalid review diffs", () => {
  for (const ref of ["", "A0", "Z9", "A5", "B0", "A1:C2"]) {
    assert.throws(() => prepareSpreadsheetCellReview(source, "model", ref, "new value"),
      /outside worksheet|No review diff/, ref);
  }
  assert.throws(() => prepareSpreadsheetCellReview(source, "deleted", "A1", "new value"),
    /no longer in this saved Artifact/);
  assert.throws(() => prepareSpreadsheetCellReview(source, "model", "A1", "x".repeat(100_001)),
    /100,000-character limit/);
});
