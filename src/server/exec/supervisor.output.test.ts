// Ported/adapted from OpenClaw src/process/supervisor/{supervisor.output-fence,supervisor.timeout-overflow,
// supervisor.output-activity.real,supervisor}.test.ts (MIT, Copyright (c) 2026 OpenClaw Foundation),
// commit c074824a27c96d3983043f9eeb33823cd1772d8c. node:test mock timers/injected adapters replace vitest mocks.
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { advanceMockTimers, createStubChildAdapter, createStubSupervisor, createTerminatingAdapter, killSignals, spawnChild } from "./supervisor.test-support";

const T = { timeout: 5_000 };
afterEach(() => mock.timers.reset());

describe("process supervisor output and deadlines", () => {
  for (const detach of [false, true]) {
    it(`fences decoded/raw output, capture and activity after ${detach ? "detach" : "result"}`, T, async () => {
      mock.timers.enable({ apis: ["Date"], now: 1_000 });
      const adapter = createStubChildAdapter({ autoExtinction: false });
      const { supervisor } = createStubSupervisor([adapter]);
      const delivered: string[] = [];
      const run = await spawnChild(supervisor, {
        onStdout: (chunk) => delivered.push(`out:${chunk}`),
        onStderr: (chunk) => delivered.push(`err:${chunk}`),
        onStdoutRaw: (chunk) => delivered.push(`raw-out:${chunk.toString()}`),
        onStderrRaw: (chunk) => delivered.push(`raw-err:${chunk.toString()}`),
      });
      mock.timers.setTime(2_000);
      adapter.emitStdout("live");
      adapter.emitStderr("live");
      const lastOutput = run.activity.lastOutputAtMs;
      if (detach) { run.detachOutput?.(); }
      else { adapter.settle(null, "SIGKILL"); await run.wait(); }
      assert.equal(adapter.disposeMock.mock.callCount(), 0);
      mock.timers.setTime(3_000);
      adapter.emitStdout("late");
      adapter.emitStderr("late");
      adapter.settle(0);
      const exit = await run.wait();
      assert.deepEqual(delivered, ["raw-out:live", "out:live", "raw-err:live", "err:live"]);
      assert.equal(exit.stdout, "live");
      assert.equal(exit.stderr, "live");
      assert.equal(run.activity.lastOutputAtMs, lastOutput);
      adapter.settleExtinction();
      await run.waitForExtinction?.();
      assert.equal(adapter.disposeMock.mock.callCount(), 1);
      await supervisor.shutdown();
    });
  }

  it("streams full output, bounds capture independently and preserves UTF-16 boundaries", T, async () => {
    const adapter = createStubChildAdapter();
    const { supervisor } = createStubSupervisor([adapter]);
    const chunks: string[] = [];
    const run = await spawnChild(supervisor, { maxCapturedOutputChars: 256, onStdout: (chunk) => chunks.push(chunk) });
    const large = "🙂".repeat(400);
    adapter.emitStdout(large);
    adapter.emitStdout("tail");
    adapter.emitStderr("exact");
    adapter.settle(0);
    const exit = await run.wait();
    assert.equal(chunks.join(""), `${large}tail`);
    assert.equal(exit.stdoutTruncated, true);
    assert.equal(exit.stderrTruncated, false);
    assert.ok(exit.stdout.length <= 256);
    assert.match(exit.stdout, /^\[lios: captured stdout truncated/);
    assert.ok(exit.stdout.endsWith("tail"));
    assert.equal(Buffer.from(exit.stdout).toString("utf8"), exit.stdout);
    assert.equal(exit.stderr, "exact");
    await supervisor.shutdown();
  });

  for (const cap of [1, 8, 55, 256]) {
    it(`keeps exact capture boundary and flags overflow at cap ${cap}`, T, async () => {
      const exact = createStubChildAdapter();
      const overflow = createStubChildAdapter({ pid: 2345 });
      const { supervisor } = createStubSupervisor([exact, overflow]);
      const a = await spawnChild(supervisor, { maxCapturedOutputChars: cap });
      exact.emitStdout("x".repeat(cap));
      exact.settle(0);
      assert.equal((await a.wait()).stdoutTruncated, false);
      const b = await spawnChild(supervisor, { maxCapturedOutputChars: cap });
      overflow.emitStdout("x".repeat(cap + 1));
      overflow.settle(0);
      const result = await b.wait();
      assert.equal(result.stdoutTruncated, true);
      assert.ok(result.stdout.length <= cap);
      await supervisor.shutdown();
    });
  }

  it("does not retain output when capture is disabled", T, async () => {
    const adapter = createStubChildAdapter();
    const { supervisor } = createStubSupervisor([adapter]);
    let streamed = "";
    const run = await spawnChild(supervisor, { captureOutput: false, maxCapturedOutputChars: 1, onStdout: (chunk) => { streamed += chunk; } });
    adapter.emitStdout("unbounded streaming");
    adapter.emitStderr("stderr");
    adapter.settle(0);
    const exit = await run.wait();
    assert.equal(exit.stdout, "");
    assert.equal(exit.stderr, "");
    assert.equal(exit.stdoutTruncated, false);
    assert.equal(streamed, "unbounded streaming");
    await supervisor.shutdown();
  });

  it("raw-only UTF-8 activity resets no-output deadline but decoder EOF text does not", T, async () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
    const adapter = createTerminatingAdapter();
    const { supervisor } = createStubSupervisor([adapter]);
    const run = await spawnChild(supervisor, { noOutputTimeoutMs: 10 });
    await advanceMockTimers(9);
    adapter.emitStdoutRaw(Buffer.from([0xe2]));
    assert.equal(run.activity.lastOutputAtMs, 1_009);
    await advanceMockTimers(9);
    adapter.emitStdoutText("�");
    assert.equal(run.activity.lastOutputAtMs, 1_009);
    assert.deepEqual(killSignals(adapter), []);
    await advanceMockTimers(1);
    await advanceMockTimers(0);
    const exit = await run.wait();
    assert.equal(exit.reason, "no-output-timeout");
    assert.equal(exit.noOutputTimedOut, true);
    assert.equal(exit.stdout, "�");
    await supervisor.shutdown();
  });

  it("escalates overall timeout from SIGTERM to SIGKILL without replacing its reason", T, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const adapter = createStubChildAdapter({ onKill: (signal, current) => { if (signal === "SIGKILL") { current.settle(null, signal); } } });
    const { supervisor } = createStubSupervisor([adapter]);
    const run = await spawnChild(supervisor, { timeoutMs: 20, gracefulCancelMs: 30 });
    await advanceMockTimers(20);
    await advanceMockTimers(0);
    assert.deepEqual(killSignals(adapter), ["SIGTERM"]);
    run.cancel("manual-cancel");
    await advanceMockTimers(30);
    const exit = await run.wait();
    assert.deepEqual(killSignals(adapter), ["SIGTERM", "SIGKILL"]);
    assert.equal(exit.reason, "overall-timeout");
    assert.equal(exit.timedOut, true);
    assert.equal(exit.noOutputTimedOut, false);
    await supervisor.shutdown();
  });

  it("rearms durations above Node's timer cap instead of overflowing to an immediate timeout", T, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const adapter = createTerminatingAdapter();
    const { supervisor } = createStubSupervisor([adapter]);
    const run = await spawnChild(supervisor, { timeoutMs: 2_147_483_647 + 50 });
    await advanceMockTimers(2_147_483_647);
    await advanceMockTimers(0);
    assert.deepEqual(killSignals(adapter), []);
    await advanceMockTimers(49);
    assert.deepEqual(killSignals(adapter), []);
    await advanceMockTimers(1);
    await advanceMockTimers(0);
    assert.equal((await run.wait()).reason, "overall-timeout");
    await supervisor.shutdown();
  });

  it("retains stream errors for scope cleanup even when the native exit succeeds", T, async () => {
    const adapter = createStubChildAdapter();
    const { supervisor } = createStubSupervisor([adapter]);
    const close = supervisor.acquireScopeCleanup("scope");
    const run = await spawnChild(supervisor, { scopeKey: "scope" });
    const failure = new Error("stdout transport failed");
    adapter.emitError(failure, "stdout");
    adapter.settle(0);
    assert.equal((await run.wait()).exitCode, 0);
    await assert.rejects(run.waitForExtinction!(), (error) => error === failure);
    await assert.rejects(close(), (error) => error === failure);
    await assert.rejects(supervisor.shutdown(), (error) => error === failure);
  });

  it("recognizes replayed ENOENT startup errors rather than presenting a normal exit", T, async () => {
    const adapter = createStubChildAdapter({ missingPid: true });
    adapter.emitError(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "process");
    const { supervisor } = createStubSupervisor([adapter]);
    const run = await spawnChild(supervisor);
    adapter.settle(-2);
    assert.equal((await run.wait()).reason, "spawn-error");
    await supervisor.shutdown();
  });
});
