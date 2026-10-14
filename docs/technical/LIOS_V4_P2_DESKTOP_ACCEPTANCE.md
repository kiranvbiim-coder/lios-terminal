# LiOS V4 — P2 Native Desktop & Release Artifact Qualification

> **Current deployment contract:** Desktop Local / LiOS Home owns identity through `/api/auth/*`, local trial state or imported vendor-signed licence verification, and one auth stack/web bundle. No vendor customer runtime, billing service, control-plane URL or separate client-terminal build is required.

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07 and SP-01–SP-07. S0–S10 are validation journeys; CP phases are historical. P7/P10 support qualification and P14 remains final release authority. Existing GM/TC/CA/P owners remain singular; privileged interactive `exec.*` stays blocked pending proven GM-11 authority. `V4-*`/`LV4-*` are frozen legacy evidence IDs, not new task numbering.

> Phase objective: prove that the downloadable customer desktop is self-contained, uses native secret protection, and can be signed/notarized/installed/recovered on each supported public platform.  
> Machine-readable status: `GET /api/operations/desktop-acceptance`  
> CI accounting contract: `npm run acceptance:desktop`

## Status semantics

- **[x] Recorded source baseline** — source/CI contract recorded by the legacy ledger; not a fresh check or exact-release qualification.
- **[~] External qualification pending** — the release path is implemented, but a real signed artifact/platform run is still required.
- **[!] External blocker** — a production credential, prior signed version, public update feed, or assistive-technology run is required and cannot be fabricated in source.
- The formal P2 exit remains: signed artifacts plus install/update/recovery evidence on every supported public platform.

## Initial public desktop targets

- macOS Apple Silicon (arm64).
- Windows x64.
- The managed runtime may support additional development/runtime architectures, but P2 public release evidence is scoped to the two targets above until separate signed install evidence is added.

## Native secret custody

- [x] Packaged desktop uses Electron `safeStorage` for the local vault master secret.
- [x] Native custody logic is isolated in `desktopSecretCustody.cjs`.
- [x] New keys are encrypted, persisted with restrictive file permissions where supported, decrypted, and round-trip verified before being accepted.
- [x] Existing protected keys are decrypted and validated.
- [x] Environment override, development fallback and native-unavailable states are distinct and are never mislabeled as native protection.
- [x] Packaged runtime exposes only the custody mode/timestamp to Operations; no secret value is exposed.
- [~] macOS signed artifact must prove native protection through the packaged self-test.
- [~] Windows signed artifact must prove native protection through the packaged self-test.

## Self-contained deterministic Python runtime

- [x] Added a frozen sidecar entrypoint for the deterministic Python analytics service.
- [x] PyInstaller is pinned in `python-service/build-requirements.txt`.
- [x] `npm run python:sidecar:build` builds a platform-native onedir executable containing the Python interpreter and dependencies.
- [x] Signed desktop requires the managed platform-native frozen sidecar; customer system Python is not a release fallback. Development Python does not qualify a public package.
- [x] Signed desktop preflight refuses to continue unless the platform sidecar has been built.
- [x] Signed desktop packaging refuses to continue if the frozen sidecar is missing.
- [x] The frozen sidecar is included in Electron `extraResources`.
- [x] `npm run python:sidecar:verify` launches the packaged executable directly, without system Python, and verifies FastAPI/Uvicorn/NumPy/SciPy/statsmodels/pandas/QuantLib health.
- [~] Each signed platform artifact must retain successful sidecar evidence from its release runner and clean-install runner.

## Packaged desktop self-test

- [x] Customer app supports `--desktop-self-test`.
- [x] Self-test qualifies the single packaged LiOS Home runtime baseline; no embedded vendor URL or second auth audience is a product prerequisite.
- [x] Self-test requires native secret protection; fallback/env override does not pass.
- [x] Self-test verifies the packaged Node backend exists.
- [x] Self-test verifies the frozen Python sidecar exists and passes its health probe.
- [x] Self-test verifies updater metadata exists.
- [x] Self-test writes local workspace data, backs it up, deliberately changes it, restores it, and checks byte-for-byte recovery.
- [x] Self-test returns machine-readable JSON and non-zero exit status on failure.

## macOS release qualification

