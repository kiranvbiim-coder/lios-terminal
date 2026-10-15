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
  const plan = planManagedRuntimeRepair(readiness());
  assert.deepEqual(plan, {
    schemaVersion: "1",
    component: "managed_runtime",
    state: "ready",
    severity: "info",
    action: "none",
    automaticCandidate: false,
    requiresConfirmation: false,
    summary: "Managed runtime is healthy; no repair is required.",
    reasons: [],
    affectedPackIds: [],
  });
});

test("SI-07 Doctor repair planner maps missing runtime state to the existing install authority", () => {
  const plan = planManagedRuntimeRepair(readiness({
    state: "missing",
    ready: false,
    repairAction: "install",
    missingPackIds: ["core"],
    reasons: ["Managed runtime is not installed."],
  }));
  assert.equal(plan.action, "install_managed_runtime");
  assert.equal(plan.severity, "warning");
  assert.equal(plan.automaticCandidate, true);
  assert.equal(plan.requiresConfirmation, true);
  assert.deepEqual(plan.affectedPackIds, ["core"]);
  assert.deepEqual(plan.reasons, ["Managed runtime is not installed."]);
  assert.equal("command" in plan, false);
});

test("SI-07 Doctor repair planner maps integrity/corruption states to verified repair, never arbitrary shell", () => {
  for (const state of ["corrupt", "incompatible", "unverified", "integrity_failed"] as const) {
    const plan = planManagedRuntimeRepair(readiness({
      state,
      ready: false,
      repairAction: "repair",
      reasons: ["verification failed"],
    }));
    assert.equal(plan.action, "repair_managed_runtime");
    assert.equal(plan.severity, state === "integrity_failed" ? "critical" : "warning");
    assert.equal(plan.automaticCandidate, true);
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
  }));
  assert.equal(plan.action, "manual_platform_support");
  assert.equal(plan.severity, "critical");
  assert.equal(plan.automaticCandidate, false);
  assert.equal(plan.requiresConfirmation, false);
});
