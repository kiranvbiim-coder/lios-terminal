// Ported/adapted from OpenClaw src/process/terminal-pty.test.ts (MIT, Copyright (c) 2026 OpenClaw Foundation),
// commit c074824a27c96d3983043f9eeb33823cd1772d8c: TERM normalization and tree-signal cases.
// LiOS: node:test/assert and injected native loader replace vitest module mocks; tree kill now also invokes native root kill.
// Added dimension/argv/error-boundary tests; Windows wrapper/Bun branches are intentionally not imported.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChildEnv } from "./env";
import { resolvePtyTerminalName, setPtyTerminalName } from "./pty-terminal-name";
import path from "node:path";
import { loadNativePty, nativePtyLoadPath, NativePtyUnavailableError, signalTerminalPtyTree, spawnTerminalPty, validateTerminalCommand, validateTerminalDimensions } from "./terminal-pty";
import type { NativePtyModule, TerminalPtyHandle, TerminalPtySpawnParams } from "./terminal-pty";

const T = { timeout: 5_000 };
const INPUT: TerminalPtySpawnParams = { file: process.execPath, args: ["-e", "0"], cols: 80, rows: 24 };
function nativeHarness() {
  const calls: string[] = [];
  const pty: TerminalPtyHandle = {
    pid: 4321,
    write: (data) => { calls.push(`write:${data}`); },
    resize: (cols, rows) => { calls.push(`resize:${cols}:${rows}`); },
    pause: () => { calls.push("pause"); }, resume: () => { calls.push("resume"); },
    onData: () => undefined, onExit: () => undefined,
    kill: (signal) => { calls.push(`kill:${signal ?? "default"}`); },
  };
  const invocations: Array<{ file: string; args: string[]; options: { name: string; env: Record<string, string>; cols: number; rows: number; cwd?: string } }> = [];
  const native: NativePtyModule = {
    spawn: (file, args, options) => { invocations.push({ file, args, options }); return pty; },
  };
  return { calls, pty, invocations, native };
}

describe("lazy native terminal adaptation", () => {
  for (const term of [undefined, "", "dumb", "DUMB", " dumb "]) {
    it(`normalizes noninteractive TERM ${JSON.stringify(term)}`, T, async () => {
      const h = nativeHarness();
      await spawnTerminalPty({ ...INPUT, env: { TERM: term } }, { loadNative: async () => h.native });
      assert.equal(h.invocations[0].options.name, "xterm-256color");
      assert.equal(h.invocations[0].options.env.TERM, "xterm-256color");
    });
  }

  it("rejects unsafe environment overrides before loading or spawning a PTY", T, async () => {
    const h = nativeHarness();
    let loads = 0;
    const secretValue = "/private/injected/library.dylib";
    await assert.rejects(spawnTerminalPty({
      ...INPUT,
      env: { DYLD_INSERT_LIBRARIES: secretValue },
    }, {
      loadNative: async () => {
        loads += 1;
        return h.native;
      },
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Unsafe child environment override: DYLD_INSERT_LIBRARIES/);
      assert.ok(!error.message.includes(secretValue));
      return true;
    });
    assert.equal(loads, 0);
    assert.deepEqual(h.invocations, []);
  });
  it("preserves interactive TERM, exact argv/cwd, and the existing environment policy", T, async () => {
    const h = nativeHarness();
    const args = ["literal A&B; $(not-a-shell)", "100%", ""];
    const env = { TERM: "screen-256color", LIOS_EXPLICIT_TOKEN: "deliberate" };
    const original = { ...env };
    await spawnTerminalPty({ ...INPUT, args, env, cwd: "/tmp" }, { loadNative: async () => h.native });
    assert.deepEqual(h.invocations[0], {
      file: INPUT.file, args, options: {
        cols: 80, rows: 24, cwd: "/tmp", name: "screen-256color", env: buildChildEnv(env),
      },
    });
    assert.deepEqual(env, original);
  });
  it("keeps the donor's case-insensitive Windows TERM canonicalization", T, () => {
    const env = { Term: "old", term: "old", TERM: "new" };
    setPtyTerminalName({ env, name: "screen-256color", platform: "win32" });
    assert.deepEqual(env, { TERM: "screen-256color" });
    assert.equal(resolvePtyTerminalName(" screen-256color "), "screen-256color");
  });
  it("defers the loader until valid terminal construction and propagates loader failure", T, async () => {
    let calls = 0;
    const failure = new NativePtyUnavailableError(new Error("missing addon"));
    const loadNative = async (): Promise<NativePtyModule> => { calls++; throw failure; };
    assert.equal(calls, 0);
    await assert.rejects(spawnTerminalPty({ ...INPUT, cols: 0 }, { loadNative }), RangeError);
    assert.equal(calls, 0);
    await assert.rejects(spawnTerminalPty(INPUT, { loadNative }), (error) => error === failure);
    assert.equal(calls, 1);
  });
  it("never classifies native executable/cwd denial as module unavailability", T, async () => {
    const failure = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    await assert.rejects(spawnTerminalPty(INPUT, {
      loadNative: async () => ({ spawn: () => { throw failure; } }),
    }), (error) => error === failure);
  });
  it("forwards native write/resize/pause/resume and validates resize before native calls", T, async () => {
    const h = nativeHarness();
    const handle = await spawnTerminalPty(INPUT, { loadNative: async () => h.native });
    handle.write("text"); handle.resize(90, 30); handle.pause(); handle.resume();
    assert.deepEqual(h.calls, ["write:text", "resize:90:30", "pause", "resume"]);
    assert.throws(() => handle.resize(1.5, 30), RangeError);
    assert.equal(h.calls.length, 4);
  });
  for (const signal of [undefined, "SIGTERM"] as const) {
    it(`signals PTY descendants before native root kill for ${signal}`, T, async () => {
      const h = nativeHarness();
      const handle = await spawnTerminalPty(INPUT, {
        loadNative: async () => h.native,
        signalTree: (pid, sig) => { h.calls.push(`tree:${pid}:${sig}`); },
      });
      handle.kill(signal);
      assert.deepEqual(h.calls, [`tree:4321:${signal ?? "SIGKILL"}`, `kill:${process.platform === "win32" ? "default" : signal ?? "SIGKILL"}`]);
    });
  }
  it("uses native kill for nonterminating signals, and still native-kills an already-gone tree", T, () => {
    const calls: string[] = [];
    signalTerminalPtyTree(4321, "SIGHUP", (signal) => { calls.push(signal); }, () => { assert.fail("tree signal"); });
    signalTerminalPtyTree(0, undefined, (signal) => { calls.push(signal); }, () => { assert.fail("zero PID signal"); });
    assert.deepEqual(calls, ["SIGHUP", "SIGKILL"]);
  });
  it("does not swallow cleanup failure or skip native root cleanup when tree signaling throws", T, () => {
    const failure = new Error("cleanup denied");
    let nativeKilled = false;
    assert.throws(() => signalTerminalPtyTree(4321, undefined, () => { nativeKilled = true; }, () => { throw failure; }),
      (error) => error === failure);
    assert.equal(nativeKilled, true);
  });
  it("rejects invalid dimensions and direct batch invocations without a shell fallback", T, () => {
    for (const cols of [0, -1, 1.2, NaN, Infinity, 65536]) { assert.throws(() => validateTerminalDimensions(cols, 24), RangeError); }
    for (const rows of [0, -1, 1.2, NaN, Infinity, 65536]) { assert.throws(() => validateTerminalDimensions(80, rows), RangeError); }
    validateTerminalDimensions(1, 65535);
    for (const argv of [[], [""], ["command\0"], ["node", "arg\0"], ["tool.cmd"], ["C:\\tool.BAT"]]) {
      assert.throws(() => validateTerminalCommand(argv));
    }
  });
});

