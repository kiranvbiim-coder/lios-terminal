import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { spreadsheetArtifactContentSchema, spreadsheetCellLineageSchema } from "./artifactContracts";
import type { SpreadsheetCellLineage } from "./artifactContracts";
import { deriveSpreadsheetCellLineageStatus, guardSpreadsheetCellLineage, mergeSpreadsheetCellLineage } from "./spreadsheetCellLineage";
import type { SpreadsheetContent } from "./spreadsheetCellLineage";

const lineage: SpreadsheetCellLineage = {
  kind: "reported_actual", custody: "server_projection", datasetSnapshotId: "00000000-0000-4000-8000-000000000001",
  contentHash: "a".repeat(64), capturedRaw: "1000.125", capturedFormat: null,
  statement: "income", canonicalKey: "revenue", sourcePath: "periods.0.income.revenue", sourceRefs: ["dataset-snapshot:fixture"],
  period: "FY", fiscalYear: "2023", periodEnd: "2023-12-31", availableAt: "2024-02-15T00:00:00.000Z", currency: "USD",
  numericRepresentation: "js_number_roundtrip",
};
function workbook(): SpreadsheetContent {
  return spreadsheetArtifactContentSchema.parse({ kind: "spreadsheet", sheets: [{ id: "actuals", name: "Actuals", cells: { C6: { raw: "1000.125", format: null, lineage } }, names: {}, rowCount: 6, columnCount: 3 }], activeSheetId: "actuals", rendererPreference: "builtin", calculationMode: "manual" });
}
const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("optional lineage leaves historical raw/format-only workbook bytes and hash unchanged", () => {
  const historical = workbook();
  delete historical.sheets[0].cells.C6.lineage;
  const before = JSON.stringify(historical);
  const parsed = spreadsheetArtifactContentSchema.parse(historical);
  assert.equal(JSON.stringify(parsed), before);
  assert.equal(digest(parsed), digest(historical));
  assert.equal("lineage" in parsed.sheets[0].cells.C6, false);
  assert.equal(deriveSpreadsheetCellLineageStatus(parsed.sheets[0].cells.C6), "unbound");
});

test("raw, formula and format edits preserve captured immutable history but demote live binding", () => {
  const base = workbook();
  for (const [raw, format] of [["1001", null], ["=C6*2", null], ["1000.125", "0.00"], ["", null]] as const) {
    const next = structuredClone(base);
    next.sheets[0].cells.C6 = { raw, format };
    const merged = mergeSpreadsheetCellLineage(base, next);
    assert.deepEqual(merged.sheets[0].cells.C6.lineage, base.sheets[0].cells.C6.lineage);
    assert.equal(merged.sheets[0].cells.C6.raw, raw);
    assert.equal(deriveSpreadsheetCellLineageStatus(merged.sheets[0].cells.C6), "edited_unverified");
    assert.equal(base.sheets[0].cells.C6.raw, "1000.125");
  }
  assert.equal(deriveSpreadsheetCellLineageStatus(base.sheets[0].cells.C6), "current");
});

test("unchanged merge retains identity, ordering and content hash; sheet identities never leak bindings", () => {
  const base = workbook();
  assert.equal(mergeSpreadsheetCellLineage(base, base), base);
  const next = structuredClone(base);
  assert.equal(digest(mergeSpreadsheetCellLineage(base, next)), digest(next));
  const renamed = structuredClone(base);
  renamed.sheets[0].id = "new-sheet";
  renamed.activeSheetId = "new-sheet";
  delete renamed.sheets[0].cells.C6.lineage;
  assert.equal(mergeSpreadsheetCellLineage(base, renamed).sheets[0].cells.C6.lineage, undefined);
  const removed = structuredClone(base);
  delete removed.sheets[0].cells.C6;
  assert.deepEqual(mergeSpreadsheetCellLineage(base, removed).sheets[0].cells, {});
});

test("generic authored writes cannot mint or replace trusted bindings; imported declarations remain unverified", () => {
  const base = workbook();
  assert.throws(() => guardSpreadsheetCellLineage(null, base), /verified persisted model projection/);
  const forged = structuredClone(base);
  forged.sheets[0].cells.D6 = { raw: "1000.125", format: null, lineage };
  assert.throws(() => guardSpreadsheetCellLineage(base, forged), /verified persisted model projection/);
  const replacement = structuredClone(base);
  replacement.sheets[0].cells.C6.lineage = { ...lineage, canonicalKey: "netIncome" };
  assert.deepEqual(guardSpreadsheetCellLineage(base, replacement).sheets[0].cells.C6.lineage, base.sheets[0].cells.C6.lineage);
  const imported = workbook();
  imported.sheets[0].cells.C6.lineage = { ...lineage, custody: "imported_history" };
  assert.equal(deriveSpreadsheetCellLineageStatus(guardSpreadsheetCellLineage(null, imported).sheets[0].cells.C6), "historical_unverified");
  assert.throws(() => guardSpreadsheetCellLineage(null, { ...imported, sheets: [{ ...imported.sheets[0], cells: { C6: { ...imported.sheets[0].cells.C6, lineage: { ...lineage, custody: "user_authored" } } } }] }), /cannot claim/);
});

test("contract rejects client-computed status and whole source payloads; unavailable units stay absent", () => {
  assert.equal(spreadsheetCellLineageSchema.safeParse({ ...lineage, status: "current" }).success, false);
  assert.equal(spreadsheetCellLineageSchema.safeParse({ ...lineage, snapshot: { payload: {} } }).success, false);
  assert.equal("sourceUnit" in spreadsheetCellLineageSchema.parse(lineage), false);
  assert.equal(spreadsheetCellLineageSchema.safeParse({ ...lineage, sourceRefs: Array.from({ length: 101 }, () => "ref") }).success, false);
});
