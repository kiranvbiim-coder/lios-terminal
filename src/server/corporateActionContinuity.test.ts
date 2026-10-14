import test from "node:test";
import assert from "node:assert/strict";
import { buildContinuousHistory, type ContinuityBar } from "@shared/corporateActionContinuity";

const sourceBars: ContinuityBar[] = [
  { date: "2026-01-01", open: 10, high: 11, low: 9, close: 10, volume: 100 },
  { date: "2026-01-02", open: 11, high: 12, low: 10, close: 11, volume: 110 },
];
const targetBars: ContinuityBar[] = [
  { date: "2026-01-02", open: 20, high: 21, low: 19, close: 20, volume: 200 },
  { date: "2026-01-03", open: 21, high: 22, low: 20, close: 21, volume: 210 },
];

const event = {
  actionId: 7,
  actionType: "ticker_change" as const,
  effectiveDate: "2026-01-02",
  sourceSymbol: "OLD",
  targetSymbol: "NEW",
};

test("continuity gives the predecessor pre-effective dates and successor effective dates", () => {
  const result = buildContinuousHistory(sourceBars, targetBars, event);
  assert.equal(result.status, "continuous");
  assert.deepEqual(result.bars.map((bar) => [bar.date, bar.close]), [["2026-01-01", 10], ["2026-01-02", 20], ["2026-01-03", 21]]);
  assert.deepEqual(result.event, { ...event, sourceSymbol: "OLD", targetSymbol: "NEW" });
});

test("continuity deduplicates dates without mutating either input series", () => {
  const originalSource = structuredClone(sourceBars);
  const originalTarget = structuredClone(targetBars);
  const result = buildContinuousHistory(sourceBars, targetBars, event);
  assert.equal(result.bars.filter((bar) => bar.date === "2026-01-02").length, 1);
  assert.deepEqual(sourceBars, originalSource);
  assert.deepEqual(targetBars, originalTarget);
});

test("continuity reports incomplete chains instead of fabricating bridge bars", () => {
  const result = buildContinuousHistory([], targetBars, event);
  assert.equal(result.status, "target_only");
  assert.equal(result.sourceBarCount, 0);
  assert.equal(result.targetBarCount, 2);
});

test("continuity rejects malformed identity and effective dates", () => {
  assert.throws(() => buildContinuousHistory(sourceBars, targetBars, { ...event, actionId: 0 }), /actionId/);
  assert.throws(() => buildContinuousHistory(sourceBars, targetBars, { ...event, effectiveDate: "2026-02-30" }), /effectiveDate/);
  assert.throws(() => buildContinuousHistory(sourceBars, targetBars, { ...event, targetSymbol: "OLD" }), /distinct/);
});
test("continuity rejects malformed bar dates instead of emitting them", () => {
  assert.throws(
    () => buildContinuousHistory(
      [{ ...sourceBars[0], date: "2026-02-30" }],
      targetBars,
      event,
    ),
    /bar date/,
  );
});
