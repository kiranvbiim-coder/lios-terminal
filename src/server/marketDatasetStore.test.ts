import assert from "node:assert/strict";
import test from "node:test";
import type { CorporateAction } from "@shared/pointInTimeData";
import { buildMarketDatasetPayload, compareMarketDatasetPayloads, trimMarketBarsToRange } from "./marketDatasetStore";

const dividend: CorporateAction = {
  type: "cash_dividend", effectiveDate: "2024-01-03", declarationDate: null, recordDate: null,
  paymentDate: null, cashAmount: 1, currency: "USD", splitFrom: null, splitTo: null,
  adjustmentFactor: null, source: "fixture",
};

test("market normalization sorts, deduplicates, validates, and computes returns", () => {
  const result = buildMarketDatasetPayload({ symbol: "test", currency: "USD", priceBasis: "raw", corporateActions: [dividend], bars: [
    { date: "2024-01-03", open: 100, high: 103, low: 99, close: 102, volume: 1200 },
    { date: "2024-01-02", open: 99, high: 101, low: 98, close: 100, volume: 1000 },
    { date: "2024-01-03", open: 101, high: 103, low: 100, close: 102, volume: 1300 },
  ] });
  assert.equal(result.payload.symbol, "TEST");
  assert.equal(result.payload.bars.length, 2);
  assert.equal(result.quality.duplicateDates, 1);
  assert.ok(Math.abs(result.payload.bars[1].priceReturn! - 0.02) < 1e-12);
  assert.ok(Math.abs(result.payload.bars[1].totalReturn! - 0.03) < 1e-12);
  assert.ok(Math.abs(result.payload.bars[1].logReturn! - Math.log(1.02)) < 1e-12);
});

test("unknown adjustment semantics withhold total return instead of double counting dividends", () => {
  const result = buildMarketDatasetPayload({ symbol: "TEST", corporateActions: [dividend], bars: [
    { date: "2024-01-02", open: 99, high: 101, low: 98, close: 100, volume: 1000 },
    { date: "2024-01-03", open: 100, high: 103, low: 99, close: 102, volume: 1200 },
  ] });
  assert.equal(result.payload.bars[1].totalReturn, null);
  assert.ok(result.quality.warnings.some((warning) => warning.includes("total returns are withheld")));
});

test("invalid OHLC observations are excluded and reported", () => {
  const result = buildMarketDatasetPayload({ symbol: "TEST", bars: [
    { date: "2024-01-02", open: 99, high: 101, low: 98, close: 100, volume: 1000 },
    { date: "2024-01-03", open: 100, high: 99, low: 98, close: 102, volume: 1200 },
  ] });
  assert.equal(result.payload.bars.length, 1);
  assert.equal(result.quality.invalidBars, 1);
});

test("market revision comparison separates appended dates, corrected values, and actions", () => {
  const before = buildMarketDatasetPayload({ symbol: "TEST", bars: [
    { date: "2024-01-02", open: 99, high: 101, low: 98, close: 100, volume: 1000 },
    { date: "2024-01-03", open: 100, high: 103, low: 99, close: 102, volume: 1200 },
  ] }).payload;
  const after = structuredClone(before);
  after.bars[0].close = 99;
  after.bars.push({ date: "2024-01-04", open: 102, high: 105, low: 101, close: 104, volume: 1400, priceReturn: 104 / 102 - 1, logReturn: Math.log(104 / 102), totalReturn: null });
  after.corporateActions.push(dividend);
  const report = compareMarketDatasetPayloads(before, after, "new", "old");
  assert.equal(report.status, "revised");
  assert.deepEqual(report.addedDates, ["2024-01-04"]);
  assert.equal(report.changedObservations, 1);
  assert.equal(report.materialChanges, 1);
  assert.equal(report.actionChanges, 1);
});

test("calendar-year range trimming does not mistake calendar days for trading sessions", () => {
  const bars = [
    { date: "2019-08-24", open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { date: "2021-08-23", open: 2, high: 2, low: 2, close: 2, volume: 1 },
    { date: "2021-08-24", open: 3, high: 3, low: 3, close: 3, volume: 1 },
    { date: "2026-08-21", open: 4, high: 4, low: 4, close: 4, volume: 1 },
  ];
  assert.deepEqual(trimMarketBarsToRange(bars, "5Y", new Date("2026-08-24T00:00:00Z")).map((bar) => bar.date), ["2021-08-24", "2026-08-21"]);
  assert.equal(trimMarketBarsToRange(bars, "MAX", new Date("2026-08-24T00:00:00Z")).length, 4);
});
