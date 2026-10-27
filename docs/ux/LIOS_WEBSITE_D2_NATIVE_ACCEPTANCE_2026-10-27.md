# LiOS website-source four-phase D2 — final native acceptance and $0 beta boundary

**27 Oct 2026** · master source-gap tracker [#258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258) · parent D1 [#297](https://github.com/kiranvbiim-coder/lios-terminal/pull/297).

## Implemented: one source + installed verification path

- Reuses the existing P1 Project navigation, P2 Chat, P4 editable Artifacts/export, P7 evidence, P9 review, beta manifest, beta acceptance and hosted source workflow. **No fifth feature phase, new store, paid renderer/asset, third-party source copying, release-upload workflow or runner upgrade.**
- Adds executable D2 native Office export regression: composed P7 + two exact P4 visual payloads → canonical report → actual native editable PPTX chart and table XML → readOfficeArtifactRoundtrip exact content/lineage; checks repeat export determinism. Native DOCX table and P4 Office metadata are also checked.
- Extends the **existing** owner-reviewed beta native acceptance control list from 10 to 23. Every control must be explicitly true and tied to the exact built installer SHA-256 for *both* macOS Apple Silicon DMG and Windows x64 NSIS installers. Four distinct real native screenshots (discovery, investigation, briefing/Office, 390px) plus a local test log/report are required. The checker reads bytes, rejects symlinks, missing files, path escapes and false image signatures. A truthful human reviewer must sign off the report. The existing beta manifest validator separately checks installer integrity and the exact commit.
- Bounds D1 source inclusion so 51+ references on a selected insight or 21+ references on a matching historical timeline event **blocks briefing composition instead of dropping lineage silently**.
- Source CI runs all prior A/B/C/D1 named gates, plus D2 test suite and existing beta proof **negative controls**. These tests do not set `checks: true` for any actual native installer.

## Required installed Electron journey, one user and two distinct Projects

| Existing beta control | Installed LiOS evidence criterion |
| --- | --- |
| signedIn, sourceAccess, nativeSecretCustody | Sign in and access authorized user-owned sources, verify OS-native key custody |
| pulseFollowMutePersistsAfterRestart | Follow and mute saved subjects; restart, confirm persisted user scope |
| sourceSearchToChatContinuity | Open one authentic source in Search, continue with exact source in Chat and Project |
| projectGraphKeyboardPanZoom | Inspect recorded P7 graph with keyboard, focus, zoom/pan; source IDs consistent |
| offlineProjectGeography | Map with original bundled basemap and permitted explicit coordinates; works offline without external tiles |
| evidenceAndContradictionReview | Open aligned perspectives/evidence, genuine sources and contradictory records visible |
| governedChatVisualsNoFakeData | Confirm only actual typed/authorized chart/table intents display; unsupported intent fails closed |
| reviewedModelResultSavedToP4 | P11 receipt verified before explicit save to P4; no invented calculation or auto-run |
| recordedConsequencePathsNoAction | Inspect C3 graph path and Chat handoff, no unapproved action or measured exposure claim |
| briefingP4ChartAndTableEditable | Include saved chart/table in Project Briefing Studio, inspect P4 version and editable report |
| pptxChartAndTableRoundtrip | Export real native PPTX, open/edit one chart and one table, reimport using existing P4 return review |
| sourceRevocationBlocksBriefingSave | Revoke source / archive visual before save, assert no write or silent stale fallback |
| projectSwitchKeepsSourcesIsolated | Switch to second Project, assert no prior Project refs, visuals or state leak |
| narrow390NoClippedControls | Native window reduced to ~390 CSS px, no clipped save/visual selection/graph controls |
| briefingSavedAndReopened, artifactVersionReopened | Reopen exact saved P4 version after relaunch, confirm provenance |
| offlineAndReconnect | Deliberate disconnect/reconnect, no fabricated success or paid network dependency |
| keyboardOnly, screenReader, zoom200, reducedMotion | Test all A–D critical surfaces, 200% zoom, visible focus, reduced motion |

Other remaining beta fields are unchanged. Human testers must capture the installed windows, not static source smoke or marketing images. Use distinct screenshot files for four key surfaces plus a truthful session log. **Do not claim 390px/mobile or screen-reader acceptance from source tests.**

## $0 release guard

Only existing public-source standard GitHub Linux/macOS Intel/Windows source runners, with credentials blank, and existing no-cost local packaging/manual test workflows. Do not trigger paid code signing, notarization, app stores, cloud video/presentation APIs, tile providers, premium design assets or deployment/publish steps. Keep the explicitly disclosed macOS Gatekeeper/Windows SmartScreen unsigned-ad-hoc installer limitations. Never tell customers the package is signed/notarized if it is not.

### Gates

Source:
```bash
cd src
npm ci --no-audit --no-fund
npm run check
npm run test:website-d2
npm run test:offline
npm run build
npm run beta:acceptance:test
npm run release:preflight:ci
```

Manual release (strict, existing checker):
```bash
cd src
node script/beta_release_acceptance.cjs \
  --manifest /release/beta-manifest.json \
  --asset-dir /release \
  --trusted-key /outside-repo/trusted-public.pem \
  --commit <exact-40-hex-commit> \
  --mac-self-test /evidence/mac-native.json \
  --win-self-test /evidence/win-native.json \
  --mac-ux /evidence/mac-ux.json \
  --win-ux /evidence/win-ux.json
```
The 23 named true/false UX checks belong in each platform's `checks` object. Use existing test schema and exact manifest hashes; no fake or placeholder evidence. **Without those real native artifacts this gate is BLOCKED.**

## Merge/release decision

D2 is a focused **stacked draft PR** on D1, not a release. Before merging into protected `main`, integrate the A1–D2 ancestor branches in order, require exact integrated HEAD CI green, resolve cross-workstream conflicts and perform packaged macOS ARM64/Windows x64 acceptance. A green public source job certifies source regressions only. The final result must report installed QA and license/rights risks honestly rather than treating donor-source integration as native UX acceptance.
