import { createHash } from "node:crypto";
import { runCommand } from "./exec/run-command";
import { pythonRuntimeEnvOverlay } from "./exec/env";
import fs from "node:fs";
import path from "node:path";
import { MANAGED_RUNTIME_MANIFEST, type ManagedRuntimeManifest } from "./runtimeManifest";
import { dataRoot } from "./dataRoot";
import { effectiveSandboxIsolationMode } from "./exec/sandbox-runtime-profile";
import { acquireManagedRuntimeLifecycleLock } from "./managedRuntimeLifecycleLock";

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
 * Runtime state is user-owned metadata, not permission to write elsewhere.
 * In particular, refuse a redirected managed-state.json before activating
 * or rolling back an installation.
 */
function assertRuntimeStateStorageSafe(): void {
  const root = fs.lstatSync(runtimeRoot(), { throwIfNoEntry: false });
  if (root && (!root.isDirectory() || root.isSymbolicLink())) {
    throw new Error("Managed runtime storage root is unsafe.");
  }
  const state = fs.lstatSync(statePath(), { throwIfNoEntry: false });
  if (state && (!state.isFile() || state.isSymbolicLink())) {
    throw new Error("Managed runtime saved state path is unsafe.");
  }
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

/** Refuse symlinked or non-directory active runtimes before recording state. */
function validateCurrentRuntimeDirectory(currentPath: string): boolean {
  const current = fs.lstatSync(currentPath, { throwIfNoEntry: false });
  if (!current) return false;
  if (!current.isDirectory() || current.isSymbolicLink()) {
    throw new Error("Managed runtime current directory is unavailable or unsafe for installation.");
  }
  const snapshot = fs.lstatSync(runtimeStateSnapshotPath(currentPath), { throwIfNoEntry: false });
  if (snapshot && (!snapshot.isFile() || snapshot.isSymbolicLink())) {
    throw new Error("Managed runtime current snapshot path is unsafe for installation.");
  }
  return true;
}

/** Never rename over a pre-existing rollback, staging, or dangling symlink. */
function unoccupiedRuntimePath(root: string, prefix: "rollback" | "install"): string {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const name = prefix === "install"
      ? `install-${process.pid}-${Date.now() + attempt}`
      : `rollback-${Date.now() + attempt}`;
    const candidate = path.join(root, name);
    if (!fs.lstatSync(candidate, { throwIfNoEntry: false })) return candidate;
  }
  throw new Error("No unused managed runtime destination is available.");
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
  if (resourcesBase) {
    const nativeLock = path.join(resourcesBase, "native-runtime-dist", "locks", `${packId}.lock.txt`);
    if (fs.existsSync(nativeLock)) return nativeLock;
  }
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

/** Read-only approval custody. No executable is launched and no files are created. */
export function inspectManagedRuntimeCustody(packIds: readonly string[]) {
  const packs = resolveSelectedPacks(MANAGED_RUNTIME_MANIFEST, [...packIds]);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const fileHash = (file: string): string | null => {
    const entry = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!entry) return null;
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Runtime custody requires regular, non-symlink metadata and release locks.");
    return hash(fs.readFileSync(file, "utf8"));
  };
  assertRuntimeStateStorageSafe();
  validateCurrentRuntimeDirectory(path.join(runtimeRoot(), "current"));
  const state = readManagedRuntimeState();
  const previousPath = authorizedRollbackPath(state?.rollbackPath);
  const rollbackSnapshotHash = previousPath ? fileHash(runtimeStateSnapshotPath(previousPath)) : null;
  const sourceStateHash = hash(JSON.stringify({
    stateHash: fileHash(statePath()),
    currentSnapshotHash: fileHash(runtimeStateSnapshotPath(path.join(runtimeRoot(), "current"))),
    rollbackPath: previousPath, rollbackSnapshotHash,
    pythonAvailable: managedRuntimePythonPath() !== null,
  }));
  const targetManifestHash = hash(JSON.stringify(MANAGED_RUNTIME_MANIFEST));
  const releaseLocks = packs.map((pack) => ({ packId: pack.id, sha256: fileHash(packLockPath(pack.id)) }));
  const custodyHash = hash(JSON.stringify({ sourceStateHash, targetManifestHash, releaseLocks }));
  return {
    sourceStateHash, targetManifestHash, releaseLocks, custodyHash,
    rollbackAvailable: previousPath !== null && rollbackSnapshotHash !== null,
    supportedPlatform: MANAGED_RUNTIME_MANIFEST.supportedPlatforms.includes(`${process.platform}-${process.arch}`),
  };
}

