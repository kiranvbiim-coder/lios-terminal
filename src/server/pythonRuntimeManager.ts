import { runCommand } from "./exec/run-command";
import { pythonRuntimeEnvOverlay } from "./exec/env";
import fs from "node:fs";
import path from "node:path";
import { MANAGED_RUNTIME_MANIFEST, type ManagedRuntimeManifest } from "./runtimeManifest";
import { dataRoot } from "./dataRoot";
import { effectiveSandboxIsolationMode } from "./exec/sandbox-runtime-profile";

const INSTALL_TIMEOUT_MS = 15 * 60 * 1_000;
const RUNTIME_STATE_SNAPSHOT = ".lios-runtime-state.json";

export interface ManagedRuntimeState {
  manifestVersion: string;
  installedAt: string;
  runtimePath: string;
  rollbackPath: string | null;
  selectedPackIds: string[];
  selectedReleasePackIds: string[];
  packageOutput: string;
  installedSpecs: string[];
  hashVerified: boolean;
  verificationWarnings: string[];
}

export interface ManagedRuntimeOperationResult {
  state: ManagedRuntimeState;
  detail: string;
}

export class ManagedRuntimeVerificationError extends Error {
  constructor(readonly code: "unverified_release_hashes" | "integrity_failed") {
    super(code === "unverified_release_hashes"
      ? "Platform release wheel-hash locks are missing for required managed packs."
      : "Staged managed runtime failed the manifest package verification.");
    this.name = "ManagedRuntimeVerificationError";
  }
}

export class StrictProvisioningAuthorityError extends Error {
  constructor(readonly code: "strict_provisioning_authority_missing") {
    super("Strict managed-runtime provisioning requires a governed provisioning authority; host pip/venv fallback is refused.");
    this.name = "StrictProvisioningAuthorityError";
  }
}

export interface StrictProvisioningRequest {
  /** LiOS-generated staging path. The authority must not provision outside this path. */
  runtimePath: string;
  /** Manifest-resolved low-level pack IDs, including core. */
  selectedPackIds: readonly string[];
  /** Exact/range pip requirements derived only from the signed runtime manifest. */
  packageSpecs: readonly string[];
  /** Trusted release lock files derived by LiOS for the selected packs. */
  lockFiles: readonly string[];
  /** True only when every selected pack has a release wheel-hash lock. */
  hashVerified: boolean;
  /** Whether the caller requires release-qualified verification. */
  requireVerified: boolean;
}

export interface StrictProvisioningResult {
  /** Diagnostic package-manager output produced inside the governed authority. */
  packageOutput: string;
  /** Package inventory observed by the authority after provisioning. */
  installedPackages: Record<string, string>;
}

export interface StrictProvisioningAuthority {
  provisionManagedRuntime(request: StrictProvisioningRequest): Promise<StrictProvisioningResult>;
}

function runtimeRoot(): string {
  return path.join(dataRoot(), "python-runtimes");
}

function statePath(): string {
  return path.join(runtimeRoot(), "managed-state.json");
}

/**
 * Persisted rollback metadata is not filesystem authority. Only a direct,
 * non-symlink rollback directory created by the managed-runtime lifecycle
 * can be moved or recursively deleted. Older/untrusted paths fail closed.
 */
function authorizedRollbackPath(candidate: unknown): string | null {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return null;
  const normalized = path.resolve(candidate);
  if (path.dirname(normalized) !== path.resolve(runtimeRoot())
    || !/^rollback-\d+$/.test(path.basename(normalized))) return null;
  try {
    const entry = fs.lstatSync(normalized);
    return entry.isDirectory() && !entry.isSymbolicLink() ? normalized : null;
  } catch {
    return null;
  }
}

function runtimeStateSnapshotPath(runtimePath: string): string {
  return path.join(runtimePath, RUNTIME_STATE_SNAPSHOT);
}

function writeRuntimeStateSnapshot(runtimePath: string, state: ManagedRuntimeState): void {
  fs.writeFileSync(runtimeStateSnapshotPath(runtimePath), JSON.stringify(state, null, 2), { mode: 0o600 });
}

