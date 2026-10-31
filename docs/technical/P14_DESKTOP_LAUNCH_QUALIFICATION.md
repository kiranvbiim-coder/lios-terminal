# P14 — Final Desktop Launch Qualification

**Status:** SOURCE QUALIFICATION HARNESS COMPLETE — external exact-release packaged evidence not yet certified.

P14 does not rebuild P10. P10 created release capabilities; P14 proves that the actual customer package works on clean machines and that the complete flagship user journey is reproducible.

## $0 beta and P14 truth boundary

The owner has locked **$0 additional cash release spend**. See [Zero-Cost Release Execution Contract](LIOS_ZERO_COST_RELEASE_EXECUTION.md). Its explicitly named ad-hoc signed/unnotarized macOS and unsigned Windows **public beta** uses a separate beta evidence/approval track and manual update verification. It is **not** a P14 production release and must **never** be marked as meeting P14-01/02/03, the 14-category P14 final board or signed flagship requirements. No paid signing/notarization/CI/hosting workaround is authorized, and no P14 validator or security boundary may be weakened to accommodate the beta. The pre-existing P14 production gates below remain intact; at $0 their paid trust prerequisites stay openly unresolved.


## Release rule

P14 is the final release authority under [SI-01–SI-07](../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md), not a replacement execution program. P14 may run in parallel with Product Hardening. Production release requires both:

1. P14 exact-release packaged/clean-machine evidence across all 14 required categories; and
2. Product Hardening Issue #1 flagship real-user acceptance on macOS and Windows.

GitHub Actions are a constrained validation resource. P14 release workflows remain manual-only and must not be repeatedly run merely to inspect progress.

## Progressive Shipping Points

The [mandatory Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md) requires `SP-01`–`SP-07` throughout `SI-01`–`SI-07`. `SP-01`–`SP-06` are progressive product milestones; `SP-07` is the production release-candidate milestone. None replaces P14 final release authority. `S0`–`S10` are validation/coverage journeys, not execution phases; historical `CP1`–`CP7` maturity evidence is not release acceptance.

Each Shipping Point requires a defined Minimum Shippable Journey (MSJ), real end-to-end user execution, packaged/target execution where applicable, explicit missing/denied/offline/unavailable states rather than fake success, regression protection for accepted behavior, and an exact evidence record. The canonical issue/PR records commit/build/release, target OS/architecture/topology, MSJ, executed checks and outcomes, permissions/provenance/numerical proof as applicable, limitations, truth level, remaining gaps and next dependency. Later work must reproduce and repair a regression under its canonical owner before claiming the affected Shipping Point remains accepted.

Use the truth ladder: `contract locked → code integrated → tests passed → packaged/provisioned → user accessible → vertical flagship passed → shipping point accepted → release proven`. Source harness completion, generated categories and this document do not establish any accepted Shipping Point. `SI-01.11 / GM-11` exact-operation authority, sandbox and trust receipts must be proven before privileged interactive `exec.*` exposure.

The phase issue/PR refines these bounded MSJs without replacing them with component-only tests:

| Phase / Shipping Point | Minimum integrated journey |
| --- | --- |
| SI-01 / SP-01 Secure Local Alpha | install/start → Project chat → approval-required exact operation → approve/execute → receipt → save → restart/restore |
| SI-02 / SP-02 Agentic Alpha | complex request → bounded plan → governed browser/Python/tool execution → cancellation and representative failure recovery → persistent result |
| SI-03 / SP-03 Research Alpha | real topic/no-ticker/public/private entity → permitted evidence → contradictions/gaps → cited Artifact → restart/reopen |
| SI-04 / SP-04 Professional Work Alpha | real XLSX/document import or creation → inspect/edit → chart/report → professional export → reopen/verify integrity and revisions |
| SI-05 / SP-05 Financial Intelligence Alpha | canonical evidence/identity → deterministic valuation/risk/financial plan → explicit assumptions/scenario → revision → professional Artifact/export and numerical reconciliation |
| SI-06 / SP-06 Autonomous LiOS Beta | trusted one-shot workflow → Save as Task/monitor → trigger → permission/credential/freshness recheck → notification/result → restart and user-owned topology continuity |
| SI-07 / SP-07 Production Release Candidate | clean install → connect data/AI → cross-capability request → persistent professional output → automation/device continuation → backup/restore → complete release evidence |

