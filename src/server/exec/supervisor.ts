// Adapted from OpenClaw src/process/supervisor/supervisor.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a) modifications:
// - Removed the "pty" spawn mode (GM-10b terminal-backend.ts owns native PTYs separately) and the "anchored-shell" mode;
//   the supervisor is child-mode only, with no dead branches.
// - Removed Windows Job / extinction-outcome plumbing (ProcessExtinctionResult), cleanupOwnership "external" and the
//   ProcessScopeCleanupPolicy argument of acquireScopeCleanup, resolveArgs, assertCurrent/beforeSpawn hooks, secretInput,
//   the construction-abort race (the child adapter is now constructed synchronously) and the supervisor-log lazy runtime.
// - @openclaw/normalization-core imports replaced by ./coerce; shared/deferred, process-deadline, lazy-runtime and
//   global-singleton replaced by ./deferred, ./process-deadline and a plain module singleton in ./index.
// - Captured-output marker prefix is "[lios: ...]"; RunExit gains stdoutTruncated/stderrTruncated; SpawnInput gains
//   gracefulCancelMs (default GRACEFUL_CANCEL_TIMEOUT_MS) so the SIGTERM->SIGKILL window is testable.
// - createProcessSupervisor accepts { createAdapter } so tests can inject stub adapters (replaces vitest module mocks).
// - A process-level 'error' with no pid (spawn failure such as ENOENT) now yields TerminationReason "spawn-error".
// - Publish replacement reservations before native construction; snapshot cancellation admission and join cleanup even
//   when caller revocation throws. Rejected subscriptions retain their cleanup owner; tiny output budgets stay bounded.
// LiOS (GM-10b): forward optional adapter pipe-backpressure hooks onto ManagedRun.
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { createChildAdapter, type ChildAdapterInput } from "./child";
import { GRACEFUL_CANCEL_TIMEOUT_MS } from "./cancellation-policy";
import { normalizeOptionalString, resolveTimerTimeoutMs, sliceUtf16Safe, toErrorObject } from "./coerce";
import { createDeferredCore } from "./deferred";
import { joinProcessCompletionAndOutput } from "./decoded-output";
import { setProcessTimeout } from "./process-deadline";
import { assertExecutionOperationBinding } from "./operation-identity";
import type {
  ManagedRun,
  ProcessSupervisor,
  RunExit,
  SpawnInput,
  SpawnProcessAdapter,
  TerminationReason,
} from "./types";

type OwnedRun = {
  runId: string;
  scopeKey?: string;
  terminationReason?: TerminationReason;
  cancel: (reason: TerminationReason) => void;
  pending?: Promise<ManagedRun>;
  waitForExtinction?: () => Promise<void>;
  cleanupOwners: ScopeCleanupOwner[];
};

type ScopeCleanupOwner = { failure?: { error: unknown } };

function recordScopeCleanupFailure(cleanupOwners: ScopeCleanupOwner[], error: unknown): void {
  for (const cleanupOwner of cleanupOwners) {
    cleanupOwner.failure ??= { error };
  }
}

type StartingScope = {
  runs: Set<Promise<ManagedRun>>;
  replacement?: Promise<ManagedRun>;
};

const DEFAULT_MAX_CAPTURED_OUTPUT_CHARS = 1024 * 1024;

function normalizeTimeoutDuration(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function clampCapturedOutputChars(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_CAPTURED_OUTPUT_CHARS;
  }
  return Math.max(1, Math.floor(value));
}

function appendCapturedOutput(
  current: string,
  chunk: string,
  stream: "stdout" | "stderr",
  maxChars: number,
): { text: string; truncated: boolean } {
  const next = current + chunk;
  if (next.length <= maxChars) {
    return { text: next, truncated: false };
  }
  const marker = `[lios: captured ${stream} truncated to last ${maxChars} chars]\n`;
  if (marker.length >= maxChars) {
    return { text: sliceUtf16Safe(marker, 0, maxChars), truncated: true };
  }
  const tailChars = maxChars - marker.length;
  return { text: `${marker}${sliceUtf16Safe(next, -tailChars)}`, truncated: true };
}

function isTimeoutReason(reason: TerminationReason) {
  return reason === "overall-timeout" || reason === "no-output-timeout";
}

export type ProcessSupervisorOptions = {
  /** Adapter factory; defaults to the node:child_process adapter. Tests inject stub adapters here. */
  createAdapter?: (params: ChildAdapterInput) => SpawnProcessAdapter<NodeJS.Signals | null>;
};

