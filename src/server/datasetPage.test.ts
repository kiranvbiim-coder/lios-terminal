import assert from "node:assert/strict";
import test from "node:test";
import { buildDatasetPage, hashDatasetRows, paginateDatasetRows } from "./datasetPage";

const provenance = {
  classification: "live" as const,
  provider: "LSE",
  sourceReference: "https://lse.example/company/AAPL",
  asOf: "2026-08-31T15:30:00.000Z",
  retrievedAt: "2026-08-31T15:31:00.000Z",
  freshness: "current" as const,
  cacheStatus: "live" as const,
  fallback: { used: false, provider: null },
  snapshotId: null,
};
function rows() {
  return [{ id: 1, value: "a" }, { id: 2, value: "b" }, { id: 3, value: "c" }];
}


test("hashDatasetRows is stable across object key order", () => {
  assert.equal(hashDatasetRows([{ b: 2, a: 1 }]), hashDatasetRows([{ a: 1, b: 2 }]));
  assert.notEqual(hashDatasetRows([{ a: 1 }]), hashDatasetRows([{ a: 2 }]));
  assert.match(hashDatasetRows(rows()), /^[a-f0-9]{64}$/);
});

test("paginateDatasetRows returns bounded rows and a continuation cursor", () => {
  const first = paginateDatasetRows(rows(), { page: 1, limit: 2 });
  assert.deepEqual(first.rows, rows().slice(0, 2));
  assert.equal(first.totalRows, 3);
  assert.equal(first.rowCountReturned, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, "2");

  const last = paginateDatasetRows(rows(), { page: 2, limit: 2, cursor: "2" });
  assert.deepEqual(last.rows, rows().slice(2));
  assert.equal(last.hasMore, false);
  assert.equal(last.nextCursor, null);
});

test("paginateDatasetRows rejects invalid pagination instead of producing an unbounded response", () => {
  assert.throws(() => paginateDatasetRows(rows(), { page: 0, limit: 10 }));
  assert.throws(() => paginateDatasetRows(rows(), { page: 1, limit: 1_001 }));
  assert.throws(() => paginateDatasetRows(rows(), { page: 1, limit: 10, cursor: "bad cursor" }));
});

test("server builder computes a content hash and redacts source credentials", () => {
  const page = buildDatasetPage({
    datasetKey: "company.profile",
    provenance: { ...provenance, sourceReference: "https://lse.example/company/AAPL?apiKey=never-leak" },
    fields: [{ name: "id", type: "integer", unit: null }],
    rows: rows(),
    totalRows: 3,
    hasMore: false,
    page: 1,
    limit: 100,
    cursor: null,
    nextCursor: null,
    exportability: { enabled: false, formats: [], exportRef: null },
  });
  assert.equal(page.provenance.contentHash, hashDatasetRows(rows()));
  assert.equal(page.provenance.sourceReference.includes("never-leak"), false);
  assert.equal(page.provenance.sourceReference, "https://lse.example/company/AAPL?apiKey=[REDACTED]");
});
