import { createContainerExecutionBackend } from "./backends/container";
import type { ExecutionBackend } from "./backends/types";

export type SandboxIsolationMode = "legacy-host" | "strict";

export interface SandboxRuntimeProfile {
  mode: SandboxIsolationMode;
  backend: ExecutionBackend | null;
  engine: "docker" | "podman" | null;
  engineTarget: string | null;
  image: string | null;
  user: string | null;
  tools: {
    shell: string | null;
    base64: string | null;
    tar: string | null;
    python: string | null;
    node: string | null;
    xlsxModule: string | null;
  };
}

export class SandboxRuntimeConfigurationError extends Error {
  readonly code = "sandbox_runtime_configuration_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "SandboxRuntimeConfigurationError";
  }
}

function absoluteTool(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim() || fallback;
  if (!value.startsWith("/") || value.includes("\0")) {
    throw new SandboxRuntimeConfigurationError(
      `${name} must be an absolute NUL-free path inside the immutable sandbox image.`,
    );
  }
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new SandboxRuntimeConfigurationError(
      `${name} must be a positive integer no larger than ${max}.`,
    );
  }
  return value;
}

export function sandboxIsolationMode(env: NodeJS.ProcessEnv = process.env): SandboxIsolationMode {
  const raw = env.LIOS_EXECUTION_ISOLATION?.trim().toLowerCase();
  if (!raw || raw === "legacy-host") return "legacy-host";
  if (raw === "strict") return "strict";
  throw new SandboxRuntimeConfigurationError(
    "LIOS_EXECUTION_ISOLATION must be legacy-host or strict.",
  );
}

export function effectiveSandboxIsolationMode(
  explicit: SandboxIsolationMode | undefined,
  env: NodeJS.ProcessEnv = process.env,
): SandboxIsolationMode {
  const configured = sandboxIsolationMode(env);
  if (configured === "strict") return "strict";
  return explicit ?? configured;
}

export function resolveSandboxRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
): SandboxRuntimeProfile {
  const mode = sandboxIsolationMode(env);
  if (mode === "legacy-host") {
    return Object.freeze({
      mode,
      backend: null,
      engine: null,
      engineTarget: null,
      image: null,
      user: null,
      tools: Object.freeze({
        shell: null,
        base64: null,
        tar: null,
        python: null,
        node: null,
        xlsxModule: null,
      }),
    });
  }

  const rawEngine = env.LIOS_EXECUTION_SANDBOX_ENGINE?.trim().toLowerCase();
  if (rawEngine !== "docker" && rawEngine !== "podman") {
    throw new SandboxRuntimeConfigurationError(
      "Strict isolation requires LIOS_EXECUTION_SANDBOX_ENGINE=docker or podman.",
    );
  }
  const engineTarget = env.LIOS_EXECUTION_SANDBOX_TARGET?.trim();
  if (!engineTarget) {
    throw new SandboxRuntimeConfigurationError(
      "Strict isolation requires LIOS_EXECUTION_SANDBOX_TARGET with an explicit local Unix socket or Windows named-pipe engine endpoint.",
    );
  }
  const image = env.LIOS_EXECUTION_SANDBOX_IMAGE?.trim();
  if (!image) {
    throw new SandboxRuntimeConfigurationError(
      "Strict isolation requires LIOS_EXECUTION_SANDBOX_IMAGE with an immutable sha256 digest.",
    );
  }
  const user = env.LIOS_EXECUTION_SANDBOX_USER?.trim() || "10001:10001";
  const shell = absoluteTool(env, "LIOS_EXECUTION_SANDBOX_SHELL", "/bin/sh");
  const base64 = absoluteTool(env, "LIOS_EXECUTION_SANDBOX_BASE64", "/usr/bin/base64");
  const tar = absoluteTool(env, "LIOS_EXECUTION_SANDBOX_TAR", "/bin/tar");
  const python = absoluteTool(env, "LIOS_EXECUTION_SANDBOX_PYTHON", "/usr/bin/python3");
  const node = absoluteTool(env, "LIOS_EXECUTION_SANDBOX_NODE", "/usr/bin/node");
  const xlsxModule = absoluteTool(
    env,
    "LIOS_EXECUTION_SANDBOX_XLSX",
    "/opt/lios/node_modules/xlsx",
  );
  const maxMemoryBytes = positiveInteger(
    env,
    "LIOS_EXECUTION_SANDBOX_MAX_MEMORY_BYTES",
    2 * 1024 * 1024 * 1024,
    16 * 1024 * 1024 * 1024,
  );
  const maxProcesses = positiveInteger(
    env,
    "LIOS_EXECUTION_SANDBOX_MAX_PROCESSES",
    128,
    1024,
  );
  const workspaceTmpfsBytes = positiveInteger(
    env,
    "LIOS_EXECUTION_SANDBOX_WORKSPACE_BYTES",
    128 * 1024 * 1024,
    128 * 1024 * 1024,
  );

  let backend: ExecutionBackend;
  try {
    backend = createContainerExecutionBackend({
      engine: rawEngine,
      engineTarget,
      image,
      user,
      maxMemoryBytes,
      maxProcesses,
      workspaceBridge: {
        shellPath: shell,
        base64Path: base64,
        tarPath: tar,
        tmpfsBytes: workspaceTmpfsBytes,
      },
    });
  } catch (error) {
    throw new SandboxRuntimeConfigurationError(
      error instanceof Error ? error.message : "Invalid strict sandbox runtime configuration.",
    );
  }

  return Object.freeze({
    mode,
    backend,
    engine: rawEngine,
    engineTarget,
    image,
    user,
    tools: Object.freeze({
      shell,
      base64,
      tar,
      python,
      node,
      xlsxModule,
    }),
  });
}

export function requireStrictSandboxRuntime(
  env: NodeJS.ProcessEnv = process.env,
): SandboxRuntimeProfile & { mode: "strict"; backend: ExecutionBackend } {
  const profile = resolveSandboxRuntimeProfile(env);
  if (profile.mode !== "strict" || !profile.backend) {
    throw new SandboxRuntimeConfigurationError(
      "Strict sandbox runtime is not enabled.",
    );
  }
  return profile as SandboxRuntimeProfile & { mode: "strict"; backend: ExecutionBackend };
}
