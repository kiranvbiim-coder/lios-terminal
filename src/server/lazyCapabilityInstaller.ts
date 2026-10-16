import {
  installManagedRuntime,
  readManagedRuntimeState,
  managedRuntimePythonPath,
  type ManagedRuntimeInstallOptions,
  type ManagedRuntimeOperationResult,
  type ManagedRuntimeState,
} from "./pythonRuntimeManager";
import { evaluateManagedRuntimeReadiness } from "./provisioningReadiness";
import {
  expandP10RuntimePacks,
  p10RuntimePackForCapability,
  type P10RuntimePackId,
} from "./p10RuntimePacks";

export type LazyCapabilityInstallStatus =
  | "already_available"
  | "runtime_not_ready"
  | "consent_required"
  | "installed"
  | "external_setup_required"
  | "not_managed";

export interface LazyCapabilityInstallOptions {
  /** Explicit user approval for packs classified as heavyweight by the canonical P10 catalog. */
  consentToHeavyweight?: boolean;
  /** Provisioning authority and verification policy passed to the managed-runtime installer. */
  runtimeInstallOptions?: ManagedRuntimeInstallOptions;
}

export interface LazyCapabilityInstallResult {
  status: LazyCapabilityInstallStatus;
  capability: string;
  runtimePackId: P10RuntimePackId | null;
  requiredManagedPackIds: string[];
  requiresConsent: boolean;
  operation?: ManagedRuntimeOperationResult;
  detail: string;
}

type InstallRuntime = (
  packIds: string[],
  selectedReleasePackIds: string[],
  options: ManagedRuntimeInstallOptions,
) => Promise<ManagedRuntimeOperationResult>;

export interface LazyCapabilityInstallerDependencies {
  readState?: () => ManagedRuntimeState | null;
  /** Testable adapter for the canonical managed-Python executable check. */
  pythonAvailable?: () => boolean;
  installRuntime?: InstallRuntime;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Resolve a requested product capability against the canonical P10 pack catalog
 * and provision only the missing managed-runtime packs.
 *
 * This function intentionally cannot fall back to host pip/venv. Every actual
 * lazy install is forced through strict managed-runtime provisioning, so a
 * missing governed provisioning authority fails closed in installManagedRuntime.
 */
export async function ensureLazyCapability(
  capability: string,
  options: LazyCapabilityInstallOptions = {},
  dependencies: LazyCapabilityInstallerDependencies = {},
): Promise<LazyCapabilityInstallResult> {
  const normalizedCapability = capability.trim().toLowerCase();
  const runtimePack = p10RuntimePackForCapability(normalizedCapability);

  if (!runtimePack) {
    return {
      status: "not_managed",
      capability: normalizedCapability,
      runtimePackId: null,
      requiredManagedPackIds: [],
      requiresConsent: false,
      detail: "Capability is not mapped to a managed LiOS runtime pack; no package installation was attempted.",
    };
  }

  if (runtimePack.lazyInstallPolicy === "external") {
    return {
      status: "external_setup_required",
      capability: normalizedCapability,
      runtimePackId: runtimePack.id,
      requiredManagedPackIds: [],
      requiresConsent: false,
      detail: `${runtimePack.name} is user-supplied and is never downloaded silently by LiOS.`,
    };
  }

  const requiredManagedPackIds = expandP10RuntimePacks([runtimePack.id]);
  const readState = dependencies.readState ?? readManagedRuntimeState;
  const currentState = readState();
  const installed = new Set(currentState?.selectedPackIds ?? []);
  const missingManagedPackIds = requiredManagedPackIds.filter((id) => !installed.has(id));

  // Check the existing installation *before* any no-op or expansion claim.
  // A missing Python, stale manifest or unverified installed base is Doctor
  // repair work; lazy expansion must not silently overwrite that state.
  if (currentState) {
    const readiness = evaluateManagedRuntimeReadiness({
      state: currentState,
      requiredPackIds: ["core", ...currentState.selectedPackIds],
      pythonAvailable: (dependencies.pythonAvailable ?? (() => managedRuntimePythonPath() !== null))(),
    });
    if (!readiness.ready) {
      return {
        status: "runtime_not_ready",
        capability: normalizedCapability,
        runtimePackId: runtimePack.id,
        requiredManagedPackIds,
        requiresConsent: false,
        detail: `${runtimePack.name} cannot be used or expanded because managed runtime readiness is ${readiness.state}. Verify or repair it through Doctor first.`,
      };
    }
  }

  if (missingManagedPackIds.length === 0) {
    return {
      status: "already_available",
      capability: normalizedCapability,
      runtimePackId: runtimePack.id,
      requiredManagedPackIds,
      requiresConsent: false,
      detail: `${runtimePack.name} is already available in the verified managed runtime.`,
    };
  }

  const requiresConsent = runtimePack.lazyInstallPolicy === "explicit-consent";
  if (requiresConsent && options.consentToHeavyweight !== true) {
    return {
      status: "consent_required",
      capability: normalizedCapability,
      runtimePackId: runtimePack.id,
      requiredManagedPackIds,
      requiresConsent: true,
      detail: `${runtimePack.name} requires explicit user consent before its managed packages are installed.`,
    };
  }

  const targetPackIds = unique([...(currentState?.selectedPackIds ?? []), ...requiredManagedPackIds]);
  const selectedReleasePackIds = unique(currentState?.selectedReleasePackIds ?? []);
  const installRuntime = dependencies.installRuntime ?? installManagedRuntime;
  const runtimeInstallOptions: ManagedRuntimeInstallOptions = {
    ...(options.runtimeInstallOptions ?? {}),
    // Lazy expansion is not a development-time package bootstrap. Require
    // platform release hash locks even when an internal caller omits or
    // explicitly disables verification; the canonical installer fails closed
    // before staging if those release artifacts are unavailable.
    requireVerified: true,
    isolationMode: "strict",
  };
  const operation = await installRuntime(targetPackIds, selectedReleasePackIds, runtimeInstallOptions);

  return {
    status: "installed",
    capability: normalizedCapability,
    runtimePackId: runtimePack.id,
    requiredManagedPackIds,
    requiresConsent,
    operation,
    detail: `${runtimePack.name} was added through governed managed-runtime provisioning.`,
  };
}
