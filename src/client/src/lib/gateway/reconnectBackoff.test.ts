import test from "node:test";
import assert from "node:assert/strict";
import { createReconnectBackoff } from "./reconnectBackoff";

test("delays grow exponentially up to the cap, and reset restarts the schedule", () => {
  const b = createReconnectBackoff({ initialMs: 100, maxMs: 500, multiplier: 2, jitter: 0 });
  assert.deepEqual([b.next(), b.next(), b.next(), b.next(), b.next()], [100, 200, 400, 500, 500]);
  assert.equal(b.attempts, 5);
  b.reset();
  assert.equal(b.next(), 100);
});

test("jitter spreads the delay symmetrically and never exceeds the cap", () => {
  const low = createReconnectBackoff({ initialMs: 100, maxMs: 1000, multiplier: 2, jitter: 0.2, random: () => 0 });
  const high = createReconnectBackoff({ initialMs: 100, maxMs: 1000, multiplier: 2, jitter: 0.2, random: () => 1 });
  assert.equal(low.next(), 80);
  assert.equal(high.next(), 120);
  const capped = createReconnectBackoff({ initialMs: 1000, maxMs: 1000, multiplier: 2, jitter: 0.2, random: () => 1 });
  assert.equal(capped.next(), 1000);
});
