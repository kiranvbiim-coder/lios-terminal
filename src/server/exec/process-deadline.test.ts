// Written for LiOS, GM-10a: the donor has no test for process-deadline.ts.
// node:test mock timers run a timer scheduled during tick() inside the same tick, so the
// "between the delay and the deferred decision" window can only be observed with real timers.
// Those tests act from a timer queued after the deadline's own timer (same expiry, so it
// runs right after it in the same timers phase) and use a later sentinel timer to prove a
// callback did not fire: the sentinel is ordered after anything the deadline can schedule.
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { setProcessTimeout } from "./process-deadline";

describe("setProcessTimeout with mock timers", () => {
  it("does not fire before the delay", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const callback = mock.fn();
      setProcessTimeout(callback, 100);
      mock.timers.tick(99);
      assert.equal(callback.mock.callCount(), 0);
    } finally {
      mock.timers.reset();
    }
  });

  it("fires exactly once after the delay", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const callback = mock.fn();
      setProcessTimeout(callback, 100);
      mock.timers.tick(100);
      assert.equal(callback.mock.callCount(), 1);
      mock.timers.tick(1000);
      assert.equal(callback.mock.callCount(), 1);
    } finally {
      mock.timers.reset();
    }
  });

  it("clear() before the delay cancels the callback", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const callback = mock.fn();
      setProcessTimeout(callback, 100).clear();
      mock.timers.tick(500);
      assert.equal(callback.mock.callCount(), 0);
    } finally {
      mock.timers.reset();
    }
  });
});

describe("setProcessTimeout with real timers", () => {
  it("fires the callback after the delay", async () => {
    const fired = Promise.withResolvers<void>();
    setProcessTimeout(() => fired.resolve(), 1);
    await fired.promise;
  });

  it("defers the callback past the delay timer's own turn", async () => {
    const order: string[] = [];
    const fired = Promise.withResolvers<void>();
    setProcessTimeout(() => {
      order.push("callback");
      fired.resolve();
    }, 1);
    setTimeout(() => order.push("same-expiry timer"), 1);
    await fired.promise;
    assert.deepEqual(order, ["same-expiry timer", "callback"]);
  });

  it("clear() after the delay but before the decision turn cancels the callback", async () => {
    const callback = mock.fn();
    const deadline = setProcessTimeout(callback, 1);
    setTimeout(() => deadline.clear(), 1);
    await delay(25);
    assert.equal(callback.mock.callCount(), 0);
  });

  it("refresh() before the delay pushes the deadline out", async () => {
    const started = performance.now();
    const fired = Promise.withResolvers<number>();
    const deadline = setProcessTimeout(() => fired.resolve(performance.now() - started), 40);
    setTimeout(() => deadline.refresh(), 20);
    const elapsed = await fired.promise;
    assert.ok(elapsed >= 58, `expected >= 58 ms (20 + 40 - timer slack), got ${elapsed}`);
  });

  it("refresh() after the delay revokes the pending decision and re-arms the deadline", async () => {
    const callback = mock.fn();
    const deadline = setProcessTimeout(callback, 1);
    setTimeout(() => deadline.refresh(), 1);
    await delay(40);
    assert.equal(callback.mock.callCount(), 1, "one callback, not one per arming");
  });
});