These are required proof journeys, not a status table. Any-topic intelligence, all 11 finance families and native/user-owned target scope remain intact; representative MSJs do not narrow the SI program.

## Canonical evidence matrix

| ID | Qualification | Existing foundation | P14 closure evidence |
| --- | --- | --- | --- |
| LIOS-P14-01 | macOS signing/notarization + clean install | production release workflow, codesign/Gatekeeper/stapler, native self-test | signed release tag + notarized DMG + clean-machine self-test evidence |
| LIOS-P14-02 | Windows signing/installer + clean install | Authenticode workflow, native self-test, clean-install job | signed installer + clean-machine install/self-test evidence |
| LIOS-P14-03 | update/migration/rollback/recovery | electron-updater + updater/recovery tests | packaged N→N+1 update + failure rollback/recovery evidence |
| LIOS-P14-04 | Runtime Pack lifecycle | P10/P11 pack manager/install/rollback gates | packaged install/remove/retry/rollback on supported desktop OSes |
| LIOS-P14-05 | backup/restore + portable import/export | desktop workspace backup tests | packaged Project/Session export → clean profile import → reopen evidence |
| LIOS-P14-06 | crash/resource/long-job recovery | desktop self-test/doctor/job cancellation contracts | packaged crash/kill/restart + long-job cancellation/recovery evidence |
| LIOS-P14-07 | packaged security/privacy/secret custody | native secret-custody self-test + release preflight + hardened Electron ASAR fuses | packaged secret custody/log/privacy evidence on clean machines |
| LIOS-P14-08 | dependency/OSS/data/trademark/license audit | P10 supply-chain/right-matrix audits | final exact release-tag audit report |
| LIOS-P14-09 | performance budgets | source benchmarks, artifact performance tests, and clean-install packaged safety probe | packaged interactive startup/search/stream/artifact/large-data measurements plus bounded main-process resource evidence |
| LIOS-P14-10 | accessibility/keyboard/visual | source accessibility + visual-smoke contracts | keyboard-only + macOS VoiceOver + Windows Narrator packaged walkthrough evidence |
| LIOS-P14-11 | first-use / Experience Center | target: UX Figma matte, non-executable public preview + same identity-only entry + ask-first authenticated shell + optional Connections, with no forced setup; visual implementation still requires packaged proof | clean-profile first run → verify matte/non-executable preview → same identity-only entry → ask without forced setup → optionally connect/verify → return to preserved task evidence |
| LIOS-P14-12 | flagship journey | Product/phase components | both platforms: clean signed install → Project → real AI/data → governed deterministic work and AI synthesis → receipt → Artifact revision/export → quit/relaunch/reopen → permission revocation/fail-closed retry |

## Canonical qualification board

`src/shared/p14ReleaseEvidence.ts` is the machine-readable authority that maps the 12 P14 tasks to the 14 required evidence categories:

- P14-01 → `mac_clean_install`
- P14-02 → `windows_clean_install`
- P14-03 → `update_rollback`
- P14-04 → `pack_lifecycle`
- P14-05 → `workspace_restore`
- P14-06 → `recovery`
- P14-07 → `security_privacy`
- P14-08 → `release_rights`
- P14-09 → `performance`
- P14-10 → **all three** of `voiceover`, `narrator`, and `keyboard`
- P14-11 → `first_use`
- P14-12 → `flagship`

The private release-mode validator (withheld from the public source tree) builds a deterministic qualification board from the exact evidence bundle. It fails closed on missing categories, duplicate categories, mismatched category/environment bindings, package-version mismatch, or evidence belonging to another release tag.

The final certification workflow writes `p14-qualification-board.json`. Its timestamp is derived from the newest evidence record so an identical evidence bundle produces an identical board. The workflow publishes the board to the exact GitHub release and refuses to overwrite an existing board with different content.

