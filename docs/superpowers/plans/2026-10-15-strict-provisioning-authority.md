# Strict Provisioning Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a governed strict provisioning authority so `pythonRuntimeManager` can stage approved managed-runtime installs without falling back to arbitrary host shell execution.

**Architecture:** Keep Doctor read-only and keep `pythonRuntimeManager` as the lifecycle/activation owner. Introduce one narrow authority that can only create the LiOS-managed venv and install the already-resolved allow-listed pack inputs into a staging directory under the LiOS runtime root; it cannot accept arbitrary argv, cwd, environment, or activation paths. `pythonRuntimeManager` continues to verify installed packages and owns atomic activation/rollback.

**Tech Stack:** TypeScript, Node.js 22, existing `runCommand` execution path, Node test runner.

**Spec:** PR #11 truth boundary: governed strict provisioning authority must exist before repair execution and must not use an ungoverned host pip/venv fallback.

## Global Constraints

- Doctor remains read-only and emits no commands.
- Strict provisioning accepts only LiOS-generated staging paths beneath the managed runtime root.
- No arbitrary shell string, argv, cwd, or caller-supplied environment surface.
- Managed-runtime activation and rollback remain in `pythonRuntimeManager`.
- Existing `requireVerified` release-artifact and post-install integrity checks remain authoritative.
- Legacy-host behavior remains unchanged.

## Review Focus

- Path traversal or sibling-prefix staging paths must be rejected before process execution.
- Strict mode without an authority must continue to fail closed.
- Strict mode with an authority must delegate provisioning without invoking the legacy host provisioning path.
- Verification-required installs must still reject absent release wheel-hash locks before provisioning begins.
- Authority failure must leave the current managed runtime untouched and remove staging state through the existing rollback path.

---

### Task 1: Define and enforce the strict provisioning authority contract

**Files:**
- Create: `src/server/strictProvisioningAuthority.ts`
- Create: `src/server/strictProvisioningAuthority.test.ts`

**Interfaces:**
- Produces: `StrictProvisioningAuthority`, `StrictProvisioningRequest`, and `createStrictProvisioningAuthority()`.
- The request contains only the managed runtime root, LiOS-generated staging directory, selected package specs/hash-lock files, and verification mode.

- [ ] **Step 1: Write failing tests** for rejecting staging outside the runtime root, rejecting non-`install-*` staging names, and proving callers cannot supply arbitrary command/cwd/env fields.
- [ ] **Step 2: Run the focused test and verify RED.**
- [ ] **Step 3: Implement the minimal authority** using the existing command runner behind a closed, server-owned operation surface.
- [ ] **Step 4: Run the focused test and verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 2: Integrate strict authority into managed runtime installation

**Files:**
- Modify: `src/server/pythonRuntimeManager.ts`
- Modify: `src/server/pythonRuntimeManager.test.ts`

**Interfaces:**
- Consumes: `StrictProvisioningAuthority.provision(request)` from Task 1.
- Produces: `ManagedRuntimeInstallOptions.strictProvisioningAuthority` for explicit injection and the production default strict authority when strict mode is active.

- [ ] **Step 1: Write failing tests** showing strict mode no longer takes the legacy command path when an authority is supplied, strict mode still fails closed when authority is unavailable, and `requireVerified` rejects before provisioning.
- [ ] **Step 2: Run focused tests and verify RED.**
- [ ] **Step 3: Implement the minimal integration**, preserving package audit, state writing, atomic activation and rollback.
- [ ] **Step 4: Run focused tests and verify GREEN.**
- [ ] **Step 5: Run `npm run test:p10`, `npm run check`, then full `npm run test:offline` through hosted source CI.**
- [ ] **Step 6: Commit and open a draft stacked PR targeting `si07/doctor-repair-plan`.**
