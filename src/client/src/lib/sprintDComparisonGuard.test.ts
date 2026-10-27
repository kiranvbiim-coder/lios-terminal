import assert from "node:assert/strict";
import test from "node:test";
import { comparisonReviewKey, resolveRecordedReceiptPair } from "./sprintDComparisonGuard";
import type { AnalyticalSnapshot } from "./terminalChangeIntelligence";
import type { CalculationReceipt } from "./terminalEvidence";

function snap(id: string, view: AnalyticalSnapshot["view"] = "valuation", symbol = "ABC"): AnalyticalSnapshot {
  return { id, view, symbol, label: id, capturedAt: 1_234, values: { revenue: 15 }, metadata: { source: "context-only" } };
}
function receipt(id: string): CalculationReceipt {
  return { id, label: id, engine: "recorded", createdAt: "2026-10-27", inputs: {}, parameters: {}, outputs: {},
    diagnostics: [], warnings: [], reproducibilityId: id };
}

test("comparison acknowledgment cannot leak to a new or reversed capture pair", () => {
  const a = snap("one"), b = snap("two", "research");
  const granted = comparisonReviewKey(a, b);
  assert.ok(granted);
  assert.equal(comparisonReviewKey(null, b), null);
  assert.notEqual(granted, comparisonReviewKey(b, a));
  assert.notEqual(granted, comparisonReviewKey(a, snap("three", "research")));
  assert.notEqual(granted, comparisonReviewKey(a, { ...b, values: { revenue: 99 } }));
  assert.equal(granted, comparisonReviewKey({ ...a }, { ...b }));
});

test("receipt comparison follows stable IDs when a new receipt is prepended or records reorder", () => {
  const first = receipt("R-1");
  const second = receipt("R-2");
  const records = [first, second];
  assert.deepEqual(resolveRecordedReceiptPair(records, "R-1", "R-2"), [first, second]);
  assert.deepEqual(resolveRecordedReceiptPair([receipt("R-new"), ...records], "R-1", "R-2"), [first, second]);
  assert.deepEqual(resolveRecordedReceiptPair([second, first], "R-1", "R-2"), [first, second]);
  assert.deepEqual(resolveRecordedReceiptPair(records, "R-2", "R-1"), [second, first]);
});

test("revoked, missing, duplicated or unselected receipt identities never silently rebind", () => {
  const records = [receipt("R-1"), receipt("R-2")];
  assert.equal(resolveRecordedReceiptPair(records, "R-1", "R-1"), null);
  assert.equal(resolveRecordedReceiptPair(records, "R-1", "R-missing"), null);
  assert.equal(resolveRecordedReceiptPair(records.slice(0, 1), "R-1", "R-2"), null);
  assert.equal(resolveRecordedReceiptPair([receipt("same"), receipt("same"), ...records], "same", "R-1"), null);
  assert.equal(resolveRecordedReceiptPair(records, null, "R-2"), null);
  assert.equal(resolveRecordedReceiptPair(records, "", "R-2"), null);
  assert.equal(resolveRecordedReceiptPair([], "R-1", "R-2"), null);
});
