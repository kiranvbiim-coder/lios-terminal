// Written for LiOS GM-10b; node:test/assert. Native fixtures exercise the injected loader, never a production fake.
// Lifecycle lineage: OpenClaw MIT src/process/terminal-pty{,-node}.test.ts at
// c074824a27c96d3983043f9eeb33823cd1772d8c (startup output/exit replay, pause/resume, termination).
// Pipe fallback tests use the real imported child supervisor, including decoder drain and descendant cleanup.
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import type { TerminalBackend, TerminalBackendExit } from "./backend";
import { createDeferredCore } from "./deferred";
import { createChildAdapter } from "./child";
import { createProcessSupervisor } from "./supervisor";
import { nodeArgv, waitForPidGone } from "./supervisor.real.test-support";
import { openTerminalBackend, PipeTerminalResizeError } from "./terminal-backend";
import { NativePtyUnavailableError } from "./terminal-pty";
import type { NativePtyModule, TerminalPtyHandle } from "./terminal-pty";
import type { ProcessSupervisor } from "./types";

const T = { timeout: 30_000 };
const INPUT = { argv: nodeArgv("0"), cols: 80, rows: 24 };
function exitOf(backend: TerminalBackend): Promise<TerminalBackendExit> {
  const exit = createDeferredCore<TerminalBackendExit>();
  backend.onExit(exit.resolve);
  return exit.promise;
}
async function waitForFile(filename: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filename);
      return true;
    } catch {
      await delay(20);
    }
  }
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

function nativeHarness() {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener: ((exit: { exitCode: number; signal?: number }) => void) | undefined;
  const calls: string[] = [];
  const pty: TerminalPtyHandle = {
    pid: 4321,
    write: (data) => { calls.push(`write:${data}`); }, resize: (cols, rows) => { calls.push(`resize:${cols}:${rows}`); },
    pause: () => { calls.push("pause"); }, resume: () => { calls.push("resume"); },
    onData: (listener) => { dataListener = listener; return { dispose: () => { calls.push("dispose-data"); } }; },
    onExit: (listener) => { exitListener = listener; return { dispose: () => { calls.push("dispose-exit"); } }; },
    kill: (signal) => { calls.push(`kill:${signal ?? "default"}`); },
  };
  const native: NativePtyModule = { spawn: () => pty };
  return {
    native, pty, calls,
    emitData: (data: string) => { dataListener?.(data); },
    emitExit: (exitCode = 0) => { exitListener?.({ exitCode }); },
    signalTree: (pid: number, signal: "SIGTERM" | "SIGKILL") => { calls.push(`tree:${pid}:${signal}`); },
  };
}
const unavailable = async (): Promise<NativePtyModule> => {
  throw new NativePtyUnavailableError(new Error("addon missing or incompatible"));
};

