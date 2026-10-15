import path from "node:path";
import { runCommand, type CommandInput, type CommandResult } from "./exec/run-command";
import { pythonRuntimeEnvOverlay } from "./exec/env";
import type {
  StrictProvisioningAuthority,
  StrictProvisioningRequest,
  StrictProvisioningResult,
} from "./pythonRuntimeManager";

const PROVISIONING_TIMEOUT_MS = 15 * 60 * 1_000;
const PROVISIONING_MAX_OUTPUT_CHARS = 2 * 1024 * 1024;

export type StrictProvisioningRequestErrorCode =
  | "staging_path_outside_runtime_root"
  | "invalid_staging_path"
  | "invalid_package_spec"
  | "invalid_release_lock"
  | "verified_artifacts_required"
  | "invalid_package_inventory";

export class StrictProvisioningRequestError extends Error {
  constructor(readonly code: StrictProvisioningRequestErrorCode) {
    super(code);
    this.name = "StrictProvisioningRequestError";
  }
}

export type StrictProvisioningCommandRunner = (input: CommandInput) => Promise<CommandResult>;

export interface StrictProvisioningAuthorityOptions {
  /** Canonical LiOS-managed runtime root. Provisioning may write only to one generated staging child. */
  runtimeRoot: string;
  /** Internal dependency injection for tests/composition; repair callers never receive this surface. */
  run?: StrictProvisioningCommandRunner;
  /** Server-owned Python executable selected by the managed-runtime owner. */
  pythonExecutable?: string;
  platform?: NodeJS.Platform;
}

function validatedStagingPath(runtimeRoot: string, candidate: string): string {
  const root = path.resolve(runtimeRoot);
  const staging = path.resolve(candidate);
  const relative = path.relative(root, staging);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new StrictProvisioningRequestError("staging_path_outside_runtime_root");
  }
  if (relative.includes(path.sep) || !/^install-\d+-\d+$/.test(relative)) {
    throw new StrictProvisioningRequestError("invalid_staging_path");
  }
  return staging;
}

function validatedPackageSpecs(specs: readonly string[]): string[] {
  return specs.map((spec) => {
    const value = spec.trim();
    if (!value || value.startsWith("-") || /[\r\n\0]/.test(value)) {
      throw new StrictProvisioningRequestError("invalid_package_spec");
    }
    return value;
  });
}

function validatedLockFiles(files: readonly string[]): string[] {
  return files.map((file) => {
    const value = file.trim();
    if (!value || /[\r\n\0]/.test(value)) {
      throw new StrictProvisioningRequestError("invalid_release_lock");
    }
    return value;
  });
}

function parseInstalledPackages(raw: string): Record<string, string> {
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    throw new StrictProvisioningRequestError("invalid_package_inventory");
  }
  if (!Array.isArray(rows)) throw new StrictProvisioningRequestError("invalid_package_inventory");
  const installed: Record<string, string> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new StrictProvisioningRequestError("invalid_package_inventory");
    const { name, version } = row as { name?: unknown; version?: unknown };
    if (typeof name !== "string" || !name.trim() || typeof version !== "string" || !version.trim()) {
      throw new StrictProvisioningRequestError("invalid_package_inventory");
    }
    installed[name] = version;
  }
  return installed;
}

function provisioningCommand(
  run: StrictProvisioningCommandRunner,
  argv: string[],
  cwd?: string,
): Promise<CommandResult> {
  return run({
    argv,
    cwd,
    timeoutMs: PROVISIONING_TIMEOUT_MS,
    maxOutputChars: PROVISIONING_MAX_OUTPUT_CHARS,
    env: pythonRuntimeEnvOverlay(),
    envProfile: "python-runtime",
  });
}

/**
 * Closed SI-07 provisioning capability. The caller supplies semantic managed-runtime inputs only;
 * argv/cwd/environment are derived here and cannot be selected by Doctor or a repair executor.
 */
export function createStrictProvisioningAuthority(
  options: StrictProvisioningAuthorityOptions,
): StrictProvisioningAuthority {
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const platform = options.platform ?? process.platform;
  const pythonExecutable = options.pythonExecutable?.trim() || (platform === "win32" ? "python" : "python3");
  const run = options.run ?? runCommand;

  return Object.freeze({
    async provisionManagedRuntime(request: StrictProvisioningRequest): Promise<StrictProvisioningResult> {
      const runtimePath = validatedStagingPath(runtimeRoot, request.runtimePath);
      const packageSpecs = validatedPackageSpecs(request.packageSpecs);
      const lockFiles = validatedLockFiles(request.lockFiles);
      if (request.requireVerified && !request.hashVerified) {
        throw new StrictProvisioningRequestError("verified_artifacts_required");
      }
      if (request.hashVerified && lockFiles.length === 0) {
        throw new StrictProvisioningRequestError("invalid_release_lock");
      }

      await provisioningCommand(run, [pythonExecutable, "-m", "venv", runtimePath]);
      const pip = platform === "win32"
        ? path.join(runtimePath, "Scripts", "pip.exe")
        : path.join(runtimePath, "bin", "pip");
      const installArgs = ["install", "--disable-pip-version-check"];
      if (request.hashVerified) {
        installArgs.push("--require-hashes");
        for (const file of lockFiles) installArgs.push("--requirement", file);
      } else {
        installArgs.push(...packageSpecs);
      }
      const install = await provisioningCommand(run, [pip, ...installArgs], runtimePath);
      const inventory = await provisioningCommand(
        run,
        [pip, "list", "--format=json", "--disable-pip-version-check"],
      );
      return {
        packageOutput: install.stdout.trim(),
        installedPackages: parseInstalledPackages(inventory.stdout),
      };
    },
  });
}
