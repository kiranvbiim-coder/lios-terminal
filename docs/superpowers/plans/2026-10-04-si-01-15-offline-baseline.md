# SI-01.15 Offline Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SI-01.15 by proving that core deterministic/local LiOS capability remains useful without any LiOS-operated runtime infrastructure and fails honestly when external providers are unavailable.

**Architecture:** Reuse Desktop Local / LiOS Home, local identity/licence, PGlite, filesystem, vault, Gateway, deterministic engines and local execution. This PR is an integration/repair workstream, not a second offline mode or new runtime.

**Tech Stack:** Existing Electron/Desktop Local stack, Home providers, deterministic engines, Gateway, execution/journal, backup/restore.

**Spec:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` SI-01.15 and SP-01, `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md`.

## Global Constraints
- No vendor customer-runtime dependency may be introduced.
- External data/AI may be unavailable; deterministic/local features must remain truthful and usable where inputs exist.
- Do not fake provider results or silently substitute unavailable data.
- Risk R2 unless shared-core security/runtime code changes; then R3. V0/V1 and relevant V2; V3 deferred to SP-01.

## Review Focus
- first-run/startup with vendor/customer-runtime network unavailable;
- local sign-in/licence/trial behavior without remote runtime dependency;
- deterministic local analysis with user/local inputs while AI/web/data providers are offline;
- explicit unavailable state for provider-dependent functions;
- persistence/restart/backup/restore continue to work offline.

---

### Task 1: Offline dependency inventory
- [x] Enumerate SP-01 runtime dependencies against existing Home/provider authorities and classify required local, deterministic local, provider-dependent and optional local capability.
- [x] Add regression tests proving the active Desktop Local profile is user-operated/zero-vendor-runtime and offline egress blocks remote provider transport before I/O.

### Task 2: Deterministic/local journey proof
- [x] Extend the authenticated live V2 journey to prove local sign-in, Project creation, Project Chat creation/persistence and deterministic personal-finance execution using only local/user-owned state.
- [x] Prove provider connectivity is not required for the deterministic personal-finance calculator; remote/provider capability remains a separate dependency rather than an implicit fallback.

### Task 3: Honest unavailable states
- [x] Prove remote provider utility calls fail with explicit offline egress denial before transport.
- [x] Prove an authenticated market-data scope with no selected connectors returns no quote rather than fabricating one; cached/user-authorized data remains governed by existing provenance/as-of rules.

### Task 4: Restart/restore continuity
- [x] Add `test:si01-offline` requiring offline contracts plus existing session-restoration, encrypted execution-journal, backup archive and backup-service integration suites; wire it into the existing SP-01 quality gate with `LIOS_EGRESS_MODE=offline`.
- [x] Add a machine-readable live V2 evidence contract and `acceptance:si01-offline-v2`; the live harness explicitly records restart/backup restore as unavailable rather than fabricating a single-process pass.
- [x] Execute V1/typecheck on the current real checkout: `npm run test:si01-offline` passed 44/44 and `npm run check` passed (macOS arm64).
- [x] Execute authenticated live V2 against a source-mode Desktop Local Home with `LIOS_EGRESS_MODE=offline`: all 5 required checks passed; the optional single-process restart/restore check correctly remains unavailable. Machine-readable evidence was emitted; packaged proof remains separate.
- [ ] Execute the authenticated live V2 against packaged Desktop Local and attach packaged evidence.
- [ ] Complete the final app-restart/backup-restore journey in SP-01 V3.
