import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionBackendRequest,
  ExecutionResourceLimits,
} from "./types";
import { ExecutionBackendUnavailableError } from "./types";

export const LOCAL_EXECUTION_BACKEND_ID = "lios.execution.local";

export const LOCAL_MAX_WALL_TIME_MS = 5 * 60_000;
export const LOCAL_MAX_CAPTURED_OUTPUT_CHARS = 1024 * 1024;

function validPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateBaseLimits(resources: ExecutionResourceLimits): void {
  if (
    !validPositiveSafeInteger(resources.maxWallTimeMs) ||
    resources.maxWallTimeMs > LOCAL_MAX_WALL_TIME_MS ||
    !validPositiveSafeInteger(resources.maxCapturedOutputChars) ||
    resources.maxCapturedOutputChars < 256 ||
    resources.maxCapturedOutputChars > LOCAL_MAX_CAPTURED_OUTPUT_CHARS
  ) {
    throw new ExecutionBackendUnavailableError(LOCAL_EXECUTION_BACKEND_ID, "resource-limit-invalid");
  }
}

function assertNoUnsupportedHardLimits(resources: ExecutionResourceLimits): void {
  if (
    resources.maxCpuTimeMs !== undefined ||
    resources.maxMemoryBytes !== undefined ||
    resources.maxStorageBytes !== undefined ||
    resources.maxProcesses !== undefined
  ) {
    throw new ExecutionBackendUnavailableError(LOCAL_EXECUTION_BACKEND_ID, "resource-control-unsupported");
  }
}

function cloneRequest(request: ExecutionBackendRequest): ExecutionBackendRequest {
  return {
    ...request,
    argv: [...request.argv],
    env: request.env ? { ...request.env } : undefined,
    isolation: { ...request.isolation },
    resources: { ...request.resources },
  };
}

/**
 * Honest GM-11c baseline over the existing GM-10 supervisor.
 *
 * This backend is NOT an OS sandbox. It only admits policies the current local
 * process supervisor can actually enforce today: host filesystem/process access,
 * inherited network access, bounded wall time, bounded retained output and
 * cancellation through the existing signal/scope mechanisms.
 *
 * Any caller requiring stronger isolation or resource enforcement is rejected.
 */
export const localExecutionBackend: ExecutionBackend = {
  id: LOCAL_EXECUTION_BACKEND_ID,
  capabilities: Object.freeze({
    filesystem: Object.freeze(["host"] as const),
    network: Object.freeze(["inherit"] as const),
    processes: Object.freeze(["host"] as const),
    resourceControls: Object.freeze(["wall-time", "captured-output"] as const),
  }),

  async prepare(rawRequest): Promise<ExecutionBackendLaunchPlan> {
    const request = cloneRequest(rawRequest);
    if (!request.argv[0] || request.argv.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
      throw new ExecutionBackendUnavailableError(LOCAL_EXECUTION_BACKEND_ID, "request-invalid");
    }
    if (request.workspaceTransfer) {
      throw new ExecutionBackendUnavailableError(LOCAL_EXECUTION_BACKEND_ID, "filesystem-isolation-unsupported");
    }

    if (request.isolation.filesystem !== "host") {
      throw new ExecutionBackendUnavailableError(LOCAL_EXECUTION_BACKEND_ID, "filesystem-isolation-unsupported");
    }
    if (request.isolation.network !== "inherit") {
      throw new ExecutionBackendUnavailableError(LOCAL_EXECUTION_BACKEND_ID, "network-isolation-unsupported");
    }
    if (request.isolation.processes !== "host") {
      throw new ExecutionBackendUnavailableError(LOCAL_EXECUTION_BACKEND_ID, "process-isolation-unsupported");
    }

    validateBaseLimits(request.resources);
    assertNoUnsupportedHardLimits(request.resources);
    if (request.signal?.aborted) {
      throw new ExecutionBackendUnavailableError(LOCAL_EXECUTION_BACKEND_ID, "authorization-cancelled");
    }

    return {
      backendId: LOCAL_EXECUTION_BACKEND_ID,
      spawn: {
        mode: "child",
        argv: request.argv,
        cwd: request.cwd,
        env: request.env,
        envProfile: request.envProfile,
        argv0: request.argv0,
        windowsVerbatimArguments: request.windowsVerbatimArguments,
        stdinMode: request.stdinMode,
        timeoutMs: request.resources.maxWallTimeMs,
        maxCapturedOutputChars: request.resources.maxCapturedOutputChars,
        captureOutput: true,
        input: request.input,
        scopeKey: request.scopeKey,
      },
      signal: request.signal,
      facts: Object.freeze({
        isolation: Object.freeze({ ...request.isolation }),
        resources: Object.freeze({ ...request.resources }),
      }),
    };
  },
};