This board is the final accounting artifact, not a shortcut around the required packaged tests. A board can report `passed` only when every underlying evidence record already reports `status: "passed"`.

## P14-01 signed-resource immutability

A signed macOS application must remain byte-for-byte valid as an application bundle after first launch. Python runtime behavior must never create `__pycache__`, `.pyc` or `.pyo` under the sealed `Contents/Resources/python-service` or `Contents/Resources/script` source trees.

The source/runtime contract is:

- Electron forces `PYTHONDONTWRITEBYTECODE=1` for the supervised backend process;
- the backend Python-service environment and bundled-sidecar environment force the same value again and callers cannot override it;
- packaging excludes pre-existing Python bytecode/cache artifacts from source-resource trees;
- packaged self-test checks those source trees before Python startup;
- the packaged sidecar runs a real deterministic `/stats/descriptive-diagnostics` calculation, not only a health ping;
- packaged self-test checks the source trees again after that calculation;
- macOS clean-install qualification performs strict deep code-signature verification before and after the packaged Python self-test.

A manual/ad-hoc re-sign after launch is not an acceptable mitigation. If the signature changes or runtime bytecode appears inside signed resources, P14-01 fails.

## P14-11 source readiness — first use

The active first-use path is not the legacy `ExperienceCenter.tsx` lead/demo page. The product authority is:

`PublicProductPreview → authentication → Project/Quick/Temporary conversation → optional Connection Center`

Source acceptance requires:

- the authenticated shell can open with zero connections;
- the primary first-use action is asking a question;
- the conversation empty state offers Connections as an explicitly optional secondary action;
- Connection Center can be exited with zero connections using **Continue to LiOS**;
- configuring a provider still uses normal verification rather than bypassing trust policy;
- when a running task discovers a missing source, opening Connections preserves the original request and returns the user to that work.

These checks make P14-11 ready for packaged qualification; they do not generate the `first_use` evidence category. That evidence still requires a clean-profile walkthrough against the exact signed release.

## Unsigned preview isolation

`.github/workflows/desktop-website-release.yml` is an **unsigned preview** workflow only. It must accept only `desktop-preview-*` tags, clearly mark artifacts as non-production, and must never masquerade as the signed production release.

Production customer publishing remains isolated in:
- `.github/workflows/production-release-readiness.yml` for macOS;
- `.github/workflows/windows-release.yml` for Windows.

### Signed-release credential containment

Both production workflows are manual-only and default **disabled** unless the owner sets the **repository Actions variable** `LIOS_SIGNED_RELEASE_ENABLED` to the exact string `true`. Leave it unset or `false` during public-source preparation; changing repository visibility is not release authorization. The signing jobs retain the `production-release` environment and exact tag/HEAD/package-version checks. Environment approvals and protected release refs must still be configured by the owner.

Node/Python dependency installation, audits, normal source tests, sidecar construction and the production build run without workflow-provided signing or notarization secrets. Only the final combined fail-closed desktop preflight + real signed packaging step receives them. The preflight still requires genuine signing/notarization configuration; macOS still forces code signing and notarization, Windows still forces code signing, and the subsequent signature/Gatekeeper/stapler/Authenticode and packaged checks are unchanged.

On macOS, App Store Connect API-key authentication takes precedence when `APPLE_API_KEY_P8` is configured; otherwise the Apple ID/password/team credentials are used. Only the selected authentication family is injected. The `.p8` file is created with private permissions immediately before preflight/packaging, its path is exported only within that shell (never `GITHUB_ENV`), and an EXIT/signal trap removes its private directory. An `always()` cleanup also removes that run/attempt-specific directory after interrupted packaging; existing runner workspace reclamation remains in place.

Every checkout disables credential persistence. `GH_TOKEN` is injected only into release upload/create or download steps, including clean-install evidence publication, not into packaged execution or source tooling. The workflow default permission is `contents: read`; jobs that create/upload releases still require job-level `contents: write` because GitHub does not support per-step token permissions. This is narrower exposure, not a separate publication security boundary.

