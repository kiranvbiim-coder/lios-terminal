import {
  installManagedRuntime,
  managedRuntimePythonPath,
  readManagedRuntimeState,
  rollbackManagedRuntime,
  type ManagedRuntimeInstallOptions,
  type ManagedRuntimeOperationResult,
  type ManagedRuntimeState,
  type StrictProvisioningAuthority,
} from "./pythonRuntimeManager";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

export type ManagedRuntimeUpgradeStatus = "already_current" | "upgraded" | "rollback_restored";

export type ManagedRuntimeUpgradeErrorCode =
  | "runtime_not_installed"
  | "invalid_manifest_version"
  | "downgrade_refused"
  | "strict_provisioning_authority_missing"
  | "upgrade_in_progress"
  | "rollback_failed";

export class ManagedRuntimeUpgradeError extends Error {
  constructor(readonly code: ManagedRuntimeUpgradeErrorCode) {
    super(
      code === "runtime_not_installed"
        ? "Managed runtime is not installed; use normal provisioning before upgrade."
        : code === "invalid_manifest_version"
          ? "Managed runtime manifest version is invalid and cannot be upgraded safely."
          : code === "downgrade_refused"
            ? "Managed runtime downgrade is refused by the safe-upgrade authority."
            : code === "strict_provisioning_authority_missing"
              ? "Safe managed-runtime upgrade requires a governed strict provisioning authority."
              : code === "upgrade_in_progress"
                ? "A managed runtime upgrade is already in progress."
                : "Managed runtime candidate failed validation and the previous runtime could not be restored.",
    );
    this.name = "ManagedRuntimeUpgradeError";
  }
}

export interface ManagedRuntimeUpgradeOptions {
  strictProvisioningAuthority?: StrictProvisioningAuthority;
}

export interface ManagedRuntimeUpgradeResult {
  status: ManagedRuntimeUpgradeStatus;
  state: ManagedRuntimeState;
  previousManifestVersion: string;
  targetManifestVersion: string;
  detail: string;
}

/** @internal Test seam; product callers should not override canonical runtime authorities. */
export interface ManagedRuntimeUpgradeDependencies {
  targetManifestVersion?: string;
  readState?: () => ManagedRuntimeState | null;
  installRuntime?: (
    packIds: string[],
    selectedReleasePackIds: string[],
    options: ManagedRuntimeInstallOptions,
  ) => Promise<ManagedRuntimeOperationResult>;
  rollbackRuntime?: () => Promise<ManagedRuntimeOperationResult>;
  validateActivatedRuntime?: (state: ManagedRuntimeState) => Promise<boolean> | boolean;
  currentPythonPath?: () => string | null;
}

let upgradeInProgress = false;

