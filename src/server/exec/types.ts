// Adapted from OpenClaw src/process/supervisor/types.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a) modifications:
// - Removed WindowsJobExtinction / ProcessExtinctionResult (managed Windows Job is not imported); waitForExtinction now resolves void.
// - Removed spawn modes "pty" (GM-10b owns native PTYs in terminal-backend.ts) and "anchored-shell"; SpawnInput is child mode only.
// - Removed cleanupOwnership "external", ProcessScopeCleanupPolicy, SpawnSecretInput, ProcessAdapterConstruction,
//   ProcessAdapterStartup, ProcessCleanupResult, oomScoreWrapperSelected, resolveArgs, exactEnv,
//   assertCurrent/beforeSpawn admission hooks (all tied to OpenClaw service relays, secret-input or Gateway internals).
// - Added RunExit.stdoutTruncated/stderrTruncated, SpawnInput.gracefulCancelMs, and SpawnInput.stdinMode default of "pipe-closed".
// SpawnInput.env is an explicit overlay checked by ./env; only the fixed internal python-runtime profile permits its Python settings.
// LiOS (GM-10b): optional output pause/resume hooks expose genuine pipe backpressure without breaking injected adapters.
// LiOS (SI-01.13): SpawnInput may carry a process-local resource reservation request; the canonical process-wide GM-10 wrapper owns it.
import type { ChildEnvProfile } from "./env";

export type TerminationReason =
  | "manual-cancel"
  | "overall-timeout"
  | "no-output-timeout"
  | "spawn-error"
  | "signal"
  | "exit";

export type ProcessResourceRequest = {
  memoryBytes: number;
  diskBytes: number;
  workload: "light" | "standard" | "heavy";
};

/** Producer-owned activity; a settled result does not establish descendant extinction. */
export type ProcessRunActivity = {
  /** Absolute deadline accepted when the supervisor armed the overall timeout. */
  readonly deadlineAtMs?: number;
  readonly resultSettled: boolean;
  readonly lastOutputAtMs: number;
};

export type RunExit = {
  reason: TerminationReason;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  /** True when captured stdout was cut to maxCapturedOutputChars (a marker line prefixes the kept tail). */
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  noOutputTimedOut: boolean;
};

export type ManagedRun = {
  readonly activity: ProcessRunActivity;
  runId: string;
  pid?: number;
  startedAtMs: number;
  stdin?: ManagedRunStdin;
  wait: () => Promise<RunExit>;
  /** Resolves once the process group is closed and every output tail is joined; rejects if that cannot be confirmed. */
  waitForExtinction?: () => Promise<void>;
  cancel: (reason?: TerminationReason) => void;
  /** Stop every decoded, raw, captured, and output-clock update for this run. */
  detachOutput?: () => void;
  /** Optional only for injected adapters; native child runs pause/resume both readable pipes. */
  pauseOutput?: () => void;
  resumeOutput?: () => void;
};

export type ManagedRunStdin = {
  write: (data: string | Buffer, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  destroy?: () => void;
  destroyed?: boolean;
  writable?: boolean;
  writableEnded?: boolean;
  writableFinished?: boolean;
};

export type SpawnProcessAdapter<WaitSignal = NodeJS.Signals | number | null> = {
  pid?: number;
  stdin?: ManagedRunStdin;
  /** Both output subscriptions observe bytes separately from decoded text. */
  supportsRawOutput: boolean;
  onStdout: (listener: (chunk: string) => void, onRaw?: (chunk: Buffer) => void) => void;
  onStderr: (listener: (chunk: string) => void, onRaw?: (chunk: Buffer) => void) => void;
  /** Present only when stdout owns a backpressured, single-consumer awaited pipe. */
  consumeStdout?: (listener: (chunk: string) => void | Promise<void>, onRaw?: (chunk: Buffer) => void) => Promise<void>;
  onExit?: (listener: (code: number | null, signal: WaitSignal) => void) => void;
  onError?: (
    listener: (error: Error, source: "process" | "stdin" | "stdout" | "stderr") => void,
  ) => void;
  wait: () => Promise<{ code: number | null; signal: WaitSignal }>;
  waitForExtinction: () => Promise<void>;
  kill: (signal?: NodeJS.Signals) => void;
  pauseOutput?: () => void;
  resumeOutput?: () => void;
  dispose: () => void;
};

export type SpawnInput = {
  mode: "child";
  argv: string[];
  runId?: string;
  scopeKey?: string;
  replaceExistingScope?: boolean;
  cwd?: string;
  /** Explicit overlay merged over the allow-listed parent environment. */
  env?: NodeJS.ProcessEnv;
  /** Restricts explicit entries to a fixed internal runtime profile. */
  envProfile?: ChildEnvProfile;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  /** Grace between SIGTERM and SIGKILL on cancellation. Defaults to GRACEFUL_CANCEL_TIMEOUT_MS. */
  gracefulCancelMs?: number;
  /**
   * When false, stdout/stderr are streamed via callbacks only and not retained in RunExit payload.
   */
  captureOutput?: boolean;
  /**
   * Maximum retained stdout/stderr characters per stream when captureOutput is enabled.
   * Streaming callbacks still receive full chunks.
   */
  maxCapturedOutputChars?: number;
  onStdout?: (chunk: string) => void;
  /**
   * Explicit native-pipe backpressure: after synchronous/raw observers, await this one stdout consumer.
   * Completion and cleanup join accepted work; rejection stops the run and rejects completion.
   * Adapters without consumeStdout are refused rather than emulating this with an unbounded queue.
   */
  onStdoutAsync?: (chunk: string) => void | Promise<void>;
  onStderr?: (chunk: string) => void;
  onStdoutRaw?: (chunk: Buffer) => void;
  onStderrRaw?: (chunk: Buffer) => void;
  /** Revoke caller-owned capabilities when cancellation starts, before native termination. */
  onCancel?: (reason: TerminationReason) => void;
  /** GM-11: optional approval-bound operation digest; verified immediately before native construction. */
  expectedOperationDigest?: string;
  /**
   * GM-11 final authorization fence. Must be synchronous and secret-safe.
   * The supervisor invokes it after exact-operation revalidation and immediately
   * before native adapter construction, leaving no asynchronous policy race.
   */
  authorizationCheck?: () => void;
  /**
   * SI-01.13 process-local admission request. This field never grants execution;
   * the canonical GM-10 wrapper consumes it at the existing final-authorization fence.
   */
  resourceRequest?: ProcessResourceRequest;
  /** Mutable script/config operands already identified by canonical command analysis. */
  operationFilePaths?: readonly string[];
  /** Preserve a distinct invocation name while executing argv[0]. */
  argv0?: string;
  windowsVerbatimArguments?: boolean;
  input?: string;
  /** Defaults to "pipe-closed" (never "inherit" the server's own stdin unless asked). */
  stdinMode?: "inherit" | "pipe-open" | "pipe-closed";
  /** Closed server-owned policies for bounded interactive input channels. */
  interactiveInputPolicy?: "sandbox-readonly-console" | "sandbox-broker-rpc";
};

export interface ProcessSupervisor {
  /** Register before spawning; close caller admission before joining this exact cleanup owner. */
  acquireScopeCleanup(scopeKey: string): () => Promise<void>;
  spawn(input: SpawnInput): Promise<ManagedRun>;
  cancel(runId: string, reason?: TerminationReason): void;
  cancelScope(scopeKey: string, reason?: TerminationReason): void;
  /** Fence new admissions, cancel every owned run, and join all cleanup. Idempotent. */
  shutdown(): Promise<void>;
}
