import type { ManagedRuntimeReadiness, ManagedRuntimeReadinessState } from "./provisioningReadiness";

export type DoctorRepairSeverity = "info" | "warning" | "critical";
export type DoctorRepairAction =
  | "none"
  | "install_managed_runtime"
  | "repair_managed_runtime"
  | "manual_platform_support";

export interface DoctorRepairPlan {
  schemaVersion: "1";
  component: "managed_runtime";
  state: ManagedRuntimeReadinessState;
  severity: DoctorRepairSeverity;
  action: DoctorRepairAction;
  automaticCandidate: boolean;
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
 * A later approved executor may map these enum actions onto the existing
 * pythonRuntimeManager install/repair authority.
 */
export function planManagedRuntimeRepair(readiness: ManagedRuntimeReadiness): DoctorRepairPlan {
  if (readiness.state === "ready") {
    return Object.freeze({
      schemaVersion: "1",
      component: "managed_runtime",
      state: readiness.state,
      severity: "info",
      action: "none",
      automaticCandidate: false,
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
      severity: "critical",
      action: "manual_platform_support",
      automaticCandidate: false,
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

  return Object.freeze({
    schemaVersion: "1",
    component: "managed_runtime",
    state: readiness.state,
    severity: severityFor(readiness.state),
    action,
    automaticCandidate: true,
    requiresConfirmation: true,
    summary,
    reasons: Object.freeze([...readiness.reasons]),
    affectedPackIds: affectedPackIds(readiness),
  });
}
