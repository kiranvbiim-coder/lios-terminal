import crypto from "node:crypto";
import { getProcessSupervisor } from "./index";
import { ExecutionBackendUnavailableError } from "./backends/types";
import type {
  ExecutionBackend,
  ExecutionBackendFinalization,
  ExecutionBackendLaunchPlan,
  ExecutionBackendRequest,
} from "./backends/types";
import type { ProcessSupervisor, RunExit } from "./types";

export interface ExecutionBackendRunResult {
  backendId: string;
  facts: ExecutionBackendLaunchPlan["facts"];
  exit: RunExit;
  finalization: ExecutionBackendFinalization;
}

export type ExecutionBackendRunner = (
  backend: ExecutionBackend,
  request: ExecutionBackendRequest,
  supervisor?: ProcessSupervisor,
) => Promise<ExecutionBackendRunResult>;

function aggregateOrThrow(errors: unknown[], message: string): never {
  const present = errors.filter((error) => error !== undefined && error !== null);
  if (present.length === 1) throw present[0];
  throw new AggregateError(present, message);
}

function uniqueAuthorizationSignals(...signals: Array<AbortSignal | undefined>): AbortSignal[] {
  return Array.from(new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined)));
}

function assertAuthorizationCurrent(backendId: string, signals: readonly AbortSignal[]): void {
  if (signals.some((signal) => signal.aborted)) {
    throw new ExecutionBackendUnavailableError(backendId, "authorization-cancelled");
  }
}

/**
 * Canonical one-shot GM-11c backend runner.
 *
 * This deliberately owns a private supervisor scope. Long-lived/shared
 * terminal sessions require a different integration authority; allowing an
 * arbitrary caller scope here would make spawn-failure cleanup capable of
 * cancelling sibling work.
 *
 * Security-critical ordering:
 *   prepare -> authorization recheck -> spawn -> wait -> native extinction -> backend finalize
 *
 * Backend finalization is never considered a substitute for native process
 * extinction. The private scope also lets request/backend authorization signals
 * cancel a run while supervisor.spawn() is pending or active.
 */
export const runExecutionBackendRequest: ExecutionBackendRunner = async (
  backend,
  request,
  supervisor = getProcessSupervisor(),
) => {
  if (request.scopeKey) {
    throw new Error("One-shot backend runner owns its cleanup scope; caller scopeKey is not accepted.");
  }

  assertAuthorizationCurrent(backend.id, uniqueAuthorizationSignals(request.signal));
  const scopeKey = "backend-run:" + crypto.randomUUID();
  const closeScope = supervisor.acquireScopeCleanup(scopeKey);
  let plan: ExecutionBackendLaunchPlan | undefined;
  const abortListeners: Array<{ signal: AbortSignal; listener: () => void }> = [];

  try {
    plan = await backend.prepare({ ...request, scopeKey });
    const authorizationSignals = uniqueAuthorizationSignals(request.signal, plan.signal);
    assertAuthorizationCurrent(backend.id, authorizationSignals);

    for (const signal of authorizationSignals) {
      const listener = () => supervisor.cancelScope(scopeKey, "manual-cancel");
      abortListeners.push({ signal, listener });
      signal.addEventListener("abort", listener, { once: true });
    }
    // Close the check/listener race synchronously immediately before admission.
    assertAuthorizationCurrent(backend.id, authorizationSignals);

    let run;
    try {
      run = await supervisor.spawn(plan.spawn);
    } catch (spawnError) {
      let scopeError: unknown;
      let finalizeError: unknown;
      try {
        await closeScope();
      } catch (error) {
        scopeError = error;
      }
      // closeScope() is the authoritative native-extinction join for a run
      // whose ManagedRun handle was never returned. Never run backend
      // finalization when that join itself failed.
      if (!scopeError) {
        try {
          await plan.lifecycle?.finalize();
        } catch (error) {
          finalizeError = error;
        }
      }
      if (scopeError || finalizeError) {
        aggregateOrThrow(
          [spawnError, scopeError, finalizeError],
          "Backend spawn failed and cleanup/finalization also failed.",
        );
      }
      throw spawnError;
    }

    let exit: RunExit | undefined;
    let runError: unknown;
    let extinctionError: unknown;
    let nativeExtinctionConfirmed = false;
    let finalization: ExecutionBackendFinalization = {};
    let finalizeError: unknown;
    let exitError: unknown;

    try {
      exit = await run.wait();
    } catch (error) {
      runError = error;
    }

    try {
      await run.waitForExtinction?.();
      nativeExtinctionConfirmed = true;
    } catch (error) {
      extinctionError = error;
    }

    let scopeError: unknown;
    if (!nativeExtinctionConfirmed) {
      try {
        // A successful private-scope join is an equivalent authoritative
        // extinction proof if the ManagedRun join itself was unavailable.
        await closeScope();
        nativeExtinctionConfirmed = true;
        extinctionError = undefined;
      } catch (error) {
        scopeError = error;
      }
    }

    // Private return frames must be consumed before cleanup, but only after
    // native extinction. Neither raw frames nor partial archives enter RunExit.
    if (nativeExtinctionConfirmed) {
      if (exit && plan.lifecycle?.acceptExit) {
        try {
          exit = plan.lifecycle.acceptExit(exit);
        } catch (error) {
          exitError = error;
        }
      }
      try {
        finalization = (await plan.lifecycle?.finalize()) ?? {};
      } catch (error) {
        finalizeError = error;
      }
    }

    if (!scopeError) {
      try {
        await closeScope();
      } catch (error) {
        scopeError = error;
      }
    }

    if (runError || extinctionError || exitError || finalizeError || scopeError) {
      aggregateOrThrow(
        [runError, extinctionError, exitError, finalizeError, scopeError],
        "Backend execution or cleanup failed.",
      );
    }
    if (!exit) {
      throw new Error("Backend execution completed without a terminal result.");
    }

    return {
      backendId: plan.backendId,
      facts: plan.facts,
      exit,
      finalization,
    };
  } finally {
    for (const { signal, listener } of abortListeners) {
      signal.removeEventListener("abort", listener);
    }
    // If prepare itself fails, no backend launch exists; still release the
    // private cleanup owner. Calling closeScope twice is idempotent.
    try {
      await closeScope();
    } catch {
      // Any post-launch closeScope failure is surfaced above. A prepare-time
      // failure has no spawned native process owned by this scope.
    }
  }
};
