import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregatePricePoints,
  average,
  formatCompactDate,
  formatCompactTime,
  mapToStooqSymbol,
  normalizeSearchQuery,
  parseNumberish,
  round,
  stripHtml,
  uniqueBy,
} from "./marketDataCore";

test("market-data core numeric and compact timestamp helpers are deterministic", () => {
  assert.equal(round(1.235, 2), 1.24);
  assert.equal(average([1, 2, 3]), 2);
  assert.equal(average([]), 0);
  assert.equal(parseNumberish("12.5"), 12.5);
  assert.equal(parseNumberish("bad"), 0);
  assert.equal(formatCompactDate("20261001"), "2026-10-01");
  assert.equal(formatCompactDate("2026"), "");
  assert.equal(formatCompactTime("093015"), "09:30:15");
  assert.equal(formatCompactTime(undefined), "");
});

test("market-data core text normalization strips markup without inventing content", () => {
  assert.equal(stripHtml("<![CDATA[<p>A &amp; B</p>]]>"), "A & B");
  assert.equal(normalizeSearchQuery("  Revenue Growth "), "revenue growth");
  assert.deepEqual(uniqueBy(["a", "a", "b"], (value) => value), ["a", "b"]);
});

test("market-data core aggregation preserves observed first/high/low/last and summed volume", () => {
  const hour = Date.parse("2026-10-01T09:00:00.000Z");
  const bars = aggregatePricePoints([
    { timestamp: hour + 1_000, price: 100, volume: 10 },
    { timestamp: hour + 60_000, price: 103, volume: 20 },
    { timestamp: hour + 120_000, price: 99, volume: 30 },
    { timestamp: hour + 240_000, price: 101, volume: 40 },
  ], "5m");
  assert.deepEqual(bars, [{
    date: new Date(hour).toISOString(),
    open: 100,
    high: 103,
    low: 99,
    close: 101,
    volume: 100,
  }]);
});

test("market-data core keeps provider symbol mapping explicit and rejects crypto fallback", () => {
  assert.equal(mapToStooqSymbol("^GSPC"), "^spx");
  assert.equal(mapToStooqSymbol("AAPL"), "aapl.us");
  assert.equal(mapToStooqSymbol("BTC-USD"), null);
});
