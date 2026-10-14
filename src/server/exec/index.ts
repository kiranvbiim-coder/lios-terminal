// Written for LiOS, GM-10a (replaces OpenClaw src/process/supervisor/index.ts, which used global-singleton).
/**
 * Process-execution kernel (child mode).
 *
 * - `createProcessSupervisor()` returns an independent supervisor: `spawn(input)` -> `ManagedRun`
 *   (`wait()` -> `RunExit` with `reason`: manual-cancel | overall-timeout | no-output-timeout | spawn-error | signal | exit,
 *   bounded captured stdout/stderr, `cancel()`, `waitForExtinction()`), `cancel(runId)`, `cancelScope(scopeKey)`,
 *   `acquireScopeCleanup(scopeKey)` (returns a closer that cancels and joins every run in the scope) and `shutdown()`.
 * - `getProcessSupervisor()` returns the lazily created process-wide supervisor, with SI-01.13 local resource reservations
 *   bound to GM-10's existing final-authorization/extinction fence.
 * - Children run in their own process group (POSIX) and cancellation kills the whole group, SIGTERM first, SIGKILL after
 *   `gracefulCancelMs`. The child environment is an allow-list plus the caller's explicit `env` (see ./env).
 * - Types: `SpawnInput`, `ManagedRun`, `RunExit`, `TerminationReason`, `ProcessSupervisor`.
 */
import { LocalResourceReservationPool } from "../si01ResourceReservation";
import { withProcessResourceReservations } from "./resource-supervisor";
import { createProcessSupervisor } from "./supervisor";
import type { ProcessSupervisor } from "./types";

let current: ProcessSupervisor | null = null;

/** Return the process-wide supervisor used by runtime code that does not inject one. */
export function getProcessSupervisor(): ProcessSupervisor {
  return (current ??= withProcessResourceReservations(
    createProcessSupervisor(),
    new LocalResourceReservationPool(),
  ));
}

export { createProcessSupervisor } from "./supervisor";
export type { ProcessSupervisorOptions } from "./supervisor";
export type {
  ManagedRun,
  ProcessResourceRequest,
  ProcessSupervisor,
  RunExit,
  SpawnInput,
  TerminationReason,
} from "./types";
