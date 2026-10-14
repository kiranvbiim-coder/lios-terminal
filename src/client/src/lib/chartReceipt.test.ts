import assert from "node:assert/strict";
import test from "node:test";
import { createChartReceipt } from "./chartReceipt";

test("chart receipts normalize context deterministically", () => {
  const receipt = createChartReceipt({ symbol: "aapl", range: "1Y", interval: "1d", chartType: "CANDLE", overlays: ["EMA12", "SMA20"], oscillator: "RSI", compareSymbols: ["msft", "AAPL", "msft"], indicatorParams: { "RSI.period": 14, "SMA20.period": 20 }, barCount: 366, dataProvider: "Yahoo", dataAsOf: "2026-08-29" }, "2026-08-29T00:00:00.000Z");
  assert.equal(receipt.symbol, "AAPL");
  assert.deepEqual(receipt.compareSymbols, ["AAPL", "MSFT"]);
  assert.deepEqual(receipt.overlays, ["EMA12", "SMA20"]);
  assert.equal(receipt.deterministic, true);
  assert.equal(receipt.version, 1);
});

test("chart receipts preserve drawings in stable order", () => {
  const receipt = createChartReceipt({
    symbol: "AAPL",
    range: "1Y",
    interval: "1d",
    chartType: "LINE",
    overlays: [],
    oscillator: "none",
    compareSymbols: [],
    indicatorParams: {},
    barCount: 2,
    drawings: [
      { id: "z", type: "horizontal", points: [{ time: 2, price: 200 }, { time: 2, price: 200 }], color: "#fff", locked: true, visible: true },
      { id: "a", type: "trendline", points: [{ time: 1, price: 100 }, { time: 2, price: 110 }], color: "#0ff", locked: false, visible: true },
    ],
  });
  assert.deepEqual(receipt.drawings?.map(drawing => drawing.id), ["a", "z"]);
  assert.deepEqual(receipt.drawings?.[0].points, [{ time: 1, price: 100 }, { time: 2, price: 110 }]);
});

test("chart receipts preserve selected Data Fabric series without inventing observations", () => {
  const receipt = createChartReceipt({
    symbol: "AAPL", range: "1Y", interval: "1d", chartType: "LINE", overlays: [], oscillator: "none",
    compareSymbols: [], indicatorParams: {}, barCount: 12,
    dataFabricSeriesIds: ["metric.roic", "market_data.price", "metric.roic"],
  });
  assert.deepEqual(receipt.dataFabricSeriesIds, ["market_data.price", "metric.roic"]);
});