**Residual supply-chain risk:** this is scoped-step containment, not isolated artifact signing. The preflight, installed `tsx`/npm tooling, electron-builder, native packaging/rebuild operations and packaging hooks execute with credentials during the signing step. Earlier compromised dependencies or runner processes could persist and observe that later step, and a self-hosted macOS runner can retain host/keychain state. No workflow guarantee removes pre-existing host secrets. Use a dedicated clean release runner with no ambient signing credentials, trusted exact tags, reviewed dependencies/actions, protected release environments and post-run host/keychain cleanup. An abrupt runner loss can bypass shell/Actions cleanup; reclaim the runner before reuse. Moving signing to an independently controlled clean job/service needs a reviewed unsigned-artifact, hook, notarization and provenance contract; it is not claimed here.

This source change is not signed-package or clean-machine acceptance. Without releasing or real credentials, validate workflow syntax/action contexts and run the existing release-preflight and desktop wrapper behavior tests with fixtures only. A later owner-authorized exact-tag run must prove genuine platform signing, notarization, key cleanup on success/failure and packaged clean-install evidence before any P14 acceptance claim.


The preview macOS matrix entry and publish job currently select bare `self-hosted`, not an OS-specific label. With the owner's Linux runner also eligible, wrong-OS scheduling is a source-derived risk; no scheduling failure has been measured here. The packaging/workflow owner must bind the macOS job to the correct target and demonstrate deliberate preview execution before claiming that scheduling gap is closed. Preview success still cannot supply signed-release evidence.

## Electron package integrity

Production packages must set `onlyLoadAppFromAsar: true` and `enableEmbeddedAsarIntegrityValidation: true`. Together they prevent Electron from falling back to an unpacked replacement application and require the packaged `app.asar` integrity metadata to validate before the app loads.

LiOS currently keeps `runAsNode: true` intentionally because `main.cjs` launches the supervised local Express process using the packaged Electron executable with `ELECTRON_RUN_AS_NODE=1`. Do not disable that fuse until the local server process is migrated to an architecture that does not depend on `ELECTRON_RUN_AS_NODE` (for example, an appropriate UtilityProcess design). P14 acceptance locks this exception explicitly so security hardening cannot silently break desktop startup.

A successful signed clean-install launch plus the P14 source contract is required before this hardening is considered proven.

## External evidence contract

P14 release-evidence mode is intentionally fail-closed. Evidence JSON must be generated by the real packaged qualification runs or human-assisted accessibility/flagship walkthroughs; placeholders are not valid.

Required evidence categories:
- macOS clean install;
- Windows clean install;
- packaged update/rollback;
- Runtime Pack lifecycle;
- portable workspace restore;
- crash/long-job recovery;
- packaged security/privacy;
- final release rights audit;
- packaged performance;
- macOS VoiceOver;
- Windows Narrator;
- keyboard-only walkthrough;
- first-use onboarding;
- flagship end-to-end journey.

Each evidence file must satisfy `src/shared/p14ReleaseEvidence.ts`: `schemaVersion: "1"`, a recognized category, exact release tag/package version, offset-aware `generatedAt`, `automated` or `human_assisted` evidence kind, platform and 1–50 named source artifacts. Automated records require a 64-hex SHA-256 for every source artifact; notes are bounded and unknown fields are rejected. `"status": "passed"` records observed qualification, not intent. Include OS/architecture/topology and limitations in the supporting evidence; a schema-valid record alone does not prove the underlying journey.


## Final certification workflow

P14 closes only through `.github/workflows/p14-release-certification.yml` against the exact signed release tag. The manual `ubuntu-latest` job checks HEAD/tag/package-version binding, downloads the release-bound `p14-*-evidence.json` assets and `flagship-release-report.json`, then runs `npm run acceptance:flagship:packaged`, `npm run acceptance:p14:release` and `npm run acceptance:p7:release` in sequence with fail-closed pipeline handling.

The certification gate fails closed when an evidence category is missing, duplicated, belongs to another release tag/version, has the wrong category, or has not reported `status: "passed"`. It then emits the canonical 12-task qualification board and publishes that board against the exact release.

