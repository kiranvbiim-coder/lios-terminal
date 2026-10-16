# LIOS-P14-05 — Packaged Workspace Backup/Restore Evidence

## Scope

This tranche defines the machine-readable observation that feeds the existing P14 `workspace_restore` evidence category. It does not create another backup format, backup writer, restore engine, desktop restore worker, release workflow, evidence writer, or release authority.

Canonical owners reused:

- `src/server/backupArchive.ts` — canonical `lios-backup/1` archive creation, verification, extraction, and restore semantics.
- `src/script/desktop_restore.ts` and the existing desktop restore path — packaged restore execution authority.
- `src/shared/p14WorkspaceRestoreEvidence.ts` — P14-05 raw packaged restore observation contract.
- `src/script/validate_p14_workspace_restore_evidence.ts` — read-only observation-file validation.
- `src/script/write_p14_evidence.cjs` — sole final P14 evidence writer/hash authority.
- `src/shared/p14ReleaseEvidence.ts` — P14 task/category board authority.

The separate SI-07.12 backup/restore hardening stack (`#49 → #50 → #52 → #54 → #55`) remains the implementation-hardening owner for restore containment, staging ownership, prior-file preservation, protected Home-state admission, and atomic verified backup publication. P14-05 does not duplicate those changes. Real packaged P14-05 qualification must exercise the hardened canonical owner after that stack is accepted into the release lineage.

## Truth boundary

Public source CI can validate the observation contract, file validator, canonical writer integration, and regression behavior. It cannot manufacture passed P14-05 evidence.

A passed P14-05 record requires a real packaged LiOS desktop journey on a supported customer target using an actual encrypted canonical backup, a fresh/clean destination profile, the packaged restore mechanism, and post-restore reopen checks. The public distribution intentionally does not recreate privileged signed/native/SP/P14 qualification infrastructure.

## Required packaged journey

One observation records one complete backup → clean-profile restore → reopen journey:

1. create a canonical `lios-backup/1` archive using the existing backup owner;
2. require the archive to be encrypted for P14 portability/private-state qualification;
3. record the archive SHA-256 identity;
4. verify the archive and its manifest before restore;
5. confirm preflight digests match the verified archive contents;
6. establish a clean destination profile/Home rather than restoring over the source profile;
7. run the packaged restore mechanism successfully;
8. record observed table, row, and file restoration counts;
9. reopen at least one Project and one Session from the restored Home;
10. verify restored Artifact integrity;
11. verify end-to-end workspace continuity after reopen.

The observation fails closed if any required boolean is false, the archive hash is malformed, the backup format is not `lios-backup/1`, the archive is not encrypted, the clean-profile boundary is absent, no preflight table was observed, source evidence is empty/duplicated, or the packaged target is unsupported.

Supported P14 packaged desktop targets mirror the current customer distribution:

- macOS (`darwin`): `arm64` or `x64`;
- Windows (`win32`): `x64` only.

Linux remains useful for source regression validation but is not accepted as packaged P14-05 customer evidence.

## Evidence flow

Validate the raw observation read-only:

```bash
node --import tsx script/validate_p14_workspace_restore_evidence.ts \
  artifacts/p14/workspace-restore-observation.json
```

Then call the existing canonical P14 writer with the observation as source artifact #1 and every support artifact named by `sourceEvidence`:

```bash
node script/write_p14_evidence.cjs \
  workspace_restore \
  artifacts/p14/workspace-restore-evidence.json \
  automated \
  "$RELEASE_TAG" \
  artifacts/p14/workspace-restore-observation.json \
  artifacts/p14/backup-create.json \
  artifacts/p14/restore-worker.json \
  artifacts/p14/reopen-walkthrough.json
```

For `workspace_restore`, the canonical writer validates source artifact #1 before hashing or writing. It also requires every support artifact named by the validated observation to be supplied and hashed into the final evidence record. Missing named support fails closed and produces no passed P14 evidence file.

`sourceEvidence` identifiers are unique artifact basenames only. Path-like aliases, `.`/`..`, slash/backslash-qualified names, duplicate identifiers, and duplicate supplied support basenames are rejected rather than normalized to a different artifact identity.

The same support-binding rule now applies to the existing observation-backed `update_rollback` and `pack_lifecycle` categories, closing the earlier possibility of validating an observation while omitting one of its named underlying support artifacts from the final hash bundle.

## Relationship to SI-07.12

Source-level backup and restore tests already exercise archive cryptography, manifest SHA verification, path containment, clean staging ownership, logical database import, file restoration, credential migration, and preservation of replaced files. The SI-07.12 stack further hardens those owners against unsafe filesystem state and publication races.

P14-05 does not claim those source tests are a packaged acceptance result. It raises the release evidence boundary to one recorded real customer-style restore journey through the packaged product and proves the resulting Project/Session/Artifact state can actually be reopened.

## TDD / regression boundary

The P14-05 raw observation tests were committed before `p14WorkspaceRestoreEvidence.ts` existed. Writer tests were added before the support-binding implementation and include a negative case where the observation names `reopen-walkthrough.json` but the writer is not given that artifact; the writer must fail and must not emit passed evidence.

A follow-on RED contract was committed before basename enforcement for an observation that names `nested/restore-worker.json` while only `restore-worker.json` is supplied. The canonical writer now rejects that alias instead of silently collapsing it with `path.basename()`.

Existing P14-03 and P14-04 writer tests were then updated to provide and assert hashes for their named support artifacts, ensuring the stronger generic writer rule does not silently weaken those prior tranches.

## Acceptance boundary

A green exact-head hosted source run proves only source-contract portability and regression safety. P14-05 is accepted only after a real packaged qualification environment supplies the raw observation and support artifacts, the canonical writer binds them into final evidence for the exact release tag, and the P14 board consumes that evidence.

## Dependency order

Release-evidence stack: `#29 → #35 → #38 → #40 → #48 → #51 → #53 → P14-05`.

Backup/restore implementation hardening remains a separate convergence prerequisite: `#49 → #50 → #52 → #54 → #55`.
