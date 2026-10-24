import crypto from "node:crypto";
import {
  createContainerExecutionLifecycle,
  type ContainerControlRunner,
} from "./container-lifecycle";
import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionBackendRequest,
  ExecutionResourceLimits,
} from "./types";
import { ExecutionBackendUnavailableError } from "./types";
import { prepareWorkspaceTransfer } from "./workspace-transfer";

export type ContainerExecutionEngine = "docker" | "podman";

export interface ContainerExecutionBackendConfig {
  engine: ContainerExecutionEngine;
  /** Explicit local engine endpoint. Ambient Docker/Podman contexts are never trusted. */
  engineTarget: string;
  /** Immutable OCI image reference: repo@sha256:<digest> or sha256:<digest>. */
  image: string;
  /** Numeric non-root uid:gid used inside the sandbox. */
  user: string;
  /** Backend-owned hard ceilings; request limits can only tighten them. */
  maxMemoryBytes: number;
  maxProcesses: number;
  /** Optional in-image tools for the copy-only workspace bridge. */
  workspaceBridge?: {
    shellPath: string;
    base64Path: string;
    tarPath: string;
    tmpfsBytes: number;
  };
}

export interface ContainerExecutionBackendDependencies {
  controlRunner?: ContainerControlRunner;
  generationId?: () => string;
  finalizeAttempts?: number;
  retryDelayMs?: number;
}

const IMAGE_DIGEST = /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._/:+-]*@sha256:[a-f0-9]{64})$/i;
const NON_ROOT_USER = /^[1-9][0-9]*:[1-9][0-9]*$/;
const WINDOWS_NPIPE = /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/;
const CONTAINER_EMPTY_WORKDIR = "/tmp";
const MAX_WALL_TIME_MS = 5 * 60_000;
const MAX_CAPTURED_OUTPUT_CHARS = 1024 * 1024;
const PODMAN_SWAP_RESERVE_BYTES = 4096;
export const CONTAINER_BASE_TMPFS_BYTES = 64 * 1024 * 1024;
const CONTAINER_ARCHIVE_TMPFS_OVERHEAD_BYTES = 1024 * 1024;

export function containerArchiveTmpfsBytes(archiveBytes: number): number {
  if (!Number.isSafeInteger(archiveBytes) || archiveBytes < 0) {
    throw new Error("Container workspace archiveBytes must be a non-negative safe integer.");
  }
  return Math.max(
    CONTAINER_BASE_TMPFS_BYTES,
    archiveBytes + CONTAINER_ARCHIVE_TMPFS_OVERHEAD_BYTES,
  );
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function invalid(backendId: string, reason: ConstructorParameters<typeof ExecutionBackendUnavailableError>[1]): never {
  throw new ExecutionBackendUnavailableError(backendId, reason);
}

function localTargetError(): Error {
  return new Error(
    "Container execution engineTarget must be an explicit local unix:// socket or Windows npipe:// endpoint.",
  );
}

function normalizeLocalEngineTarget(value: string): string {
  if (typeof value !== "string" || !value || value.includes("\0")) throw localTargetError();
  if (WINDOWS_NPIPE.test(value)) return value;
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw localTargetError();
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(target.pathname);
  } catch {
    throw localTargetError();
  }
  if (
    target.protocol !== "unix:" ||
    target.hostname ||
    target.username ||
    target.password ||
    target.port ||
    target.search ||
    target.hash ||
    !decodedPath.startsWith("/") ||
    decodedPath === "/" ||
    decodedPath.includes("\0")
  ) {
    throw localTargetError();
  }
  return target.href;
}

