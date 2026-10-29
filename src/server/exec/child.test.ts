// Ported/adapted from OpenClaw src/process/supervisor/adapters/{child,child.events}.test.ts
// (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS: native dependencies are injected, vitest becomes node:test/assert; omit Windows Job/IPC/service-relay branches.
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, describe, it, mock } from "node:test";
import { createChildAdapter } from "./child";
import { createChildAdapterHarness, createStubChild } from "./child.test-support";
import { createDeferredCore } from "./deferred";
import { buildChildEnv, pythonRuntimeEnvOverlay, toStringEnv } from "./env";

const T = { timeout: 5_000 };
const POSIX = { ...T, skip: process.platform === "win32" };
afterEach(() => mock.timers.reset());

describe("native child adapter", () => {
  it("spawns a dedicated group with safe environment and closed stdin by default", T, async () => {
    const h = createChildAdapterHarness({ env: { LIOS_EXPLICIT_TOKEN: "deliberate" } });
    const options = h.spawnMock.mock.calls[0].arguments[2];
    assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
    assert.equal(options.detached, process.platform !== "win32");
    assert.equal(options.env?.LIOS_EXPLICIT_TOKEN, "deliberate");
    assert.equal(h.adapter.stdin?.writableEnded, true);
    await h.closePipes();
    h.emitExit(0);
    h.emitClose(0);
    await Promise.all([h.adapter.wait(), h.adapter.waitForExtinction()]);
    h.adapter.dispose();
  });

  it("waits for native close and both decoder tails rather than only root exit", T, async () => {
    const h = createChildAdapterHarness();
    let settled = false;
    void h.adapter.wait().then(() => { settled = true; });
    h.child.stdout.write(Buffer.from([0xf0, 0x9f]));
    h.child.stderr.write(Buffer.from([0xe2]));
    h.emitExit(7);
    await nextTurn();
    assert.equal(settled, false);
    await h.closePipes();
    await nextTurn();
    assert.equal(settled, false);
    h.emitClose(7);
    assert.deepEqual(await h.adapter.wait(), { code: 7, signal: null });
    assert.deepEqual(h.stdout, ["�"]);
    assert.deepEqual(h.stderr, ["�"]);
    await h.adapter.waitForExtinction();
    h.adapter.dispose();
  });

  it("hard-signals retained descendants at close even after a graceful root exit", POSIX, async () => {
    const h = createChildAdapterHarness({}, { deferSignals: true });
    h.adapter.kill("SIGTERM");
    await h.closePipes();
    h.emitExit(null, "SIGTERM");
    h.emitClose(null, "SIGTERM");
    assert.deepEqual(h.signalTreeMock.mock.calls.map((call) => call.arguments[1]), ["SIGTERM", "SIGKILL"]);
    assert.equal(h.killMock.mock.callCount(), 0, "closed roots must never be signalled by positive PID");
    let extinct = false;
    void h.adapter.waitForExtinction().then(() => { extinct = true; });
    h.deliveries[1]();
    await nextTurn();
    assert.equal(extinct, false);
    h.deliveries[0]();
    await h.adapter.waitForExtinction();
    assert.deepEqual(await h.adapter.wait(), { code: null, signal: "SIGTERM" });
    h.adapter.dispose();
    h.adapter.kill("SIGKILL");
    assert.equal(h.signalTreeMock.mock.callCount(), 2);
  });

  it("joins late cancellation deliveries before confirming group extinction", POSIX, async () => {
    const h = createChildAdapterHarness({}, { deferSignals: true });
    await h.closePipes();
    h.emitExit(0);
    h.emitClose(0);
    h.deliveries[0]();
    h.adapter.kill("SIGKILL");
    let settled = false;
    void h.adapter.waitForExtinction().then(() => { settled = true; });
    await nextTurn();
    assert.equal(settled, false);
    h.deliveries[1]();
    await h.adapter.waitForExtinction();
    h.adapter.dispose();
  });

  it("does not confirm cleanup while its retained process group still exists", POSIX, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    let alive = true;
    const h = createChildAdapterHarness({}, { groupExists: () => alive });
    await h.closePipes();
    h.emitExit(0);
    h.emitClose(0);
    await h.adapter.wait();
    await nextTurn();
    let extinct = false;
    void h.adapter.waitForExtinction().then(() => { extinct = true; });
    assert.equal(extinct, false);
    alive = false;
    mock.timers.tick(20);
    await h.adapter.waitForExtinction();
    h.adapter.dispose();
  });

  for (const disposeEarly of [false, true]) {
    it(`retains the original kill cleanup deadline across close (disposed=${disposeEarly})`, T, async () => {
      mock.timers.enable({ apis: ["setTimeout"] });
      const h = createChildAdapterHarness({}, { deferSignals: true });
      h.adapter.kill("SIGKILL");
      mock.timers.tick(2_000);
      await h.closePipes();
      h.emitExit(0);
      h.emitClose(0);
      await h.adapter.wait();
      if (disposeEarly) { h.adapter.dispose(); }
      mock.timers.tick(2_000);
      await assert.rejects(h.adapter.waitForExtinction(), /cleanup could not be confirmed/);
      h.deliveries[0]();
      await nextTurn();
      h.adapter.dispose();
    });
  }

  it("bounded cleanup failure destroys and drains inherited pipes before wait settles", T, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const h = createChildAdapterHarness({}, { deferSignals: true });
    h.child.stdout.write(Buffer.from([0xe2]));
    h.adapter.kill("SIGKILL");
    mock.timers.tick(4_000);
    const exit = await h.adapter.wait();
    assert.deepEqual(exit, { code: null, signal: "SIGKILL" });
    assert.equal(h.child.stdout.destroyed, true);
    assert.equal(h.child.stderr.destroyed, true);
    assert.deepEqual(h.stdout, ["�"]);
    await assert.rejects(h.adapter.waitForExtinction(), /cleanup could not be confirmed/);
    h.deliveries[0]();
    h.emitClose(null, "SIGKILL");
    await nextTurn();
    h.adapter.dispose();
  });

  it("records tree signaling rejection without an unhandled promise and preserves native exit", T, async () => {
    const stub = createStubChild();
    const failure = new Error("tree signaling failed");
    const adapter = createChildAdapter({ argv: ["synthetic"] }, {
      spawn: () => stub.child,
      signalTree: () => { throw failure; },
      groupExists: () => false,
    });
    adapter.onStdout(() => {});
    adapter.onStderr(() => {});
    adapter.kill("SIGKILL");
    await assert.rejects(adapter.waitForExtinction(), (error) => error === failure);
    await stub.closePipes();
    stub.emitExit(3);
    stub.emitClose(3);
    assert.deepEqual(await adapter.wait(), { code: 3, signal: null });
    adapter.dispose();
  });

  for (const source of ["process", "stdin", "stdout", "stderr"] as const) {
    it(`retains startup ${source} errors, forwards live errors, and replays actual exit`, T, async () => {
      const h = createChildAdapterHarness();
      const emitter = source === "process" ? h.child : h.child[source];
      const early = new Error("early transport failure");
      emitter.emit("error", early);
      emitter.emit("error", new Error("duplicate early transport failure"));
      const seen: Array<[Error, string]> = [];
      h.adapter.onError((error, origin) => seen.push([error, origin]));
      assert.deepEqual(seen, [[early, source]]);
      const live = new Error("live transport failure");
      emitter.emit("error", live);
      assert.deepEqual(seen, [[early, source], [live, source]]);
      const exits: Array<number | null> = [];
      h.emitExit(1);
      h.adapter.onExit((code) => exits.push(code));
      assert.deepEqual(exits, [1]);
      await h.closePipes();
      h.emitClose(1);
      assert.deepEqual(await h.adapter.wait(), { code: 1, signal: null });
      await h.adapter.waitForExtinction();
      h.adapter.dispose();
      assert.equal(h.child.listenerCount("error"), 0);
      assert.equal(h.child.stdout.listenerCount("data"), 0);
      assert.equal(h.child.stderr.listenerCount("data"), 0);
    });
  }

  it("returns cleanup ownership when synchronous stdin delivery fails after native spawn", T, async () => {
    const stub = createStubChild();
    const failure = new Error("stdin delivery failed");
    stub.child.stdin.write = () => { throw failure; };
    const adapter = createChildAdapter({ argv: ["synthetic"], input: "payload" }, {
      spawn: () => stub.child,
      signalTree: (_pid, _signal, options) => options?.onComplete?.(),
      groupExists: () => false,
    });
    adapter.onStdout(() => {});
    adapter.onStderr(() => {});
    await stub.closePipes();
    stub.emitExit(null, "SIGKILL");
    stub.emitClose(null, "SIGKILL");
    await assert.rejects(adapter.wait(), (error) => error === failure);
    await adapter.waitForExtinction();
    adapter.dispose();
    assert.equal(stub.child.listenerCount("error"), 0);
  });
});

