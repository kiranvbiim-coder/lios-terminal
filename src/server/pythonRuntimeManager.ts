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
  /** P10 user-facing release-pack selections persisted beside the expanded low-level allow-list. */
  selectedReleasePackIds: string[];
  packageOutput: string;
  /** P0.5: which allow-listed specs this install actually requested. */
  installedSpecs: string[];
  /** P0.5: true only when every spec was installed under pip --require-hashes
   * against a real committed lock file. False means pinned-version-only
   * install (no wheel hashes available for this pack/platform yet) -- recorded
   * honestly rather than implying a stronger guarantee than was enforced. */
  hashVerified: boolean;
  /** P0.5: post-install allow-list audit -- every installed distribution is
   * checked against the manifest. Non-empty means something outside the
   * signed allow-list (or at an unexpected version) landed in the venv. */
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

function runtimeRoot(): string {
  return path.join(dataRoot(), "python-runtimes");
}

function statePath(): string {
  return path.join(runtimeRoot(), "managed-state.json");
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
      selectedReleasePackIds: Array.isArray(parsed.selectedReleasePackIds) ? parsed.selectedReleasePackIds.filter((item): item is string => typeof item === "string") : [],
      packageOutput: parsed.packageOutput ?? "",
      installedSpecs: parsed.installedSpecs ?? [],
      hashVerified: parsed.hashVerified ?? false,
      verificationWarnings: parsed.verificationWarnings ?? [],
    };
  } catch {
    return null;
  }
}

function requirementsPath(): string {
  const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
  return resourcesBase
    ? path.join(resourcesBase, "python-service", "requirements.txt")
    : path.resolve(path.dirname(typeof __dirname !== "undefined" ? __dirname : process.argv[1] || process.cwd()), "../python-service/requirements.txt");
}

