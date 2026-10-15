# SI-07.11 — Governed Local Data Migration

## Scope

This is the first bounded SI-07.11 tranche. It governs relocation of the existing LiOS Home/data root without creating another copy engine, database migrator, restore engine, or workspace owner.

The existing GM-03 data-root authority remains canonical.

## Reused authorities

- `src/dataRootCore.cjs`
  - data-root resolution
  - root marker and known-root ledger
  - verified whole-tree copy
  - SHA-256/size verification
  - activation pointer
  - legacy workspace folding
- `src/main.cjs`
  - trusted Electron main-process IPC boundary
  - local-server shutdown before filesystem maintenance
  - desktop relaunch after the move
- existing backup/restore worker remains separate and unchanged

## Governed migration contract

`migrateDataRootSafely(...)` performs policy/orchestration only:

1. Resolve and prepare the current canonical data root.
2. Return `already_current` when the requested absolute target is already active.
3. Refuse a move while `LIOS_DATA_ROOT` or `LIMURIA_DATA_DIR` controls resolution, because the persisted activation pointer cannot supersede that external authority.
4. Refuse overlapping migrations in the same process.
5. Delegate all copying and whole-tree integrity verification to canonical `moveDataRoot(...)`.
6. After activation, re-run canonical data-root preparation and verify that:
   - the requested target is the active pointer-selected root;
   - the previous and new root markers exist;
   - both markers retain the same `rootId`.
7. Run an optional post-activation validator when supplied.
8. On successful validation, return `migrated`.
9. On validation failure, re-select the previous verified root through GM-03 only:
   - previous pointer-selected root → canonical `restoreDataRootPointer(...)`;
   - previous default root → canonical `clearDataRootPointer(...)`.
10. Verify that rollback actually restored the previous root and return `rollback_restored`.
11. If the previous root can no longer be selected, fail explicitly with `rollback_failed`.

## Data-safety invariants

- The original source is never deleted by migration.
- Copy and integrity verification stay inside `moveDataRoot(...)`.
- A failed pre-activation copy removes only the incomplete target, using the existing GM-03 behavior.
- A verified target is retained if later post-activation validation requires pointer rollback; this tranche does not invent an independent deletion authority.
- Pointer JSON is never written by the orchestration module. GM-03 owns all pointer mutation.
- Desktop migration remains behind the trusted Electron main-process IPC boundary.

## Tests

Source contracts cover:

- successful verified relocation while preserving the source;
- truthful already-current no-op;
- refusal under environment root overrides;
- post-activation rollback to a previously pointer-selected root;
- overlapping migration refusal;
- explicit rollback failure when the previous verified root becomes unavailable;
- desktop `limuria:move-data-folder` delegation to the governed authority instead of raw `moveDataRoot(...)`.

## Explicitly deferred

This tranche does not implement:

- database schema migrations;
- Artifact schema/version migrations;
- donor-version migrations;
- backup/restore qualification;
- packaged cross-version migration qualification across macOS, Windows, and Linux.

Those remain subsequent SI-07.11 / SI-07.12 / SP-07 / P14 work as applicable.

## Qualification boundary

Source-level behavior is qualified by the repository's hosted Linux/macOS/Windows validation. Native packaged cross-version migration and recovery must not be claimed until the dedicated SP-07/P14 packaged-target qualification is executed.