- [x] Customer distribution build forces code signing.
- [x] Hardened Runtime remains enabled.
- [x] Entitlements and inherited entitlements are packaged.
- [x] Production workflow requires Developer ID signing configuration.
- [x] Production workflow requires notarization credentials.
- [x] Workflow verifies `codesign --verify --deep --strict --verbose=2` before and after the installed self-test invokes real Python diagnostics. Python source trees must remain unchanged; bytecode/cache writes are disabled, and post-launch ad-hoc re-signing cannot qualify the artifact.
- [x] Workflow verifies Gatekeeper execution assessment.
- [x] Workflow verifies notarization staple and DMG install assessment.
- [x] Workflow builds and verifies the frozen Python sidecar.
- [x] Workflow runs the packaged desktop self-test before publishing.
- [x] Published DMG is handed to a separate GitHub-hosted `macos-15` job.
- [x] Clean-machine job downloads the published DMG, verifies checksum/Gatekeeper, copies the app to a fresh location, and runs the installed self-test.
- [~] Real Developer ID/notarization execution remains blocked until approved Apple credentials are available and the production workflow is run on an exact release tag.
- Production build runs on approved self-hosted macOS arm64 infrastructure; the separate hosted `macos-15` clean-install job is not interchangeable build evidence.

## Windows release qualification

- [x] Customer distribution build forces code signing.
- [x] Workflow requires the Windows signing certificate/password.
- [x] Workflow verifies installer Authenticode status.
- [x] Workflow verifies the bundled Python sidecar Authenticode status.
- [x] Workflow runs the unpacked packaged desktop self-test before publishing.
- [x] Published installer is handed to a separate clean `windows-latest` job.
- [x] Clean-machine job verifies checksum/Authenticode, performs a silent install, finds the installed app, verifies the installed sidecar signature, and runs the installed self-test.
- [~] Real Authenticode execution remains blocked until the approved Windows signing certificate is configured and the workflow is run on an exact release tag.

## Install, upgrade, update, rollback and recovery

- [x] Workspace backup/restore uses hash manifests and staged rollback.
- [x] Desktop updater requires HTTPS, rejects malformed/local feeds, disables downgrades and keeps signed-update behavior under tests.
- [x] Clean-install acceptance is automated for both platforms once signed artifacts exist.
- [x] Recovery is exercised inside every packaged self-test.
- [!] A real update/upgrade/rollback exercise requires two signed versions plus the production HTTPS update feed.
- [~] macOS previous-version → current-version update/rollback evidence pending.
- [~] Windows previous-version → current-version update/rollback evidence pending.

## Accessibility and keyboard

- [x] Existing semantic/keyboard contracts remain represented in V4-28.
- [x] `npm run acceptance:accessibility` protects visible focus indicators, reduced-motion handling, Omnibox keyboard/dialog semantics, and accessible names/states on core dock/workspace/tab controls.
- [x] Target-platform execution procedure is versioned in `docs/technical/LIOS_V4_P2_ACCESSIBILITY_RUNBOOK.md`.
- [x] P2 acceptance ledger has separate macOS and Windows assistive-technology rows so they cannot be silently omitted.
- [!] VoiceOver acceptance requires a signed macOS build and target-platform run.
- [!] Narrator acceptance requires a signed Windows build and target-platform run.
- [~] Keyboard-only navigation and focus-order acceptance must be retained with those platform runs.

## Central visibility and CI

- [x] `GET /api/operations/desktop-acceptance` exposes the redacted P2 ledger.
- [x] Operations Readiness panel displays P2 rows under V4-28/V4-29.
- [x] `npm run acceptance:desktop` requires all P2 rows/categories, blockers and next actions.
- [x] Authoritative Quality Gate runs the P2 accounting validator and desktop accessibility source contract.
- [x] No P2 row becomes verified merely because a workflow exists.

## Formal P2 exit

P2's legacy source accounting is not SI completion or shipping acceptance. It is **release-qualified** only after the external rows are supplied with dated evidence from real signed artifacts:

1. macOS Developer ID + notarization evidence;
2. Windows Authenticode evidence;
3. clean-machine macOS install self-test;
4. clean-machine Windows install self-test;
5. signed update/upgrade/rollback evidence on macOS;
6. signed update/upgrade/rollback evidence on Windows;
7. VoiceOver + keyboard acceptance;
8. Narrator + keyboard acceptance.

Those artifacts/credentials are intentionally not fabricated or committed.

SP acceptance additionally requires a defined real Minimum Shippable Journey, packaged/target execution, explicit unavailable/denied/error states rather than fake success, regression protection for accepted behavior, and exact commit/build/tag, target/topology, checks/outcomes, limitations and truth level. No SP is accepted by this ledger alone. Self-test safety ceilings (20 s ready, 60 s whole test, 1 GiB main RSS, 512 MiB heap) are not interactive performance proof or independent security review.
