# SI-01.16 Zero-Setup Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SI-01.16 so a normal Desktop Local user can install/start LiOS and have required internal components provisioned, verified, activated and repaired without manual hidden setup.

**Architecture:** Reuse existing runtime-provider, packaging, sidecar, Electron and System Doctor/provisioning seams. Add one governed capability/dependency provisioning flow behind existing authorities; do not create a second package manager or capability registry.

**Tech Stack:** Electron/Node.js, existing runtime provider contracts, sidecar/runtime bootstrap, package/build scripts, checksums/signatures/provenance records.

**Spec:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` SI-01.16, `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md`, capability-assimilation rules.

## Global Constraints
- Normal users must not manually install hidden donor runtimes for SP-01-required capability.
- Heavy optional downloads require visible size/rights/consent.
- Packages/components must have pinned provenance, integrity verification and rollback/repair semantics.
- Reuse existing package/runtime/provisioning authorities; no second registry/updater.
- Risk R2/R3 depending on packaging/security changes; V0/V1 + relevant V2; packaged proof belongs to SP-01 V3.

## Review Focus
- clean machine/profile with missing internal dependencies;
- corrupt/partial download or incompatible native module;
- offline install/start with already-provisioned required components;
- insufficient disk/unsupported OS/runtime;
- rollback/repair after failed upgrade without deleting user state.

---

### Task 1: SP-01 dependency manifest
- [ ] Inventory every internal dependency required for the SP-01 journey: Electron/native PTY, server/runtime, database/storage/vault, execution backend, required Python/runtime pieces and packaged assets.
- [ ] Map each dependency to existing runtime/capability authority and provenance record.

### Task 2: Provision/verify/activate contract
- [ ] Reuse or extend the existing provisioning seam for install-present/version/integrity/health states.
- [ ] Add fail-closed integrity/version checks and explicit unsupported/unavailable states.

### Task 3: Repair/rollback
- [ ] Add or reuse atomic staging/activation and rollback for replaceable internal components.
- [ ] Preserve user data and canonical state across provisioning failure.

### Task 4: UX and consent
- [ ] Keep normal required components zero-setup.
- [ ] Require visible size/licence/consent for heavy optional downloads; no hidden network install.

### Task 5: V2 and packaged handoff
- [ ] Exercise clean-profile provisioning and repair on the self-hosted Mac.
- [ ] Leave final packaged clean-install proof to SP-01 V3 and record exact remaining packaging limitations.

## Bounded implementation and remaining qualification
- `server/sp01DependencyInventory.ts` exposes machine-readable SP-01 dependency owners, provenance pointers, verification and repair authority through Doctor and the existing setup status response. It is an inventory, not an assertion that the packaged components passed health checks.
- `POST /api/setup/python-runtime/install` keeps its existing install body/response. An authenticated admin may supply `reconcile: true` in that same endpoint for no-op/installation/repair through `managedRuntimeReconciler` and `pythonRuntimeManager`; the result includes before/after readiness. Failed attempts return bounded readiness and rollback evidence rather than raw pip output. Previously selected managed packs remain selected during repair.
- `hashVerified: false` remains unverified, even after an install succeeds. Required platform wheel-hash release locks are not present in the repository; missing/corrupt-to-*ready* evidence therefore requires real lock artifacts and a packaged target. Source-only fixtures or installed-but-unverified results do not qualify SP-01.
- Bundled native PTY, Home/renderer, database/vault and execution assets still require packaged clean-install, offline/restart and repair evidence at the SP-01 V3 boundary; this inventory does not provision application-bundle files independently.
