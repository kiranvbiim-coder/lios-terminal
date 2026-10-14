// Adapted from OpenClaw packages/retry/src/index.test.ts, v2026.9.7,
// c074824a27c96d3983043f9eeb33823cd1772d8c (MIT).
// Copyright (c) 2026 OpenClaw Foundation. MIT permission/warranty notice:
// see retry-timing.ts and repository THIRD_PARTY_NOTICES.md.
// Ports exact capped schedules, long-lived exponential caps, cancellation and
// unref cases to node:test; adds LiOS boundary, overflow and secret-safety cases.
// Supervisor/retry-runner tests are not ported: no retry authority is imported.
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, it } from "node:test";
import {
  computeBackoff,
  computeBackoffSchedule,
  resolveSleepDelayMs,
  sleepWithAbort,
} from "./retry-timing";

const TIMER_MAX_MS = 2_147_000_000;

function assertSafeAbort(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "aborted");
  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.deepEqual(Object.getOwnPropertyNames(error).sort(), ["message", "name", "stack"]);
  for (const rendered of [String(error), inspect(error), JSON.stringify(error), error.stack ?? ""]) {
    assert.equal(rendered.includes("private-secret-value"), false);
  }
  return true;
}

describe("donor backoff timing (not retry admission)", () => {
  it("uses exact capped schedules", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map((attempt) => computeBackoffSchedule([5, 25, 120], attempt)),
      [0, 5, 25, 120, 120, 120],
    );
  });

  it("handles empty schedules, nonpositive attempts and exhausted schedules", () => {
    assert.equal(computeBackoffSchedule([], 1), 0);
    assert.equal(computeBackoffSchedule([10], -1), 0);
    assert.equal(computeBackoffSchedule([10], Number.MAX_SAFE_INTEGER), 10);
  });

  it("starts at the initial delay and caps exponential growth", () => {
    const policy = { initialMs: 100, maxMs: 250, factor: 2, jitter: 0 };
    assert.deepEqual([-1, 0, 1, 2, 3, 4].map((attempt) => computeBackoff(policy, attempt)),
      [100, 100, 100, 200, 250, 250]);
    assert.equal(computeBackoff({ ...policy, initialMs: 500 }, 1), 250);
  });

  it("keeps long-lived exponential backoff at its cap", () => {
    assert.equal(computeBackoff({ initialMs: 1_000, maxMs: 30_000, factor: 2, jitter: 0 }, 1_016), 30_000);
  });

  it("preserves positive jitter, rounding and the cap at random boundaries", (t) => {
    const random = t.mock.method(Math, "random", () => 0);
    const policy = { initialMs: 100, maxMs: 250, factor: 2, jitter: 0.5 };
    assert.equal(computeBackoff(policy, 1), 100);
    random.mock.mockImplementation(() => 0.99);
    assert.equal(computeBackoff(policy, 1), 150);
    assert.equal(computeBackoff(policy, 2), 250);
    assert.equal(computeBackoff({ ...policy, initialMs: 0 }, 1), 0);
  });
});

