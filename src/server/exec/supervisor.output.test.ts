// Ported/adapted from OpenClaw src/process/supervisor/{supervisor.output-fence,supervisor.timeout-overflow,
// supervisor.output-activity.real,supervisor}.test.ts (MIT, Copyright (c) 2026 OpenClaw Foundation),
// commit c074824a27c96d3983043f9eeb33823cd1772d8c. node:test mock timers/injected adapters replace vitest mocks.
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createChildAdapterHarness } from "./child.test-support";
import { createDeferredCore } from "./deferred";
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

  it("escalates overall timeout from SIGTERM to SIGKILL without replacing its reason (Windows forces SIGKILL at once)", T, async () => {
    // Windows has no catchable SIGTERM: the supervisor skips the grace window and force-terminates the tree immediately.
    const windows = process.platform === "win32";
    mock.timers.enable({ apis: ["setTimeout"] });
    const adapter = createStubChildAdapter({ onKill: (signal, current) => { if (signal === "SIGKILL") { current.settle(null, signal); } } });
    const { supervisor } = createStubSupervisor([adapter]);
    const run = await spawnChild(supervisor, { timeoutMs: 20, gracefulCancelMs: 30 });
    await advanceMockTimers(20);
    await advanceMockTimers(0);
    assert.deepEqual(killSignals(adapter), windows ? ["SIGKILL"] : ["SIGTERM"]);
    run.cancel("manual-cancel");
    await advanceMockTimers(30);
    const exit = await run.wait();
    assert.deepEqual(killSignals(adapter), windows ? ["SIGKILL"] : ["SIGTERM", "SIGKILL"]);
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

describe("process supervisor opted awaited stdout", () => {
  it("joins opted consumption even when an injected adapter reports native completion first", T, async () => {
    const adapter = createStubChildAdapter();
    const consumed = createDeferredCore();
    const release = createDeferredCore();
    let listener: ((chunk: string) => void | Promise<void>) | undefined;
    adapter.consumeStdout = (next) => { listener = next; return consumed.promise; };
    const { supervisor } = createStubSupervisor([adapter]);
    const run = await spawnChild(supervisor, { onStdoutAsync: () => release.promise });
    const accepted = listener!("accepted");
    adapter.settle(0);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(run.activity.resultSettled, false);
    assert.equal(adapter.disposeMock.mock.callCount(), 0);
    release.resolve();
    await accepted;
    consumed.resolve();
    assert.equal((await run.wait()).stdout, "accepted");
    await run.waitForExtinction!();
    assert.equal(adapter.disposeMock.mock.callCount(), 1);
    await supervisor.shutdown();
  });

  it("retains async cleanup ownership through native extinction failure", { ...T, skip: process.platform === "win32" }, async () => {
    const failure = new Error("native extinction failed");
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" }, { groupExists: () => { throw failure; } });
    const { supervisor } = createStubSupervisor([h.adapter]);
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const run = await spawnChild(supervisor, {
      onStdoutAsync: async () => { entered.resolve(); await release.promise; },
    });
    h.child.stdout.write("accepted");
    await entered.promise;
    let cleanupSettled = false;
    const cleanup = run.waitForExtinction!();
    void cleanup.then(() => { cleanupSettled = true; }, () => { cleanupSettled = true; });
    await h.closePipes();
    h.emitExit(0);
    h.emitClose(0);
    await assert.rejects(h.adapter.waitForExtinction(), (error) => error === failure);
    await Promise.resolve();
    assert.equal(cleanupSettled, false);
    release.resolve();
    assert.equal((await run.wait()).stdout, "accepted");
    await assert.rejects(cleanup, (error) => error === failure);
    await assert.rejects(supervisor.shutdown(), (error) => error === failure);
  });

  it("passes the native opt-in and joins accepted work before result, cleanup and disposal", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const dispose = mock.fn(h.adapter.dispose);
    h.adapter.dispose = dispose;
    const { supervisor, createAdapter } = createStubSupervisor([h.adapter]);
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const events: string[] = [];
    const run = await spawnChild(supervisor, {
      onStdoutRaw: (chunk) => { events.push(`raw:${chunk.toString()}`); },
      onStdout: (chunk) => { events.push(`sync:${chunk}`); },
      onStdoutAsync: async (chunk) => {
        events.push(`async:${chunk}`);
        entered.resolve();
        await release.promise;
      },
    });
    assert.equal(createAdapter.mock.calls[0].arguments[0].stdoutConsumption, "awaited");
    h.child.stdout.write("accepted");
    await entered.promise;
    assert.deepEqual(events, ["raw:accepted", "sync:accepted", "async:accepted"]);
    await h.closePipes();
    h.emitExit(0);
    h.emitClose(0);
    await h.adapter.waitForExtinction();
    assert.equal(run.activity.resultSettled, false);
    assert.equal(dispose.mock.callCount(), 0);
    release.resolve();
    assert.equal((await run.wait()).stdout, "accepted");
    await run.waitForExtinction!();
    assert.equal(dispose.mock.callCount(), 1);
    await supervisor.shutdown();
  });

  it("fences later raw, synchronous and async callbacks without abandoning accepted work", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const { supervisor } = createStubSupervisor([h.adapter]);
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const events: string[] = [];
    const run = await spawnChild(supervisor, {
      onStdoutRaw: (chunk) => { events.push(`raw:${chunk}`); },
      onStdout: (chunk) => { events.push(`sync:${chunk}`); },
      onStdoutAsync: async (chunk) => {
        events.push(`async:${chunk}`);
        entered.resolve();
        await release.promise;
      },
    });
    h.child.stdout.write("accepted");
    await entered.promise;
    run.detachOutput!();
    h.child.stdout.write("revoked");
    await h.closePipes();
    h.emitExit(0);
    h.emitClose(0);
    assert.equal(run.activity.resultSettled, false);
    release.resolve();
    assert.equal((await run.wait()).stdout, "accepted");
    assert.deepEqual(events, ["raw:accepted", "sync:accepted", "async:accepted"]);
    await supervisor.shutdown();
  });

  it("stops on rejection, preserves the output error and joins native finalization", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const { supervisor } = createStubSupervisor([h.adapter]);
    const close = supervisor.acquireScopeCleanup("async-scope");
    const canceled = createDeferredCore();
    const failure = new Error("awaited stdout rejected");
    const reasons: string[] = [];
    const run = await spawnChild(supervisor, {
      scopeKey: "async-scope",
      onStdoutAsync: async () => { throw failure; },
      onCancel: (reason) => { reasons.push(reason); canceled.resolve(); },
    });
    h.child.stdout.write("input");
    await canceled.promise;
    assert.equal(run.activity.resultSettled, false);
    await h.closePipes();
    h.emitExit(null, "SIGKILL");
    h.emitClose(null, "SIGKILL");
    await assert.rejects(run.wait(), (error) => error === failure);
    await assert.rejects(run.waitForExtinction!(), (error) => error === failure);
    await assert.rejects(close(), (error) => error === failure);
    await assert.rejects(supervisor.shutdown(), (error) => error === failure);
    assert.deepEqual(reasons, ["spawn-error"]);
  });

  it("preserves observer and revocation failures while still requesting native stop", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const { supervisor } = createStubSupervisor([h.adapter]);
    const failure = new Error("observer failed");
    const revokeFailure = new Error("revocation failed");
    const canceled = createDeferredCore();
    const run = await spawnChild(supervisor, {
      onStdoutAsync: async () => { throw failure; },
      onCancel: () => { canceled.resolve(); throw revokeFailure; },
    });
    h.child.stdout.write("input");
    await canceled.promise;
    await h.closePipes();
    h.emitExit(null, "SIGKILL");
    h.emitClose(null, "SIGKILL");
    await assert.rejects(run.wait(), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failure, revokeFailure]);
      return true;
    });
    assert.ok(h.signalTreeMock.mock.calls.some((call) => call.arguments[1] === "SIGKILL"));
    await assert.rejects(supervisor.shutdown(), (error) => error === failure);
  });

  it("revokes blocked accepted work on pipe failure before joining stdout completion", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const { supervisor } = createStubSupervisor([h.adapter]);
    const entered = createDeferredCore(), released = createDeferredCore();
    const failure = new Error("native stdout failed during host work");
    const reasons: string[] = [];
    const run = await spawnChild(supervisor, {
      onStdoutAsync: async () => { entered.resolve(); await released.promise; },
      onCancel: reason => { reasons.push(reason); released.resolve(); },
    });
    h.child.stdout.write("accepted");
    await entered.promise;
    h.child.stdout.destroy(failure);
    await released.promise;
    h.child.stderr.end();
    h.emitExit(null, "SIGKILL");
    h.emitClose(null, "SIGKILL");
    await assert.rejects(run.wait(), error => error === failure);
    await assert.rejects(run.waitForExtinction!(), error => error === failure);
    await assert.rejects(supervisor.shutdown(), error => error === failure);
    assert.deepEqual(reasons, ["spawn-error"]);
  });

  it("refuses unsupported adapters instead of treating fire-and-forget output as awaited", T, async () => {
    const adapter = createTerminatingAdapter();
    const { supervisor } = createStubSupervisor([adapter]);
    await assert.rejects(spawnChild(supervisor, { onStdoutAsync: async () => {} }),
      /does not support awaited stdout consumption/);
    await supervisor.shutdown();
    assert.deepEqual(killSignals(adapter), ["SIGKILL"]);
    assert.equal(adapter.disposeMock.mock.callCount(), 1);
  });
});
