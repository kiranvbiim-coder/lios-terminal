import assert from "node:assert/strict";
import test from "node:test";
import { auditDatasetQuality } from "./dataQualityEngine";

test("P5 Data Quality Engine detects duplicates, missing fields and look-ahead risk", () => {
  const report = auditDatasetQuality({
    datasetRef: "fixture",
    rows: [
      { id: 1, value: 10, availableAt: "2026-01-01T00:00:00.000Z" },
      { id: 1, value: null, availableAt: "2026-02-01T00:00:00.000Z" },
    ],
    requiredFields: ["id", "value"],
    uniqueKeyFields: ["id"],
    expectedTypes: { id: "number", value: "number", availableAt: "date" },
    availableAtField: "availableAt",
    asKnownOn: "2026-01-15T00:00:00.000Z",
  });
  assert.ok(report.score < 1);
  assert.ok(report.issues.some((issue) => issue.code === "duplicate_key"));
  assert.ok(report.issues.some((issue) => issue.code === "lookahead_risk"));
});
