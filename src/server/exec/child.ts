// Adapted from OpenClaw src/process/supervisor/adapters/child.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a) modifications:
// - Child-only, synchronous construction; omitted Windows Job, spawn broker, service relay, worker IPC/start gate,
//   secret descriptor, OOM wrapper, spawn fallback and awaited-consumer branches (their owners are not imported).
// - Allow-listed inherited environment plus explicit overlay; stdin defaults to pipe-closed.
// - Detached POSIX group ownership survives root close: join every signal delivery and kill retained descendants
//   before confirming extinction. Native close and decoder drain fence wait; bounded cleanup failure drains pipes.
// - Inject native spawn, tree signaling and group probing for deterministic ports of donor lifecycle tests.
// LiOS (GM-10b): expose readable-stream pause/resume for pipe terminals; termination resumes paused output to drain.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { toErrorObject } from "./coerce";
import { createDeferredCore } from "./deferred";
import { onDecodedOutput } from "./decoded-output";
import { signalProcessTree } from "./kill-tree";
import { createManagedChildStdin } from "./child-stdin";
import { buildChildEnv, type ChildEnvProfile } from "./env";
import { createProcessAdapterEvents } from "./process-events";
import type { SpawnProcessAdapter } from "./types";

const FORCE_KILL_WAIT_FALLBACK_MS = 4000;
const GROUP_PROBE_INTERVAL_MS = 20;
type ExitState = { code: number | null; signal: NodeJS.Signals | null };

export type ChildAdapter = SpawnProcessAdapter<NodeJS.Signals | null> &
  Required<Pick<SpawnProcessAdapter<NodeJS.Signals | null>, "onExit" | "onError">>;

export type ChildAdapterInput = {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envProfile?: ChildEnvProfile;
  /** Snapshot used by GM-11 operation binding so spawn sees the exact inherited environment that was approved. */
  parentEnv?: NodeJS.ProcessEnv;
  argv0?: string;
  windowsVerbatimArguments?: boolean;
  input?: string;
  stdinMode?: "inherit" | "pipe-open" | "pipe-closed";
};

export type ChildAdapterOptions = {
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  signalTree?: typeof signalProcessTree;
  groupExists?: (pgid: number) => boolean;
};

function unixGroupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    // Darwin can report EPERM for an empty, recently orphaned process group. This is not a successful probe:
    // explicitly enumerate groups, and propagate any enumeration error instead of assuming extinction.
    if (process.platform === "darwin" && error instanceof Error && "code" in error && error.code === "EPERM") {
      const groups = execFileSync("/bin/ps", ["-axo", "pgid="], { encoding: "utf8", timeout: 1_000, maxBuffer: 1024 * 1024 });
      return groups.split(/\s+/).some((group) => group === String(pgid));
    }
    throw error;
  }
}