Automated clean-install jobs publish the macOS and Windows evidence assets themselves. Other automated or human-assisted qualification jobs/walkthroughs must use the same typed evidence schema and attach their evidence to the same exact GitHub release before final certification.


### Automatically generated exact-release evidence

The signed macOS production workflow now publishes typed evidence for:
- `mac_clean_install` from the clean-machine signed DMG installation and packaged native self-test;
- `security_privacy` from production preflight, packaged native secret-custody self-test, and signed artifact checksums;
- `release_rights` from production dependency, static license, release-rights/OSS reconciliation, and third-party notice evidence.

The signed Windows workflow publishes `windows_clean_install`.

These are the only typed categories automatically generated by those workflows; they are not final release certification. The macOS `security_privacy` and `release_rights` records have the macOS artifact scope described above. They do not establish independent security review, all-platform privacy behavior or Windows security/rights qualification. The release owner must retain independent review and platform-specific security/privacy/rights evidence required by P7 and the desktop/security ledgers. Update/rollback, runtime-pack lifecycle, Project/Session restore, failure recovery, packaged performance, accessibility, first-use, and flagship acceptance remain separate gates because source tests are not acceptable substitutes for those real packaged behaviors.

### Packaged performance safety probe

The macOS and Windows clean-install jobs run `validate_p14_packaged_performance_probe.cjs` against the installed application's native self-test report. The probe records and bounds:
- elapsed time from Electron main-process start to `app.whenReady()`;
- total native packaged self-test duration;
- main-process RSS at self-test completion;
- main-process heap used at self-test completion.

The checked-in safety ceilings are regression guards, not aspirational UX targets: 20 seconds to Electron readiness, 60 seconds for the full native self-test, 1 GiB RSS and 512 MiB heap used. Both platform-specific raw probe reports are attached to the exact release.

These probes intentionally **do not** generate the final typed `performance` evidence category. P14-09 remains open until interactive packaged startup, search/stream, Artifact rendering and large-data workflows are measured and approved. A future release workflow must not convert the native self-test probe alone into `p14-performance-evidence.json`.

## Unresolved release-path evidence gaps

The inspected source/configuration exposes release-path gaps; no workflow failure, overwrite outcome or performance value was measured in this documentation reconciliation.

- **Visual count mismatch:** the capture and UX workflow require 15 UX cases, the macOS production workflow checks 9 PNGs, and the P10 release validator requires 13 manifest cases and advertises 13 in its output. The P10 packaging/workflow owner (`LIOS-P10-01/02`) must reconcile these contracts without dropping cases and retain exact-build capture/manifest/validator evidence. Documentation does not repair the mismatch; see [P10 packaged acceptance](P10_PRODUCTION_HARDENING_RELEASE.md#packaged-acceptance).
- **Shared release asset overwrite:** both signed workflows upload `release-checksums.txt`, `python-sidecar-evidence.json` and `desktop-self-test-report.json` using `--clobber`. macOS checksums cover DMG/ZIP; Windows checksums cover EXE/update metadata/blockmaps. `[INFERENCE]` Sequential or concurrent publication can replace the other platform's evidence/checksums and affect clean-install consumers. The P10 packaging/publication owner must preserve non-colliding or equivalently integrity-bound per-platform evidence and prove both clean-install consumers against the same exact release. Typed platform clean-install names and an immutable qualification board do not fix the shared raw-asset risk.
- **Platform proof boundary:** P10's validator checks artifacts/reports/manifests/checksum text, not actual signing or notarization. Windows has no analogous P10 visual/release-mode validator in its workflow. Retain real Windows rendered/manual qualification separately; do not promote Linux CI or macOS automation to Windows proof.

The authoritative Quality Gate defaults to the owner's `[self-hosted, Linux, lios-docker]` runner. Manual alternatives are `ubuntu-latest` or `[self-hosted, macOS]`; signed macOS/Windows packaging and final certification remain deliberate manual qualification workflows. Runner configuration or a green source gate is not exact-package release acceptance.
