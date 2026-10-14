// Written for LiOS, GM-10b, wrapping the OpenClaw MIT terminal/kernel adaptations at
// c074824a27c96d3983043f9eeb33823cd1772d8c (src/process/terminal-pty.ts and src/process/supervisor/*).
// Canonical session/admission ownership remains with LiOS; this module creates no endpoint or permission authority.
// Native PTY is optional and lazy. Pipes are real supervised children, not terminal emulation; resize is unsupported.
import { constants } from "node:os";
import type { TerminalBackend, TerminalBackendExit } from "./backend";
import { BoundedBuffer } from "./bounded-buffer";
import { sliceUtf16Safe, toErrorObject } from "./coerce";
import { getProcessSupervisor } from "./index";
import { signalPtySessionTree } from "./kill-tree";
import { NativePtyUnavailableError, spawnTerminalPty, validateTerminalCommand, validateTerminalDimensions } from "./terminal-pty";
import type { TerminalPtyDependencies, TerminalPtySubscription } from "./terminal-pty";
import type { ProcessSupervisor } from "./types";

export type OpenTerminalInput = {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols: number;
  rows: number;
  preferPty?: boolean;
};
export type OpenTerminalResult = { backend: TerminalBackend; mode: "pty" | "pipe"; pid: number | undefined };
export type TerminalBackendDependencies = TerminalPtyDependencies & { supervisor?: ProcessSupervisor };

// Startup output only: the session's existing output ring owns output after first subscription.
const STARTUP_OUTPUT_CHARS = 64 * 1024;
class TerminalEvents {
  private readonly pending = new BoundedBuffer<string>(STARTUP_OUTPUT_CHARS,
    { mode: "drop-oldest", fit: (chunk, capacity) => sliceUtf16Safe(chunk, -capacity) }, (chunk) => chunk.length);
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(exit: TerminalBackendExit) => void>();
  private exitState: TerminalBackendExit | undefined;
  private subscribed = false;

  data(chunk: string): void {
    if (this.exitState || !chunk) { return; }
    if (!this.subscribed) { this.pending.push(chunk); return; }
    for (const listener of this.dataListeners) { listener(chunk); }
  }
  exit(exit: TerminalBackendExit): void {
    if (this.exitState) { return; }
    this.exitState = exit;
    for (const listener of this.exitListeners) { listener(exit); }
  }
  onData(listener: (data: string) => void): void {
    this.dataListeners.add(listener);
    if (!this.subscribed) {
      this.subscribed = true;
      for (const chunk of this.pending.drain()) { listener(chunk); }
    }
  }
  onExit(listener: (exit: TerminalBackendExit) => void): void {
    if (this.exitListeners.has(listener)) { return; }
    this.exitListeners.add(listener);
    if (this.exitState) { listener(this.exitState); }
  }
  get exited(): boolean { return this.exitState !== undefined; }
}

export class PipeTerminalResizeError extends Error {
  constructor() {
    super("Pipe terminal mode does not support resizing");
    this.name = "PipeTerminalResizeError";
  }
}