function validateConfig(config: ContainerExecutionBackendConfig): void {
  if (config.engine !== "docker" && config.engine !== "podman") {
    throw new Error("Container execution engine must be docker or podman.");
  }
  // Enforce the engine/endpoint pairing at the canonical GM backend too,
  // not only at the packaged desktop bootstrap. Otherwise a manually
  // configured strict profile can appear valid until its first Python call.
  if (config.engine === "podman" && WINDOWS_NPIPE.test(config.engineTarget)) {
    throw new Error("Podman execution cannot use a Windows Docker named-pipe endpoint.");
  }
  const localSocketPath = WINDOWS_NPIPE.test(config.engineTarget)
    ? null : decodeURIComponent(new URL(config.engineTarget).pathname);
  if (config.engine === "docker" && localSocketPath?.endsWith("/podman/podman.sock")) {
    throw new Error("A local Podman socket must be paired with the Podman execution engine.");
  }
  if (!IMAGE_DIGEST.test(config.image)) {
    throw new Error("Container execution image must use an immutable sha256 digest.");
  }
  if (!NON_ROOT_USER.test(config.user)) {
    throw new Error("Container execution user must be a non-root numeric uid:gid.");
  }
  if (!positiveSafeInteger(config.maxMemoryBytes)) {
    throw new Error("Container execution maxMemoryBytes must be a positive safe integer.");
  }
  if (!positiveSafeInteger(config.maxProcesses)) {
    throw new Error("Container execution maxProcesses must be a positive safe integer.");
  }
  if (config.workspaceBridge) {
    const { shellPath, base64Path, tarPath, tmpfsBytes } = config.workspaceBridge;
    for (const value of [shellPath, base64Path, tarPath]) {
      if (!value.startsWith("/") || value.includes("\0")) {
        throw new Error("Container workspace bridge tool paths must be absolute and NUL-free.");
      }
    }
    if (!positiveSafeInteger(tmpfsBytes) || tmpfsBytes > 128 * 1024 * 1024) {
      throw new Error("Container workspace bridge tmpfsBytes must be a positive value no larger than 128 MiB.");
    }
  }
}

function validateRequestResources(
  backendId: string,
  requested: ExecutionResourceLimits,
  config: ContainerExecutionBackendConfig,
): ExecutionResourceLimits {
  if (
    !positiveSafeInteger(requested.maxWallTimeMs) ||
    requested.maxWallTimeMs > MAX_WALL_TIME_MS ||
    !positiveSafeInteger(requested.maxCapturedOutputChars) ||
    requested.maxCapturedOutputChars < 256 ||
    requested.maxCapturedOutputChars > MAX_CAPTURED_OUTPUT_CHARS
  ) {
    invalid(backendId, "resource-limit-invalid");
  }
  if (requested.maxCpuTimeMs !== undefined || requested.maxStorageBytes !== undefined) {
    invalid(backendId, "resource-control-unsupported");
  }
  if (requested.maxMemoryBytes !== undefined && !positiveSafeInteger(requested.maxMemoryBytes)) {
    invalid(backendId, "resource-limit-invalid");
  }
  if (requested.maxProcesses !== undefined && !positiveSafeInteger(requested.maxProcesses)) {
    invalid(backendId, "resource-limit-invalid");
  }
  return Object.freeze({
    maxWallTimeMs: requested.maxWallTimeMs,
    maxCapturedOutputChars: requested.maxCapturedOutputChars,
    maxMemoryBytes: Math.min(requested.maxMemoryBytes ?? config.maxMemoryBytes, config.maxMemoryBytes),
    maxProcesses: Math.min(requested.maxProcesses ?? config.maxProcesses, config.maxProcesses),
  });
}

function memoryArgs(
  engine: ContainerExecutionEngine,
  backendId: string,
  totalLimitBytes: number,
): string[] {
  if (engine === "docker") {
    return [
      "--memory=" + String(totalLimitBytes) + "b",
      "--memory-swap=" + String(totalLimitBytes) + "b",
    ];
  }
  if (totalLimitBytes <= PODMAN_SWAP_RESERVE_BYTES) {
    invalid(backendId, "resource-limit-invalid");
  }
  const residentLimitBytes = totalLimitBytes - PODMAN_SWAP_RESERVE_BYTES;
  return [
    "--memory=" + String(residentLimitBytes) + "b",
    "--memory-swap=" + String(totalLimitBytes) + "b",
  ];
}

function safeArgv(backendId: string, argv: readonly string[]): string[] {
  if (!argv[0] || argv.some((value) => typeof value !== "string" || value.includes("\0"))) {
    invalid(backendId, "request-invalid");
  }
  return [...argv];
}

function isClosedInteractivePolicy(policy: ExecutionBackendRequest["interactiveInputPolicy"]): boolean {
  return policy === "sandbox-readonly-console" || policy === "sandbox-broker-rpc";
}

