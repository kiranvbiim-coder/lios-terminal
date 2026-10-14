import assert from "node:assert/strict";
import test from "node:test";
import {
  detectImportFileFormat,
  importFormatCapability,
  parseJsonImport,
  previewRowsForImport,
} from "./fileImportPipeline";

test("detects supported file formats case-insensitively", () => {
  assert.equal(detectImportFileFormat("holdings.CSV"), "csv");
  assert.equal(detectImportFileFormat("fundamentals.tsv"), "tsv");
  assert.equal(detectImportFileFormat("model.xlsx"), "xlsx");
  assert.equal(detectImportFileFormat("sample.json"), "json");
  assert.equal(detectImportFileFormat("data.parquet"), "parquet");
  assert.equal(detectImportFileFormat("notes.txt"), "unknown");
});

test("Parquet support is reported truthfully instead of fabricated", () => {
  const capability = importFormatCapability("parquet");
  assert.equal(capability.supported, false);
  assert.match(capability.reason ?? "", /DuckDB|bridge/i);
});

test("JSON import accepts arrays and common nested record containers", () => {
  assert.deepEqual(parseJsonImport('[{"symbol":"AAPL"}]'), [{ symbol: "AAPL" }]);
  assert.deepEqual(parseJsonImport('{"records":[{"symbol":"MSFT"}]}'), [{ symbol: "MSFT" }]);
  assert.throws(() => parseJsonImport('{bad'), /valid JSON/);
  assert.throws(() => parseJsonImport('[1,2,3]'), /object records/);
});

test("common preview contract infers schema and truncates to 500 rows", () => {
  const rows = Array.from({ length: 510 }, (_, index) => ({ id: index, price: index + 0.5 }));
  const preview = previewRowsForImport("prices.csv", "csv", rows);
  assert.equal(preview.totalRows, 510);
  assert.equal(preview.previewRows.length, 500);
  assert.equal(preview.truncated, true);
  assert.equal(preview.fields.find(field => field.name === "id")?.type, "integer");
  assert.equal(preview.fields.find(field => field.name === "price")?.type, "number");
});
