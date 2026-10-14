import type { RunExit, SpawnInput, TerminationReason } from "../types";
import type {
  ExecutionWorkspaceTransferRequest,
  WorkspaceReturnedFile,
  WorkspaceFileFact,
  WorkspaceTransferMode,
} from "./workspace-transfer";

export type ExecutionFilesystemIsolation =
  | "host"
  | "workspace-readonly"
  | "workspace-readwrite"
  | "none"
  | "sandbox";

export type ExecutionNetworkIsolation = "inherit" | "deny" | "brokered";

export type ExecutionProcessIsolation = "host" | "deny-child-process" | "sandbox";

export interface ExecutionIsolationRequirements {
  filesystem: ExecutionFilesystemIsolation;
  network: ExecutionNetworkIsolation;
  processes: ExecutionProcessIsolation;
}

export interface ExecutionResourceLimits {
  /** Required wall-clock deadline. */
  maxWallTimeMs: number;
  /** Required bounded stdout/stderr retention per stream. */
  maxCapturedOutputChars: number;
  /** Optional hard controls; a backend must reject rather than ignore unsupported limits. */
  maxCpuTimeMs?: number;
  maxMemoryBytes?: number;
  maxStorageBytes?: number;
  maxProcesses?: number;
}

export interface ExecutionBackendRequest {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Existing GM-10 launch semantics that a backend must preserve unless its isolation wrapper deliberately transforms them. */
  envProfile?: SpawnInput["envProfile"];
  argv0?: SpawnInput["argv0"];
  windowsVerbatimArguments?: SpawnInput["windowsVerbatimArguments"];
  stdinMode?: SpawnInput["stdinMode"];
  /** Set only by a closed server-owned input channel such as the safe console or broker RPC. */
  interactiveInputPolicy?: SpawnInput["interactiveInputPolicy"];
  isolation: ExecutionIsolationRequirements;
  resources: ExecutionResourceLimits;
  signal?: AbortSignal;
  input?: string;
  scopeKey?: string;
  /** Optional explicit copy bridge; never a host bind mount. */
  workspaceTransfer?: ExecutionWorkspaceTransferRequest;
}

export interface ExecutionBackendCapabilities {
  filesystem: readonly ExecutionFilesystemIsolation[];
  network: readonly ExecutionNetworkIsolation[];
  processes: readonly ExecutionProcessIsolation[];
  resourceControls: readonly (
    | "wall-time"
    | "captured-output"
    | "cpu-time"
    | "memory"
    | "storage"
    | "process-count"
  )[];
}

export interface ExecutionBackendFinalization {
  workspaceOutputs?: WorkspaceReturnedFile[];
}

export interface ExecutionBackendLifecycle {
  /**
   * Synchronous cancellation hook invoked before native client termination.
   * Backend cleanup may begin here, but this is not itself extinction proof.
   */
  onCancel(reason: TerminationReason): void;
  /**
   * Optional private transport hooks. When present they must be the exact raw
   * callbacks carried by the approved SpawnInput; GM-11 rejects unbound hooks.
   */
  onStdoutRaw?: SpawnInput["onStdoutRaw"];
  onStderrRaw?: SpawnInput["onStderrRaw"];
  /** Consume private output transport and return only sanitized, bounded diagnostics. Call after native extinction, before finalize. */
  acceptExit?(exit: RunExit): RunExit;
  /**
   * Authoritative backend cleanup/proof. Call only after the native launch
   * process has reached extinction, and await it before recording completion.
   */
  finalize(): Promise<ExecutionBackendFinalization>;
}
export interface ExecutionBackendLaunchPlan {
  backendId: string;
  /**
   * Canonical GM-10 spawn input. A backend may wrap argv/cwd/env to enforce
   * isolation, but it must never weaken the admitted request.
   *
   * GM-11 integration ordering is security-critical:
   *   backend.prepare(request) -> exact-operation identity/approval over THIS
   *   final spawn plan -> current-policy lease recheck -> supervisor spawn.
   * Never approve a pre-backend command and then let a backend silently mutate it.
   */
  spawn: SpawnInput;
  /** Caller/backend-owned authorization signal that must remain live through execution. */
  signal?: AbortSignal;
  /** Optional backend-owned lifecycle that must be finalized after native extinction. */
  lifecycle?: ExecutionBackendLifecycle;
  /** Secret-free facts suitable for receipts/diagnostics. */
  facts: {
    isolation: ExecutionIsolationRequirements;
    resources: ExecutionResourceLimits;
    runtimeGenerationId?: string;
    workspaceTransfer?: {
      mode: WorkspaceTransferMode;
      inputs: readonly WorkspaceFileFact[];
      outputs: readonly string[];
    };
  };
}

export class ExecutionBackendUnavailableError extends Error {
  constructor(
    readonly backendId: string,
    readonly reason:
      | "filesystem-isolation-unsupported"
      | "network-isolation-unsupported"
      | "process-isolation-unsupported"
      | "resource-control-unsupported"
      | "resource-limit-invalid"
      | "authorization-cancelled"
      | "request-invalid",
  ) {
    super(`Execution backend "${backendId}" cannot satisfy required isolation/resource policy (${reason}).`);
    this.name = "ExecutionBackendUnavailableError";
  }
}

export interface ExecutionBackend {
  readonly id: string;
  readonly capabilities: ExecutionBackendCapabilities;
  prepare(request: ExecutionBackendRequest): Promise<ExecutionBackendLaunchPlan>;
}
