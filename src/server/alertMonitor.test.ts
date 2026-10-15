import test from "node:test";
import assert from "node:assert/strict";

import { createAlertMonitor, runAlertEvaluationCycle } from "./alertMonitor";

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

test("scheduled monitoring reports a failed tick and retries without an unhandled rejection", async () => {
  const errors: string[] = [];
  let cycles = 0;
  let stop = () => {};
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const retried = new Promise<void>((resolve) => {
    stop = createAlertMonitor(
      async () => {
        cycles += 1;
        if (cycles === 1) throw new Error("synthetic upstream failure");
        resolve();
        return 0;
      },
      5,
      (error) => { errors.push((error as Error).message); },
    );
  });
  try {
    await Promise.race([
      retried,
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new Error("Monitor did not retry.")), 1_000);
      }),
    ]);
  } finally {
    stop();
    if (watchdog) clearTimeout(watchdog);
  }
  assert.deepEqual(errors, ["synthetic upstream failure"]);
  assert.ok(cycles >= 2);
});

test("monitor polling refuses invalid intervals and keeps the stop function idempotent", () => {
  for (const intervalMs of [0, -1, Infinity, Number.NaN, 1.5]) {
    assert.throws(() => createAlertMonitor(async () => 0, intervalMs), RangeError);
  }
  const stop = createAlertMonitor(async () => 0, 10_000);
  assert.doesNotThrow(() => { stop(); stop(); });
});
