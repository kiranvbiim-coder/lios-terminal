import type {
  ManagedRun,
  ProcessResourceRequest,
  ProcessSupervisor,
  SpawnInput,
  TerminationReason,
} from "./types";

export interface ProcessResourceReservation {
  release(): void;
}

export interface ProcessResourceReservationAuthority {
  acquire(request: ProcessResourceRequest): ProcessResourceReservation;
}

function requestedResources(input: SpawnInput): ProcessResourceRequest | null {
  if (input.resourceRequest) {
    return {
      memoryBytes: input.resourceRequest.memoryBytes,
      diskBytes: input.resourceRequest.diskBytes,
      workload: input.resourceRequest.workload,
    };
  }
  // Every exact-operation-approved privileged launch participates in the heavy
  // concurrency budget even when its backend does not yet publish byte-level
  // local preflight metadata. Backend hard limits remain independently enforced.
  if (input.expectedOperationDigest) {
    return { memoryBytes: 0, diskBytes: 0, workload: "heavy" };
  }
  return null;
}

/**
 * Bind SI-01.13 capacity reservations to the canonical GM-10 supervisor.
 *
 * Acquisition is injected into GM-10's existing synchronous authorizationCheck,
 * which the underlying supervisor invokes after exact-operation revalidation and
 * immediately before native adapter construction. A reservation is released only
 * when native descendant extinction is proven, or when construction rejects after
 * acquisition. Failed extinction intentionally remains fail-closed until restart.
 */
export function withProcessResourceReservations(
  supervisor: ProcessSupervisor,
  reservations: ProcessResourceReservationAuthority,
): ProcessSupervisor {
  return {
    acquireScopeCleanup: (scopeKey) => supervisor.acquireScopeCleanup(scopeKey),
    async spawn(input: SpawnInput): Promise<ManagedRun> {
      const request = requestedResources(input);
      if (!request) return supervisor.spawn(input);

      let reservation: ProcessResourceReservation | null = null;
      let released = false;
      const release = () => {
        if (released || !reservation) return;
        released = true;
        reservation.release();
      };
      const originalAuthorizationCheck = input.authorizationCheck;
      const delegated: SpawnInput = {
        ...input,
        argv: [...input.argv],
        env: input.env ? { ...input.env } : undefined,
        operationFilePaths: input.operationFilePaths ? [...input.operationFilePaths] : undefined,
        resourceRequest: undefined,
        authorizationCheck: () => {
          originalAuthorizationCheck?.();
          if (!reservation) reservation = reservations.acquire(request);
        },
      };

      let run: ManagedRun;
      try {
        run = await supervisor.spawn(delegated);
      } catch (error) {
        release();
        throw error;
      }

      const waitForExtinction = run.waitForExtinction;
      if (reservation && waitForExtinction) {
        void waitForExtinction().then(release, () => undefined);
      }
      return run;
    },
    cancel: (runId: string, reason?: TerminationReason) => supervisor.cancel(runId, reason),
    cancelScope: (scopeKey: string, reason?: TerminationReason) => supervisor.cancelScope(scopeKey, reason),
    shutdown: () => supervisor.shutdown(),
  };
}