describe("terminal backend", () => {
  const supervisors: ProcessSupervisor[] = [];
  const makeSupervisor = () => {
    const supervisor = createProcessSupervisor();
    supervisors.push(supervisor);
    return supervisor;
  };
  afterEach(async () => { await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.shutdown())); });

  it("adapts native controls and replays bounded pre-subscription output plus exactly one exit", T, async () => {
    const h = nativeHarness();
    const result = await openTerminalBackend(INPUT, { loadNative: async () => h.native, signalTree: h.signalTree });
    assert.equal(result.mode, "pty"); assert.equal(result.pid, 4321);
    result.backend.write("hello"); result.backend.resize(100, 40); result.backend.pause(); result.backend.resume();
    h.emitData("early-"); h.emitExit(7); h.emitData("tail"); h.emitExit(8);
    await nextTurn();
    const order: string[] = [];
    result.backend.onData((chunk) => { order.push(chunk); });
    result.backend.onExit((exit) => { order.push(`exit:${exit.exitCode}`); });
    assert.deepEqual(order, ["early-", "tail", "exit:7"]);
    let duplicateExits = 0;
    const listener = () => { duplicateExits++; };
    result.backend.onExit(listener); result.backend.onExit(listener);
    assert.equal(duplicateExits, 1);
    assert.deepEqual(h.calls, ["write:hello", "resize:100:40", "pause", "resume", "tree:4321:SIGKILL", "dispose-data", "dispose-exit"]);
    result.backend.kill();
    assert.throws(() => result.backend.write("late"), /closed/);
  });

  it("bounds native startup backlog without bisecting UTF-16 surrogate pairs", T, async () => {
    const h = nativeHarness();
    const { backend } = await openTerminalBackend(INPUT, { loadNative: async () => h.native, signalTree: h.signalTree });
    h.emitData("😀".repeat(40_000));
    const output: string[] = [];
    backend.onData((chunk) => { output.push(chunk); });
    assert.equal(output.join("").length, 64 * 1024);
    assert.equal(output.join(""), "😀".repeat(32 * 1024));
    h.emitExit(); await exitOf(backend);
  });

  it("resumes native output on kill, signals descendants and native root once, and surfaces tree failure", T, async () => {
    const h = nativeHarness();
    const failure = new Error("tree denied");
    const { backend } = await openTerminalBackend(INPUT, {
      loadNative: async () => h.native,
      signalTree: () => { h.calls.push("tree-failed"); throw failure; },
    });
    backend.pause();
    assert.throws(() => backend.kill(), (error) => error === failure);
    backend.kill(); h.emitExit();
    const exit = await exitOf(backend);
    assert.equal(exit.error, "tree denied");
    assert.deepEqual(h.calls, ["pause", "resume", "tree-failed", `kill:${process.platform === "win32" ? "default" : "SIGKILL"}`, "dispose-data", "dispose-exit"]);
  });

  for (const code of ["EACCES", "ENOENT", "ENOTDIR"]) {
    it(`does not retry native launch ${code} through pipe execution`, T, async () => {
      const supervisor = makeSupervisor();
      let pipeSpawns = 0;
      const failure = Object.assign(new Error(`spawn ${code}`), { code });
      await assert.rejects(openTerminalBackend(INPUT, {
        loadNative: async () => ({ spawn: () => { throw failure; } }),
        supervisor: { ...supervisor, spawn: async (input) => { pipeSpawns++; return supervisor.spawn(input); } },
      }), (error) => error === failure);
      assert.equal(pipeSpawns, 0);
    });
  }

  it("does not retry a denied PTY environment through pipe execution", T, async () => {
    const supervisor = makeSupervisor();
    let loads = 0;
    let pipeSpawns = 0;
    await assert.rejects(openTerminalBackend({ ...INPUT, env: { NODE_OPTIONS: "private" } }, {
      loadNative: async () => {
        loads += 1;
        return nativeHarness().native;
      },
      supervisor: { ...supervisor, spawn: async (input) => { pipeSpawns += 1; return supervisor.spawn(input); } },
    }), /Unsafe child environment override: NODE_OPTIONS/);
    assert.equal(loads, 0);
    assert.equal(pipeSpawns, 0);
  });
  it("does not reinterpret an unclassified loader exception as availability", T, async () => {
    const failure = new Error("authorization denied");
    await assert.rejects(openTerminalBackend(INPUT, { loadNative: async () => { throw failure; } }), (error) => error === failure);
  });

  it("falls back to real pipes with stdin open, merged output, decoder tails before exit, and unsupported resize", T, async () => {
    const result = await openTerminalBackend({ ...INPUT, argv: nodeArgv(`
      process.stdin.once('data', data => {
        process.stdout.write('out:' + data.toString());
        process.stderr.write('err');
        process.stderr.write(Buffer.from([0xe2]));
        process.stdin.destroy();
      });
    `) }, { loadNative: unavailable, supervisor: makeSupervisor() });
    assert.equal(result.mode, "pipe"); assert.ok(result.pid);
    assert.throws(() => result.backend.resize(90, 30), PipeTerminalResizeError);
    assert.throws(() => result.backend.resize(0, 30), RangeError);
    const order: string[] = [];
    result.backend.onData((chunk) => { order.push(chunk); });
    const exitPromise = exitOf(result.backend);
    result.backend.onExit(() => { order.push("EXIT"); });
    result.backend.write("literal A&B; $(not-shell)");
    const exit = await exitPromise;
    assert.equal(exit.exitCode, 0);
    assert.equal(exit.error, undefined);
    assert.equal(order.pop(), "EXIT");
    const output = order.join("");
    assert.match(output, /out:literal A&B; \$\(not-shell\)/);
    assert.match(output, /err/); assert.match(output, /�/);
    assert.throws(() => result.backend.write("late"), /closed/);
  });

  it("skips native loading entirely for pipe preference and replays immediate-exit output to late subscribers", T, async () => {
    let loads = 0;
    const { backend, mode } = await openTerminalBackend({ ...INPUT, preferPty: false,
      argv: nodeArgv("process.stdout.write('startup'); process.stderr.write('stderr'); process.exitCode = 9"),
    }, { loadNative: async () => { loads++; throw new Error("must not load"); }, supervisor: makeSupervisor() });
    assert.equal(mode, "pipe");
    const firstExit = await exitOf(backend);
    assert.equal(firstExit.exitCode, 9); assert.equal(loads, 0);
    const chunks: string[] = [];
    backend.onData((chunk) => { chunks.push(chunk); });
    assert.match(chunks.join(""), /startup/); assert.match(chunks.join(""), /stderr/);
    assert.deepEqual(await exitOf(backend), firstExit);
  });

  it("bounds real pipe startup output without retaining full captured output", T, async () => {
    const { backend } = await openTerminalBackend({ ...INPUT, preferPty: false,
      argv: nodeArgv("process.stdout.write('x'.repeat(200000)); process.stdout.write('END')"),
    }, { supervisor: makeSupervisor() });
    await exitOf(backend);
    let output = "";
    backend.onData((chunk) => { output += chunk; });
    assert.ok(output.length > 0 && output.length <= 64 * 1024);
    assert.ok(output.endsWith("END"));
  });

  it("surfaces a real missing executable as an error, not fabricated successful output", T, async () => {
    const { backend, pid } = await openTerminalBackend({ ...INPUT, preferPty: false,
      argv: [path.join(os.tmpdir(), "lios-terminal-nonexistent-executable")],
    }, { supervisor: makeSupervisor() });
    assert.equal(pid, undefined);
    const exit = await exitOf(backend);
    assert.match(exit.error ?? "", /failed/);
    assert.notEqual(exit.exitCode, 0);
    const chunks: string[] = [];
    backend.onData((chunk) => { chunks.push(chunk); });
    assert.deepEqual(chunks, []);
  });

  it("keeps old injected adapters valid for supervisor runs but rejects an incomplete pipe terminal", T, async () => {
    const supervisor = createProcessSupervisor({
      createAdapter: (input) => ({
        ...createChildAdapter(input), pauseOutput: undefined, resumeOutput: undefined,
      }),
    });
    supervisors.push(supervisor);
    const ordinary = await supervisor.spawn({ mode: "child", argv: nodeArgv("process.stdout.write('ordinary')") });
    assert.equal((await ordinary.wait()).stdout, "ordinary");
    await ordinary.waitForExtinction?.();
    await assert.rejects(openTerminalBackend({ ...INPUT, preferPty: false,
      argv: nodeArgv("process.stdin.resume()"),
    }, { supervisor }), /real output backpressure hooks/);
  });

  it("uses real readable stream pause/resume, not callback suppression", T, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lios-terminal-pause-"));
    const marker = path.join(directory, "produced");
    let backend: TerminalBackend | undefined;
    try {
      const result = await openTerminalBackend({ ...INPUT, preferPty: false, argv: nodeArgv(`
        const fs = require('node:fs');
        process.stdout.write('READY');
        // The child must stay alive while paused: Node resumes paused stdio when a child exits, which would mask the pause.
        process.stdin.on('data', (chunk) => {
          if (String(chunk).includes('quit')) process.exit(0);
          process.stdout.write('AFTER-PAUSE'); process.stderr.write('STDERR-PAUSED');
          fs.writeFileSync(${JSON.stringify(marker)}, 'produced');
        });
      `) }, { supervisor: makeSupervisor() });
      backend = result.backend;
      let output = "";
      const ready = createDeferredCore();
      backend.onData((chunk) => { output += chunk; if (output.includes("READY")) { ready.resolve(); } });
      await ready.promise;
      backend.pause();
      // macOS filesystem watchers can miss the marker and stall this real-pipe regression.
      // Poll a bounded time, while still requiring the child to consume stdin with pipes paused.
      backend.write("produce");
      assert.equal(await waitForFile(marker), true, "child should create the marker while output is paused");
      await nextTurn();
      assert.equal(output, "READY");
      const flushed = createDeferredCore();
      backend.onData(() => { if (output.includes("AFTER-PAUSE") && output.includes("STDERR-PAUSED")) { flushed.resolve(); } });
      backend.resume();
      await flushed.promise;
      backend.write("quit");
      const exit = await exitOf(backend);
      assert.equal(exit.exitCode, 0);
    } finally { backend?.kill(); await rm(directory, { recursive: true, force: true }); }
  });

  it("kills a paused pipe run idempotently and joins real descendants before exit", { ...T, skip: process.platform === "win32" }, async () => {
    // Real child lifetime timers deliberately keep native processes alive for platform signal/descendant cleanup.
    const { backend } = await openTerminalBackend({ ...INPUT, preferPty: false, argv: nodeArgv(`
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
      process.stdout.write('PIDS ' + process.pid + ' ' + child.pid + '\\n');
      setInterval(() => {}, 1000);
    `) }, { supervisor: makeSupervisor() });
    const pidsResult = createDeferredCore<number[]>();
    let output = "";
    backend.onData((chunk) => {
      output += chunk;
      const match = /PIDS (\d+) (\d+)/.exec(output);
      if (match) { pidsResult.resolve([Number(match[1]), Number(match[2])]); }
    });
    const pids = await pidsResult.promise;
    backend.pause(); backend.kill(); backend.kill();
    const exit = await exitOf(backend);
    assert.equal(exit.error, undefined);
    assert.ok(exit.signal);
    for (const pid of pids) { assert.equal(await waitForPidGone(pid), true); }
  });
});
