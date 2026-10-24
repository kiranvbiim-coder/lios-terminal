import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const univer = readFileSync(new URL("../components/terminal/UniverSpreadsheetEditor.tsx", import.meta.url), "utf8");
const pane = readFileSync(new URL("../components/terminal/ArtifactPane.tsx", import.meta.url), "utf8");
const projection = readFileSync(new URL("../../../shared/univerArtifact.ts", import.meta.url), "utf8");

test("WS-38 both actual spreadsheet editors review against exact P4 worksheet and never an unsaved cell", () => {
  assert.match(univer, /prepareSpreadsheetCellReview\(baseline\.content, sheetId, cellRef, proposedRaw\)/);
  assert.match(pane, /prepareSpreadsheetCellReview\(baseline\.current\.content, sheet\.id, ref, value\)/);
  assert.match(univer, /const reviewRefValid = checkedSpreadsheetCellRef\(activeReviewSheet, cellRef\) !== null/);
  assert.match(pane, /const reviewRef = checkedSpreadsheetCellRef\(sheet, ref\)/);
  assert.match(univer, /aria-invalid=\{!reviewRefValid\}/);
  assert.match(pane, /aria-invalid=\{!reviewRef\}/);
  assert.match(univer, /disabled=\{!ready \|\| saving \|\| disabled \|\| conflict \|\| recovery\.blocked \|\| !reviewRefValid\}/);
  assert.match(pane, /disabled=\{!reviewRef\} onClick=\{\(\) => void propose\(\)\}/);
});

test("WS-38 malformed selected-cell references never reach built-in grid engine or crash source inspector", () => {
  assert.match(pane, /const selectedInBounds = checkedSpreadsheetCellRef\(sheet, selectedRef\) !== null/);
  assert.match(pane, /const selectedCell = selectedInBounds\s*\?/);
  assert.match(pane, /selectedInBounds && selectedCell \? <SpreadsheetCellSourceInspect/);
  assert.match(pane, /value=\{selectedCell\?\.format \?\? ""\}/);
  assert.match(pane, /Select a cell reference within this worksheet to inspect its recorded source/);
  assert.match(pane, /const checkpoint = gridToArtifactSheet\(draftContent, grid\)/);
});

test("WS-38 failed saves never silently succeed or lose the unsaved revision", () => {
  assert.match(pane, /const \[saveError, setSaveError\] = useState<string \| null>\(null\)/);
  assert.match(pane, /try \{ await onSave\(next\); \}/);
  assert.match(pane, /catch \(cause\) \{ setSaveError\(/);
  assert.match(pane, /role="alert" data-testid="spreadsheet-save-error"/);
  assert.match(pane, /<fieldset disabled=\{disabled \|\| saving \|\| conflict \|\| recovery\.blocked\}/);
  assert.match(univer, /finally \{\s*setSaving\(false\);\s*\}/);
  assert.match(univer, /setError\(cause instanceof Error/);
});

test("WS-38 no synthetic table results, outside-P4 persistence or invented cell-level source verification", () => {
  assert.match(projection, /Univer cell at row/);
  assert.match(projection, /exceeds worksheet dimensions; no P4 revision was saved/);
  assert.match(univer, /<SpreadsheetCellSourceInspect sheetName=/);
  assert.match(pane, /<SpreadsheetCellSourceInspect sheetName=/);
  assert.doesNotMatch(univer, /localStorage\.setItem|persistConversationDraft|createArtifactVersion/);
});