function readRuntimeStateSnapshot(runtimePath: string): ManagedRuntimeState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(runtimeStateSnapshotPath(runtimePath), "utf8")) as Partial<ManagedRuntimeState>;
    if (!parsed.manifestVersion || !Array.isArray(parsed.selectedPackIds)) return null;
    return {
      manifestVersion: parsed.manifestVersion,
      installedAt: parsed.installedAt ?? "",
      runtimePath,
      rollbackPath: parsed.rollbackPath ?? null,
      selectedPackIds: parsed.selectedPackIds,
      selectedReleasePackIds: Array.isArray(parsed.selectedReleasePackIds)
        ? parsed.selectedReleasePackIds.filter((item): item is string => typeof item === "string")
        : [],
      packageOutput: parsed.packageOutput ?? "",
      installedSpecs: parsed.installedSpecs ?? [],
      hashVerified: parsed.hashVerified ?? false,
      verificationWarnings: parsed.verificationWarnings ?? [],
    };
  } catch {
    return null;
  }
}

function packLockPath(packId: string): string {
  const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  const base = resourcesBase
    ? path.join(resourcesBase, "python-service", "requirements")
    : path.resolve(path.dirname(typeof __dirname !== "undefined" ? __dirname : process.argv[1] || process.cwd()), "../python-service/requirements");
  return path.join(base, `${packId}.lock.txt`);
}

function managedPythonPath(runtimePath = path.join(runtimeRoot(), "current")): string {
  return process.platform === "win32"
    ? path.join(runtimePath, "Scripts", "python.exe")
    : path.join(runtimePath, "bin", "python3");
}

export function managedRuntimePythonPath(): string | null {
  const candidate = managedPythonPath();
  return fs.existsSync(candidate) ? candidate : null;
}

export function readManagedRuntimeState(): ManagedRuntimeState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8")) as Partial<ManagedRuntimeState>;
    if (!parsed.runtimePath || !parsed.manifestVersion || !Array.isArray(parsed.selectedPackIds)) return null;
    return {
      manifestVersion: parsed.manifestVersion,
      installedAt: parsed.installedAt ?? "",
      runtimePath: parsed.runtimePath,
      rollbackPath: parsed.rollbackPath ?? null,
      selectedPackIds: parsed.selectedPackIds,
      selectedReleasePackIds: Array.isArray(parsed.selectedReleasePackIds)
        ? parsed.selectedReleasePackIds.filter((item): item is string => typeof item === "string")
        : [],
      packageOutput: parsed.packageOutput ?? "",
      installedSpecs: parsed.installedSpecs ?? [],
      hashVerified: parsed.hashVerified ?? false,
      verificationWarnings: parsed.verificationWarnings ?? [],
    };
  } catch {
    return null;
  }
}

function pythonExecutable(): string {
  const configured = process.env.PYTHON_EXECUTABLE?.trim();
  if (configured) return configured;
  return process.platform === "win32" ? "python" : "python3";
}

export type ManifestVersionKind = "exact" | "range" | "not-pip-installable";

export function classifyManifestVersion(version: string): ManifestVersionKind {
  if (/^\d+(\.\d+)*$/.test(version)) return "exact";
  if (/^\d+\.x$/i.test(version)) return "range";
  if (/^[<>=!~]/.test(version)) return "range";
  return "not-pip-installable";
}

export function packSpec(pkg: { name: string; version: string }): string | null {
  const kind = classifyManifestVersion(pkg.version);
  if (kind === "not-pip-installable") return null;
  if (kind === "exact") return `${pkg.name}==${pkg.version}`;
  const majorSeries = pkg.version.match(/^(\d+)\.x$/i);
  if (majorSeries) {
    const major = Number(majorSeries[1]);
    return `${pkg.name}>=${major},<${major + 1}`;
  }
  return `${pkg.name}${pkg.version}`;
}

export function resolveSelectedPacks(manifest: ManagedRuntimeManifest, packIds: string[]): ManagedRuntimeManifest["packs"] {
  const selected = new Set(packIds);
  selected.add("core");
  const packs = manifest.packs.filter((pack) => selected.has(pack.id));
  if (packs.length !== selected.size) throw new Error("Requested runtime pack is not present in the signed manifest.");
  return packs;
}

function selectedPackages(manifest: ManagedRuntimeManifest, packIds: string[]): string[] {
  return resolveSelectedPacks(manifest, packIds)
    .flatMap((pack) => pack.packages.map(packSpec))
    .filter((spec): spec is string => spec !== null);
}

