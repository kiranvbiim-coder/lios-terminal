# LIOS-P14-04 — Packaged Runtime Pack Lifecycle Evidence

## Scope

This tranche defines the machine-readable observation that feeds the existing P14 `pack_lifecycle` evidence category. It does not create another Runtime Pack manager, installer, rollback subsystem, release workflow, evidence writer, or release authority.

Canonical owners reused:

- `src/server/p11PackManager.ts` — Runtime Pack install/activate/update/rollback/remove authority.
- `src/script/validate_p11_platform_lifecycle.ts` — source/clean-runner lifecycle fixture proving manager behavior.
- `src/shared/p14PackLifecycleEvidence.ts` — P14-04 raw packaged journey observation contract.
- `src/script/validate_p14_pack_lifecycle_evidence.ts` — read-only observation-file validation.
- `src/script/write_p14_evidence.cjs` — sole final P14 evidence writer/hash authority.
- `src/shared/p14ReleaseEvidence.ts` — P14 task/category board authority.

## Truth boundary

Public source CI can validate the observation contract and writer integration. It cannot create passed P14-04 evidence because the required journey must run inside the actual packaged LiOS desktop on a supported customer target.

The public distribution intentionally withholds privileged signed/native/SP/P14 workflows. This tranche does not recreate them. A real qualification environment must produce the observation and supporting artifacts.

## Required packaged journey

One observation covers a single Runtime Pack through the complete packaged lifecycle:

1. baseline and target pack versions are exact stable semantic versions;
2. target is strictly newer than baseline;
3. baseline and target artifact SHA-256 identities differ;
4. artifact integrity/signature verification is observed;
5. baseline install, health check, and activation are observed;
6. target install, health check, and activation are observed;
7. a representative failure is observed and retry succeeds;
8. rollback is exercised and succeeds to the baseline version;
9. pack deactivation is observed;
10. target and baseline versions are removed;
11. final inspection confirms the pack is absent.

Supported P14 packaged desktop targets mirror the current customer distribution:

- macOS (`darwin`): `arm64` or `x64`;
- Windows (`win32`): `x64` only.

Linux remains useful for source/runtime testing but is not accepted as P14 packaged desktop evidence.

## Evidence flow

Validate a raw observation read-only:

```bash
node --import tsx script/validate_p14_pack_lifecycle_evidence.ts artifacts/p14/pack-lifecycle-observation.json
```

Then use the existing canonical P14 writer, with the observation as source artifact #1 followed by the underlying packaged journey artifacts:

```bash
node script/write_p14_evidence.cjs \
  pack_lifecycle \
  artifacts/p14/pack-lifecycle-evidence.json \
  automated \
  "$RELEASE_TAG" \
  artifacts/p14/pack-lifecycle-observation.json \
  artifacts/p14/pack-install.json \
  artifacts/p14/pack-retry.json \
  artifacts/p14/pack-rollback.json \
  artifacts/p14/pack-removal.json
```

For `pack_lifecycle`, the canonical writer now validates source artifact #1 before hashing or writing. Invalid observations fail closed and must not produce a passed P14 evidence file.

## Relationship to P11

`validate_p11_platform_lifecycle.ts` already proves the manager's install → health → activate → update → rollback → deactivate → remove behavior using signed fixtures. P14-04 does not duplicate that implementation. It raises the evidence bar from source/runtime capability to a recorded real packaged journey on the supported desktop targets, including the retry/failure path required by the P14 specification.

## Acceptance boundary

A green hosted source run proves only that the contract, validators, writer integration, and regressions are portable across source CI. P14-04 is accepted only after a real packaged qualification run supplies the observation and supporting artifacts and the exact-release P14 board consumes the resulting `pack_lifecycle` evidence.

## Dependency order

PR #29 → #35 → #38 → #40 → #48 → #51 → P14-04.
