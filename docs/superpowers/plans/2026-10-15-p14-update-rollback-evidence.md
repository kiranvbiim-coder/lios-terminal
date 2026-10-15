# LIOS-P14-03 — Packaged Update, Migration, Rollback and Recovery Evidence

## Scope

This tranche defines and validates the machine-readable observation that feeds the existing P14 `update_rollback` evidence category. It does **not** create another updater, release pipeline, evidence writer, signer, installer, migration authority or rollback subsystem.

Canonical owners reused:

- `src/desktopUpdater.cjs` — packaged update trust/download/install policy.
- `src/shared/p14UpdateRollbackEvidence.ts` — P14-03 raw journey observation contract.
- `src/script/validate_p14_update_rollback_evidence.ts` — read-only validation of a supplied observation JSON file.
- `src/script/write_p14_evidence.cjs` — sole final P14 evidence writer/hash authority.
- `src/shared/p14ReleaseEvidence.ts` — final P14 category/task board authority.
- `src/script/validate_p14_desktop_acceptance.ts` — final P14 board validation.

## Truth boundary

Source CI can validate this contract but cannot manufacture a passed P14-03 journey. The observation must come from an actual signed/package qualification environment that exercised the relevant application packages and user state.

A valid observation proves that the supplied record is complete and internally consistent. It does not, by itself, prove code signing, notarization, update transport, clean-machine installation, or the authenticity of external evidence files. Final P14 evidence must hash the observation **and the underlying source artifacts** through the existing `write_p14_evidence.cjs` writer.

## Required journey

The observation records one N → N+1 packaged journey and requires:

1. exact baseline and target semantic versions;
2. different SHA-256 identities for the baseline and target packages;
3. target version strictly newer than baseline;
4. update download observed;
5. explicit user install/restart confirmation observed;
6. install initiation observed;
7. application restart observed;
8. running post-update version equal to the target;
9. migration path actually exercised and successful;
10. user/workspace continuity verified after the update;
11. a recovery path actually exercised and successful;
12. final running version consistent with the recorded recovery outcome.

Supported target combinations mirror current desktop distribution truth:

- macOS (`darwin`): `arm64` or `x64`;
- Windows (`win32`): `x64` only.

Linux is not a packaged LiOS desktop distribution target for this P14 observation contract.

## Recovery outcome semantics

`recoveryOutcome` is intentionally narrow:

- `retained_target` — recovery succeeded while retaining N+1; `finalObservedVersion` must equal `targetVersion`.
- `rolled_back` — a separately qualified rollback/reinstall/recovery mechanism restored N; `finalObservedVersion` must equal `baselineVersion`.

`rolled_back` must **not** be interpreted as evidence that `electron-updater` supports or performed automatic downgrade/rollback. The current desktop updater explicitly refuses downgrades. Until a real previous-version rollback authority is qualified, a rollback claim must be backed by the separate recovery/reinstall mechanism and its artifacts.

## Observation file validation

From `src/` after dependencies are installed:

```bash
node --import tsx script/validate_p14_update_rollback_evidence.ts artifacts/p14/update-rollback-observation.json
```

The validator is read-only. It does not rewrite the observation, create hashes, or emit final P14 evidence.

## Final P14 evidence

After the raw observation passes validation, use the existing canonical writer. Include the observation and every material source artifact referenced by the journey so the final evidence hashes the real inputs:

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

The exact artifact names may differ by qualification environment. The rule does not: the final evidence record must hash the observation plus the underlying proof needed to support it.

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

Placeholders above describe the shape only; they are not valid release evidence. Real qualification must use the exact observed versions, package digests, timestamps and source-artifact identifiers.

## TDD evidence

RED was observed before each behavior was implemented:

- the P14-03 observation module was absent (`ERR_MODULE_NOT_FOUND`);
- the release-facing file validator module was absent (`ERR_MODULE_NOT_FOUND`);
- the first validator incorrectly accepted `win32 + arm64` before the Windows x64 target lock was added.

Focused GREEN evidence was then observed for the observation contract, file-validation behaviors, and Windows target restriction. Exact-head hosted Linux/macOS/Windows source validation remains the source-regression gate; real P14-03 acceptance still requires signed/package execution outside source CI.

## Dependency order

PR #29 → PR #35 → PR #38 → PR #40 → PR #48 → P14-03.
