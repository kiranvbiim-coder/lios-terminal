# Governed Doctor Repair Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the existing Doctor managed-runtime repair plan only after explicit confirmation, a fresh readiness check, and through the existing managed-runtime provisioning authority.

**Architecture:** Doctor remains a read-only planner. A new server-side executor re-reads canonical runtime state immediately before mutation, recomputes the repair decision, refuses healthy/unsupported/blocked states, preserves existing release-pack selection metadata, and delegates the actual lifecycle operation to `installManagedRuntime`. Strict execution is possible only when a governed `StrictProvisioningAuthority` is explicitly composed.

**Tech Stack:** TypeScript, Node.js 22, Node test runner, existing `doctorRepairPlan`, `provisioningReadiness`, and `pythonRuntimeManager` owners.

**Spec:** PR #11 repair-planning truth boundary plus PR #29 governed strict provisioning authority.

## Global Constraints

- No Doctor plan supplied by a client is trusted as execution authority; readiness is recomputed at execution time.
- Explicit confirmation is mandatory for every install/repair mutation.
- Doctor/planner never receives shell, argv, cwd, environment, or filesystem mutation authority.
- Strict mode fails closed without an explicitly composed governed provisioning authority.
- Repair states requiring verified artifacts pass `requireVerified: true` to `installManagedRuntime`.
- Existing selected release-pack metadata is preserved across repair.
- Unsupported and healthy states never mutate runtime state.

## Review Focus

- Stale plan / state changes between display and confirmation must not cause obsolete mutation.
- Confirmation false or missing must refuse before install.
- Strict mode without authority must remain blocked.
- Unverified/corrupt/incompatible/integrity-failed repairs must force verified artifacts.
- Existing release-pack selection metadata must survive repair.

---

### Task 1: Make repair planning truthful when strict authority is explicitly available

**Files:**
- Modify: `src/server/doctorRepairPlan.ts`
- Modify: `src/server/doctorRepairPlan.test.ts`

**Interfaces:**
- `DoctorRepairPlanningContext` gains optional `strictProvisioningAuthorityAvailable`.
- Omitted value preserves current fail-closed Doctor behavior.

- [ ] Write RED test: strict mode + explicit authority availability yields `authority_available` and no blocker.
- [ ] Verify RED.
- [ ] Implement minimal planner context change.
- [ ] Verify GREEN.

### Task 2: Add fresh-state confirmed repair executor

**Files:**
- Create: `src/server/doctorRepairExecutor.ts`
- Create: `src/server/doctorRepairExecutor.test.ts`

**Interfaces:**
- `executeManagedRuntimeRepair({ confirmed, isolationMode, strictProvisioningAuthority? }, dependencies?)`.
- Production dependencies read canonical managed-runtime state/Python availability and call canonical `installManagedRuntime`.

- [ ] Write RED tests for confirmation refusal, healthy/unsupported refusal, strict missing-authority refusal, strict install delegation, verified repair, and release-pack metadata preservation.
- [ ] Verify RED.
- [ ] Implement minimal executor.
- [ ] Verify focused GREEN.
- [ ] Run exact-head Linux/macOS/Windows hosted source validation.
- [ ] Keep PR stacked on PR #29 until dependencies land; no merge or main retarget without reconciliation.
