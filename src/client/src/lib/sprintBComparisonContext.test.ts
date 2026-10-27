import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyticalSnapshot } from "./terminalChangeIntelligence";
import { describeSnapshotPair } from "./sprintBComparisonContext";
const capture = (view: AnalyticalSnapshot["view"], symbol: string): AnalyticalSnapshot => ({
  id: "saved", view, symbol, label: "Saved context", capturedAt: 1000, metadata: {},
  values: { revenue: 42 },
});
test("matching symbol and view allow a clearly scoped field comparison", () => {
  assert.equal(describeSnapshotPair(capture("valuation", "abc"), capture("valuation", " ABC ")).kind, "same-context");
  assert.equal(describeSnapshotPair(capture("valuation", "ABC"), null).kind, "incomplete");
});
test("distinct views or issuers trigger explicit cross-context review instead of an implied comparable delta", () => {
  assert.equal(describeSnapshotPair(capture("valuation", "ABC"), capture("valuation", "XYZ")).kind, "cross-context");
  assert.equal(describeSnapshotPair(capture("valuation", "ABC"), capture("research", "ABC")).kind, "cross-context");
  assert.match(describeSnapshotPair(capture("valuation", "ABC"), capture("research", "ABC")).message, /no numeric comparison/);
});