function assertExpectedRuntimeCustody(packIds: readonly string[], expected?: string): void {
  if (expected && inspectManagedRuntimeCustody(packIds).custodyHash !== expected) {
    throw new Error("Runtime approval is stale; inspect and confirm the current operation again.");
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
  /** Exact preview custody, rechecked while holding the canonical writer lock. */
  expectedCustodyHash?: string;
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
  assertRuntimeStateStorageSafe();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  assertRuntimeStateStorageSafe();
  const releaseLifecycleLock = acquireManagedRuntimeLifecycleLock(root);
  try {
  assertExpectedRuntimeCustody(resolvedPackIds, options.expectedCustodyHash);
  const currentPath = path.join(root, "current");
  const currentExists = validateCurrentRuntimeDirectory(currentPath);
  const temporaryPath = unoccupiedRuntimePath(root, "install");
  const previousPath = currentExists ? unoccupiedRuntimePath(root, "rollback") : null;
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

    const staged = fs.lstatSync(temporaryPath, { throwIfNoEntry: false });
    if (!staged?.isDirectory() || staged.isSymbolicLink()) {
      throw new Error("Managed runtime provisioning did not create a safe LiOS staging runtime.");
    }

    const verificationWarnings = auditInstalledPackages(MANAGED_RUNTIME_MANIFEST, resolvedPackIds, installedPackages);
    if (options.requireVerified && verificationWarnings.length > 0) {
      throw new ManagedRuntimeVerificationError("integrity_failed");
    }

    // Provisioning is asynchronous. Recheck the active directory and target
    // just before mutation so a replaced current symlink or occupied rollback
    // destination cannot redirect or clobber a filesystem write.
    assertRuntimeStateStorageSafe();
    const stillCurrent = validateCurrentRuntimeDirectory(currentPath);
    if (stillCurrent !== currentExists) {
      throw new Error("Managed runtime current directory changed during provisioning.");
    }
    if (previousPath) {
      if (fs.lstatSync(previousPath, { throwIfNoEntry: false })) {
        throw new Error("Managed runtime rollback destination became occupied.");
      }
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
  } finally {
    releaseLifecycleLock();
  }
}

export async function rollbackManagedRuntime(options: { expectedCustodyHash?: string; packIds?: readonly string[] } = {}): Promise<ManagedRuntimeOperationResult> {
  assertRuntimeStateStorageSafe();
  const lifecycleRoot = runtimeRoot();
  if (!fs.lstatSync(lifecycleRoot, { throwIfNoEntry: false })) {
    throw new Error("No safe managed runtime rollback is available.");
  }
  const releaseLifecycleLock = acquireManagedRuntimeLifecycleLock(lifecycleRoot);
  try {
  assertExpectedRuntimeCustody(options.packIds ?? ["core"], options.expectedCustodyHash);
  const state = readManagedRuntimeState();
  const previousPath = authorizedRollbackPath(state?.rollbackPath);
  if (!state || !previousPath) {
    throw new Error("No safe managed runtime rollback is available.");
  }
  const root = runtimeRoot();
  const currentPath = path.join(root, "current");
  const currentEntry = fs.lstatSync(currentPath, { throwIfNoEntry: false });
  if (!currentEntry?.isDirectory() || currentEntry.isSymbolicLink()) {
    throw new Error("Managed runtime current directory is unavailable or unsafe for rollback.");
  }

  // A rollback destination must never replace an existing file, directory or
  // dangling symlink. Use the same authorized rollback naming contract so the
  // just-replaced runtime remains eligible for a later deliberate rollback.
  let replacedPath: string | null = null;
  for (let n = 0; n < 1_000; n += 1) {
    const candidate = path.join(root, `rollback-${Date.now() + n}`);
    if (!fs.lstatSync(candidate, { throwIfNoEntry: false })) {
      replacedPath = candidate;
      break;
    }
  }
  if (!replacedPath) throw new Error("No free managed runtime rollback destination is available.");
  const safeReplacedPath = replacedPath;

  const rollbackSnapshotPath = runtimeStateSnapshotPath(previousPath);
  const currentSnapshotPath = runtimeStateSnapshotPath(currentPath);
  // Reject metadata symlinks before any write; folder containment alone is
  // insufficient if .lios-runtime-state.json points to a different location.
  for (const snapshot of [rollbackSnapshotPath, currentSnapshotPath]) {
    const entry = fs.lstatSync(snapshot, { throwIfNoEntry: false });
    if (entry && (!entry.isFile() || entry.isSymbolicLink())) {
      throw new Error("Managed runtime state snapshot path is unsafe for rollback.");
    }
  }
  const originalCurrentSnapshot = fs.existsSync(currentSnapshotPath)
    ? fs.readFileSync(currentSnapshotPath, "utf8") : null;
  const originalRollbackSnapshot = fs.existsSync(rollbackSnapshotPath)
    ? fs.readFileSync(rollbackSnapshotPath, "utf8") : null;
  const originalState = fs.readFileSync(statePath(), "utf8");
  const previousState = readRuntimeStateSnapshot(previousPath);
  const rollbackState: ManagedRuntimeState = previousState
    ? {
        ...previousState,
        installedAt: new Date().toISOString(),
        runtimePath: currentPath,
        rollbackPath: safeReplacedPath,
      }
    : {
        ...state,
        installedAt: new Date().toISOString(),
        runtimePath: currentPath,
        rollbackPath: safeReplacedPath,
        selectedReleasePackIds: [],
        verificationWarnings: [
          ...state.verificationWarnings,
          "Rollback runtime predates pack-state snapshots; release-pack selection metadata was reset.",
        ],
      };

  let currentMovedAside = false;
  let rollbackActivated = false;
  let stateWriteAttempted = false;
  try {
    writeRuntimeStateSnapshot(currentPath, state);
    fs.renameSync(currentPath, safeReplacedPath);
    currentMovedAside = true;
    fs.renameSync(previousPath, currentPath);
    rollbackActivated = true;
    writeRuntimeStateSnapshot(currentPath, rollbackState);
    stateWriteAttempted = true;
    fs.writeFileSync(statePath(), JSON.stringify(rollbackState, null, 2), { mode: 0o600 });
  } catch (error) {
    // On a failed second rename or metadata write, restore *both* runtime
    // directories and their prior snapshots rather than leaving no "current".
    // Keep the original failure and report any recovery failure as well.
    const recoveryErrors: unknown[] = [];
    const recover = (step: () => void) => {
      try { step(); } catch (cause) { recoveryErrors.push(cause); }
    };
    if (rollbackActivated) {
      recover(() => fs.renameSync(currentPath, previousPath));
      recover(() => {
        if (originalRollbackSnapshot === null) fs.rmSync(rollbackSnapshotPath, { force: true });
        else fs.writeFileSync(rollbackSnapshotPath, originalRollbackSnapshot, { mode: 0o600 });
      });
    }
    if (currentMovedAside) {
      recover(() => fs.renameSync(safeReplacedPath, currentPath));
    }
    recover(() => {
      if (!fs.existsSync(currentPath)) return;
      if (originalCurrentSnapshot === null) fs.rmSync(currentSnapshotPath, { force: true });
      else fs.writeFileSync(currentSnapshotPath, originalCurrentSnapshot, { mode: 0o600 });
    });
    if (stateWriteAttempted) {
      recover(() => fs.writeFileSync(statePath(), originalState, { mode: 0o600 }));
    }
    if (recoveryErrors.length) {
      throw new AggregateError([error, ...recoveryErrors], "Managed runtime rollback failed and recovery was incomplete.");
    }
    throw error;
  }
  return {
    state: rollbackState,
    detail: previousState
      ? "Managed Python runtime rolled back with its previous pack-selection state."
      : "Managed Python runtime rolled back; legacy rollback metadata was unavailable and release-pack selection was reset.",
  };
  } finally {
    releaseLifecycleLock();
  }
}
