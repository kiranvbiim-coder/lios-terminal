import type { SandboxIsolationMode } from "./exec/sandbox-runtime-profile";
import type { ManagedRuntimeReadiness, ManagedRuntimeReadinessState } from "./provisioningReadiness";

export type DoctorRepairSeverity = "info" | "warning" | "critical";
export type DoctorRepairAction =
  | "none"
  | "install_managed_runtime"
  | "repair_managed_runtime"
  | "manual_platform_support";
export type DoctorRepairExecutionStatus =
  | "not_required"
  | "authority_available"
  | "blocked"
  | "manual_required";
export type DoctorRepairExecutionBlocker =
  | "strict_provisioning_authority_missing"
  | "unsupported_platform"
  | null;

export interface DoctorRepairPlanningContext {
  isolationMode: SandboxIsolationMode;
}

export interface DoctorRepairPlan {
  schemaVersion: "1";
  component: "managed_runtime";
  state: ManagedRuntimeReadinessState;
  isolationMode: SandboxIsolationMode;
  severity: DoctorRepairSeverity;
  action: DoctorRepairAction;
  /** True means the action is suitable for a future governed executor, not that it is executable now. */
  futureAutomaticCandidate: boolean;
  executionStatus: DoctorRepairExecutionStatus;
  executionBlocker: DoctorRepairExecutionBlocker;
  requiresConfirmation: boolean;
  summary: string;
  reasons: readonly string[];
  affectedPackIds: readonly string[];
}

function severityFor(state: ManagedRuntimeReadinessState): DoctorRepairSeverity {
  if (state === "ready") return "info";
  if (state === "unsupported" || state === "integrity_failed") return "critical";
  return "warning";
}

function affectedPackIds(readiness: ManagedRuntimeReadiness): readonly string[] {
  if (readiness.missingPackIds.length > 0) return Object.freeze([...readiness.missingPackIds]);
  if (readiness.state === "ready") return Object.freeze([]);
  return Object.freeze([...readiness.requiredPackIds]);
}

/**
 * SI-07.06/07: deterministic, read-only repair planning over the existing
 * provisioning readiness authority. This function never executes commands,
 * mutates runtime state, downloads artifacts, or invents shell instructions.
 *
 * The existing managed-runtime installer can provision through the legacy-host
 * path, but deliberately refuses strict SI-01.12 isolation until governed
 * package-network and runtime-root write authority exists. The plan therefore
 * reports that boundary explicitly instead of implying a repair is executable.
 */
export function planManagedRuntimeRepair(
  readiness: ManagedRuntimeReadiness,
  context: DoctorRepairPlanningContext,
): DoctorRepairPlan {
  if (readiness.state === "ready") {
    return Object.freeze({
      schemaVersion: "1",
      component: "managed_runtime",
      state: readiness.state,
      isolationMode: context.isolationMode,
      severity: "info",
      action: "none",
      futureAutomaticCandidate: false,
      executionStatus: "not_required",
      executionBlocker: null,
      requiresConfirmation: false,
      summary: "Managed runtime is healthy; no repair is required.",
      reasons: Object.freeze([...readiness.reasons]),
      affectedPackIds: Object.freeze([]),
    });
  }

  if (readiness.state === "unsupported") {
    return Object.freeze({
      schemaVersion: "1",
      component: "managed_runtime",
      state: readiness.state,
      isolationMode: context.isolationMode,
      severity: "critical",
      action: "manual_platform_support",
      futureAutomaticCandidate: false,
      executionStatus: "manual_required",
      executionBlocker: "unsupported_platform",
      requiresConfirmation: false,
      summary: "Managed runtime cannot be repaired automatically on this unsupported platform.",
      reasons: Object.freeze([...readiness.reasons]),
      affectedPackIds: affectedPackIds(readiness),
    });
  }

  const action: DoctorRepairAction = readiness.repairAction === "install"
    ? "install_managed_runtime"
    : "repair_managed_runtime";
  const summary = action === "install_managed_runtime"
    ? "Managed runtime installation is required."
    : "Managed runtime verification or repair is required.";
  const strictBlocked = context.isolationMode === "strict";

  return Object.freeze({
    schemaVersion: "1",
    component: "managed_runtime",
    state: readiness.state,
    isolationMode: context.isolationMode,
    severity: severityFor(readiness.state),
    action,
    futureAutomaticCandidate: true,
    executionStatus: strictBlocked ? "blocked" : "authority_available",
    executionBlocker: strictBlocked ? "strict_provisioning_authority_missing" : null,
    requiresConfirmation: true,
    summary,
    reasons: Object.freeze([...readiness.reasons]),
    affectedPackIds: affectedPackIds(readiness),
  });
}