export function auditInstalledPackages(
  manifest: ManagedRuntimeManifest,
  packIds: string[],
  installed: Record<string, string>,
): string[] {
  const warnings: string[] = [];
  const normalized = new Map(Object.entries(installed).map(([name, version]) => [name.toLowerCase().replace(/[_.]+/g, "-"), version]));
  for (const pack of resolveSelectedPacks(manifest, packIds)) {
    for (const pkg of pack.packages) {
      if (classifyManifestVersion(pkg.version) === "not-pip-installable") continue;
      const key = pkg.name.toLowerCase().replace(/[_.]+/g, "-");
      const actual = normalized.get(key);
      if (!actual) {
        warnings.push(`${pkg.name} (pack ${pack.id}) is in the signed manifest but is not installed in the runtime.`);
        continue;
      }
      if (classifyManifestVersion(pkg.version) === "exact" && actual !== pkg.version) {
        warnings.push(`${pkg.name} is pinned to ${pkg.version} in the signed manifest but ${actual} is installed.`);
      }
    }
  }
  return warnings;
}

async function readInstalledPackages(pip: string): Promise<Record<string, string>> {
  try {
    const raw = await command(pip, ["list", "--format=json", "--disable-pip-version-check"]);
    const rows = JSON.parse(raw) as Array<{ name: string; version: string }>;
    return Object.fromEntries(rows.map((row) => [row.name, row.version]));
  } catch {
    return {};
  }
}

async function command(file: string, args: string[], cwd?: string): Promise<string> {
  const result = await runCommand({
    argv: [file, ...args],
    cwd,
    timeoutMs: INSTALL_TIMEOUT_MS,
    maxOutputChars: 2 * 1024 * 1024,
    env: pythonRuntimeEnvOverlay(),
    envProfile: "python-runtime",
  });
  return result.stdout.trim();
}

export interface ManagedRuntimeInstallOptions {
  isolationMode?: "legacy-host" | "strict";
  requireVerified?: boolean;
  strictProvisioningAuthority?: StrictProvisioningAuthority;
}

