import test from "node:test";
import assert from "node:assert/strict";
import { computeEMA, computeMACD, computeRSI, computeSMA } from "./technicalIndicators";

const closes = [44.0,44.15,43.9,44.35,44.8,44.6,45.1,45.4,45.0,45.3,45.7,45.5,45.9,46.2,46.0,46.4,46.8,46.5,46.9,47.2,47.0,47.5];
const points = closes.map((close) => ({ close, open: close, high: close + 0.5, low: close - 0.5 }));

test("P6 LSE/Brue parity: RSI uses Wilder seed and smoothing", () => {
  const values = computeRSI(points, 14);
  const expected = [
    72.22222222222223,
    74.64898595943836,
    76.82900076779642,
    71.83932530196526,
    74.24143177757068,
    75.90171178819294,
    72.54465665529345,
    75.46610431305275,
  ];
  assert.equal(values.slice(0, 14).every((value) => value === null), true);
  expected.forEach((value, index) => {
    assert.ok(Math.abs((values[index + 14] as number) - value) < 1e-10);
  });
});

test("P6 LSE/Brue parity: SMA and EMA preserve deterministic warm-up semantics", () => {
  const sma = computeSMA(points, 5);
  const ema = computeEMA(points, 5);
  assert.deepEqual(sma.slice(0, 4), [null, null, null, null]);
  assert.deepEqual(ema.slice(0, 4), [null, null, null, null]);
  assert.ok(Math.abs((sma[4] as number) - 44.24) < 1e-12);
  assert.ok(Math.abs((ema[4] as number) - 44.24) < 1e-12);
});

test("P6 indicator parity keeps MACD warm-up explicit rather than inventing early values", () => {
  const extended = Array.from({ length: 70 }, (_, index) => {
    const close = 100 + index * 0.25 + Math.sin(index / 5);
    return { close, open: close, high: close + 1, low: close - 1 };
  });
  const macd = computeMACD(extended);
  assert.equal(macd.macd.slice(0, 25).every((value) => value === null), true);
  assert.equal(macd.signal.slice(0, 33).every((value) => value === null), true);
  assert.ok(Number.isFinite(macd.histogram.at(-1) as number));
});
