import test from "node:test";
import assert from "node:assert/strict";
import { computeHeatmapAnalytics, computeMoveZScores, relativeVolumeForQuote } from "./heatmapAnalytics";
import type { Quote } from "./finance";

function quote(symbol: string, changePercent: number, marketCap: number | null, volume = 100, avgVolume = 100, sector = "Technology"): Quote {
  return {
    symbol, name: symbol, price: 100, change: changePercent, changePercent, volume, marketCap,
    pe: null, eps: null, revenue: null, high52: 120, low52: 80, open: 100, previousClose: 100,
    dayHigh: 101, dayLow: 99, avgVolume, exchange: "TEST", sector, quoteSource: "test", isLive: false,
    status: { provider: "Limuria Intelligence", freshness: "snapshot", asOf: null, delayLabel: "Test", isFallback: false }, currency: "USD",
  };
}

test("heatmap analytics derives breadth, relative volume, sector movement and contribution from quote fields", () => {
  const result = computeHeatmapAnalytics([
    quote("AAA", 2, 60, 300, 100, "Tech"),
    quote("BBB", -1, 40, 50, 100, "Tech"),
    quote("CCC", 0, null, 100, 0, "Health"),
  ]);
  assert.equal(result.advances, 1);
  assert.equal(result.declines, 1);
  assert.equal(result.flat, 1);
  assert.equal(result.averageMove, 1 / 3);
  assert.equal(result.relativeVolume[0].symbol, "AAA");
  assert.equal(result.relativeVolume[0].value, 3);
  assert.equal(result.contribution.find((row) => row.symbol === "AAA")?.value, 1.2);
  assert.equal(result.contribution.find((row) => row.symbol === "BBB")?.value, -0.4);
  assert.equal(result.sectors.find((row) => row.sector === "Tech")?.weightedMove, 0.8);
});

test("relative volume refuses invalid denominators rather than fabricating a value", () => {
  assert.equal(relativeVolumeForQuote({ volume: 10, avgVolume: 0 }), null);
  assert.equal(relativeVolumeForQuote({ volume: 10, avgVolume: Number.NaN }), null);
});

test("move z-scores are cross-sectional and deterministic", () => {
  const rows = computeMoveZScores([
    { symbol: "A", changePercent: -1 },
    { symbol: "B", changePercent: 0 },
    { symbol: "C", changePercent: 1 },
  ]);
  assert.equal(rows.find((row) => row.symbol === "B")?.value, 0);
  assert.ok((rows.find((row) => row.symbol === "A")?.value ?? 0) < 0);
  assert.ok((rows.find((row) => row.symbol === "C")?.value ?? 0) > 0);
});
