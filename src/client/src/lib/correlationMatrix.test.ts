import test from "node:test";
import assert from "node:assert/strict";
import { buildCorrelationMatrix, dailyReturnsFromBars, pearsonCorrelation } from "./correlationMatrix";
import type { OHLCVBar } from "./finance";

function bars(closes: number[], start = 1): OHLCVBar[] {
  return closes.map((close, index) => ({
    date: `2026-01-${String(start + index).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

test("dailyReturnsFromBars uses observed closes and caps the rolling window", () => {
  const result = dailyReturnsFromBars(bars([100, 110, 99, 108.9]), 2);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result[0].value + 0.1) < 1e-12);
  assert.ok(Math.abs(result[1].value - 0.1) < 1e-12);
});

test("pearsonCorrelation aligns observations by date", () => {
  const left = [
    { date: "2026-01-02", value: 1 },
    { date: "2026-01-03", value: 2 },
    { date: "2026-01-04", value: 3 },
  ];
  const right = [
    { date: "2026-01-01", value: 10 },
    { date: "2026-01-02", value: -2 },
    { date: "2026-01-03", value: -4 },
    { date: "2026-01-04", value: -6 },
  ];
  const result = pearsonCorrelation(left, right, 3);
  assert.equal(result.observations, 3);
  assert.ok(result.value !== null && Math.abs(result.value + 1) < 1e-12);
  assert.equal(result.startDate, "2026-01-02");
  assert.equal(result.endDate, "2026-01-04");
});

test("correlation refuses to invent a value when overlap is insufficient or variance is zero", () => {
  const insufficient = pearsonCorrelation(
    [{ date: "2026-01-01", value: 0.01 }],
    [{ date: "2026-01-01", value: 0.02 }],
    2,
  );
  assert.equal(insufficient.value, null);

  const constant = pearsonCorrelation(
    [{ date: "a", value: 1 }, { date: "b", value: 1 }, { date: "c", value: 1 }],
    [{ date: "a", value: 2 }, { date: "b", value: 3 }, { date: "c", value: 4 }],
    3,
  );
  assert.equal(constant.value, null);
});

test("matrix carries observation coverage instead of structural fallback constants", () => {
  const a = dailyReturnsFromBars(bars([100, 101, 103, 102, 105]), 90);
  const b = dailyReturnsFromBars(bars([50, 51, 53, 52, 54]), 90);
  const result = buildCorrelationMatrix([a, b], 3);
  assert.equal(result.matrix.length, 2);
  assert.equal(result.matrix[0][0].value, 1);
  assert.equal(result.matrix[0][1].observations, 4);
  assert.ok(result.matrix[0][1].value !== null);
});
