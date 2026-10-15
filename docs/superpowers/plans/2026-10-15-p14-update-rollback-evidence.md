# LIOS-P14-03 — Packaged Update, Migration, Rollback and Recovery Evidence

## Scope

This tranche defines and validates the machine-readable observation that feeds the existing P14 `update_rollback` evidence category. It does **not** create another updater, release pipeline, evidence writer, signer, installer, migration authority or rollback subsystem.

Canonical owners reused:

- `src/desktopUpdater.cjs` — packaged update trust/download/install policy.
- `src/shared/p14UpdateRollbackEvidence.ts` — raw P14-03 journey observation contract.
- `src/script/validate_p14_update_rollback_evidence.ts` — read-only validation of a supplied observation JSON file.
- `src/script/write_p14_evidence.cjs` — sole final P14 evidence writer/hash authority; for `update_rollback` it now refuses to write unless the first source artifact passes the P14-03 validator.
- `src/shared/p14ReleaseEvidence.ts` — final P14 category/task board authority.
- `src/script/validate_p14_desktop_acceptance.ts` — final P14 board validation.

## Truth boundary

Source CI can validate this contract but cannot manufacture a passed P14-03 journey. The observation must come from an actual signed/package qualification environment that exercised the relevant application packages and user state.

A valid observation proves that the supplied record is complete and internally consistent. It does not, by itself, prove code signing, notarization, update transport, clean-machine installation, or authenticity of external artifacts. Final P14 evidence must hash the observation **and the underlying source artifacts** through the existing canonical writer.

The canonical writer closes the validation bypass: for category `update_rollback`, source artifact **#1 must be the raw observation JSON**, and that observation must pass the P14-03 validator before any evidence file is written.

## Required journey

One observation records one N → N+1 packaged journey and requires:

1. exact baseline and target semantic versions;
2. different SHA-256 identities for baseline and target packages;
3. target strictly newer than baseline;
4. update download observed;
5. explicit user install/restart confirmation observed;
6. install initiation observed;
7. application restart observed;
8. running post-update version equal to the target;
9. migration actually exercised and successful;
10. user/workspace continuity verified;
11. recovery actually exercised and successful;
12. final running version consistent with the recovery outcome.

Supported packaged targets mirror current distribution truth:

- macOS (`darwin`): `arm64` or `x64`;
- Windows (`win32`): `x64` only.

Linux is not a packaged LiOS desktop distribution target for this P14 observation contract.

## Recovery outcome semantics

- `retained_target` — recovery succeeded while retaining N+1; `finalObservedVersion` must equal `targetVersion`.
- `rolled_back` — a separately qualified rollback/reinstall/recovery mechanism restored N; `finalObservedVersion` must equal `baselineVersion`.

`rolled_back` must **not** be interpreted as evidence that `electron-updater` performed an automatic downgrade. The current desktop updater explicitly refuses downgrades. A rollback claim therefore requires evidence from a separately qualified recovery/reinstall mechanism until a real previous-version rollback authority exists.

## Observation validation

From `src/` after dependencies are installed:

```bash
node --import tsx script/validate_p14_update_rollback_evidence.ts artifacts/p14/update-rollback-observation.json
```

The validator is read-only. It does not rewrite the observation, create hashes, or emit final P14 evidence.

## Final P14 evidence

The raw observation must be the first source artifact passed to the canonical writer. Add every material underlying source artifact after it:

```bash
node script/write_p14_evidence.cjs \
  update_rollback \
  artifacts/p14/update-rollback-evidence.json \
  automated \
  "$RELEASE_TAG" \
  artifacts/p14/update-rollback-observation.json \
  artifacts/p14/signed-update-journey.json \
  artifacts/p14/workspace-continuity.json \
  artifacts/p14/recovery-journey.json
```

For `update_rollback`, `write_p14_evidence.cjs` validates the first source artifact before hashing or writing. If validation fails, no passed final evidence file is emitted.

The exact artifact names may differ by qualification environment. The invariant does not: final evidence hashes the observation plus the material proof needed to support it.

## Source observation shape

```json
{
  "schemaVersion": "1",
  "category": "update_rollback",
  "platform": "darwin",
  "arch": "arm64",
  "baselineVersion": "N.N.N",
  "targetVersion": "N.N.N",
  "baselinePackageSha256": "<64 lowercase hex characters>",
  "targetPackageSha256": "<64 lowercase hex characters>",
  "updateDownloaded": true,
  "explicitInstallConfirmed": true,
  "installInitiated": true,
  "restartObserved": true,
  "postUpdateVersion": "N.N.N",
  "migrationExercised": true,
  "migrationSucceeded": true,
  "continuityVerified": true,
  "recoveryExercised": true,
  "recoverySucceeded": true,
  "recoveryOutcome": "retained_target",
  "finalObservedVersion": "N.N.N",
  "observedAt": "<ISO timestamp>",
  "sourceEvidence": [
    "signed-update-journey.json",
    "workspace-continuity.json",
    "recovery-journey.json"
  ]
}
```

Placeholders describe the shape only; they are not release evidence. Real qualification must use exact observed versions, package digests, timestamps and source-artifact identifiers.

## TDD evidence

RED was observed before each behavior was implemented:

- the raw observation validator was absent (`ERR_MODULE_NOT_FOUND`);
- the release-facing file validator was absent (`ERR_MODULE_NOT_FOUND`);
- the initial validator accepted fictitious `win32 + arm64` evidence;
- the canonical P14 writer accepted an invalid `update_rollback` observation and wrote a passed evidence file.

Focused GREEN evidence was then observed for observation/file validation and Windows target restriction. The canonical writer integration is additionally covered by `write_p14_update_rollback_evidence.test.cjs`; exact-head hosted Linux/macOS/Windows source validation is the final source-regression gate.

Real LIOS-P14-03 acceptance still requires signed/package execution outside source CI.

## Dependency order

PR #29 → PR #35 → PR #38 → PR #40 → PR #48 → P14-03.
