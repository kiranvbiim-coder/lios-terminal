import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyticalChange, AnalyticalContextChange } from "./terminalChangeIntelligence";
import {
  countShownChanges, displayRecordedValue, recordedChangeCategory,
  recordedChangeDelta, validLocalSnapshotTime, visibleAnalyticalChanges,
} from "./analyticalChangeStories";

const entry = (id: string, changes: AnalyticalChange[], capturedAt = 1_761_000_000_000): AnalyticalContextChange => ({
  contextKey: id, view: "valuation", symbol: "ABC",
  label: `Recorded ${id}`, capturedAt,
  previousCapturedAt: capturedAt - 86_400_000,
  changes, criticalCount: 0, materialCount: changes.length,
});
const numeric: AnalyticalChange = {
  key: "Revenue", before: 100, after: 120,
  direction: "up", severity: "critical", absoluteDelta: 20, percentDelta: 20,
};
const stringChange: AnalyticalChange = {
  key: "reviewState", before: "draft", after: "reviewed",
  direction: "changed", severity: "material",
};
const added: AnalyticalChange = {
  key: "New input", before: undefined, after: 100,
  direction: "added", severity: "material",
};

test("filter keeps exact local changed fields and never mutates original snapshots", () => {
  const all = [entry("valuation:ABC", [numeric, stringChange]), entry("valuation:XYZ", [added])];
  const before = JSON.stringify(all);
  const result = visibleAnalyticalChanges(all, "Revenue", "numeric");
  assert.deepEqual(result.map(x => [x.contextKey, x.changes.map(y => y.key)]), [["valuation:ABC", ["Revenue"]]]);
  assert.equal(countShownChanges(result), 1);
  assert.equal(visibleAnalyticalChanges(all, "Revenue", "structure").length, 0);
  assert.equal(visibleAnalyticalChanges(all, "ABC", "all").length, 2, "object labels and symbols can match");
  assert.equal(JSON.stringify(all), before);
});

test("field categories never classify added records as numeric before-and-after", () => {
  assert.equal(recordedChangeCategory(numeric), "numeric");
  assert.equal(recordedChangeCategory(added), "structure");
  assert.equal(recordedChangeCategory(stringChange), "text");
  assert.equal(recordedChangeCategory({ ...numeric, before: Number.NaN }), "text");
});

test("numerical difference is computed only for finite recorded values and honest denominator", () => {
  assert.equal(recordedChangeDelta(numeric), "+20 (+20.0%)");
  assert.equal(recordedChangeDelta({ ...numeric, before: -20, after: -10 }), "+10 (+50.0%)");
  assert.equal(recordedChangeDelta({ ...numeric, before: 0, after: 10 }),
    "+10 (percentage unavailable: reference was zero)");
  assert.equal(recordedChangeDelta(stringChange), null);
  assert.equal(recordedChangeDelta(added), null);
  assert.equal(recordedChangeDelta({ ...numeric, after: Infinity }), null);
  assert.equal(recordedChangeDelta({ ...numeric, before: Number.NaN }), null);
});

test("unrecorded, null, boolean and zero values remain distinct", () => {
  assert.equal(displayRecordedValue(undefined), "Not recorded");
  assert.equal(displayRecordedValue(null), "Null");
  assert.equal(displayRecordedValue(false), "False");
  assert.equal(displayRecordedValue(0), "0");
  assert.equal(displayRecordedValue("0"), "0");
  assert.equal(displayRecordedValue(Infinity), "Invalid number");
});

test("timestamp guard is explicit about invalid and absent snapshot dates", () => {
  assert.equal(validLocalSnapshotTime(0), null);
  assert.equal(validLocalSnapshotTime(Number.NaN), null);
  assert.equal(validLocalSnapshotTime(Number.POSITIVE_INFINITY), null);
  assert.equal(validLocalSnapshotTime(-1), null);
  assert.equal(validLocalSnapshotTime(1_761_000_000_000), new Date(1_761_000_000_000).toISOString());
});

test("filter yields no inferred changes from an empty comparison", () => {
  assert.deepEqual(visibleAnalyticalChanges([], "", "all"), []);
  assert.deepEqual(visibleAnalyticalChanges([entry("empty", [])], "", "all"), []);
  assert.equal(countShownChanges([]), 0);
});