export function createChildAdapter(params: ChildAdapterInput, dependencies: ChildAdapterOptions = {}): ChildAdapter {
  const command = params.argv[0];
  if (!command) {
    throw new Error("spawn argv cannot be empty");
  }
  const stdinMode = params.stdinMode ?? "pipe-closed";
  const childIsDetached = process.platform !== "win32";
  const child = (dependencies.spawn ?? spawn)(command, params.argv.slice(1), {
    cwd: params.cwd,
    env: buildChildEnv(params.env, params.parentEnv ?? process.env, process.platform, params.envProfile),
    argv0: params.argv0,
    stdio: [stdinMode === "inherit" ? "inherit" : "pipe", "pipe", "pipe"],
    detached: childIsDetached,
    windowsHide: true,
    windowsVerbatimArguments: params.windowsVerbatimArguments,
  });
  // Both output pipes are required by the native spawn options above.
  if (!child.stdout || !child.stderr) {
    child.kill("SIGKILL");
    throw new Error("child output pipes are unavailable");
  }
  const stdout = child.stdout;
  const stderr = child.stderr;
  const signalTree = dependencies.signalTree ?? signalProcessTree;
  const groupExists = dependencies.groupExists ?? unixGroupExists;
  const events = createProcessAdapterEvents();
  const stdin = createManagedChildStdin(child.stdin);
  const completion = createDeferredCore<ExitState>();
  const cleanup = createDeferredCore();
  void completion.promise.catch(() => undefined);
  void cleanup.promise.catch(() => undefined);
  const outputUnsubscribers: Array<() => void> = [];
  let waitSettled = false;
  let processClosed = false;
  let disposed = false;
  let cleanupSettled = false;
  let cleanupStarted = false;
  let hardKillRequested = false;
  let forceKillWaitFallbackTimer: NodeJS.Timeout | undefined;
  let groupProbeTimer: NodeJS.Timeout | undefined;
  let treeSignaling = Promise.resolve();
  let childExitState: ExitState | undefined;
  let forcedExitState: ExitState | undefined;
  let startupError: Error | undefined;
  let stdoutDrained = false;
  let stderrDrained = false;

  const clearCleanupTimers = () => {
    clearTimeout(forceKillWaitFallbackTimer);
    clearTimeout(groupProbeTimer);
    forceKillWaitFallbackTimer = undefined;
    groupProbeTimer = undefined;
  };
  const failCleanup = (error: unknown) => {
    if (cleanupSettled) {
      return;
    }
    cleanupSettled = true;
    clearTimeout(groupProbeTimer);
    groupProbeTimer = undefined;
    cleanup.reject(error);
    if (!processClosed && !childExitState) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Extinction remains failed; retain the bounded pipe-drain fallback.
      }
    }
    if (waitSettled) {
      clearCleanupTimers();
    } else {
      scheduleForceKillWaitFallback();
    }
  };
  const settleWait = () => {
    if (waitSettled || !stdoutDrained || !stderrDrained || (!processClosed && !forcedExitState)) {
      return;
    }
    waitSettled = true;
    if (cleanupSettled) {
      clearCleanupTimers();
    }
    if (startupError) {
      completion.reject(startupError);
    } else {
      completion.resolve(childExitState ?? forcedExitState ?? { code: child.exitCode, signal: child.signalCode });
    }
  };
  // Drain listeners precede decoder subscribers; a microtask joins every decoder's EOF tail first.
  const afterOutputBoundary = () => queueMicrotask(settleWait);
  const markStdoutDrained = () => {
    stdoutDrained = true;
    afterOutputBoundary();
  };
  const markStderrDrained = () => {
    stderrDrained = true;
    afterOutputBoundary();
  };
  stdout.once("end", markStdoutDrained);
  stdout.once("close", markStdoutDrained);
  stderr.once("end", markStderrDrained);
  stderr.once("close", markStderrDrained);

  const scheduleForceKillWaitFallback = () => {
    if (forceKillWaitFallbackTimer || (cleanupSettled && waitSettled)) {
      return;
    }
    // Native close must not renew an already-admitted kill's cleanup deadline.
    forceKillWaitFallbackTimer = setTimeout(() => {
      failCleanup(new Error("child cleanup could not be confirmed before the kill deadline"));
      forcedExitState = { code: null, signal: "SIGKILL" };
      stdout.destroy();
      stderr.destroy();
      afterOutputBoundary();
    }, FORCE_KILL_WAIT_FALLBACK_MS);
    // Cleanup is still owned even after root/pipe handles close: keep the event loop alive until this bounded join settles.
  };

  const deliverTreeSignal = (signal: "SIGTERM" | "SIGKILL") => {
    const pid = child.pid;
    if (!pid || cleanupSettled) {
      return;
    }
    const delivery = createDeferredCore();
    // Reserve before signaling: a synchronous transport may emit close from inside kill.
    treeSignaling = Promise.all([treeSignaling, delivery.promise]).then(() => undefined);
    void treeSignaling.catch(failCleanup);
    try {
      signalTree(pid, signal, { detached: childIsDetached, onComplete: () => delivery.resolve() });
    } catch (error) {
      delivery.reject(error);
    }
  };

  let joinedSignals: Promise<void> | undefined;
  const joinTreeSignals = () => {
    const admitted = treeSignaling;
    void admitted.then(() => {
      joinedSignals = admitted;
      confirmGroupClosed();
    }, failCleanup);
  };
  const confirmGroupClosed = () => {
    if (cleanupSettled) {
      return;
    }
    if (joinedSignals !== treeSignaling) {
      joinTreeSignals();
      return;
    }
    try {
      if (childIsDetached && child.pid && groupExists(child.pid)) {
        groupProbeTimer = setTimeout(confirmGroupClosed, GROUP_PROBE_INTERVAL_MS);
        return;
      }
      cleanupSettled = true;
      clearCleanupTimers();
      cleanup.resolve();
    } catch (error) {
      failCleanup(error);
    }
  };
  const joinNativeClose = () => {
    if (cleanupStarted) {
      return;
    }
    cleanupStarted = true;
    if (childIsDetached && child.pid && !hardKillRequested) {
      // Closed pipes do not establish descendant extinction. Only target the retained group,
      // never the positive root PID after close (it may be reused).
      hardKillRequested = true;
      deliverTreeSignal("SIGKILL");
    }
    scheduleForceKillWaitFallback();
    joinTreeSignals();
  };

  const onProcessError = (error: Error) => events.emitError(error, "process");
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    childExitState = { code, signal };
    events.emitExit(code, signal);
  };
  const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
    processClosed = true;
    childExitState ??= { code, signal };
    joinNativeClose();
    afterOutputBoundary();
    if (disposed) {
      child.off("error", onProcessError);
    }
  };
  child.on("error", onProcessError);
  child.once("exit", onExit);
  child.once("close", onClose);
  // Keep error observers through destroy's queued error/close notifications.
  for (const [stream, source] of [[child.stdin, "stdin"], [stdout, "stdout"], [stderr, "stderr"]] as const) {
    if (!stream) {
      continue;
    }
    const onError = (error: Error) => events.emitError(error, source);
    stream.on("error", onError);
    stream.once("close", () => stream.off("error", onError));
  }

  const kill = (signal: NodeJS.Signals = "SIGKILL") => {
    if (cleanupSettled) {
      return;
    }
    if (signal === "SIGTERM" || signal === "SIGKILL") {
      stdout.resume();
      stderr.resume();
      if (processClosed && !childIsDetached) {
        return;
      }
      hardKillRequested ||= signal === "SIGKILL";
      deliverTreeSignal(signal);
      if (signal === "SIGKILL") {
        scheduleForceKillWaitFallback();
      }
      return;
    }
    if (!processClosed) {
      try {
        child.kill(signal);
      } catch {
        // Operational signal failures do not replace the actual exit/close state.
      }
    }
  };
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const unsubscribe of outputUnsubscribers.splice(0)) {
      unsubscribe();
    }
    stdout.off("end", markStdoutDrained);
    stdout.off("close", markStdoutDrained);
    stderr.off("end", markStderrDrained);
    stderr.off("close", markStderrDrained);
    stdout.destroy();
    stderr.destroy();
    stdin?.destroy?.();
    if (processClosed) {
      child.off("error", onProcessError);
      child.off("exit", onExit);
      child.off("close", onClose);
    }
    // Cleanup timers and native-close observation remain owned until cleanup settles.
    events.clear();
  };

  try {
    if (params.input !== undefined) {
      child.stdin?.write(params.input);
      stdin?.end();
    } else if (stdinMode === "pipe-closed") {
      stdin?.end();
    }
  } catch (error) {
    // Construction already owns a live child. Return that owner rather than leaking it
    // through a synchronous throw; wait rejects only after native close and output drain.
    startupError = toErrorObject(error, "child stdin delivery failed");
    events.emitError(startupError, "stdin");
    kill("SIGKILL");
  }

  return {
    get pid() { return child.pid; },
    stdin,
    supportsRawOutput: true,
    onStdout: (listener, onRaw) => outputUnsubscribers.push(onDecodedOutput(stdout, listener, onRaw)),
    onStderr: (listener, onRaw) => outputUnsubscribers.push(onDecodedOutput(stderr, listener, onRaw)),
    onExit: events.onExit,
    onError: events.onError,
    wait: () => completion.promise,
    waitForExtinction: () => cleanup.promise,
    pauseOutput: () => { stdout.pause(); stderr.pause(); },
    resumeOutput: () => { stdout.resume(); stderr.resume(); },
    kill,
    dispose,
  };
}