describe("donor abortable sleep", () => {
  it("normalizes native timer bounds without overflow", () => {
    for (const ms of [NaN, Infinity, -Infinity, -1, 0]) {
      assert.equal(resolveSleepDelayMs(ms), 0);
    }
    assert.equal(resolveSleepDelayMs(0.1), 1);
    assert.equal(resolveSleepDelayMs(1.9), 1);
    assert.equal(resolveSleepDelayMs(25.9), 25);
    assert.equal(resolveSleepDelayMs(TIMER_MAX_MS), TIMER_MAX_MS);
    assert.equal(resolveSleepDelayMs(2 ** 31), TIMER_MAX_MS);
    assert.equal(resolveSleepDelayMs(Number.MAX_VALUE), TIMER_MAX_MS);
  });

  it("does not schedule zero/invalid delays (including an already-aborted signal)", async (t) => {
    const schedule = t.mock.method(globalThis, "setTimeout");
    const controller = new AbortController();
    controller.abort("private-secret-value");
    for (const ms of [0, -1, NaN, Infinity]) {
      await sleepWithAbort(ms, controller.signal);
    }
    assert.equal(schedule.mock.callCount(), 0);
  });

  it("floors fractional waits and removes its listener on successful completion", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const controller = new AbortController();
    const added = t.mock.method(controller.signal, "addEventListener");
    const removed = t.mock.method(controller.signal, "removeEventListener");
    let settled = false;
    const wait = sleepWithAbort(25.9, controller.signal).then(() => { settled = true; });
    t.mock.timers.tick(24);
    await Promise.resolve();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await wait;
    assert.equal(removed.mock.callCount(), 1);
    assert.equal(removed.mock.calls[0].arguments[1], added.mock.calls[0].arguments[1]);
    controller.abort("private-secret-value");
    await wait;
  });

  it("caps over-ceiling native waits rather than waking immediately", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let settled = false;
    const wait = sleepWithAbort(Number.MAX_VALUE).then(() => { settled = true; });
    t.mock.timers.tick(TIMER_MAX_MS - 1);
    await Promise.resolve();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await wait;
    assert.equal(settled, true);
  });

  it("rejects pre-aborted waits without creating a timer or leaking the reason", async (t) => {
    const controller = new AbortController();
    controller.abort(new Error("private-secret-value"));
    const schedule = t.mock.method(globalThis, "setTimeout");
    const removed = t.mock.method(controller.signal, "removeEventListener");
    await assert.rejects(sleepWithAbort(100, controller.signal), assertSafeAbort);
    assert.equal(schedule.mock.callCount(), 0);
    assert.equal(removed.mock.callCount(), 1);
  });

  it("clears pending timers and removes listeners for secret-bearing cancellation", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const clear = t.mock.method(globalThis, "clearTimeout");
    for (const reason of ["private-secret-value", new Error("private-secret-value"), { token: "private-secret-value" }]) {
      const controller = new AbortController();
      const added = t.mock.method(controller.signal, "addEventListener");
      const removed = t.mock.method(controller.signal, "removeEventListener");
      const wait = sleepWithAbort(60_000, controller.signal);
      const rejection = assert.rejects(wait, assertSafeAbort);
      controller.abort(reason);
      await rejection;
      assert.equal(removed.mock.callCount(), 1);
      assert.equal(removed.mock.calls[0].arguments[1], added.mock.calls[0].arguments[1]);
    }
    assert.equal(clear.mock.callCount(), 3);
    t.mock.timers.tick(60_000);
  });

  it("never reads private reason getters, whether pre-aborted or cancelled in flight", async () => {
    for (const preAborted of [false, true]) {
      const controller = new AbortController();
      if (preAborted) controller.abort("private-secret-value");
      let reads = 0;
      Object.defineProperty(controller.signal, "reason", {
        get() { reads += 1; throw new Error("private-secret-value"); },
      });
      const wait = sleepWithAbort(60_000, controller.signal);
      const rejection = assert.rejects(wait, assertSafeAbort);
      if (!preAborted) controller.abort("private-secret-value");
      await rejection;
      assert.equal(reads, 0);
    }
  });

  it("can unref the scheduled timer while remaining abortable", async (t) => {
    const controller = new AbortController();
    const schedule = t.mock.method(globalThis, "setTimeout");
    try {
      const wait = sleepWithAbort(60_000, controller.signal, { ref: false });
      const timer = schedule.mock.calls[0].result;
      assert.ok(timer);
      assert.equal(timer.hasRef(), false);
      const rejection = assert.rejects(wait, assertSafeAbort);
      controller.abort("private-secret-value");
      await rejection;
    } finally {
      controller.abort();
    }
  });

  it("keeps mandatory cleanup waits referenced by default", async (t) => {
    const controller = new AbortController();
    const schedule = t.mock.method(globalThis, "setTimeout");
    try {
      const wait = sleepWithAbort(60_000, controller.signal);
      const timer = schedule.mock.calls[0].result;
      assert.ok(timer);
      assert.equal(timer.hasRef(), true);
      const rejection = assert.rejects(wait, assertSafeAbort);
      controller.abort();
      await rejection;
    } finally {
      controller.abort();
    }
  });
});
