import assert from "node:assert/strict";
import test from "node:test";
import { TelegramPollingController, type TelegramPollingTarget } from "./telegramPollingController";
import type { TelegramAdoptionResult } from "./telegramConnectionService";

const target = (connectionId = 1): TelegramPollingTarget => ({ context: { userId: 1, organizationId: null, role: "internal_admin" }, connectionId });
const adopted = (adoptedCount = 0): TelegramAdoptionResult => ({ kind: "adopted", adopted: adoptedCount, ignored: 0, duplicates: 0, nextOffset: 1 });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const instantSleep = (log: number[] = []) => async (ms: number, signal: AbortSignal) => { log.push(ms); await new Promise<void>(resolve => setImmediate(resolve)); return !signal.aborted; };

test("stop closes admission, aborts the in-flight cycle and joins before later work can run", async () => {
  let cycles = 0;
  const entered = Promise.withResolvers<void>();
  const controller = new TelegramPollingController({
    isTerminalFailure: () => false,
    cycle: async (_target, signal) => { cycles++; entered.resolve(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); return adopted(); },
  });
  controller.start(target());
  controller.start(target());
  await entered.promise;
  assert.equal(cycles, 1, "start is idempotent per connection");
  await controller.stop();
  assert.equal(cycles, 1);
  assert.equal(controller.status()[0].state, "stopped");
  assert.throws(() => controller.start(target()), /stopped/);
});

test("revoked authority is terminal and never retried; provider credential problems block repair-first", async () => {
  for (const scenario of ["authority", "unauthorized", "conflict"] as const) {
    let cycles = 0;
    const controller = new TelegramPollingController({
      sleep: instantSleep(),
      isTerminalFailure: error => error instanceof Error && error.name === "Refusal",
      cycle: async () => {
        cycles++;
        if (scenario === "authority") throw Object.assign(new Error("PRIVATE-DETAIL"), { name: "Refusal" });
        return { kind: "provider_error", code: scenario, retryAfterMs: null };
      },
    });
    controller.start(target());
    while (["polling", "backoff"].includes(controller.status()[0]?.state ?? "polling")) await settle();
    await controller.stop();
    assert.equal(cycles, 1, scenario);
    const status = controller.status()[0];
    assert.equal(status.state, scenario === "authority" ? "refused" : "provider_blocked");
    assert.equal(JSON.stringify(status).includes("PRIVATE-DETAIL"), false);
  }
});

test("rate-limit hints and capped exponential backoff pace recoverable failures", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const controller = new TelegramPollingController({
    isTerminalFailure: () => false,
    sleep: instantSleep(sleeps),
    cycle: async () => {
      calls++;
      if (calls === 1) return { kind: "provider_error", code: "rate_limited", retryAfterMs: 7_000 };
      if (calls < 4) throw new Error("transient");
      return adopted(1);
    },
  });
  controller.start(target());
  while (calls < 5) await settle();
  await controller.stop();
  assert.deepEqual(sleeps.slice(0, 3), [7_000, 500, 1_000]);
  assert.ok(controller.status()[0].lastAdoptedAt);
});

test("ready-then-crash cycles cannot evade the ceiling by resetting failures on first success", async () => {
  let calls = 0;
  const controller = new TelegramPollingController({
    isTerminalFailure: () => false, sleep: instantSleep(), maxConsecutiveFailures: 5, stableSuccessMs: 60_000, now: () => 1_000,
    cycle: async () => { calls++; if (calls % 2 === 0) throw new Error("crash"); return adopted(); },
  });
  controller.start(target());
  while (controller.status()[0].state !== "exhausted") await settle();
  await controller.stop();
  assert.equal(controller.status()[0].consecutiveFailures, 5);
  assert.equal(calls, 10);
});

test("a stale attempt cannot publish after an explicit replacement start", async () => {
  const first = Promise.withResolvers<TelegramAdoptionResult>();
  let calls = 0;
  const controller = new TelegramPollingController({
    isTerminalFailure: () => false, sleep: instantSleep(),
    cycle: async (_target, signal) => {
      calls++;
      if (calls === 1) return first.promise;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      return adopted();
    },
  });
  controller.start(target());
  await settle();
  const stopping = controller.stop(1);
  first.resolve(adopted(5));
  await stopping;
  assert.equal(controller.status()[0].lastAdoptedAt, null, "an aborted attempt cannot publish adoption status");
  controller.restart(target());
  await settle();
  assert.equal(calls, 2);
  await controller.stop();
});

test("periodic rediscovery cannot restart terminal loops or reset their failure budget", { timeout: 5000 }, async () => {
  for (const outcome of ["refused", "provider_blocked", "exhausted"] as const) {
    let calls = 0;
    const controller = new TelegramPollingController({
      maxConsecutiveFailures: 2, sleep: instantSleep(),
      isTerminalFailure: () => outcome === "refused",
      cycle: async () => {
        calls++;
        if (outcome === "provider_blocked") return { kind: "provider_error", code: "unauthorized", retryAfterMs: null };
        throw new Error("controlled failure");
      },
    });
    try {
      controller.start(target());
      while (controller.status()[0].state !== outcome) await settle();
      const callsBefore = calls;
      const failuresBefore = controller.status()[0].consecutiveFailures;
      for (let tick = 0; tick < 3; tick++) {
        controller.start(target());
        await settle();
      }
      assert.equal(calls, callsBefore, outcome);
      assert.equal(controller.status()[0].consecutiveFailures, failuresBefore, outcome);
    } finally { await controller.stop(); }
  }
});
