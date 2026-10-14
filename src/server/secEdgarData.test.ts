import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeSubmissionRecords,
  normalizeEdgarPageOptions,
  pageSubmissionRecords,
  type SubmissionRows,
} from "./secEdgarData";

test("SEC page options use one bounded default contract", () => {
  assert.deepEqual(normalizeEdgarPageOptions(), {
    page: 1,
    limit: 20,
    from: null,
    to: null,
    cursor: undefined,
  });
  assert.equal(normalizeEdgarPageOptions({ page: 3, limit: 500 }).limit, 100);
  assert.equal(normalizeEdgarPageOptions({ page: 0, limit: 0 }).page, 1);
  assert.equal(normalizeEdgarPageOptions({ cursor: "3" }).page, 3);
});

test("SEC page options reject invalid and inverted date ranges", () => {
  assert.throws(() => normalizeEdgarPageOptions({ from: "2026-02-31" }), /YYYY-MM-DD/);
  assert.throws(() => normalizeEdgarPageOptions({ from: "2026-03-01", to: "2026-02-01" }), /must not be after/);
  assert.throws(() => normalizeEdgarPageOptions({ cursor: "bad" }), /positive page/);
});

test("SEC continuation merges recent and older submission files in filing order", () => {
  const recent: SubmissionRows = { form: ["4", "10-K"], filingDate: ["2026-03-10", "2026-03-01"], accessionNumber: ["0001-03", "0001-02"] };
  const older: SubmissionRows = { form: ["4"], filingDate: ["2025-03-10"], accessionNumber: ["0001-01"] };
  const merged = mergeSubmissionRecords(recent, [older]);
  assert.deepEqual(merged.map((row) => row.accessionNumber), ["0001-03", "0001-02", "0001-01"]);
});

test("SEC insider filing page boundaries are deterministic", () => {
  const page = pageSubmissionRecords(["a", "b", "c"], 2, 2);
  assert.deepEqual(page.rows, ["c"]);
  assert.equal(page.total, 3);
  assert.equal(page.hasMore, false);
});
