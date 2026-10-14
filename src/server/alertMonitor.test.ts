import test from "node:test";
import assert from "node:assert/strict";

import { runAlertEvaluationCycle } from "./alertMonitor";

test("runAlertEvaluationCycle triggers matching pending alerts", async () => {
  const alerts = [
    { id: 1, symbol: "AAPL", condition: "above", price: 200, triggered: false },
    { id: 2, symbol: "MSFT", condition: "below", price: 350, triggered: false },
  ];
  const triggeredCalls: Array<{ id: number; triggerPrice: number }> = [];

  const triggered = await runAlertEvaluationCycle({
    loadAlerts: async () => alerts as any,
    fetchQuotes: async () => [
      { symbol: "AAPL", price: 205 },
      { symbol: "MSFT", price: 380 },
    ],
    triggerAlert: async (id, details) => {
      triggeredCalls.push({ id, triggerPrice: details.triggerPrice });
    },
    now: () => new Date("2026-03-17T12:00:00.000Z"),
  });

  assert.equal(triggered, 1);
  assert.deepEqual(triggeredCalls, [{ id: 1, triggerPrice: 205 }]);
});

test("runAlertEvaluationCycle skips work when there are no pending alerts", async () => {
  let fetched = false;

  const triggered = await runAlertEvaluationCycle({
    loadAlerts: async () => [{ id: 1, symbol: "AAPL", condition: "above", price: 200, triggered: true }] as any,
    fetchQuotes: async () => {
      fetched = true;
      return [];
    },
    triggerAlert: async () => {},
    now: () => new Date("2026-03-17T12:00:00.000Z"),
  });

  assert.equal(triggered, 0);
  assert.equal(fetched, false);
});
