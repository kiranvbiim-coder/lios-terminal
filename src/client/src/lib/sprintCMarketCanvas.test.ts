import assert from "node:assert/strict";
import test from "node:test";
import type { MarketBreadthResult } from "./useFinance";
import { recordedBreadthRows, recordedLatestBreadth, shortRecordedMarketDate } from "./sprintCMarketCanvas";

const point = (date: string, advances = 50, declines = 30, unchanged = 20, netAdvances = 20) =>
  ({ date, advances, declines, unchanged, netAdvances, advanceDeclineLine: 1, newHighs: 0, newLows: 0, mcClellanOscillator: null });

test("Sprint C chart and readable table share exactly the same recorded breadth proportions", () => {
  const rows = recordedBreadthRows([point("2026-10-25"), point("2026-10-26", 60, 25, 15, 35)], 7);
  assert.deepEqual(rows.map(x => [x.date, x.advances, x.declines, x.net]), [
    ["2026-10-25", 50, -30, 20], ["2026-10-26", 60, -25, 35],
  ]);
  assert.deepEqual(recordedLatestBreadth({ date: "2026-10-26", advances: 60, declines: 25, unchanged: 15, newHighs: 2, newLows: 1, armsIndex: null, mcClellanOscillator: null }),
    { advances: 60, declines: 25, unchanged: 15, net: null });
  assert.equal(shortRecordedMarketDate("2026-02-30"), "2026-02-30");
});

test("Sprint C does not draw missing, unsafe or zero-denominator market records", () => {
  assert.deepEqual(recordedBreadthRows([
    point("2026-10-26", 0, 0, 0, 0),
    point("2026-10-27", Number.NaN),
    point("2026-10-28", 10, 10, 0, 60),
    point("2026-10-29", 10, 10, 0, 0),
  ], 30).map(x => x.date), ["2026-10-29"]);
  assert.deepEqual(recordedBreadthRows([point("2026-10-27")], 0), []);
  assert.equal(recordedLatestBreadth(null), null);
  assert.equal(recordedLatestBreadth({ date: "x", advances: 0, declines: 0, unchanged: 0, newHighs: 0, newLows: 0, armsIndex: null, mcClellanOscillator: null }), null);
  assert.equal(recordedBreadthRows(Array.from({ length: 110 }, (_, i) => point("2026-10-27")), 1000).length, 90);
  assert.equal(recordedBreadthRows([point("2026-10-27")], Number.NaN).length, 0);
});
