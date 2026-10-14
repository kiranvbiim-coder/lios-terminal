import assert from "node:assert/strict";
import test from "node:test";
import {
  profileSourceRecords,
  recordsFromDiscoveredValue,
  selectDiscoveryValue,
  validateDiscoveryPath,
} from "@shared/sourceDiscovery";

test("profiles heterogeneous rows deterministically", () => {
  const preview = profileSourceRecords([
    { symbol: "AAPL", revenue: 100, margin: 0.25, asOf: "2026-09-15", active: true, importedAt: new Date("2026-09-15T08:30:00Z") },
    { symbol: "MSFT", revenue: 110.5, margin: null, asOf: "2026-09-15T08:30:00Z", active: false, tags: ["cloud"], importedAt: new Date("2026-09-15T08:31:00Z") },
  ], { maxRows: 100 });

  assert.equal(preview.observedRows, 2);
  assert.equal(preview.truncated, false);
  assert.deepEqual(preview.fields.map(field => field.name), ["symbol", "revenue", "margin", "asOf", "active", "importedAt", "tags"]);
  assert.equal(preview.fields.find(field => field.name === "revenue")?.type, "number");
  assert.equal(preview.fields.find(field => field.name === "margin")?.nullable, true);
  assert.equal(preview.fields.find(field => field.name === "asOf")?.type, "datetime");
  assert.equal(preview.fields.find(field => field.name === "importedAt")?.type, "datetime");
  assert.equal(preview.fields.find(field => field.name === "tags")?.type, "array");
});

test("response paths reject prototype traversal and malformed segments", () => {
  assert.equal(validateDiscoveryPath("data.results").valid, true);
  assert.equal(validateDiscoveryPath("data.__proto__.polluted").valid, false);
  assert.equal(validateDiscoveryPath("data[0]").valid, false);
});

test("response-path selection and record extraction are bounded to object records", () => {
  const payload = { data: { results: [{ a: 1 }, null, "bad", { a: 2 }] } };
  const selected = selectDiscoveryValue(payload, "data.results");
  assert.deepEqual(recordsFromDiscoveredValue(selected), [{ a: 1 }, { a: 2 }]);
});

test("profile marks truncation when source exceeds preview bound", () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ index }));
  const preview = profileSourceRecords(rows, { maxRows: 2 });
  assert.equal(preview.observedRows, 2);
  assert.equal(preview.truncated, true);
  assert.deepEqual(preview.previewRows, [{ index: 0 }, { index: 1 }]);
});