describe("packaged-app native module path", () => {
  const sep = path.sep;
  const unpacked = ["", "Applications", "LiOS.app", "Contents", "Resources", "app.asar.unpacked", "node_modules", "@lydell", "node-pty", "lib", "index.js"].join(sep);
  const viaAsar = unpacked.replace(`${sep}app.asar.unpacked${sep}`, `${sep}app.asar${sep}`);

  it("loads the unpacked tree through its app.asar path so node-pty's own rewrite finds spawn-helper", () => {
    assert.equal(nativePtyLoadPath(unpacked), viaAsar);
    // This is the rewrite node-pty applies to its own location; applying it to the unpacked path doubled the suffix.
    assert.match(unpacked.replace("app.asar", "app.asar.unpacked"), /app\.asar\.unpacked\.unpacked/);
    assert.doesNotMatch(viaAsar.replace("app.asar", "app.asar.unpacked"), /unpacked\.unpacked/);
  });

  it("leaves development and already-asar paths untouched", () => {
    const dev = ["", "work", "src", "node_modules", "@lydell", "node-pty", "lib", "index.js"].join(sep);
    assert.equal(nativePtyLoadPath(dev), dev);
    assert.equal(nativePtyLoadPath(viaAsar), viaAsar);
  });

  it("the default loader loads the real addon and spawns a real terminal, or reports it unavailable", T, async (t) => {
    let native;
    try { native = await loadNativePty(); }
    catch (error) {
      assert.ok(error instanceof NativePtyUnavailableError);
      t.skip("native PTY addon is not installed on this platform");
      return;
    }
    const handle = native.spawn(process.execPath, ["-e", "process.stdout.write(String(process.stdout.isTTY))"], { name: "xterm-256color", cols: 80, rows: 24, env: buildChildEnv({}) });
    let output = "";
    const exited = new Promise<number>((resolve) => { handle.onExit((event) => resolve(event.exitCode)); });
    handle.onData((chunk) => { output += chunk; });
    assert.equal(await exited, 0);
    assert.match(output, /true/);
  });
});