function parseNumericManifestVersion(version: string): number[] | null {
  const value = version.trim();
  if (!/^\d+(?:\.\d+){1,3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) return null;
  while (parts.length < 4) parts.push(0);
  return parts;
}

function compareManifestVersions(left: string, right: string): number | null {
  const a = parseNumericManifestVersion(left);
  const b = parseNumericManifestVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * A rollback result is not evidence of recovery unless both the returned
 * state and the independently reread on-disk state agree with the original
 * runtime's version, selections and verification evidence. A new installedAt
 * time and a new rollbackPath are expected after the directory swap.
 */
function sameRestoredRuntime(actual: ManagedRuntimeState | null, original: ManagedRuntimeState): boolean {
  return actual !== null
    && actual.manifestVersion === original.manifestVersion
    && actual.runtimePath === original.runtimePath
    && sameStringSet(actual.selectedPackIds, original.selectedPackIds)
    && sameStringSet(actual.selectedReleasePackIds, original.selectedReleasePackIds)
    && sameStringSet(actual.installedSpecs, original.installedSpecs)
    && actual.hashVerified === original.hashVerified
    && actual.verificationWarnings.length === original.verificationWarnings.length
    && actual.verificationWarnings.every((warning, index) => warning === original.verificationWarnings[index]);
}

function defaultActivatedRuntimeValidator(
  candidate: ManagedRuntimeState,
  expected: ManagedRuntimeState,
  targetManifestVersion: string,
  readState: () => ManagedRuntimeState | null,
  currentPythonPath: () => string | null,
): boolean {
  const persisted = readState();
  return candidate.manifestVersion === targetManifestVersion
    && candidate.hashVerified === true
    && candidate.verificationWarnings.length === 0
    && sameStringSet(candidate.selectedPackIds, expected.selectedPackIds)
    && sameStringSet(candidate.selectedReleasePackIds, expected.selectedReleasePackIds)
    && persisted?.manifestVersion === targetManifestVersion
    && persisted.hashVerified === true
    && persisted.verificationWarnings.length === 0
    && sameStringSet(persisted.selectedPackIds, expected.selectedPackIds)
    && sameStringSet(persisted.selectedReleasePackIds, expected.selectedReleasePackIds)
    && currentPythonPath() !== null;
}

/**
 * Upgrade an already-installed LiOS managed runtime through the canonical
 * side-by-side installer. The old runtime remains the rollback target until
 * the newly activated candidate passes post-activation health validation.
 */
export async function upgradeManagedRuntimeSafely(
  options: ManagedRuntimeUpgradeOptions = {},
  dependencies: ManagedRuntimeUpgradeDependencies = {},
): Promise<ManagedRuntimeUpgradeResult> {
  if (upgradeInProgress) throw new ManagedRuntimeUpgradeError("upgrade_in_progress");

  const readState = dependencies.readState ?? readManagedRuntimeState;
  const current = readState();
  if (!current) throw new ManagedRuntimeUpgradeError("runtime_not_installed");

  const targetManifestVersion = dependencies.targetManifestVersion ?? MANAGED_RUNTIME_MANIFEST.manifestVersion;
  const comparison = compareManifestVersions(current.manifestVersion, targetManifestVersion);
  if (comparison === null) throw new ManagedRuntimeUpgradeError("invalid_manifest_version");
  if (comparison > 0) throw new ManagedRuntimeUpgradeError("downgrade_refused");
  if (comparison === 0) {
    return {
      status: "already_current",
      state: current,
      previousManifestVersion: current.manifestVersion,
      targetManifestVersion,
      detail: "Managed runtime already matches the bundled manifest version; no upgrade was attempted.",
    };
  }

  if (!options.strictProvisioningAuthority) {
    throw new ManagedRuntimeUpgradeError("strict_provisioning_authority_missing");
  }

  const installRuntime = dependencies.installRuntime ?? installManagedRuntime;
  const rollbackRuntime = dependencies.rollbackRuntime ?? rollbackManagedRuntime;
  const currentPythonPath = dependencies.currentPythonPath ?? managedRuntimePythonPath;
  const validateActivatedRuntime = dependencies.validateActivatedRuntime;

  upgradeInProgress = true;
  try {
    const operation = await installRuntime(
      [...current.selectedPackIds],
      [...current.selectedReleasePackIds],
      {
        isolationMode: "strict",
        requireVerified: true,
        strictProvisioningAuthority: options.strictProvisioningAuthority,
      },
    );

    let healthy = false;
    try {
      healthy = validateActivatedRuntime
        ? await validateActivatedRuntime(operation.state)
        : defaultActivatedRuntimeValidator(operation.state, current, targetManifestVersion, readState, currentPythonPath);
    } catch {
      healthy = false;
    }

    if (!healthy) {
      try {
        const restored = await rollbackRuntime();
        // A successful return from the rollback function does not prove that
        // the original runtime was restored. Check the operation result AND
        // canonical persisted state; otherwise preserve the hard failure.
        if (!sameRestoredRuntime(restored.state, current) || !sameRestoredRuntime(readState(), current)) {
          throw new ManagedRuntimeUpgradeError("rollback_failed");
        }
        return {
          status: "rollback_restored",
          state: restored.state,
          previousManifestVersion: current.manifestVersion,
          targetManifestVersion,
          detail: "Managed runtime candidate failed post-activation health validation; the previous runtime was restored.",
        };
      } catch {
        throw new ManagedRuntimeUpgradeError("rollback_failed");
      }
    }

    return {
      status: "upgraded",
      state: operation.state,
      previousManifestVersion: current.manifestVersion,
      targetManifestVersion,
      detail: "Managed runtime upgraded through verified side-by-side provisioning and passed post-activation health validation.",
    };
  } finally {
    upgradeInProgress = false;
  }
}