export async function installManagedRuntime(
  packIds: string[] = ["core"],
  selectedReleasePackIds: string[] = [],
  options: ManagedRuntimeInstallOptions = {},
): Promise<ManagedRuntimeOperationResult> {
  const strictIsolation = effectiveSandboxIsolationMode(options.isolationMode) === "strict";
  if (strictIsolation && !options.strictProvisioningAuthority) {
    throw new StrictProvisioningAuthorityError("strict_provisioning_authority_missing");
  }
  if (!MANAGED_RUNTIME_MANIFEST.supportedPlatforms.includes(`${process.platform}-${process.arch}`)) {
    throw new Error("This platform is not supported by the managed Python runtime manifest.");
  }

  const packs = resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, packIds);
  const resolvedPackIds = packs.map((pack) => pack.id);
  const specs = selectedPackages(MANAGED_RUNTIME_MANIFEST, packIds);
  const lockFiles = resolvedPackIds.map(packLockPath).filter((file) => fs.existsSync(file));
  const hashVerified = lockFiles.length === resolvedPackIds.length && lockFiles.length > 0;
  if (options.requireVerified && !hashVerified) {
    throw new ManagedRuntimeVerificationError("unverified_release_hashes");
  }

  const root = runtimeRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(root, `install-${process.pid}-${Date.now()}`);
  const currentPath = path.join(root, "current");
  const previousPath = fs.existsSync(currentPath) ? path.join(root, `rollback-${Date.now()}`) : null;
  const previousState = readManagedRuntimeState();
  let currentMovedAside = false;
  let temporaryActivated = false;

  try {
    let packageOutput: string;
    let installedPackages: Record<string, string>;

    if (strictIsolation) {
      const result = await options.strictProvisioningAuthority!.provisionManagedRuntime({
        runtimePath: temporaryPath,
        selectedPackIds: [...resolvedPackIds],
        packageSpecs: [...specs],
        lockFiles: [...lockFiles],
        hashVerified,
        requireVerified: options.requireVerified === true,
      });
      if (!result || typeof result.packageOutput !== "string" || !result.installedPackages || typeof result.installedPackages !== "object") {
        throw new Error("Strict provisioning authority returned invalid provisioning evidence.");
      }
      packageOutput = result.packageOutput;
      installedPackages = result.installedPackages;
    } else {
      await command(pythonExecutable(), ["-m", "venv", temporaryPath]);
      const pip = process.platform === "win32"
        ? path.join(temporaryPath, "Scripts", "pip.exe")
        : path.join(temporaryPath, "bin", "pip");
      const installArgs = ["install", "--disable-pip-version-check"];
      if (hashVerified) {
        installArgs.push("--require-hashes");
        for (const file of lockFiles) installArgs.push("--requirement", file);
      } else {
        installArgs.push(...specs);
      }
      packageOutput = await command(pip, installArgs, temporaryPath);
      installedPackages = await readInstalledPackages(pip);
    }

    if (!fs.existsSync(temporaryPath)) {
      throw new Error("Managed runtime provisioning did not create the LiOS staging runtime.");
    }

    const verificationWarnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, resolvedPackIds, installedPackages);
    if (options.requireVerified && verificationWarnings.length > 0) {
      throw new ManagedRuntimeVerificationError("integrity_failed");
    }

    if (previousPath) {
      if (previousState) writeRuntimeStateSnapshot(currentPath, previousState);
      fs.renameSync(currentPath, previousPath);
      currentMovedAside = true;
    }
    fs.renameSync(temporaryPath, currentPath);
    temporaryActivated = true;

    const state: ManagedRuntimeState = {
      manifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion,
      installedAt: new Date().toISOString(),
      runtimePath: currentPath,
      rollbackPath: previousPath,
      selectedPackIds: resolvedPackIds,
      selectedReleasePackIds: [...new Set(selectedReleasePackIds)],
      packageOutput,
      installedSpecs: specs,
      hashVerified,
      verificationWarnings,
    };
    writeRuntimeStateSnapshot(currentPath, state);
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
    const obsoleteRollback = authorizedRollbackPath(previousState?.rollbackPath);
    if (obsoleteRollback && obsoleteRollback !== previousPath) {
      fs.rmSync(obsoleteRollback, { recursive: true, force: true });
    }
    const detail = verificationWarnings.length
      ? `Managed Python runtime installed with ${verificationWarnings.length} allow-list warning(s).`
      : "Managed Python runtime installed and activated.";
    return { state, detail };
  } catch (error) {
    if (temporaryActivated && fs.existsSync(currentPath)) {
      fs.rmSync(currentPath, { recursive: true, force: true });
    }
    if (currentMovedAside && previousPath && fs.existsSync(previousPath) && !fs.existsSync(currentPath)) {
      fs.renameSync(previousPath, currentPath);
    }
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

export async function rollbackManagedRuntime(): Promise<ManagedRuntimeOperationResult> {
  const state = readManagedRuntimeState();
  const previousPath = authorizedRollbackPath(state?.rollbackPath);
  if (!state || !previousPath) {
    throw new Error("No safe managed runtime rollback is available.");
  }
  const currentPath = path.join(runtimeRoot(), "current");
  // A replaced/missing current installation cannot be the source of an
  // atomic rollback; in particular do not write its snapshot via a symlink.
  const currentEntry = fs.lstatSync(currentPath, { throwIfNoEntry: false });
  if (!currentEntry?.isDirectory() || currentEntry.isSymbolicLink()) {
    throw new Error("Managed runtime current directory is unavailable or unsafe for rollback.");
  }
  const previousState = readRuntimeStateSnapshot(previousPath);
  const failedPath = path.join(runtimeRoot(), `failed-${Date.now()}`);
  if (fs.existsSync(currentPath)) writeRuntimeStateSnapshot(currentPath, state);
  fs.renameSync(currentPath, failedPath);
  fs.renameSync(previousPath, currentPath);

  const rollbackState: ManagedRuntimeState = previousState
    ? {
        ...previousState,
        installedAt: new Date().toISOString(),
        runtimePath: currentPath,
        rollbackPath: failedPath,
      }
    : {
        ...state,
        installedAt: new Date().toISOString(),
        runtimePath: currentPath,
        rollbackPath: failedPath,
        selectedReleasePackIds: [],
        verificationWarnings: [
          ...state.verificationWarnings,
          "Rollback runtime predates pack-state snapshots; release-pack selection metadata was reset.",
        ],
      };

  writeRuntimeStateSnapshot(currentPath, rollbackState);
  fs.writeFileSync(statePath(), JSON.stringify(rollbackState, null, 2), { mode: 0o600 });
  return {
    state: rollbackState,
    detail: previousState
      ? "Managed Python runtime rolled back with its previous pack-selection state."
      : "Managed Python runtime rolled back; legacy rollback metadata was unavailable and release-pack selection was reset.",
  };
}
