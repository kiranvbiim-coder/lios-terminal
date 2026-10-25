# WS-65 — Installed UX and release evidence (macOS + Windows)

**Status: ENGINEERING EVIDENCE GATE IMPLEMENTED; INSTALLED RELEASE NOT VALIDATED.** Canonical 65-WS plan PR #119, WS-65 (P0). Stack: WS-64 draft #203 → WS-65 draft. This is an evidence admission layer, not another release mechanism, provider, P4 store or parallel UI. P14 remains final release certification authority.

## Existing machinery, reused without duplication

- P14 qualification is already authoritative via `shared/p14ReleaseEvidence.ts`, its 14 typed evidence categories, 12 release tasks, and `script/validate_p14_desktop_acceptance.ts --mode=release`.
- Packaged flagship proof is already defined by `shared/flagshipReleaseEvidence.ts`, `script/validate_packaged_flagship_evidence.ts`, and `docs/technical/PACKAGED_FLAGSHIP_RELEASE_ACCEPTANCE.md`. Requires same signed Mac/Win client release, real BYOAI and user-owned source, nonfixture AI/deterministic work, reviewed Artifact/version, export, relaunch and revocation.
- Source accessibility contract `script/validate_desktop_accessibility.ts` and P2 VoiceOver/Narrator runbook exist; neither proves a real OS screen-reader walkthrough. Mac/Win clean-install automation produces only some P14 evidence categories; does not certify interactive UX.
- WS-64 tests all seven source-level scenarios via `npm run test:ws64`; installed checks and owner sign-off are absent. WS-65 uses that same seven-case gate catalogue and accepts **no scenario** from fixture testing alone.

## New WS-65 admission contract

- `src/evals/ws65InstalledUxEvidence.ts`: strictly typed complete-release report. Requires one signed/notarized macOS arm64 and one signed Windows x64 clean install, keyboard-only and VoiceOver/Narrator walkthrough, reduced motion, 200% zoom, viewport samples at 320/390/768/1440 px, all seven complete WS-64 scenario runs on **each** OS (14 installed runs), exact per-scenario gate proofs, zero unresolved critical defects, and a hashed owner signoff.
- Neither a fixture run, a service-only run nor a development-only flow may be marked passed. Scenario runs expressly deny developer intervention/simulation. Each required WS-64 gate must be present exactly once; gate evidence refers to a real named source artifact in the *same platform* run.
- Each platform supplies uniquely named and SHA-256-hashed nonempty files for installation logs, screen recordings, screen-reader trace, performance trace, source provenance, privacy/recovery evidence and any retained run receipts or exports.
- `src/evals/ws65InstalledUxValidator.ts` plus `script/validate_ws65_installed_ux.ts`: reject missing files, symlinks, tampered bytes, missing/duplicated scenes and platform roles, wrong tag/version/commit, missing or wrong SHA256 reviewer file, any missing P14 category, and P14 flagship report hash not bound to flagship evidence record. The validator reads the original **existing P14** typed reports and rebuilds the P14 board; it does not invent another certification authority.
- `src/evals/ws65InstalledUxEvidence.test.ts` plus script source wiring checks test negative controls: fake screens, missing manual gate, missing actual file, malformed filename, missing signed package, wrong OS AT, orphan proof, unapproved data, commit/version mismatches. Synthetic fixtures exist **only in unit tests**.

## Operating procedure — exact signed customer release only

