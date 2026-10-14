import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDatasetPage,
  datasetPageSchema,
  parseDatasetPage,
  parseDatasetPageRequest,
  redactDatasetReference,
} from "./datasetPage";

const HASH = "a".repeat(64);
const basePage = {
  schemaVersion: "1" as const,
  datasetKey: "prices.daily",
  provenance: {
    classification: "live" as const,
    provider: "Example Provider",
    sourceReference: "https://provider.example/prices",
    asOf: "2026-08-31",
    retrievedAt: "2026-08-31T12:00:00.000Z",
    freshness: "daily" as const,
    cacheStatus: "not_cached" as const,
    fallback: { used: false, provider: null },
    snapshotId: null,
    contentHash: HASH,
  },
  fields: [{ name: "close", type: "number" as const, unit: "USD", description: "Closing price" }],
  rows: [{ close: 100 }, { close: 101 }],
  rowCountReturned: 2,
  totalRows: 3,
  hasMore: true,
  page: 1,
  limit: 2,
  cursor: null,
  nextCursor: "page-2",
  exportability: { enabled: true, formats: ["json" as const, "csv" as const], exportRef: "/api/datasets/prices.daily/export" },
};

test("parses a complete dataset page with schema, rows, paging, and provenance", () => {
  const parsed = parseDatasetPage(basePage);
  assert.deepEqual(parsed, basePage);
  assert.equal(datasetPageSchema.safeParse(basePage).success, true);
});

test("buildDatasetPage supplies schema version and row count without weakening validation", () => {
  const page = buildDatasetPage({ ...basePage, schemaVersion: undefined, rowCountReturned: undefined });
  assert.equal(page.schemaVersion, "1");
  assert.equal(page.rowCountReturned, 2);
});

test("rejects live data with missing as-of provenance", () => {
  const result = parseDatasetPage({
    ...basePage,
    provenance: { ...basePage.provenance, asOf: null, cacheStatus: "live" },
  });
  assert.equal(result, null);
});

test("rejects inconsistent row counts, page limits, cursors, and hasMore metadata", () => {
  assert.equal(parseDatasetPage({ ...basePage, rowCountReturned: 1 }), null);
  assert.equal(parseDatasetPage({ ...basePage, limit: 0 }), null);
  assert.equal(parseDatasetPage({ ...basePage, cursor: "contains whitespace" }), null);
  assert.equal(parseDatasetPage({ ...basePage, totalRows: 3, hasMore: false, nextCursor: null }), null);
  assert.equal(parseDatasetPage({ ...basePage, hasMore: true, nextCursor: "page-2", totalRows: 2 }), null);
});

test("requires a snapshot for cached rows and a fallback provider when fallback is used", () => {
  assert.equal(parseDatasetPage({ ...basePage, provenance: { ...basePage.provenance, cacheStatus: "cached", snapshotId: null } }), null);
  assert.equal(parseDatasetPage({ ...basePage, provenance: { ...basePage.provenance, fallback: { used: true, provider: null } } }), null);
});

test("classifies cached, manual, and synthetic pages without conflating their status", () => {
  const cached = parseDatasetPage({
    ...basePage,
    provenance: { ...basePage.provenance, classification: "cached", cacheStatus: "cached", freshness: "snapshot", snapshotId: "snapshot-1" },
  });
  const manual = parseDatasetPage({
    ...basePage,
    provenance: { ...basePage.provenance, classification: "manual", cacheStatus: "manual", freshness: "manual", asOf: null },
  });
  const synthetic = parseDatasetPage({
    ...basePage,
    provenance: { ...basePage.provenance, classification: "synthetic", cacheStatus: "not_cached", freshness: "reference", asOf: null },
  });
  assert.notEqual(cached, null);
  assert.notEqual(manual, null);
  assert.notEqual(synthetic, null);
});

test("page request parser enforces bounded page, limit, and opaque cursor values", () => {

  assert.deepEqual(parseDatasetPageRequest({}), { page: 1, limit: 100, cursor: null });
  assert.deepEqual(parseDatasetPageRequest({ page: "2", limit: "25", cursor: "cursor_1" }), { page: 2, limit: 25, cursor: "cursor_1" });
  assert.equal(parseDatasetPageRequest({ page: 0 }), null);
  assert.equal(parseDatasetPageRequest({ page: true }), null);
  assert.equal(parseDatasetPageRequest({ limit: 1001 }), null);
  assert.equal(parseDatasetPageRequest({ limit: "1.5" }), null);
  assert.equal(parseDatasetPageRequest({ cursor: "not allowed" }), null);
});

test("redacts credential query parameters before a source reference is emitted", () => {
  const spaced = redactDatasetReference("https://provider.example/data?apiKey = top-secret&date=2026-08-31");
  assert.equal(spaced.includes("top-secret"), false);
  assert.equal(redactDatasetReference("apiKey=top-secret").includes("top-secret"), false);
  const redacted = redactDatasetReference("https://provider.example/data?apikey=do-not-leak&date=2026-08-31");
  assert.equal(redacted, "https://provider.example/data?apikey=[REDACTED]&date=2026-08-31");
  assert.equal(parseDatasetPage({ ...basePage, provenance: { ...basePage.provenance, sourceReference: "https://provider.example/data?apiKey=secret" } }), null);
  assert.equal(redacted.includes("do-not-leak"), false);
  assert.equal(parseDatasetPage({ ...basePage, provenance: { ...basePage.provenance, sourceReference: redacted } }) !== null, true);
});
