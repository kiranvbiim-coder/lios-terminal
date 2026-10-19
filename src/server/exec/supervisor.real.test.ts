// Written for LiOS, GM-10a. Real child-process tests of the supervisor kernel (POSIX; not verified on Windows).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createProcessSupervisor } from "./supervisor";
import { createOutputWatcher, IDLE_SCRIPT, nodeArgv, pidAlive, waitForPidGone } from "./supervisor.real.test-support";
import type { ProcessSupervisor } from "./types";

const T = { timeout: 30_000 };

describe("process supervisor with real children", () => {
  const supervisors: ProcessSupervisor[] = [];
  const make = () => {
    const supervisor = createProcessSupervisor();
    supervisors.push(supervisor);
    return supervisor;
  };
  afterEach(async () => {
    await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.shutdown()));
  });

  it("captures output and reports a normal exit", T, async () => {
    const run = await make().spawn({
      mode: "child",
      argv: nodeArgv("process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"),
    });
    const exit = await run.wait();
    assert.equal(exit.reason, "exit");
    assert.equal(exit.exitCode, 3);
    assert.equal(exit.stdout, "out");
    assert.equal(exit.stderr, "err");
    assert.equal(exit.timedOut, false);
    await run.waitForExtinction?.();
  });

  it("reports spawn-error for a missing executable", T, async () => {
    const run = await make().spawn({ mode: "child", argv: ["/nonexistent/lios-binary"] });
    const exit = await run.wait();
    assert.equal(exit.reason, "spawn-error");
  });

  it("cancel kills the process and the grandchild it spawned", T, async () => {
    const watcher = createOutputWatcher();
    const run = await make().spawn({
      mode: "child",
      argv: nodeArgv(
        `const { spawn } = require("node:child_process");
         const g = spawn(process.execPath, ["-e", ${JSON.stringify(IDLE_SCRIPT)}], { stdio: ["ignore", "inherit", "ignore"] });
         console.log("PIDS " + process.pid + " " + g.pid);
         ${IDLE_SCRIPT}`,
      ),
      onStdout: watcher.onStdout,
    });
    const match = await watcher.waitFor(/PIDS (\d+) (\d+)/);
    const childPid = Number(match[1]);
    const grandchildPid = Number(match[2]);
    assert.ok(pidAlive(childPid) && pidAlive(grandchildPid));
    run.cancel();
    const exit = await run.wait();
    assert.equal(exit.reason, "manual-cancel");
    await run.waitForExtinction?.();
    assert.equal(await waitForPidGone(childPid), true, "child still alive");
    assert.equal(await waitForPidGone(grandchildPid), true, "grandchild still alive");
  });

  it("overall timeout terminates with reason overall-timeout", T, async () => {
    const run = await make().spawn({ mode: "child", argv: nodeArgv(IDLE_SCRIPT), timeoutMs: 300 });
    const exit = await run.wait();
    assert.equal(exit.reason, "overall-timeout");
    assert.equal(exit.timedOut, true);
    assert.equal(exit.noOutputTimedOut, false);
  });

  it("no-output timeout terminates a silent process after its last output", T, async () => {
    const watcher = createOutputWatcher();
    const run = await make().spawn({
      mode: "child",
      argv: nodeArgv(`console.log("started"); ${IDLE_SCRIPT}`),
      // This real-process test verifies silence termination, not sub-300ms Node cold startup.
      // Exact timer rearming is covered by the supervisor's injected-clock tests.
      noOutputTimeoutMs: 5_000,
      onStdout: watcher.onStdout,
    });
    await watcher.waitFor(/started/);
    const exit = await run.wait();
    assert.equal(exit.reason, "no-output-timeout");
    assert.equal(exit.timedOut, true);
    assert.equal(exit.noOutputTimedOut, true);
    assert.match(exit.stdout, /started/);
    await run.waitForExtinction?.();
    assert.ok(run.pid !== undefined && await waitForPidGone(run.pid), "the silent process is still alive");
  });

  it("truncates captured output past the cap, reports it, and still streams full chunks", T, async () => {
    let streamed = 0;
    const run = await make().spawn({
      mode: "child",
      argv: nodeArgv("process.stdout.write('x'.repeat(5000)); process.stderr.write('ok')"),
      maxCapturedOutputChars: 256,
      onStdout: (chunk) => {
        streamed += chunk.length;
      },
    });
    const exit = await run.wait();
    assert.equal(exit.stdoutTruncated, true);
    assert.equal(exit.stderrTruncated, false);
    assert.ok(exit.stdout.length <= 256);
    assert.match(exit.stdout, /^\[lios: captured stdout truncated to last 256 chars\]/);
    assert.equal(streamed, 5000);
  });

  it("cancelScope kills every process in the scope and leaves other scopes alone", T, async () => {
    const supervisor = make();
    const a1 = await supervisor.spawn({ mode: "child", argv: nodeArgv(IDLE_SCRIPT), scopeKey: "conv-a" });
    const a2 = await supervisor.spawn({ mode: "child", argv: nodeArgv(IDLE_SCRIPT), scopeKey: "conv-a" });
    const b = await supervisor.spawn({ mode: "child", argv: nodeArgv(IDLE_SCRIPT), scopeKey: "conv-b" });
    supervisor.cancelScope("conv-a");
    const [exitA1, exitA2] = await Promise.all([a1.wait(), a2.wait()]);
    assert.equal(exitA1.reason, "manual-cancel");
    assert.equal(exitA2.reason, "manual-cancel");
    assert.equal(b.activity.resultSettled, false);
    assert.ok(b.pid !== undefined && pidAlive(b.pid));
    supervisor.cancelScope("conv-b");
    assert.equal((await b.wait()).reason, "manual-cancel");
  });

  it("acquireScopeCleanup closes the scope: cancels and joins its runs", T, async () => {
    const supervisor = make();
    const close = supervisor.acquireScopeCleanup("conv-c");
    const run = await supervisor.spawn({ mode: "child", argv: nodeArgv(IDLE_SCRIPT), scopeKey: "conv-c" });
    await close();
    assert.equal((await run.wait()).reason, "manual-cancel");
    assert.ok(run.pid !== undefined && (await waitForPidGone(run.pid)));
  });

  it("escalates to SIGKILL when the process ignores SIGTERM", T, async () => {
    const watcher = createOutputWatcher();
    const run = await make().spawn({
      mode: "child",
      argv: nodeArgv(`process.on("SIGTERM", () => {}); console.log("armed"); ${IDLE_SCRIPT}`),
      onStdout: watcher.onStdout,
      gracefulCancelMs: 200,
    });
    await watcher.waitFor(/armed/);
    run.cancel();
    const exit = await run.wait();
    assert.equal(exit.reason, "manual-cancel");
    // POSIX reports the signal. Windows terminates the tree with taskkill and reports no OS signal, so assert the
    // observable contract instead: the process that ignored the graceful request is really gone.
    if (process.platform === "win32") {
      assert.ok(exit.exitSignal === null || exit.exitSignal === "SIGKILL", `unexpected exit signal ${String(exit.exitSignal)}`);
      assert.ok(run.pid !== undefined && (await waitForPidGone(run.pid)), "the cancelled process is still alive");
    } else {
      assert.equal(exit.exitSignal, "SIGKILL");
    }
  });

  it("kills a SIGTERM-ignoring descendant with no inherited output after the root exits", { ...T, skip: process.platform === "win32" }, async () => {
    const watcher = createOutputWatcher();
    const descendant = `process.on("SIGTERM", () => {}); process.send("ready"); ${IDLE_SCRIPT}`;
    const run = await make().spawn({
      mode: "child",
      argv: nodeArgv(`const { spawn } = require("node:child_process");
        const g = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
        g.once("message", () => { g.disconnect(); console.log("PIDS " + process.pid + " " + g.pid); });
        ${IDLE_SCRIPT}`),
      onStdout: watcher.onStdout,
      gracefulCancelMs: 200,
    });
    const match = await watcher.waitFor(/PIDS (\d+) (\d+)/);
    const descendantPid = Number(match[2]);
    run.cancel();
    assert.equal((await run.wait()).reason, "manual-cancel");
    await run.waitForExtinction?.();
    assert.equal(await waitForPidGone(descendantPid), true, "descendant survived root close");
  });

  it("joins both output pipes before returning a large natural-exit result", T, async () => {
    const size = 2 * 1024 * 1024;
    const run = await make().spawn({
      mode: "child",
      argv: nodeArgv(`process.stdout.write("o".repeat(${size})); process.stderr.write("e".repeat(${size}));`),
      maxCapturedOutputChars: size,
    });
    const exit = await run.wait();
    assert.equal(exit.stdout.length, size);
    assert.equal(exit.stderr.length, size);
    assert.equal(exit.stdoutTruncated, false);
    assert.equal(exit.stderrTruncated, false);
    await run.waitForExtinction?.();
  });
});