describe("native child awaited stdout", () => {
  it("refuses synchronous stdout ownership and joins accepted work after native close", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const chunks: string[] = [];
    const raw: Buffer[] = [];
    assert.throws(() => h.adapter.onStdout(() => {}), /requires its awaited consumer/);
    const consumed = h.adapter.consumeStdout!(async (chunk) => {
      chunks.push(chunk);
      entered.resolve();
      await release.promise;
    }, (chunk) => { raw.push(chunk); });
    h.child.stdout.write("accepted");
    await entered.promise;
    const wait = h.adapter.wait();
    let settled = false;
    void wait.then(() => { settled = true; }, () => { settled = true; });
    await h.closePipes();
    h.emitExit(0);
    h.emitClose(0);
    await h.adapter.waitForExtinction();
    assert.equal(settled, false);
    release.resolve();
    await consumed;
    assert.deepEqual(await wait, { code: 0, signal: null });
    assert.deepEqual(chunks, ["accepted"]);
    assert.equal(Buffer.concat(raw).toString(), "accepted");
    h.adapter.dispose();
  });

  it("stops immediately for rejected consumption but waits for native close", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const failed = createDeferredCore();
    const failure = new Error("async observer rejected");
    const errors: Error[] = [];
    h.adapter.onError((error, source) => {
      if (source === "stdout") {
        errors.push(error);
        failed.resolve();
      }
    });
    const consumed = h.adapter.consumeStdout!(async () => { throw failure; });
    const wait = h.adapter.wait();
    let settled = false;
    void wait.then(() => { settled = true; }, () => { settled = true; });
    h.child.stdout.write("input");
    await failed.promise;
    assert.equal(h.signalTreeMock.mock.calls[0].arguments[1], "SIGKILL");
    await assert.rejects(consumed, (error) => error === failure);
    assert.equal(settled, false);
    await h.closePipes();
    h.emitExit(null, "SIGKILL");
    h.emitClose(null, "SIGKILL");
    await assert.rejects(wait, (error) => error === failure);
    assert.deepEqual(errors, [failure]);
    await h.adapter.waitForExtinction();
    h.adapter.dispose();
  });

  it("joins the awaited decoder tail after native close", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const chunks: string[] = [];
    const consumed = h.adapter.consumeStdout!(async (chunk) => {
      chunks.push(chunk);
      entered.resolve();
      await release.promise;
    });
    h.child.stdout.write(Buffer.from([0xf0, 0x9f]));
    await h.closePipes();
    h.emitExit(2);
    h.emitClose(2);
    await entered.promise;
    let settled = false;
    const wait = h.adapter.wait();
    void wait.then(() => { settled = true; });
    await nextTurn();
    assert.equal(settled, false);
    assert.deepEqual(chunks, ["�"]);
    release.resolve();
    await consumed;
    assert.deepEqual(await wait, { code: 2, signal: null });
    await h.adapter.waitForExtinction();
    h.adapter.dispose();
  });

  it("does not release accepted work when disposed before EOF", T, async () => {
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" });
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const consumed = h.adapter.consumeStdout!(async () => {
      entered.resolve();
      await release.promise;
    });
    const wait = h.adapter.wait();
    let settled = false;
    void wait.then(() => { settled = true; }, () => { settled = true; });
    h.child.stdout.write("accepted");
    await entered.promise;
    h.adapter.dispose();
    h.emitExit(0);
    h.emitClose(0);
    await nextTurn();
    assert.equal(settled, false);
    release.resolve();
    await assert.rejects(consumed, /stdout consumption closed/);
    await assert.rejects(wait, /stdout consumption closed/);
    await h.adapter.waitForExtinction();
  });

  it("bounds canceled pipe retention and joins accepted work through forced drain", T, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const h = createChildAdapterHarness({ stdoutConsumption: "awaited" }, { deferSignals: true });
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const chunks: string[] = [];
    const consumed = h.adapter.consumeStdout!(async (chunk) => {
      chunks.push(chunk);
      entered.resolve();
      await release.promise;
    });
    h.child.stdout.write("accepted");
    await entered.promise;
    const large = Buffer.alloc(h.child.stdout.writableHighWaterMark, 0x78);
    h.child.stdout.write(large);
    assert.equal(h.child.stdout.write(large), false);
    h.adapter.kill("SIGKILL");
    assert.equal(h.child.stdout.isPaused(), true);
    const wait = h.adapter.wait();
    let settled = false;
    void wait.then(() => { settled = true; }, () => { settled = true; });
    mock.timers.tick(4_000);
    await nextTurn();
    assert.equal(h.child.stdout.destroyed, true);
    assert.equal(settled, false);
    release.resolve();
    await assert.rejects(consumed, /stdout consumption closed/);
    await assert.rejects(wait, /stdout consumption closed/);
    assert.deepEqual(chunks, ["accepted"]);
    await assert.rejects(h.adapter.waitForExtinction(), /cleanup could not be confirmed/);
    h.deliveries.forEach((deliver) => deliver());
    h.emitClose(null, "SIGKILL");
    h.adapter.dispose();
  });
});