function assertSupportedLaunchSemantics(
  backendId: string,
  request: ExecutionBackendRequest,
): void {
  if (request.envProfile || Object.keys(request.env ?? {}).length > 0) {
    invalid(backendId, "request-invalid");
  }
  if (request.argv0 || request.windowsVerbatimArguments) {
    invalid(backendId, "request-invalid");
  }
  if (
    request.stdinMode === "inherit" ||
    (request.stdinMode === "pipe-open" && !isClosedInteractivePolicy(request.interactiveInputPolicy)) ||
    (request.interactiveInputPolicy !== undefined &&
      (request.stdinMode !== "pipe-open" || request.input !== undefined || request.workspaceTransfer !== undefined))
  ) {
    invalid(backendId, "request-invalid");
  }
}

export function createContainerExecutionBackend(
  configInput: ContainerExecutionBackendConfig,
  dependencies: ContainerExecutionBackendDependencies = {},
): ExecutionBackend {
  const config = Object.freeze({
    ...configInput,
    engineTarget: normalizeLocalEngineTarget(configInput.engineTarget),
    workspaceBridge: configInput.workspaceBridge
      ? Object.freeze({ ...configInput.workspaceBridge })
      : undefined,
  });
  validateConfig(config);
  const backendId = `lios.execution.${config.engine}`;

  return {
    id: backendId,
    capabilities: Object.freeze({
      filesystem: Object.freeze(["sandbox"] as const),
      network: Object.freeze(["deny"] as const),
      processes: Object.freeze(["sandbox"] as const),
      resourceControls: Object.freeze([
        "wall-time",
        "captured-output",
        "memory",
        "process-count",
      ] as const),
    }),

    async prepare(request): Promise<ExecutionBackendLaunchPlan> {
      if (request.signal?.aborted) {
        invalid(backendId, "authorization-cancelled");
      }
      assertSupportedLaunchSemantics(backendId, request);

      if (request.isolation.network !== "deny") {
        invalid(backendId, "network-isolation-unsupported");
      }
      if (request.isolation.processes !== "sandbox") {
        invalid(backendId, "process-isolation-unsupported");
      }
      if (request.isolation.filesystem !== "sandbox" || request.cwd) {
        invalid(backendId, "filesystem-isolation-unsupported");
      }

      const argv = safeArgv(backendId, request.argv);
      if (!argv[0].startsWith("/")) {
        invalid(backendId, "request-invalid");
      }
      const resources = validateRequestResources(backendId, request.resources, config);
      if (request.workspaceTransfer && request.input !== undefined) {
        invalid(backendId, "request-invalid");
      }
      if (request.workspaceTransfer && !config.workspaceBridge) {
        invalid(backendId, "filesystem-isolation-unsupported");
      }
      const workspace = request.workspaceTransfer
        ? prepareWorkspaceTransfer(request.workspaceTransfer)
        : undefined;
      if (workspace && workspace.archiveBytes > config.workspaceBridge!.tmpfsBytes) {
        invalid(backendId, "resource-limit-invalid");
      }

      const tempTmpfsBytes = containerArchiveTmpfsBytes(workspace?.archiveBytes ?? 0);
      if (
        workspace &&
        tempTmpfsBytes + config.workspaceBridge!.tmpfsBytes > (resources.maxMemoryBytes ?? config.maxMemoryBytes)
      ) {
        invalid(backendId, "resource-limit-invalid");
      }

      const generatedId = dependencies.generationId?.() ?? crypto.randomUUID();
      const generationId = "lios-exec-" + generatedId.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (!/^lios-exec-[a-z0-9][a-z0-9-]{7,80}$/.test(generationId)) {
        invalid(backendId, "request-invalid");
      }
      const returning = workspace?.facts.mode === "write-return" && workspace.facts.outputs.length > 0;
      const token = returning ? crypto.randomBytes(32).toString("hex") : undefined;
      const outputStream = token
        ? workspace!.createOutputStream(token, resources.maxCapturedOutputChars)
        : undefined;
      const onStdoutRaw = outputStream ? (chunk: Buffer) => outputStream.onStdout(chunk) : undefined;
      const onStderrRaw = outputStream ? (chunk: Buffer) => outputStream.onStderr(chunk) : undefined;
      const lifecycle = createContainerExecutionLifecycle({
        engine: config.engine,
        engineTarget: config.engineTarget,
        generationId,
        runner: dependencies.controlRunner,
        finalizeAttempts: dependencies.finalizeAttempts,
        retryDelayMs: dependencies.retryDelayMs,
        onStdoutRaw,
        onStderrRaw,
        acceptExit: outputStream ? (exit) => outputStream.acceptExit(exit) : undefined,
        beforeRemove: outputStream
          ? async () => ({ workspaceOutputs: outputStream.collectOutputs() })
          : undefined,
      });
      const engineTargetArg = config.engine === "docker"
        ? "--host=" + config.engineTarget
        : "--url=" + config.engineTarget;
      const engineArgs: string[] = [
        config.engine,
        engineTargetArg,
        "run",
        ...(workspace ? [] : ["--rm"]),
        "--restart=no",
        "--name=" + generationId,
        "--init",
        "--pull=never",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges:true",
        "--network=none",
        "--ipc=private",
        "--no-healthcheck",
        "--log-driver=none",
        "--sig-proxy=true",
        "--stop-timeout=2",
        ...memoryArgs(config.engine, backendId, resources.maxMemoryBytes!),
        "--pids-limit=" + String(resources.maxProcesses),
        "--user=" + config.user,
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=" + String(tempTmpfsBytes),
      ];

      if (workspace) {
        const [uid, gid] = config.user.split(":");
        engineArgs.push(
          "--tmpfs=/workspace:rw,noexec,nosuid,nodev,size=" +
            String(config.workspaceBridge!.tmpfsBytes) +
            ",uid=" +
            uid +
            ",gid=" +
            gid +
            ",mode=0700",
        );
      }

      if (config.engine === "podman") engineArgs.push("--pid=private");

      if (workspace || request.input !== undefined || request.stdinMode === "pipe-open") {
        engineArgs.push("--interactive");
      }

      if (workspace) {
        const bridge = config.workspaceBridge!;
        const bridgeScript = returning
          ? 'set -eu; IFS= read -r token; base64_path=$1; tar_path=$2; archive=/tmp/lios-workspace.tar; "$base64_path" -d > "$archive"; "$tar_path" -xf "$archive" -C /workspace; rm -f "$archive"; cd /workspace; shift 2; set +e; "$@"; status=$?; set -e; if [ "$status" -ne 0 ]; then exit "$status"; fi; ' + workspace.outputScript()
          : 'set -eu; archive=/tmp/lios-workspace.tar; "$1" -d > "$archive"; "$2" -xf "$archive" -C /workspace; rm -f "$archive"; cd /workspace; shift 2; exec "$@"';
        engineArgs.push(
          "--workdir=/workspace",
          "--entrypoint=" + bridge.shellPath,
          config.image,
          "-c",
          bridgeScript,
          "lios-workspace",
          bridge.base64Path,
          bridge.tarPath,
          ...argv,
        );
      } else {
        engineArgs.push("--workdir=" + CONTAINER_EMPTY_WORKDIR);
        engineArgs.push("--entrypoint=" + argv[0], config.image, ...argv.slice(1));
      }

      const isolation = Object.freeze({ ...request.isolation });
      return {
        backendId,
        spawn: {
          mode: "child",
          argv: engineArgs,
          cwd: undefined,
          timeoutMs: resources.maxWallTimeMs,
          maxCapturedOutputChars: resources.maxCapturedOutputChars,
          captureOutput: !returning,
          onStdoutRaw: lifecycle.onStdoutRaw,
          onStderrRaw: lifecycle.onStderrRaw,
          input: returning ? `${token}\n${workspace!.stdinBase64}` : workspace?.stdinBase64 ?? request.input,
          stdinMode: request.stdinMode ?? "pipe-closed",
          interactiveInputPolicy: request.interactiveInputPolicy,
          scopeKey: request.scopeKey,
          onCancel: lifecycle.onCancel,
        },
        signal: request.signal,
        lifecycle,
        facts: Object.freeze({
          isolation,
          resources,
          runtimeGenerationId: generationId,
          workspaceTransfer: workspace?.facts,
        }),
      };
    },
  };
}
