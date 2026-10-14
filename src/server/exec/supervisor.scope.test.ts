// Ported/adapted from OpenClaw src/process/supervisor/{supervisor,supervisor.queued-cancellation,
// supervisor.scope-extinction,supervisor.rejection,supervisor.cancellation-reason}.test.ts
// (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS: injected synchronous child adapters and node:test/assert replace vitest module mocks; no PTY/service-relay cases.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStubChildAdapter, createStubSupervisor, createTerminatingAdapter, killSignals, spawnChild } from "./supervisor.test-support";
import type { ManagedRun } from "./types";

const T = { timeout: 5_000 };

describe("process supervisor admission and cleanup", () => {
  it("does not launch a cancelled queued replacement or cancel its surviving scope", T, async () => {
    const first = createStubChildAdapter();
    const later = createStubChildAdapter({ pid: 4567 });
    const { supervisor, createAdapter } = createStubSupervisor([first, later]);
    const initial = spawnChild(supervisor, { runId: "first", scopeKey: "scope" });
    const replacement = spawnChild(supervisor, { runId: "replacement", scopeKey: "scope", replaceExistingScope: true });
    const following = spawnChild(supervisor, { runId: "later", scopeKey: "scope" });
    supervisor.cancel("replacement");
    const [a, b, c] = await Promise.all([initial, replacement, following]);
    assert.equal(createAdapter.mock.callCount(), 2);
    assert.equal(b.pid, undefined);
    assert.equal((await b.wait()).reason, "manual-cancel");
    assert.equal(b.activity.resultSettled, true);
    assert.deepEqual(killSignals(first), []);
    assert.deepEqual(killSignals(later), []);
    first.settle(0);
    later.settle(0);
    await Promise.all([a.wait(), c.wait(), supervisor.shutdown()]);
  });

  it("replaces predecessors without cancelling arrivals behind its fence", T, async () => {
    const first = createTerminatingAdapter();
    const replacement = createStubChildAdapter({ pid: 5678 });
    const later = createStubChildAdapter({ pid: 6789 });
    const { supervisor } = createStubSupervisor([first, replacement, later]);
    const a = spawnChild(supervisor, { scopeKey: "scope" });
    const b = spawnChild(supervisor, { scopeKey: "scope", replaceExistingScope: true });
    const c = spawnChild(supervisor, { scopeKey: "scope" });
    const runs = await Promise.all([a, b, c]);
    assert.deepEqual(killSignals(first), ["SIGTERM"]);
    assert.deepEqual(killSignals(replacement), []);
    assert.deepEqual(killSignals(later), []);
    assert.equal((await runs[0].wait()).reason, "manual-cancel");
    replacement.settle(0);
    later.settle(0);
    await Promise.all(runs.map((run) => run.wait()));
    await supervisor.shutdown();
  });

  it("cancels every admitted scoped run but leaves a later arrival and other scopes alive", T, async () => {
    const first = createTerminatingAdapter(1234);
    const second = createTerminatingAdapter(2345);
    const outside = createStubChildAdapter({ pid: 3456 });
    const later = createStubChildAdapter({ pid: 4567 });
    const { supervisor } = createStubSupervisor([first, second, outside, later]);
    const pending = [spawnChild(supervisor, { scopeKey: " scope " }), spawnChild(supervisor, { scopeKey: "scope" })];
    const external = spawnChild(supervisor, { scopeKey: "other" });
    supervisor.cancelScope(" scope ");
    const newest = await spawnChild(supervisor, { scopeKey: "scope" });
    const runs = await Promise.all(pending);
    assert.deepEqual(await Promise.all(runs.map(async (run) => (await run.wait()).reason)), ["manual-cancel", "manual-cancel"]);
    assert.deepEqual(killSignals(outside), []);
    assert.deepEqual(killSignals(later), []);
    outside.settle(0);
    later.settle(0);
    await Promise.all([(await external).wait(), newest.wait(), supervisor.shutdown()]);
  });

  it("retains separate descendant owners when retries share a run ID", T, async () => {
    const first = createStubChildAdapter({ autoExtinction: false });
    const second = createStubChildAdapter({ pid: 2345, autoExtinction: false });
    const { supervisor } = createStubSupervisor([first, second]);
    const a = await spawnChild(supervisor, { runId: "retry", scopeKey: "scope" });
    first.settle(23);
    const authentic = await a.wait();
    const b = await spawnChild(supervisor, { runId: "retry", scopeKey: "scope" });
    supervisor.cancel(" retry ");
    assert.deepEqual(killSignals(first), ["SIGKILL"]);
    assert.deepEqual(killSignals(second), ["SIGTERM"]);
    second.settle(null, "SIGTERM");
    first.settleExtinction();
    second.settleExtinction();
    await Promise.all([a.waitForExtinction?.(), b.waitForExtinction?.()]);
    assert.equal(await a.wait(), authentic);
    assert.equal((await b.wait()).reason, "manual-cancel");
    supervisor.cancel("retry");
    assert.deepEqual(killSignals(first), ["SIGKILL"]);
    await supervisor.shutdown();
  });

  it("joins every live sibling before reporting a scope extinction failure", T, async () => {
    const failed = createStubChildAdapter({ autoExtinction: false });
    const sibling = createStubChildAdapter({ pid: 2345, autoExtinction: false });
    const { supervisor } = createStubSupervisor([failed, sibling]);
    const close = supervisor.acquireScopeCleanup(" scope ");
    const a = await spawnChild(supervisor, { scopeKey: "scope" });
    const b = await spawnChild(supervisor, { scopeKey: "scope" });
    const closing = close();
    assert.equal(close(), closing);
    let settled = false;
    void closing.then(() => { settled = true; }, () => { settled = true; });
    const failure = new Error("cleanup identity lost");
    failed.settle(0);
    failed.rejectExtinction(failure);
    await assert.rejects(a.waitForExtinction!(), (error) => error === failure);
    assert.equal(settled, false);
    sibling.settle(0);
    sibling.settleExtinction();
    await b.wait();
    await assert.rejects(closing, (error) => error === failure);
    await assert.rejects(supervisor.shutdown(), (error) => error === failure);
  });

  it("preserves output when authoritative extinction settles before native result", T, async () => {
    const adapter = createStubChildAdapter({ autoExtinction: false });
    const { supervisor } = createStubSupervisor([adapter]);
    const run = await spawnChild(supervisor);
    adapter.settleExtinction();
    await Promise.resolve();
    assert.equal(adapter.disposeMock.mock.callCount(), 0);
    adapter.emitStdout("tail after extinction");
    adapter.settle(0);
    assert.equal((await run.wait()).stdout, "tail after extinction");
    await run.waitForExtinction?.();
    assert.equal(adapter.disposeMock.mock.callCount(), 1);
    await supervisor.shutdown();
  });

  it("keeps first cancellation reason across run and scope cancellation", T, async () => {
    const adapter = createStubChildAdapter();
    const { supervisor } = createStubSupervisor([adapter]);
    let revoked = 0;
    const run = await spawnChild(supervisor, { scopeKey: "scope", onCancel: () => { revoked += 1; } });
    run.cancel("overall-timeout");
    supervisor.cancelScope("scope", "manual-cancel");
    adapter.settle(null, "SIGTERM");
    assert.equal((await run.wait()).reason, "overall-timeout");
    assert.equal(revoked, 1);
    // Windows force-terminates deadline cancellations immediately; POSIX starts with SIGTERM.
    assert.deepEqual(killSignals(adapter), [process.platform === "win32" ? "SIGKILL" : "SIGTERM"]);
    await supervisor.shutdown();
  });

  it("releases rejected construction and subscription ownership without unhandled rejection", T, async () => {
    const failure = new Error("synthetic construction rejected");
    const adapter = createTerminatingAdapter();
    adapter.onStdout = () => { throw new Error("output subscription rejected"); };
    const survivor = createStubChildAdapter({ pid: 4567 });
    const { supervisor } = createStubSupervisor([failure, adapter, survivor]);
    await assert.rejects(spawnChild(supervisor), (error) => error === failure);
    await assert.rejects(spawnChild(supervisor), /output subscription rejected/);
    assert.deepEqual(killSignals(adapter), ["SIGKILL"]);
    const run = await spawnChild(supervisor);
    survivor.settle(0);
    await run.wait();
    await supervisor.shutdown();
    assert.equal(adapter.disposeMock.mock.callCount(), 1);
  });

  it("rejects malformed replacements before affecting the surviving scope", T, async () => {
    const adapter = createStubChildAdapter();
    const { supervisor } = createStubSupervisor([adapter]);
    const run = await spawnChild(supervisor, { scopeKey: "scope" });
    await assert.rejects(spawnChild(supervisor, { scopeKey: "scope", replaceExistingScope: true, argv: [] }), /argv cannot be empty/);
    assert.deepEqual(killSignals(adapter), []);
    adapter.settle(0);
    await run.wait();
    await supervisor.shutdown();
  });

  it("shutdown immediately fences admission, drains queued runs and is idempotent", T, async () => {
    const adapter = createTerminatingAdapter();
    const { supervisor, createAdapter } = createStubSupervisor([adapter]);
    const active = spawnChild(supervisor, { scopeKey: "scope" });
    const queued = spawnChild(supervisor, { scopeKey: "scope", replaceExistingScope: true });
    const closing = supervisor.shutdown();
    assert.equal(supervisor.shutdown(), closing);
    await assert.rejects(spawnChild(supervisor), /shut down/);
    const runs = await Promise.all([active, queued]);
    await closing;
    assert.equal(createAdapter.mock.callCount(), 1);
    assert.deepEqual(await Promise.all(runs.map(async (run) => (await run.wait()).reason)), ["manual-cancel", "manual-cancel"]);
    await assert.rejects(spawnChild(supervisor), /shut down/);
  });

  it("shutdown still cancels all owners when caller revocation throws", T, async () => {
    const first = createTerminatingAdapter();
    const second = createTerminatingAdapter(2345);
    const { supervisor } = createStubSupervisor([first, second]);
    const failure = new Error("caller revocation failed");
    const a = await spawnChild(supervisor, { onCancel: () => { throw failure; } });
    const b = await spawnChild(supervisor);
    await assert.rejects(supervisor.shutdown(), (error) => error === failure);
    await Promise.all([a.wait(), b.wait()]);
    assert.deepEqual(killSignals(first), ["SIGTERM"]);
    assert.deepEqual(killSignals(second), ["SIGTERM"]);
  });

  it("publishes replacement admission before predecessor revocation can submit later work", T, async () => {
    const first = createTerminatingAdapter();
    const replacement = createStubChildAdapter({ pid: 2345 });
    const later = createStubChildAdapter({ pid: 3456 });
    const { supervisor } = createStubSupervisor([first, replacement, later]);
    let following: Promise<ManagedRun> | undefined;
    const initial = await spawnChild(supervisor, {
      scopeKey: "scope",
      onCancel: () => { following = spawnChild(supervisor, { scopeKey: "scope" }); },
    });
    const replacing = await spawnChild(supervisor, { scopeKey: "scope", replaceExistingScope: true });
    assert.ok(following);
    const newest = await following;
    assert.equal(replacing.pid, 2345);
    assert.equal(newest.pid, 3456);
    assert.deepEqual(killSignals(later), []);
    replacement.settle(0);
    later.settle(0);
    await Promise.all([initial.wait(), replacing.wait(), newest.wait()]);
    await supervisor.shutdown();
  });

  it("scope cleanup still joins siblings when caller revocation throws", T, async () => {
    const first = createTerminatingAdapter();
    const sibling = createStubChildAdapter({ pid: 2345, autoExtinction: false });
    const { supervisor } = createStubSupervisor([first, sibling]);
    const close = supervisor.acquireScopeCleanup("scope");
    const failure = new Error("revocation failed");
    const a = await spawnChild(supervisor, { scopeKey: "scope", onCancel: () => { throw failure; } });
    const b = await spawnChild(supervisor, { scopeKey: "scope" });
    const closing = close();
    let settled = false;
    void closing.then(() => { settled = true; }, () => { settled = true; });
    await a.wait();
    assert.deepEqual(killSignals(sibling), ["SIGTERM"]);
    assert.equal(settled, false);
    sibling.settle(0);
    sibling.settleExtinction();
    await b.wait();
    await assert.rejects(closing, (error) => error === failure);
    await supervisor.shutdown();
  });
});
