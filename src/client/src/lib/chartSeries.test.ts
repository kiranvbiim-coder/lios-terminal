import test from "node:test";
import assert from "node:assert/strict";

import { getAllowedIntervals, normalizeComparisonSeries, supportsIntradayCharts } from "./chartSeries";

test("supportsIntradayCharts enables equity intraday only for current data", () => {
  assert.equal(supportsIntradayCharts("current", false), true);
  assert.equal(supportsIntradayCharts("daily", false), false);
  assert.equal(supportsIntradayCharts("reference", false), false);
  assert.equal(supportsIntradayCharts(null, true), true);
});

test("getAllowedIntervals enables intraday when charting support is available", () => {
  assert.deepEqual(getAllowedIntervals(true), ["5m", "15m", "1h", "1d"]);
  assert.deepEqual(getAllowedIntervals(false), ["1d"]);
});

test("normalizeComparisonSeries reindexes all series to a shared 100 base", () => {
  const result = normalizeComparisonSeries([
    {
      symbol: "AAPL",
      points: [
        { date: "2026-03-17T14:00:00.000Z", close: 100 },
        { date: "2026-03-17T15:00:00.000Z", close: 110 },
      ],
    },
    {
      symbol: "MSFT",
      points: [
        { date: "2026-03-17T14:00:00.000Z", close: 200 },
        { date: "2026-03-17T15:00:00.000Z", close: 180 },
      ],
    },
  ]);

  assert.deepEqual(result, [
    { date: "2026-03-17T14:00:00.000Z", AAPL: 100, MSFT: 100 },
    { date: "2026-03-17T15:00:00.000Z", AAPL: 110, MSFT: 90 },
  ]);
});
