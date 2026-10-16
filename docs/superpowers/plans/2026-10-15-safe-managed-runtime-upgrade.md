# SI-07.10 — Safe Managed Runtime Upgrade

## Scope

This bounded tranche upgrades an already-installed LiOS managed Python runtime. It deliberately does not implement Electron/application self-update, signing, release channels, database/schema migration, Doctor repair, or a second package installer.

## Canonical authorities reused

- `MANAGED_RUNTIME_MANIFEST` remains the bundled target runtime manifest.
- `installManagedRuntime()` remains the only staging, verification, activation and pre-activation rollback authority.
- `StrictProvisioningAuthority` remains mandatory for upgrade mutation.
- `rollbackManagedRuntime()` remains the only runtime rollback authority.
- Existing managed-runtime state remains the source of installed low-level pack IDs and selected product release-pack IDs.

## Upgrade contract

`upgradeManagedRuntimeSafely()` performs the following bounded flow:

1. Refuse when no managed runtime is installed; initial provisioning belongs to SI-07.08/SI-07.09.
2. Compare the installed manifest version with the bundled target using a strict numeric manifest-version comparator.
3. Return `already_current` without mutation when versions match.
4. Refuse a target older than the installed manifest; downgrade is never inferred as an upgrade.
5. Require an explicitly composed governed `StrictProvisioningAuthority` before mutation.
6. Preserve the currently selected low-level managed pack IDs and product release-pack IDs exactly.
7. Delegate installation to `installManagedRuntime()` with `isolationMode: "strict"` and `requireVerified: true`.
8. Rely on the existing installer for side-by-side staging, package inventory verification, atomic activation and restoration if staging/activation itself fails.
9. After activation, validate the candidate against the target manifest, verified/hash-clean state, preserved pack selections, persisted state and existence of the canonical managed Python executable.
10. If post-activation validation fails or throws, invoke the existing `rollbackManagedRuntime()` authority and return `rollback_restored` only after that restoration succeeds.
11. If rollback itself fails, fail closed with `rollback_failed`; never report the candidate healthy.
12. Serialize in-process upgrade attempts with one guard so two callers cannot concurrently replace the managed runtime.

## Truthful outcomes

- `already_current`: target manifest already installed; no mutation attempted.
- `upgraded`: strict verified side-by-side upgrade activated and post-activation validation passed.
- `rollback_restored`: candidate activated but failed health validation; previous runtime restored successfully.

Errors remain errors for missing installation, malformed versions, downgrade attempts, missing strict authority, overlapping upgrades, provisioning failure, or failed restoration.

## Security and failure invariants

- No arbitrary package name, shell command, cwd, environment, runtime root, or download URL is accepted by this layer.
- No legacy-host `pip`/`venv` downgrade is permitted from the upgrade path.
- Release verification is forced for every actual upgrade.
- Existing pack selections are carried forward rather than recomputed from user input.
- An install failure before successful activation is propagated directly because `installManagedRuntime()` already owns restoration/cleanup for that phase; this layer does not create a competing rollback path.
- Candidate validator exceptions are treated as failed health, without exposing their payload as successful state.
- The in-process overlap guard is not represented as a cross-process lock; cross-process/native release qualification remains a later SP-07/P14 concern.

## Test contracts

`safeManagedRuntimeUpgrade.test.ts` covers:

- dedicated safe-upgrade authority;
- already-current no-op;
- downgrade refusal before mutation;
- exact preservation of managed/release pack selections;
- forced strict and release-verified provisioning;
- missing-authority fail-closed behavior;
- post-activation health failure and successful restoration;
- pre-activation provisioning failure without duplicate rollback;
- overlapping upgrade refusal and guard release after successful completion.

## Deferred SI-07.10 work

Desktop application self-update, code signing/notarization, release-channel selection, signed application artifact verification, restart/apply semantics and application-level rollback are separate SI-07.10 tranches because they have a different release/security authority from the managed Python runtime.
