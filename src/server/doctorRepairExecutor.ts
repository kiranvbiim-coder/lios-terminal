import { effectiveSandboxIsolationMode, type SandboxIsolationMode } from "./exec/sandbox-runtime-profile";
import {
  installManagedRuntime,
  managedRuntimePythonPath,
  readManagedRuntimeState,
  type ManagedRuntimeInstallOptions,
  type ManagedRuntimeOperationResult,
  type StrictProvisioningAuthority,
} from "./pythonRuntimeManager";
import {
  evaluateManagedRuntimeReadiness,
  type ManagedRuntimeReadiness,
} from "./provisioningReadiness";
import { planManagedRuntimeRepair, type DoctorRepairPlan } from "./doctorRepairPlan";

/**
 * One explicitly approved repair request. A client-supplied plan is never
 * accepted: the executor always recomputes from canonical runtime readiness.
 */
export interface DoctorRepairExecutionRequest {
  confirmed: boolean;
  isolationMode: SandboxIsolationMode;
  strictProvisioningAuthority?: StrictProvisioningAuthority;
  expectedCustodyHash?: string;
}

export interface DoctorRepairExecutionDependencies {
  readCurrentRuntimeContext(): {
    readiness: ManagedRuntimeReadiness;
    selectedReleasePackIds: readonly string[];
  };
  installManagedRuntime(
    packIds: string[],
    selectedReleasePackIds: string[],
    options: ManagedRuntimeInstallOptions,
  ): Promise<ManagedRuntimeOperationResult>;
}

export interface DoctorRepairExecutionResult {
  plan: DoctorRepairPlan;
  operation: ManagedRuntimeOperationResult;
}

export type DoctorRepairExecutionRefusalCode =
  | "confirmation_required"
  | "no_repair_required"
  | "unsupported_platform"
  | "strict_provisioning_authority_missing"
  | "repair_unavailable"
  | "repair_in_progress";

export class DoctorRepairExecutionRefusedError extends Error {
  constructor(readonly code: DoctorRepairExecutionRefusalCode) {
    super(`Managed runtime repair refused: ${code}.`);
    this.name = "DoctorRepairExecutionRefusedError";
  }
}

/** Production context is obtained immediately before any installation attempt. */
const productionDependencies: DoctorRepairExecutionDependencies = {
  readCurrentRuntimeContext() {
    const state = readManagedRuntimeState();
    return {
      readiness: evaluateManagedRuntimeReadiness({
        state,
        pythonAvailable: managedRuntimePythonPath() !== null,
        requiredPackIds: state?.selectedPackIds.length ? state.selectedPackIds : ["core"],
      }),
      // Never silently replace the existing release-pack selection with an
      // empty selection when repairing a partially broken installation.
      selectedReleasePackIds: state?.selectedReleasePackIds ?? [],
    };
  },
  installManagedRuntime,
};

/**
 * Doctor stays read-only. Only this explicitly confirmed server-side boundary
 * can call the existing managed-runtime installer. The installer retains all
 * manifest checks, strict provisioning, release-lock verification, rollback
 * and atomic activation responsibility.
 */
// Prevent overlapping in-process install/rollback transactions. The canonical
// installer remains the lifecycle authority; this gate is not a cross-process lock.
let repairInProgress = false;

export async function executeManagedRuntimeRepair(
  request: DoctorRepairExecutionRequest,
  dependencies: DoctorRepairExecutionDependencies = productionDependencies,
): Promise<DoctorRepairExecutionResult> {
  if (request.confirmed !== true) {
    throw new DoctorRepairExecutionRefusedError("confirmation_required");
  }
  if (repairInProgress) {
    throw new DoctorRepairExecutionRefusedError("repair_in_progress");
  }

  repairInProgress = true;
  try {
    // Server strict-mode policy overrides a requested legacy-host mode.
    const isolationMode = effectiveSandboxIsolationMode(request.isolationMode);
    const current = dependencies.readCurrentRuntimeContext();
    const plan = planManagedRuntimeRepair(current.readiness, {
      isolationMode,
      strictProvisioningAuthorityAvailable: Boolean(request.strictProvisioningAuthority),
    });

    if (plan.action === "none") {
      throw new DoctorRepairExecutionRefusedError("no_repair_required");
    }
    if (plan.action === "manual_platform_support") {
      throw new DoctorRepairExecutionRefusedError("unsupported_platform");
    }
    if (plan.executionStatus !== "authority_available") {
      throw new DoctorRepairExecutionRefusedError(
        plan.executionBlocker === "strict_provisioning_authority_missing"
          ? "strict_provisioning_authority_missing"
          : "repair_unavailable",
      );
    }

    const packIds = [...current.readiness.requiredPackIds];
    const selectedReleasePackIds = [...current.selectedReleasePackIds];
    const installOptions: ManagedRuntimeInstallOptions = {
      isolationMode,
      requireVerified: plan.requiresVerifiedArtifacts,
      expectedCustodyHash: request.expectedCustodyHash,
    };
    if (request.strictProvisioningAuthority) {
      installOptions.strictProvisioningAuthority = request.strictProvisioningAuthority;
    }

    const operation = await dependencies.installManagedRuntime(
      packIds, selectedReleasePackIds, installOptions,
    );
    return { plan, operation };
  } finally {
    repairInProgress = false;
  }
}