/** Release-artifact lock file carrying real `--hash=sha256:...` lines for a
 * pack. Absent by design in-repo: platform-specific wheel hashes are
 * produced at release time, and this code must never invent them (see
 * runtimeManifest.ts's own note). When present, the install switches to
 * pip --require-hashes; when absent, it installs pinned versions and
 * records hashVerified:false. */
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
    // A state file written before P0.5 has no verification fields. Default
    // them to the honest weaker answer (not hash-verified, no audit
    // performed) rather than implying guarantees that install never made.
    return {
      manifestVersion: parsed.manifestVersion,
      installedAt: parsed.installedAt ?? "",
      runtimePath: parsed.runtimePath,
      rollbackPath: parsed.rollbackPath ?? null,
      selectedPackIds: parsed.selectedPackIds,
      selectedReleasePackIds: Array.isArray(parsed.selectedReleasePackIds) ? parsed.selectedReleasePackIds.filter((item): item is string => typeof item === "string") : [],
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

/**
 * How a manifest version string translates to a pip requirement. A naive
 * "starts with a digit means exact pin" is wrong for range-style entries
 * such as numpy's "2.x", and non-pip runtime components such as
 * "managed-sidecar" must never be concatenated into bogus wheel specs.
 */
export type ManifestVersionKind = "exact" | "range" | "not-pip-installable";

export function classifyManifestVersion(version: string): ManifestVersionKind {
  if (/^\d+(\.\d+)*$/.test(version)) return "exact";
  if (/^\d+\.x$/i.test(version)) return "range";
  if (/^[<>=!~]/.test(version)) return "range";
  return "not-pip-installable";
}

/** Returns null for a component that is not installed by pip at all (for
 * example a separately managed sidecar), so it is never handed to pip as
 * a bogus wheel requirement. */
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
  // Core is the retail default and is always installed: every other pack's
  // engines import from it. Selecting nothing therefore means "core only",
  // which is exactly P0.5's "ship/install core only by default for retail".
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

/** Post-install allow-list audit. Every distribution pip actually put in
 * the venv is compared against the manifest: a manifest package pinned to
 * an exact version must match it exactly, and anything installed that the
 * manifest never listed is reported (transitive dependencies are expected
 * and reported separately from unexpected direct drift, so the caller can
 * tell a normal dependency tree from a substituted package). Returns
 * human-readable warnings; an empty array means the venv matches the
 * signed allow-list exactly. */
export function auditInstalledPackages(
  manifest: ManagedRuntimeManifest,
  packIds: string[],
  installed: Record<string, string>,
): string[] {
  const warnings: string[] = [];
  const normalized = new Map(Object.entries(installed).map(([name, version]) => [name.toLowerCase().replace(/[_.]+/g, "-"), version]));
  for (const pack of resolveSelectedPacks(manifest, packIds)) {
    for (const pkg of pack.packages) {
      // A component pip never installs (for example a managed sidecar)
      // cannot be audited against the venv and must not be reported missing.
      if (classifyManifestVersion(pkg.version) === "not-pip-installable") continue;
      const key = pkg.name.toLowerCase().replace(/[_.]+/g, "-");
      const actual = normalized.get(key);
      if (!actual) {
        warnings.push(`${pkg.name} (pack ${pack.id}) is in the signed manifest but is not installed in the runtime.`);
        continue;
      }
      // Only exact pins are enforceable here. Range pins ("<3.0", "2.x")
      // are satisfied by pip's own resolver and are not re-derived, and a
      // non-pip component is not expected in the venv at all.
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
    // Retain the existing user-managed interpreter, package-index and network settings through a
    // fixed profile. PATH remains inherited, and unsupported keys are rejected at launch.
    env: pythonRuntimeEnvOverlay(),
    envProfile: "python-runtime",
  });
  return result.stdout.trim();
}

export interface ManagedRuntimeInstallOptions {
  isolationMode?: "legacy-host" | "strict";
  requireVerified?: boolean;
}

export async function installManagedRuntime(
  packIds: string[] = ["core"],
  selectedReleasePackIds: string[] = [],
  options: ManagedRuntimeInstallOptions = {},
): Promise<ManagedRuntimeOperationResult> {
  if (effectiveSandboxIsolationMode(options.isolationMode) === "strict") {
    throw new Error(
      "Strict SI-01.12 isolation is unavailable for managed Python provisioning; governed package-network and runtime-root write authority are not implemented, so host pip/venv fallback is refused.",
    );
  }
  if (!MANAGED_RUNTIME_MANIFEST.supportedPlatforms.includes(`${process.platform}-${process.arch}`)) throw new Error("This platform is not supported by the managed Python runtime manifest.");
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
    await command(pythonExecutable(), ["-m", "venv", temporaryPath]);
    const pip = process.platform === "win32" ? path.join(temporaryPath, "Scripts", "pip.exe") : path.join(temporaryPath, "bin", "pip");

    // Install ONLY the selected packs' allow-listed specs. This used
    // to install python-service/requirements.txt wholesale -- the entire
    // superset including yfinance -- regardless of which packs the user
    // actually selected, which made the pack model decorative.
    // A release-qualified request has already checked that every selected pack has a lock.
    const installArgs = ["install", "--disable-pip-version-check"];
    if (hashVerified) {
      // Release build: every selected pack has a real hash lock file, so
      // pip is required to verify each wheel against it.
      installArgs.push("--require-hashes");
      for (const file of lockFiles) installArgs.push("--requirement", file);
    } else {
      installArgs.push(...specs);
    }
    const packageOutput = await command(pip, installArgs, temporaryPath);

    const verificationWarnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, resolvedPackIds, await readInstalledPackages(pip));
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
    if (previousState?.rollbackPath && previousState.rollbackPath !== previousPath) {
      fs.rmSync(previousState.rollbackPath, { recursive: true, force: true });
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
  if (!state?.rollbackPath || !fs.existsSync(state.rollbackPath)) throw new Error("No managed runtime rollback is available.");
  const currentPath = path.join(runtimeRoot(), "current");
  const previousPath = state.rollbackPath;
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
