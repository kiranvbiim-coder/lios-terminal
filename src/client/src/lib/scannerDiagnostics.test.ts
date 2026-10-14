import test from "node:test";
import assert from "node:assert/strict";
import { evaluateScanQuote, rankNearMisses } from "./scannerDiagnostics";
import type { Quote } from "./finance";

function quote(symbol: string, fields: Partial<Quote> = {}): Quote {
  return {
    symbol, name: symbol, price: 99, change: 0, changePercent: 0, volume: 100, avgVolume: 100,
    marketCap: 1_000_000, pe: 20, eps: 1, revenue: 1_000_000, high52: 100, low52: 50,
    open: 99, previousClose: 99, dayHigh: 100, dayLow: 98, exchange: "TEST", quoteSource: "test", isLive: false,
    status: { provider: "Limuria Intelligence", freshness: "snapshot", asOf: null, delayLabel: "Test", isFallback: false }, currency: "USD",
    ...fields,
  };
}

test("52-week breakout requires a real observed 52-week high", () => {
  assert.equal(evaluateScanQuote(quote("PASS"), "breakout_52w").match, true);
  const unavailable = evaluateScanQuote(quote("MISS", { high52: Number.NaN }), "breakout_52w");
  assert.equal(unavailable.match, false);
  assert.equal(unavailable.conditions[0].pass, null);
});

test("relative volume scan uses volume divided by actual average volume", () => {
  assert.equal(evaluateScanQuote(quote("PASS", { volume: 250, avgVolume: 100 }), "high_volume").match, true);
  assert.equal(evaluateScanQuote(quote("MISS", { volume: 150, avgVolume: 100 }), "high_volume").match, false);
});

test("near misses prefer more passed conditions before smaller threshold gaps", () => {
  const candidates = [
    evaluateScanQuote(quote("A", { changePercent: 0.5, price: 90, high52: 100, low52: 50 }), "golden_cross"),
    evaluateScanQuote(quote("B", { changePercent: 1.5, price: 78, high52: 100, low52: 50 }), "golden_cross"),
  ];
  assert.equal(rankNearMisses(candidates)[0].quote.symbol, "B");
});