describe("explicit child environment overlays", () => {
  it("does not inherit unspecified secrets and treats undefined as removal", () => {
    assert.deepEqual(buildChildEnv({ PATH: undefined, API_TOKEN: "explicit", EXTRA: "yes" }, {
      PATH: "/parent", HOME: "/home", API_TOKEN: "inherited", UNLISTED: "private", NODE_OPTIONS: "unsafe",
    }, "darwin"), { HOME: "/home", API_TOKEN: "explicit", EXTRA: "yes" });
    assert.deepEqual(toStringEnv({ PRESENT: "", ABSENT: undefined }), { PRESENT: "" });
  });
  for (const name of [
    "NODE_OPTIONS", "NODE_PATH", "PYTHONHOME", "PYTHONPATH", "BASH_ENV", "ENV",
    "GIT_SSH_COMMAND", "NPM_CONFIG_NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES",
  ]) {
    it(`rejects unsafe explicit environment key ${name} without echoing its value`, () => {
      const secretValue = "never-echo-this-value";
      assert.throws(() => buildChildEnv({ [name]: secretValue }, {}, "darwin"), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, `Unsafe child environment override: ${name}`);
        assert.ok(!error.message.includes(secretValue));
        return true;
      });
    });
  }
  it("matches dangerous override names case-insensitively on Windows", () => {
    assert.throws(
      () => buildChildEnv({ nOdE_oPtIoNs: "private" }, {}, "win32"),
      /Unsafe child environment override: NODE_OPTIONS/,
    );
    assert.throws(
      () => buildChildEnv({ gIt_SsH_cOmMaNd: "private" }, {}, "win32"),
      /Unsafe child environment override: GIT_SSH_COMMAND/,
    );
  });
  it("keeps Python runtime overrides inside the fixed profile key set", () => {
    const overlay = pythonRuntimeEnvOverlay({}, {
      PYTHONPATH: "/runtime/python",
      PYTHONHOME: "/runtime/home",
      PIP_INDEX_URL: "https://packages.example/",
      NODE_OPTIONS: "--require=/untrusted",
      OTHER: "not-selected",
    });
    assert.deepEqual(overlay, {
      PYTHONHOME: "/runtime/home",
      PYTHONPATH: "/runtime/python",
      PIP_INDEX_URL: "https://packages.example/",
    });
    assert.deepEqual(buildChildEnv(overlay, {}, "darwin", "python-runtime"), overlay);
    assert.throws(
      () => pythonRuntimeEnvOverlay({ NODE_OPTIONS: "private" }, {}),
      /Unsafe child environment override: NODE_OPTIONS/,
    );
    assert.throws(
      () => buildChildEnv({ OTHER: "private" }, {}, "darwin", "python-runtime"),
      /not allowed by the python-runtime profile: OTHER/,
    );
    assert.throws(
      () => buildChildEnv({ NODE_OPTIONS: "private" }, {}, "darwin", "python-runtime"),
      /Unsafe child environment override: NODE_OPTIONS/,
    );
  });
  it("replaces Windows inherited names case-insensitively", () => {
    assert.deepEqual(buildChildEnv({ pAtH: "/explicit", systemRoot: undefined }, {
      Path: "/parent", SystemRoot: "C:\\Windows", COMSPEC: "cmd.exe", SERVICE_TOKEN: "secret",
    }, "win32"), { PATH: "/explicit", COMSPEC: "cmd.exe" });
  });
});
