import assert from "node:assert/strict";
import test from "node:test";
import type { ProvenanceRecord } from "./terminalEvidence";
import { filterPublishedSources, safePublishedSourceUrl, sourceNeedsReview, summarizePublishedSources } from "./sprintBSourceReview";

const source = (id: string, patch: Partial<ProvenanceRecord> = {}): ProvenanceRecord => ({
  id, label: id, source: "Recorded filing", provider: "Manual", freshness: "point-in-time",
  effectiveAt: "2026-01-10", transformations: [], assumptions: [], quality: "normal", conflicts: [],
  ...patch,
});

test("source-review summaries count published observations only, not fabricated credibility scores", () => {
  const records = [
    source("verified", { quality: "verified" }),
    source("old", { freshness: "stale", effectiveAt: undefined }),
    source("conflict", { conflicts: ["Provider conflict"], fallbackSource: "Cached snapshot" }),
  ];
  assert.deepEqual(summarizePublishedSources(records), {
    recorded: 3, review: 2, stale: 1, missingAsOf: 1,
  });
  assert.equal(sourceNeedsReview(records[0]), false);
  assert.deepEqual(filterPublishedSources(records, "", "review").map(item => item.id), ["old", "conflict"]);
  assert.deepEqual(filterPublishedSources(records, "", "stale").map(item => item.id), ["old"]);
  assert.deepEqual(filterPublishedSources(records, "", "no-as-of").map(item => item.id), ["old"]);
  assert.deepEqual(filterPublishedSources(records, "provider conflict", "all").map(item => item.id), ["conflict"]);
  assert.deepEqual(records[1].effectiveAt, undefined);
});

test("source URL rendering rejects unsafe schemes, credentials and relative paths", () => {
  assert.equal(safePublishedSourceUrl("https://example.com/report?a=1"), "https://example.com/report?a=1");
  assert.equal(safePublishedSourceUrl("javascript:alert(1)"), null);
  assert.equal(safePublishedSourceUrl("http://example.com/"), null);
  assert.equal(safePublishedSourceUrl("https://user:secret@example.com/"), null);
  assert.equal(safePublishedSourceUrl("//example.com"), null);
  assert.equal(safePublishedSourceUrl(undefined), null);
});