1. Identify the exact signed Git commit (40-digit SHA), version and release tag before running anything. Confirm P14 macOS/Windows signing and notarization, installer SHA256, installed executable hash, OS version/architecture and human reviewer. Never substitute source HEAD or an unsigned preview as an installed release.
2. Start fresh signed macOS arm64 from notarized DMG and Windows x64 from Authenticode installer. Create a clean LiOS profile without developer tooling. Capture independent setup/install logs, product welcome screen, real first-use and customer sign-in. Do not leak user identifiers, credentials, source documents or secret hashes.
3. Repeat *all seven* WS-64 scenarios on each installed platform. Use the real Apple/Microsoft/Alphabet comparison and a reviewed WACC=9% compute; include source attribution, exact P4 revision/receipt ID, return to Chat, restart, opt-in P9 monitor. Also test non-finance work, connected source conflicts, file import with owner consent, denied cross-tenant rights, actual P4 reopen and Home interruption/Temporary Chat non-retention. Record substantive failures and stop; do not replace them with fixture snapshots.
4. Do a keyboard-only end-to-end path and native VoiceOver/Narrator path on their respective OS. Check readable focus rings, Tab/Shift+Tab/Escape/arrow keys, modal focus return, Omnibox/Work Search, Artifact and share/export confirmation, 320/390/768/1440 narrow/wide render and 200% zoom, motion reduction. Use a screen-reader trace and real navigation recording, not merely a source assertion.
5. Capture and hash CPU/memory cold/warm/large Chat/stream/search/charts/table performance trace per WS-62, denied provider/offline/reconnect/wrong account traces per WS-61/63, and all observable release workflows. Logs must be sanitized and retained in a release-owned restricted evidence directory.
6. An authorized human reviewer checks footage and provenance, resolves defects, and provides a signed-off review file (or an attested record if organization signing is available). WS-65 currently checks the signoff **file hash**, not a reviewer cryptographic identity signature; do not claim identity attestation from file hashing.
7. Complete official P14 flagship report and all 14 P14 category files separately. Bind the flagship P14 category to the exact flagship report SHA256 and require one full P14 qualification board. The authoritative `acceptance:p14:release`, packaged flagship and release workflow still must pass; WS-65 alone cannot certify a build.

## File layout and execution

Keep release-owned private evidence **outside** the source repository:

```text
private-evidence/
  macos/<hashed nonempty files: installer_log, screen_recording, screenreader_trace, performance_trace, source_provenance, privacy_recovery, ...>
  windows/<same categories; independent observations>
  p14/p14-*-evidence.json  (all fourteen original typed category records)
  flagship-release-report.json
  ws65-installed-ux-report.json
  reviewer-signoff.txt
```

For the source suite (`cd src`):

```sh
npm run test:ws64
npm run test:ws65
npm run check
npm run test:offline
```

For a **real complete witnessed** release only, supply actual files and actual target SHA:

```sh
npm run acceptance:ux:installed -- \
  --report=../private-evidence/ws65-installed-ux-report.json \
  --evidence-dir=../private-evidence \
  --flagship-report=../private-evidence/flagship-release-report.json \
  --p14-evidence-dir=../private-evidence/p14 \
  --owner-signoff=../private-evidence/reviewer-signoff.txt \
  --release-tag=v1.0.0 \
  --commit-sha=<EXACT_SIGNED_RELEASE_COMMIT>
```

Replace `v1.0.0` with the exact intended package version and actual release tag. The CLI **fails** if required arguments or files are absent. It does not auto-generate passing evidence; no synthetic specimen is provided as a completed release witness.

## Blocking limitations and follow-up

- No signed installer, installed macOS/Windows session, native VoiceOver/Narrator trace, real provider/financial data, device performance measurement, exact-revision artifact receipt or human acceptance record was available in this repository coding session. No user journey is therefore marked release accepted.
- Hashing an artifact can detect accidental or malicious byte changes after recording; it does NOT prove a human actually performed the test, that screenshots are genuine, or who signed the reviewer file. These require external audit, independent human observation and release-owner authority.
- P14 records carry only release tag and package version; the WS-65 validator additionally binds the flagship report to exact commit. Validate that the signed installers/checksums and external P14 category authors used that **same** target via existing signed release workflows.
- Validate rights revocation against **current provider/source entitlements**, not only a P3 saved snapshot. Verify both user ownership and organizational RLS with two independent tenant identities. No source file, secret or private user trace may be placed in an open PR.
- Any unmet scenario, unmatched file, wrong OS, missing P14 category, failed CI, manual test or review blocks WS-65 acceptance. The evidence gate is implementation progress, not final release certification.
