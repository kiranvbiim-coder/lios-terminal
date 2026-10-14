import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { extractFragment, insertFragment } from "./componentFragment";

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

test("extractFragment: normalizes a range so its top-left cell becomes A1, preserving relative formula references", () => {
  const g = new SpreadsheetGrid();
  feed(g, { C5: "Label", D5: "10", D6: "=D5*2" });
  const fragment = extractFragment(g, 2, 4, 3, 5); // C5:D6, 0-based col 2-3, row 4-5
  assert.deepEqual(fragment, { A1: "Label", B1: "10", B2: "=B1*2" });
});

test("insertFragment: re-shifts an A1-relative fragment out to an arbitrary anchor, and is the exact inverse of extractFragment", () => {
  const fragment = { A1: "Label", B1: "10", B2: "=B1*2" };
  const cells = insertFragment(fragment, 5, 10); // anchor at col 5 (F), row 10 (11)
  assert.deepEqual(cells, { F11: "Label", G11: "10", G12: "=G11*2" });
});

test("extractFragment -> insertFragment round-trips a formula-driven block back to its original position unchanged", () => {
  const g = new SpreadsheetGrid();
  feed(g, { E8: "Revenue", F8: "100", F9: "=F8*1.1" });
  const fragment = extractFragment(g, 4, 7, 5, 8); // E8:F9
  const reinserted = insertFragment(fragment, 4, 7); // same anchor -> should reproduce the original refs/formulas
  assert.deepEqual(reinserted, { E8: "Revenue", F8: "100", F9: "=F8*1.1" });
});

test("extractFragment: skips blank cells inside the range instead of writing empty strings", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "5"); // B1 left blank
  const fragment = extractFragment(g, 0, 0, 1, 0); // A1:B1
  assert.deepEqual(fragment, { A1: "5" });
});

test("insertFragment: a cross-sheet-block reference (a formula pointing OUTSIDE the fragment's own range) still shifts consistently with everything else", () => {
  // A formula that references a cell outside the copied block (e.g. a shared assumption elsewhere on the sheet) shifts by the same delta as an in-block reference -- translateFormula doesn't know or care which references were "inside" the original selection.
  const fragment = { A1: "=Z99*2" };
  const cells = insertFragment(fragment, 2, 3);
  assert.equal(cells["C4"], "=AB102*2");
});