export async function openTerminalBackend(
  input: OpenTerminalInput,
  dependencies: TerminalBackendDependencies = {},
): Promise<OpenTerminalResult> {
  validateTerminalDimensions(input.cols, input.rows);
  validateTerminalCommand(input.argv);
  const events = new TerminalEvents();
  if (input.preferPty !== false) {
    try {
      const pty = await spawnTerminalPty({
        file: input.argv[0], args: input.argv.slice(1), cwd: input.cwd, env: input.env,
        cols: input.cols, rows: input.rows,
      }, dependencies);
      let killed = false;
      let sourceExited = false;
      let lifecycleError: Error | undefined;
      const subscriptions: TerminalPtySubscription[] = [];
      try {
        const dataSubscription = pty.onData((data) => events.data(data));
        if (dataSubscription) { subscriptions.push(dataSubscription); }
        const exitSubscription = pty.onExit((exit) => {
          if (sourceExited) { return; }
          sourceExited = true;
          // Natural root exit must also retire retained descendants. Never native-kill a root PID after exit.
          if (!killed) {
            killed = true;
            try { (dependencies.signalTree ?? signalPtySessionTree)(pty.pid, "SIGKILL"); }
            catch (error) { lifecycleError ??= toErrorObject(error, "PTY descendant cleanup failed"); }
          }
          // Join any synchronous startup subscription and the native output/exit turn before publishing.
          queueMicrotask(() => {
            for (const subscription of subscriptions.splice(0)) {
              try { subscription.dispose(); }
              catch (error) { lifecycleError ??= toErrorObject(error, "PTY subscription disposal failed"); }
            }
            events.exit({ ...exit, ...(lifecycleError ? { error: lifecycleError.message } : {}) });
          });
        });
        if (exitSubscription) { subscriptions.push(exitSubscription); }
      } catch (error) {
        const failures: unknown[] = [error];
        for (const subscription of subscriptions) {
          try { subscription.dispose(); } catch (disposeError) { failures.push(disposeError); }
        }
        try { pty.kill(); } catch (killError) { failures.push(killError); }
        if (failures.length > 1) { throw new AggregateError(failures, "PTY construction cleanup failed"); }
        throw error;
      }
      return {
        mode: "pty", pid: pty.pid,
        backend: {
          write: (data) => {
            if (killed || sourceExited) { throw new Error("Terminal is closed"); }
            pty.write(data);
          },
          resize: (cols, rows) => {
            validateTerminalDimensions(cols, rows);
            if (killed || sourceExited) { throw new Error("Terminal is closed"); }
            pty.resize(cols, rows);
          },
          pause: () => { if (!sourceExited) { pty.pause(); } },
          resume: () => { if (!sourceExited) { pty.resume(); } },
          kill: () => {
            if (killed || sourceExited) { return; }
            killed = true;
            // A paused terminal must drain native output before its exit is published.
            try { pty.resume(); }
            finally {
              try { pty.kill(); }
              catch (error) { lifecycleError = toErrorObject(error, "PTY termination failed"); throw error; }
            }
          },
          onData: (listener) => events.onData(listener),
          onExit: (listener) => events.onExit(listener),
        },
      };
    } catch (error) {
      if (!(error instanceof NativePtyUnavailableError)) { throw error; }
    }
  }

  const run = await (dependencies.supervisor ?? getProcessSupervisor()).spawn({
    mode: "child", argv: input.argv, cwd: input.cwd, env: input.env,
    stdinMode: "pipe-open", captureOutput: false,
    onStdout: (data) => events.data(data), onStderr: (data) => events.data(data),
  });
  if (!run.pauseOutput || !run.resumeOutput || !run.stdin) {
    // Production children always supply these. An injected incomplete adapter is not a working terminal.
    run.cancel();
    await Promise.allSettled([run.wait(), run.waitForExtinction?.()]);
    throw new Error("Pipe terminal requires stdin and real output backpressure hooks");
  }
  const pauseOutput = run.pauseOutput;
  const resumeOutput = run.resumeOutput;
  const stdin = run.stdin;
  let killed = false;
  let lifecycleError: Error | undefined;
  // Supervisor wait joins native close and decoded EOF; extinction also reports descendant/stream cleanup failures.
  void Promise.allSettled([run.wait(), run.waitForExtinction?.()]).then(([result, cleanup]) => {
    if (result.status === "rejected") {
      events.exit({ error: toErrorObject(result.reason, "Terminal process failed").message });
      return;
    }
    const exit = result.value;
    if (cleanup.status === "rejected") { lifecycleError ??= toErrorObject(cleanup.reason, "Terminal cleanup failed"); }
    if (exit.reason === "spawn-error") { lifecycleError ??= new Error("Terminal process failed to start or its input failed"); }
    events.exit({
      ...(exit.exitCode === null ? {} : { exitCode: exit.exitCode }),
      ...(typeof exit.exitSignal === "number" ? { signal: exit.exitSignal }
        : exit.exitSignal ? { signal: constants.signals[exit.exitSignal] } : {}),
      ...(lifecycleError ? { error: lifecycleError.message } : {}),
    });
  }).catch((error: unknown) => {
    // Consume delivery failures too; promises must never leak unhandled rejections from terminal teardown.
    events.exit({ error: toErrorObject(error, "Terminal exit delivery failed").message });
  });
  return {
    mode: "pipe", pid: run.pid,
    backend: {
      write: (data) => {
        if (killed || events.exited || stdin.destroyed || stdin.writableEnded) { throw new Error("Terminal is closed"); }
        stdin.write(data, (error) => {
          if (!error) { return; }
          lifecycleError ??= error;
          // Async stdin callbacks cannot throw termination failures into the process event loop.
          try { resumeOutput(); }
          catch (resumeError) { lifecycleError ??= toErrorObject(resumeError, "Terminal output resume failed"); }
          try { run.cancel("spawn-error"); }
          catch (cancelError) { lifecycleError ??= toErrorObject(cancelError, "Terminal termination failed"); }
        });
      },
      resize: (cols, rows) => { validateTerminalDimensions(cols, rows); throw new PipeTerminalResizeError(); },
      pause: () => { if (!events.exited && !killed) { pauseOutput(); } },
      resume: () => { if (!events.exited) { resumeOutput(); } },
      kill: () => {
        if (killed || events.exited) { return; }
        killed = true;
        try { resumeOutput(); } finally { run.cancel(); }
      },
      onData: (listener) => events.onData(listener),
      onExit: (listener) => events.onExit(listener),
    },
  };
}
