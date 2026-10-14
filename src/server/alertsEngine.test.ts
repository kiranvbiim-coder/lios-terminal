import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAlertTrigger, evaluateAlerts } from "./alertsEngine";

test("evaluateAlertTrigger fires above alerts when quote trades through threshold", () => {
  const result = evaluateAlertTrigger(
    { condition: "above", price: 200 },
    { symbol: "AAPL", price: 205 },
  );

  assert.deepEqual(result, {
    triggered: true,
    triggerPrice: 205,
  });
});

test("evaluateAlertTrigger fires below alerts when quote falls through threshold", () => {
  const result = evaluateAlertTrigger(
    { condition: "below", price: 150 },
    { symbol: "TSLA", price: 148.5 },
  );

  assert.deepEqual(result, {
    triggered: true,
    triggerPrice: 148.5,
  });
});

test("evaluateAlerts returns only newly triggered alerts for matching quotes", () => {
  const result = evaluateAlerts(
    [
      { id: 1, symbol: "AAPL", condition: "above", price: 200, triggered: false },
      { id: 2, symbol: "MSFT", condition: "below", price: 380, triggered: false },
      { id: 3, symbol: "NVDA", condition: "above", price: 900, triggered: true },
    ],
    [
      { symbol: "AAPL", price: 205 },
      { symbol: "MSFT", price: 390 },
      { symbol: "NVDA", price: 950 },
    ],
  );

  assert.deepEqual(result, [
    { id: 1, symbol: "AAPL", triggerPrice: 205, metric: "price" },
  ]);
});

test("evaluateAlertTrigger fires valuation metric alerts", () => {
  const result = evaluateAlertTrigger(
    { condition: "forwardPE:below", price: 18 },
    { symbol: "MSFT", price: 500, forwardPE: 16.5 },
  );

  assert.deepEqual(result, {
    triggered: true,
    triggerPrice: 16.5,
  });
});
