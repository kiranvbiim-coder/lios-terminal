import fs from "node:fs";
import path from "node:path";
import { nodeNetworkDenyImport, nodePermissionModelFlag } from "../node-isolation";
import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionBackendRequest,
  ExecutionResourceLimits,
} from "./types";
import { ExecutionBackendUnavailableError } from "./types";

export const NODE_PERMISSION_EXECUTION_BACKEND_ID = "lios.execution.node-permission";
export const NODE_PERMISSION_MAX_WALL_TIME_MS = 5 * 60_000;
export const NODE_PERMISSION_MAX_CAPTURED_OUTPUT_CHARS = 1024 * 1024;

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateResources(resources: ExecutionResourceLimits): void {
  if (
    !positiveSafeInteger(resources.maxWallTimeMs) ||
    resources.maxWallTimeMs > NODE_PERMISSION_MAX_WALL_TIME_MS ||
    !positiveSafeInteger(resources.maxCapturedOutputChars) ||
    resources.maxCapturedOutputChars < 256 ||
    resources.maxCapturedOutputChars > NODE_PERMISSION_MAX_CAPTURED_OUTPUT_CHARS
  ) {
    throw new ExecutionBackendUnavailableError(
      NODE_PERMISSION_EXECUTION_BACKEND_ID,
      "resource-limit-invalid",
    );
  }
  if (
    resources.maxCpuTimeMs !== undefined ||
    resources.maxMemoryBytes !== undefined ||
    resources.maxStorageBytes !== undefined ||
    resources.maxProcesses !== undefined
  ) {
    throw new ExecutionBackendUnavailableError(
      NODE_PERMISSION_EXECUTION_BACKEND_ID,
      "resource-control-unsupported",
    );
  }
}

function realNodePath(candidate: string): string {
  try {
    return fs.realpathSync.native(path.resolve(candidate));
  } catch {
    throw new ExecutionBackendUnavailableError(
      NODE_PERMISSION_EXECUTION_BACKEND_ID,
      "request-invalid",
    );
  }
}

function workspaceRoot(request: ExecutionBackendRequest): string {
  if (!request.cwd) {
    throw new ExecutionBackendUnavailableError(
      NODE_PERMISSION_EXECUTION_BACKEND_ID,
      "request-invalid",
    );
  }
  const resolved = realNodePath(request.cwd);
  if (!fs.statSync(resolved).isDirectory()) {
    throw new ExecutionBackendUnavailableError(
      NODE_PERMISSION_EXECUTION_BACKEND_ID,
      "request-invalid",
    );
  }
  return resolved;
}

function inlineNodeCode(request: ExecutionBackendRequest): string {
  if (
    request.argv.length !== 3 ||
    (request.argv[1] !== "-e" && request.argv[1] !== "--eval") ||
    !request.argv[2] ||
    request.argv[2].includes("\0")
  ) {
    throw new ExecutionBackendUnavailableError(
      NODE_PERMISSION_EXECUTION_BACKEND_ID,
      "request-invalid",
    );
  }
  const requestedNode = realNodePath(request.argv[0] ?? "");
  const currentNode = fs.realpathSync.native(process.execPath);
  if (requestedNode !== currentNode) {
    throw new ExecutionBackendUnavailableError(
      NODE_PERMISSION_EXECUTION_BACKEND_ID,
      "request-invalid",
    );
  }
  return request.argv[2];
}

function validateLaunchSemantics(request: ExecutionBackendRequest): void {
  if (
    request.stdinMode === "inherit" ||
    request.windowsVerbatimArguments === true ||
    request.envProfile === "python-runtime"
  ) {
    throw new ExecutionBackendUnavailableError(
      NODE_PERMISSION_EXECUTION_BACKEND_ID,
      "request-invalid",
    );
  }
}

/**
 * Real Node isolation backend.
 *
 * Security boundary:
 * - Node Permission Model denies filesystem access entirely.
 * - child_process/worker/addon permissions are not granted.
 * - a shared locked preload denies raw Node/global network APIs.
 * - host stdin inheritance and Windows verbatim argument mode are refused.
 * - the Python-only environment profile is refused instead of widening Node execution policy.
 *
 * Node's path permissions follow symlinks lexically, so workspace-scoped filesystem
 * modes are deliberately rejected here until a symlink-safe OS/path-broker backend
 * owns that boundary. This backend intentionally accepts only inline Node code.
 */
export const nodePermissionExecutionBackend: ExecutionBackend = {
  id: NODE_PERMISSION_EXECUTION_BACKEND_ID,
  capabilities: Object.freeze({
    filesystem: Object.freeze(["none"] as const),
    network: Object.freeze(["deny"] as const),
    processes: Object.freeze(["deny-child-process"] as const),
    resourceControls: Object.freeze(["wall-time", "captured-output"] as const),
  }),

  async prepare(request): Promise<ExecutionBackendLaunchPlan> {
    if (request.signal?.aborted) {
      throw new ExecutionBackendUnavailableError(
        NODE_PERMISSION_EXECUTION_BACKEND_ID,
        "authorization-cancelled",
      );
    }
    validateResources(request.resources);
    validateLaunchSemantics(request);

    if (request.isolation.network !== "deny") {
      throw new ExecutionBackendUnavailableError(
        NODE_PERMISSION_EXECUTION_BACKEND_ID,
        "network-isolation-unsupported",
      );
    }
    if (request.isolation.processes !== "deny-child-process") {
      throw new ExecutionBackendUnavailableError(
        NODE_PERMISSION_EXECUTION_BACKEND_ID,
        "process-isolation-unsupported",
      );
    }
    if (request.isolation.filesystem !== "none") {
      throw new ExecutionBackendUnavailableError(
        NODE_PERMISSION_EXECUTION_BACKEND_ID,
        "filesystem-isolation-unsupported",
      );
    }

    const code = inlineNodeCode(request);
    const workspace = workspaceRoot(request);
    const argv = [
      process.execPath,
      nodePermissionModelFlag(),
      "--import=" + nodeNetworkDenyImport(),
      "-e",
      code,
    ];

    const isolation = Object.freeze({ ...request.isolation });
    const resources = Object.freeze({ ...request.resources });
    return {
      backendId: NODE_PERMISSION_EXECUTION_BACKEND_ID,
      spawn: {
        mode: "child",
        argv,
        cwd: workspace,
        env: request.env ? { ...request.env } : undefined,
        envProfile: request.envProfile,
        argv0: request.argv0,
        windowsVerbatimArguments: request.windowsVerbatimArguments,
        stdinMode: request.stdinMode,
        timeoutMs: resources.maxWallTimeMs,
        maxCapturedOutputChars: resources.maxCapturedOutputChars,
        captureOutput: true,
        input: request.input,
        scopeKey: request.scopeKey,
      },
      signal: request.signal,
      facts: Object.freeze({ isolation, resources }),
    };
  },
};
