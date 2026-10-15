import assert from "node:assert/strict";
import test from "node:test";
import { planManagedRuntimeRepair } from "./doctorRepairPlan";
import type { ManagedRuntimeReadiness } from "./provisioningReadiness";

function readiness(overrides: Partial<ManagedRuntimeReadiness> = {}): ManagedRuntimeReadiness {
  return {
    state: "ready",
    ready: true,
    repairAction: "none",
    requiredPackIds: ["core"],
    missingPackIds: [],
    reasons: [],
    ...overrides,
  };
}

test("SI-07 Doctor repair planner emits no mutation for a healthy managed runtime", () => {
  const plan = planManagedRuntimeRepair(readiness(), { isolationMode: "strict" });
  assert.deepEqual(plan, {
    schemaVersion: "1",
    component: "managed_runtime",
    state: "ready",
    isolationMode: "strict",
    severity: "info",
    action: "none",
    futureAutomaticCandidate: false,
    executionStatus: "not_required",
    executionBlocker: null,
    requiresConfirmation: false,
    summary: "Managed runtime is healthy; no repair is required.",
    reasons: [],
    affectedPackIds: [],
  });
});

test("SI-07 Doctor repair planner maps missing runtime to install but blocks strict execution truthfully", () => {
  const plan = planManagedRuntimeRepair(readiness({
    state: "missing",
    ready: false,
    repairAction: "install",
    missingPackIds: ["core"],
    reasons: ["Managed runtime is not installed."],
  }), { isolationMode: "strict" });
  assert.equal(plan.action, "install_managed_runtime");
  assert.equal(plan.severity, "warning");
  assert.equal(plan.futureAutomaticCandidate, true);
  assert.equal(plan.executionStatus, "blocked");
  assert.equal(plan.executionBlocker, "strict_provisioning_authority_missing");
  assert.equal(plan.requiresConfirmation, true);
  assert.deepEqual(plan.affectedPackIds, ["core"]);
  assert.deepEqual(plan.reasons, ["Managed runtime is not installed."]);
  assert.equal("command" in plan, false);
});

test("SI-07 Doctor repair planner reports existing legacy-host provisioning authority without executing it", () => {
  const plan = planManagedRuntimeRepair(readiness({
    state: "missing",
    ready: false,
    repairAction: "install",
    missingPackIds: ["core"],
    reasons: ["Managed runtime is not installed."],
  }), { isolationMode: "legacy-host" });
  assert.equal(plan.action, "install_managed_runtime");
  assert.equal(plan.executionStatus, "authority_available");
  assert.equal(plan.executionBlocker, null);
  assert.equal(plan.requiresConfirmation, true);
});

test("SI-07 Doctor repair planner maps integrity/corruption states to verified repair, never arbitrary shell", () => {
  for (const state of ["corrupt", "incompatible", "unverified", "integrity_failed"] as const) {
    const plan = planManagedRuntimeRepair(readiness({
      state,
      ready: false,
      repairAction: "repair",
      reasons: ["verification failed"],
    }), { isolationMode: "strict" });
    assert.equal(plan.action, "repair_managed_runtime");
    assert.equal(plan.severity, state === "integrity_failed" ? "critical" : "warning");
    assert.equal(plan.futureAutomaticCandidate, true);
    assert.equal(plan.executionStatus, "blocked");
    assert.equal(plan.executionBlocker, "strict_provisioning_authority_missing");
    assert.equal(plan.requiresConfirmation, true);
    assert.equal(JSON.stringify(plan).includes("shell"), false);
  }
});

test("SI-07 Doctor repair planner fails closed for unsupported platforms", () => {
  const plan = planManagedRuntimeRepair(readiness({
    state: "unsupported",
    ready: false,
    repairAction: "none",
    missingPackIds: ["core"],
    reasons: ["Current platform is not supported by the managed runtime manifest."],
  }), { isolationMode: "strict" });
  assert.equal(plan.action, "manual_platform_support");
  assert.equal(plan.severity, "critical");
  assert.equal(plan.futureAutomaticCandidate, false);
  assert.equal(plan.executionStatus, "manual_required");
  assert.equal(plan.executionBlocker, "unsupported_platform");
  assert.equal(plan.requiresConfirmation, false);
});