export function createProcessSupervisor(options: ProcessSupervisorOptions = {}): ProcessSupervisor {
  const createAdapter = options.createAdapter ?? createChildAdapter;
  // Retries share a run ID while an older command can still own descendants.
  // Keep each admission until its own cleanup completes.
  const ownedRuns = new Set<OwnedRun>();
  const scopeCleanupOwners = new Map<string, Set<ScopeCleanupOwner>>();
  const startingScopes = new Map<string, StartingScope>();
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;
  let cleanupFailure: { error: unknown } | undefined;

  const cancelOwnedRuns = (matches: (owner: OwnedRun) => boolean, reason: TerminationReason) => {
    let failure: { error: unknown } | undefined;
    // Revocation callbacks may admit later work; only the entry snapshot belongs to this cancellation.
    for (const owner of Array.from(ownedRuns)) {
      if (matches(owner)) {
        try {
          owner.cancel(reason);
        } catch (error) {
          failure ??= { error };
        }
      }
    }
    if (failure) {
      throw failure.error;
    }
  };

  const cancel = (runId: string, reason: TerminationReason = "manual-cancel") => {
    runId = normalizeOptionalString(runId) ?? "";
    cancelOwnedRuns((owner) => owner.runId === runId, reason);
  };

  const cancelActiveScope = (scopeKey: string, reason: TerminationReason) => {
    cancelOwnedRuns((owner) => !!owner.waitForExtinction && owner.scopeKey === scopeKey, reason);
  };

  const cancelScope = (scopeKey: string, reason: TerminationReason = "manual-cancel") => {
    scopeKey = normalizeOptionalString(scopeKey) ?? "";
    if (!scopeKey) {
      return;
    }
    cancelOwnedRuns((owner) => owner.scopeKey === scopeKey, reason);
  };

  const waitForRuns = async (
    scopeKey: string | null,
    ignoreStartupFailures = false,
  ): Promise<void> => {
    let firstFailure: PromiseRejectedResult | undefined;
    const observed = new Set<OwnedRun>();
    while (true) {
      const selected = Array.from(ownedRuns).filter(
        (current) => !observed.has(current) && (scopeKey === null || current.scopeKey === scopeKey),
      );
      const starts = selected.flatMap((current) => (current.pending ? [current.pending] : []));
      const owned = selected.flatMap((current) => {
        if (!current.waitForExtinction) {
          return [];
        }
        observed.add(current);
        return [current.waitForExtinction()];
      });
      if (starts.length === 0 && owned.length === 0) {
        if (firstFailure) {
          throw firstFailure.reason;
        }
        return;
      }
      // Startup can become active while the snapshot settles; recheck admissions
      // so shutdown cannot outrun an admitted command or retained descendants.
      const results = await Promise.allSettled([...owned, ...starts]);
      firstFailure ??= results
        .slice(0, ignoreStartupFailures ? owned.length : undefined)
        .find((result): result is PromiseRejectedResult => result.status === "rejected");
    }
  };
  const acquireScopeCleanup = (scopeKey: string): (() => Promise<void>) => {
    scopeKey = normalizeOptionalString(scopeKey) ?? "";
    if (!scopeKey) {
      throw new Error("scope cleanup key cannot be empty");
    }
    const cleanupOwner: ScopeCleanupOwner = {};
    const owners = scopeCleanupOwners.get(scopeKey) ?? new Set<ScopeCleanupOwner>();
    owners.add(cleanupOwner);
    scopeCleanupOwners.set(scopeKey, owners);
    let closing: Promise<void> | undefined;
    return () =>
      (closing ??= (async () => {
        try {
          try {
            cancelScope(scopeKey);
          } catch (error) {
            cleanupOwner.failure ??= { error };
          }
          await waitForRuns(scopeKey);
        } catch (error) {
          cleanupOwner.failure ??= { error };
        } finally {
          owners.delete(cleanupOwner);
          if (owners.size === 0) {
            scopeCleanupOwners.delete(scopeKey);
          }
        }
        if (cleanupOwner.failure) {
          throw cleanupOwner.failure.error;
        }
      })());
  };

  const startRun = async (input: SpawnInput, owner: OwnedRun): Promise<ManagedRun> => {
    const { runId, scopeKey } = owner;
    const startedAtMs = Date.now();

    const settleConstructionResult = (reason: TerminationReason): ManagedRun => {
      const exit: RunExit = {
        reason,
        exitCode: null,
        exitSignal: null,
        durationMs: Date.now() - startedAtMs,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: isTimeoutReason(reason),
        noOutputTimedOut: reason === "no-output-timeout",
      };
      return {
        runId,
        startedAtMs,
        activity: Object.freeze({ resultSettled: true, lastOutputAtMs: startedAtMs }),
        wait: async () => exit,
        cancel: () => undefined,
      };
    };
    if (owner.terminationReason) {
      // A replacement can be cancelled behind its scope fence. Never launch
      // its command or terminate the surviving scope after that cancellation.
      return settleConstructionResult(owner.terminationReason);
    }
    if (input.argv.length === 0) {
      throw new Error("spawn argv cannot be empty");
    }

    if (input.replaceExistingScope && scopeKey) {
      // Scope admission already waited for predecessor startups. Do not
      // cancel this replacement or later runs reserved behind its fence.
      cancelActiveScope(scopeKey, "manual-cancel");
    }
    if (owner.terminationReason) {
      return settleConstructionResult(owner.terminationReason);
    }

    let forcedReason: TerminationReason | null = null;
    let resultSettled = false;
    let lastOutputAtMs = startedAtMs;
    let cleanupSettled = false;
    const outputCompletion = createDeferredCore();
    let outputError: Error | undefined;
    let awaitedOutput: Promise<void> | undefined;
    const captured = { stdout: "", stderr: "" };
    const truncated = { stdout: false, stderr: false };
    // Forced settlement (kill-wait fallback) resolves the result while inherited
    // pipes stay open, and callers finalize their own output state from that
    // terminal result. One fence closes every output path together: a late chunk
    // reaches no listener, capture buffer, or output clock.
    let outputDetached = false;
    const detachOutput = () => {
      outputDetached = true;
    };
    let forceKillTimer: NodeJS.Timeout | null = null;
    let cancelRequested = false;
    const captureOutput = input.captureOutput !== false;
    const maxCapturedOutputChars = clampCapturedOutputChars(input.maxCapturedOutputChars);
    const gracefulCancelMs = normalizeTimeoutDuration(input.gracefulCancelMs) ?? GRACEFUL_CANCEL_TIMEOUT_MS;

    const setForcedReason = (reason: TerminationReason) => {
      if (forcedReason || resultSettled) {
        return;
      }
      forcedReason = reason;
    };

    let cancelAdapter: ((reason: TerminationReason) => void) | null = null;

    const requestCancel = (reason: TerminationReason) => {
      const firstCancel = forcedReason === null && !resultSettled;
      setForcedReason(reason);
      try {
        if (firstCancel) {
          input.onCancel?.(reason);
        }
      } finally {
        cancelAdapter?.(reason);
      }
    };
    owner.cancel = requestCancel;

    const createDeadline = (reason: "overall-timeout" | "no-output-timeout", value?: number) => {
      const durationMs = normalizeTimeoutDuration(value);
      let deadlineMs: number | null = null;
      let timer: { clear(): void; refresh(): void } | undefined;
      // Re-arm bounded intervals: a long deadline must not overflow Node's timer cap.
      const schedule = (remainingMs: number, deadline: number) => {
        const intervalMs = resolveTimerTimeoutMs(remainingMs, 1);
        timer = setProcessTimeout(() => {
          if (resultSettled) {
            return;
          }
          const remaining = Math.min(remainingMs - intervalMs, deadline - performance.now());
          if (remaining <= 0) {
            requestCancel(reason);
          } else {
            schedule(remaining, deadline);
          }
        }, intervalMs);
      };
      return {
        get deadlineMs() {
          return deadlineMs;
        },
        reset: () => {
          if (!durationMs || resultSettled) {
            return;
          }
          timer?.clear();
          deadlineMs = performance.now() + durationMs;
          schedule(durationMs, deadlineMs);
        },
        clear: () => timer?.clear(),
      };
    };
    const overallDeadline = createDeadline("overall-timeout", input.timeoutMs);
    const outputDeadline = createDeadline("no-output-timeout", input.noOutputTimeoutMs);
    const touchOutput = () => {
      lastOutputAtMs = Date.now();
      outputDeadline.reset();
    };
    const settleResult = (adapter?: SpawnProcessAdapter) => {
      resultSettled = true;
      outputCompletion.resolve();
      overallDeadline.clear();
      outputDeadline.clear();
      detachOutput();
      if (cleanupSettled) {
        adapter?.dispose();
      }
    };

    let adapter: SpawnProcessAdapter<NodeJS.Signals | null>;
    try {
      // GM-11 exact-operation binding is checked as late as possible. The parent
      // environment snapshot used for the digest is handed to the adapter so
      // the actual spawn cannot observe a different inherited PATH/HOME/etc.
      const operationParentEnv = input.expectedOperationDigest ? { ...process.env } : undefined;
      // Snapshot every caller-mutable launch input before async filesystem hashing.
      // The adapter below must consume the same snapshot that was verified.
      const approvalBoundInput = input.expectedOperationDigest
        ? {
            argv: [...input.argv],
            cwd: input.cwd,
            env: input.env ? { ...input.env } : undefined,
            envProfile: input.envProfile,
            argv0: input.argv0,
            windowsVerbatimArguments: input.windowsVerbatimArguments,
            input: input.input,
            stdinMode: input.stdinMode,
            interactiveInputPolicy: input.interactiveInputPolicy,
            filePaths: input.operationFilePaths ? [...input.operationFilePaths] : undefined,
          }
        : undefined;
      const verifiedOperation = approvalBoundInput
        ? await assertExecutionOperationBinding(
            approvalBoundInput,
            input.expectedOperationDigest!,
            operationParentEnv,
          )
        : undefined;
      if (owner.terminationReason) return settleConstructionResult(owner.terminationReason);
      // GM-11 policy/cancellation is rechecked after the exact launch has been
      // revalidated and immediately before native construction. This callback
      // is intentionally synchronous: no promise/IO may open a stale-policy race.
      input.authorizationCheck?.();
      if (owner.terminationReason) return settleConstructionResult(owner.terminationReason);
      overallDeadline.reset();
      outputDeadline.reset();
      adapter = createAdapter({
        argv: verifiedOperation
          ? [verifiedOperation.executable.path, ...approvalBoundInput!.argv.slice(1)]
          : input.argv,
        cwd: verifiedOperation ? verifiedOperation.cwd : input.cwd,
        env: verifiedOperation ? approvalBoundInput!.env : input.env,
        envProfile: verifiedOperation ? approvalBoundInput!.envProfile : input.envProfile,
        parentEnv: operationParentEnv,
        argv0: verifiedOperation ? verifiedOperation.launch.argv0 : input.argv0,
        windowsVerbatimArguments: verifiedOperation
          ? approvalBoundInput!.windowsVerbatimArguments
          : input.windowsVerbatimArguments,
        input: verifiedOperation ? approvalBoundInput!.input : input.input,
        stdinMode: verifiedOperation ? approvalBoundInput!.stdinMode : input.stdinMode,
        stdoutConsumption: input.onStdoutAsync ? "awaited" : undefined,
      });
    } catch (err) {
      settleResult();
      throw err;
    }

    cancelAdapter = (reason: TerminationReason) => {
      if (cleanupSettled || (cancelRequested && !(resultSettled && forceKillTimer))) {
        return;
      }
      cancelRequested = true;
      if (resultSettled) {
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = null;
        }
        // Root completion closes its terminal record, not ownership of
        // descendants still retained by the process group.
        adapter.kill("SIGKILL");
        return;
      }
      // Windows has no catchable SIGTERM equivalent: the adapter implements it
      // with asynchronous taskkill, so waiting the cleanup grace only delays an
      // already-expired deadline before the same forced tree termination.
      if (
        process.platform === "win32" &&
        (reason === "overall-timeout" || reason === "no-output-timeout")
      ) {
        adapter.kill("SIGKILL");
        return;
      }
      adapter.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!cleanupSettled) {
          adapter.kill("SIGKILL");
        }
      }, gracefulCancelMs);
      forceKillTimer.unref?.();
    };
    // Reserve the join before any output can arrive: a timeout result does not
    // release the process group or its pipes.
    const cleanup = createDeferredCore();
    owner.waitForExtinction = () => cleanup.promise;
    void cleanup.promise.catch(() => undefined);
    const nativeExtinctionPromise = Promise.resolve().then(() => adapter.waitForExtinction()).finally(() => {
      cleanupSettled = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      if (resultSettled) {
        adapter.dispose();
      }
    });
    // Ordinary pipes retain the existing fast native-failure report. Opted async consumers
    // retain their cleanup owner until accepted work settles, even when native cleanup failed.
    const joinedOutput = outputCompletion.promise.then(() => {
      if (outputError) {
        throw outputError;
      }
    });
    const extinctionPromise = input.onStdoutAsync
      ? joinProcessCompletionAndOutput(nativeExtinctionPromise, joinedOutput)
      : Promise.all([nativeExtinctionPromise, joinedOutput]);
    void extinctionPromise.then(
      () => {
        ownedRuns.delete(owner);
        cleanup.resolve();
      },
      (error: unknown) => {
        recordScopeCleanupFailure(owner.cleanupOwners, error);
        cleanupFailure ??= { error };
        ownedRuns.delete(owner);
        cleanup.reject(error);
      },
    );

    const withOutputFence =
      <Chunk>(deliver?: (chunk: Chunk) => void, recordsOutput = true) =>
      (chunk: Chunk) => {
        if (outputDetached) {
          return;
        }
        if (recordsOutput) {
          touchOutput();
        }
        deliver?.(chunk);
      };
    // Byte transports can flush decoded text at EOF without fresh activity.
    try {
      adapter.onError?.((error, source) => {
        if (source === "stdout" || source === "stderr") {
          outputError ??= error;
          recordScopeCleanupFailure(owner.cleanupOwners, error);
          if (source === "stdout" && input.onStdoutAsync) {
            // Revoke pending host work now, before the adapter joins its accepted consumer.
            requestCancel("spawn-error");
          }
        } else if (source === "stdin") {
          requestCancel("spawn-error");
        } else if (adapter.pid === undefined) {
          setForcedReason("spawn-error");
        }
      });
      for (const [stream, subscribe, onText, onRaw] of [
        ["stdout", adapter.onStdout, input.onStdout, input.onStdoutRaw],
        ["stderr", adapter.onStderr, input.onStderr, input.onStderrRaw],
      ] as const) {
        const onDecoded = withOutputFence((chunk: string) => {
          if (captureOutput) {
            const next = appendCapturedOutput(captured[stream], chunk, stream, maxCapturedOutputChars);
            captured[stream] = next.text;
            truncated[stream] ||= next.truncated;
          }
          onText?.(chunk);
        }, !adapter.supportsRawOutput);
        const onBytes = withOutputFence(onRaw);
        if (stream === "stdout" && input.onStdoutAsync) {
          if (!adapter.consumeStdout) {
            throw new Error("Process adapter does not support awaited stdout consumption");
          }
          const consume = input.onStdoutAsync;
          awaitedOutput = adapter.consumeStdout((chunk) => {
            onDecoded(chunk);
            if (!outputDetached) {
              return consume(chunk);
            }
          }, onBytes).catch((error: unknown) => {
            outputError ??= toErrorObject(error, "Process stdout consumption failed");
            recordScopeCleanupFailure(owner.cleanupOwners, outputError);
            try {
              requestCancel("spawn-error");
            } catch (stopError) {
              throw new AggregateError([error, stopError], "Process stdout consumption and stop failed");
            }
            throw error;
          });
          void awaitedOutput.catch(() => undefined);
        } else {
          subscribe(onDecoded, onBytes);
        }
      }
    } catch (error) {
      // The adapter already owns a native child. Retain cleanup and join its drain
      // even though subscribing failed and spawn must reject.
      adapter.kill("SIGKILL");
      const completion = Promise.resolve().then(() => adapter.wait());
      void (awaitedOutput ? joinProcessCompletionAndOutput(completion, awaitedOutput) : completion)
        .finally(() => settleResult(adapter)).catch(() => undefined);
      throw error;
    }

    const waitOutcome = Promise.allSettled([
      (async (): Promise<RunExit> => {
        const completion = adapter.wait();
        const result = await (awaitedOutput ? joinProcessCompletionAndOutput(completion, awaitedOutput) : completion);
        if (awaitedOutput && outputError) {
          throw outputError;
        }
        const terminalReason = forcedReason;
        settleResult(adapter);

        const reason: TerminationReason =
          terminalReason ?? (result.signal != null ? ("signal" as const) : ("exit" as const));
        return {
          reason,
          exitCode: result.code,
          exitSignal: result.signal,
          durationMs: Date.now() - startedAtMs,
          ...captured,
          stdoutTruncated: truncated.stdout,
          stderrTruncated: truncated.stderr,
          timedOut: isTimeoutReason(reason),
          noOutputTimedOut: terminalReason === "no-output-timeout",
        };
      })().catch((error: unknown) => {
        requestCancel("spawn-error");
        throw error;
      }).finally(() => {
        if (!resultSettled) {
          settleResult(adapter);
        }
      }),
    ]);

    const managedRun: ManagedRun = {
      activity: Object.freeze({
        get deadlineAtMs() {
          return overallDeadline.deadlineMs === null
            ? undefined
            : Date.now() + overallDeadline.deadlineMs - performance.now();
        },
        get resultSettled() {
          return resultSettled;
        },
        get lastOutputAtMs() {
          return lastOutputAtMs;
        },
      }),
      runId,
      pid: adapter.pid,
      startedAtMs,
      stdin: adapter.stdin,
      wait: async () => {
        const [outcome] = await waitOutcome;
        if (outcome.status === "rejected") {
          throw outcome.reason;
        }
        return outcome.value;
      },
      waitForExtinction: () => cleanup.promise,
      cancel: (reason = "manual-cancel") => {
        requestCancel(reason);
      },
      detachOutput,
      pauseOutput: adapter.pauseOutput ? () => adapter.pauseOutput?.() : undefined,
      resumeOutput: adapter.resumeOutput ? () => adapter.resumeOutput?.() : undefined,
    };

    if (forcedReason) {
      managedRun.cancel(forcedReason);
    }
    return managedRun;
  };

  const spawn = (input: SpawnInput): Promise<ManagedRun> => {
    if (shuttingDown) {
      return Promise.reject(new Error("process supervisor is shut down"));
    }
    const scopeKey = normalizeOptionalString(input.scopeKey);
    const runId = normalizeOptionalString(input.runId) ?? crypto.randomUUID();
    const owner: OwnedRun = {
      runId,
      scopeKey,
      cancel: (reason) => {
        if (!owner.terminationReason) {
          owner.terminationReason = reason;
          input.onCancel?.(reason);
        }
      },
      cleanupOwners: scopeKey ? [...(scopeCleanupOwners.get(scopeKey) ?? [])] : [],
    };
    // Reserve cancellation before either adapter startup or a replacement
    // fence, so stopping a run cannot silently leave a late child alive.
    ownedRuns.add(owner);

    const starting = scopeKey
      ? (startingScopes.get(scopeKey) ?? { runs: new Set<Promise<ManagedRun>>() })
      : undefined;
    if (scopeKey && starting) {
      startingScopes.set(scopeKey, starting);
    }

    // Ordinary runs start together, but replacements fence later arrivals so
    // delayed cancellation cannot accidentally terminate a newer scoped run.
    const previous = starting
      ? input.replaceExistingScope
        ? Array.from(starting.runs)
        : starting.replacement
          ? [starting.replacement]
          : []
      : [];
    const admission = createDeferredCore<ManagedRun>();
    const pending = admission.promise;
    owner.pending = pending;
    starting?.runs.add(pending);
    if (starting && input.replaceExistingScope) {
      starting.replacement = pending;
    }
    // Publish the reservation before starting: synchronous revocation callbacks
    // must see the replacement fence, not launch around its native construction.
    const construction = previous.length > 0
      ? Promise.allSettled(previous).then(() => startRun(input, owner))
      : startRun(input, owner);
    void construction.then(admission.resolve, admission.reject);

    const clearPendingStart = () => {
      delete owner.pending;
      if (!owner.waitForExtinction) {
        ownedRuns.delete(owner);
      }
      starting?.runs.delete(pending);
      if (starting?.replacement === pending) {
        delete starting.replacement;
      }
      if (scopeKey && starting?.runs.size === 0 && startingScopes.get(scopeKey) === starting) {
        startingScopes.delete(scopeKey);
      }
    };
    void pending.then(clearPendingStart, clearPendingStart);
    return pending;
  };

  const shutdown = (): Promise<void> => {
    // Publish the admission fence before cancellation can invoke owner callbacks.
    shuttingDown = true;
    return (shutdownPromise ??= Promise.resolve().then(async () => {
      while (ownedRuns.size) {
        for (const owner of ownedRuns) {
          try {
            owner.cancel("manual-cancel");
          } catch (error) {
            cleanupFailure ??= { error };
          }
        }
        // A failed startup owns no live process; only failed owner extinction
        // must keep the process-wide supervisor fenced for operator recovery.
        await waitForRuns(null, true);
      }
      if (cleanupFailure) {
        throw cleanupFailure.error;
      }
    }));
  };

  return {
    acquireScopeCleanup,
    spawn,
    cancel,
    cancelScope,
    shutdown,
  };
}
