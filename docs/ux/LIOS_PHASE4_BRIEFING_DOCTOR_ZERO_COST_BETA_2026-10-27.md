# LiOS Phase 4 — Briefing, Doctor, Native UX and $0 Beta: Integration / Acceptance

**Date:** 27 October 2026  
**Base:** Phase 3 integration PR #251, including Phase 2 #248 and Phase 1 #237  
**Branch:** `integrate/phase4-briefing-doctor-native-finish-20261027`  
**Budget:** Exactly $0 **additional cash expenditure** to distribute an explicitly lower-trust beta. No free-trial-to-paid, pay-as-you-go overages, nonessential paid SDKs, new cloud, certificate or domain purchases.

## Implemented source behavior

1. **F11 Briefing Studio:** A single `Research | Briefing Studio` switch inside existing Project Investigation, no new sidebar/workflow/backend. User selects up to 16 Project-owned P7 saved insights. The preview contains only recorded titles, summaries, event dates, classifications, opaque source IDs and optional recorded Project timeline, with visible missing-source warnings. User explicitly saves a real `report` P4 Artifact via canonical `createArtifact`, strict response Project/version checks and existing Artifact Library invalidation. Open uses the same saved Artifact focus and editing tools as Chat/Workbench. Editor notes are labelled. No AI facts, automatic distribution, rights-free screenshots or hardcoded market quotations.
2. **System Doctor:** Opt-in, read-only runtime registry health inspection via already existing **internal-only** `GET /api/runtime/foundation/health`. Shows exact status counts and registered component IDs; `configurable` is explicitly *not* `available`. Backend diagnosis/repair tools and tenant permissions stay unchanged. The component reports limited authorization as limited authorization, not system failure; does not display raw exception details, provider credentials or trigger repairs. Existing Devices Settings hosts the surface and retains pairing/revocation authority.
3. **$0 beta integrity gate:** Reuses exact reviewed blobs from the concurrent existing zero-cost beta branch for `src/betaReleaseManifest.cjs`, its tests, and explicit owner CLI. Ed25519 offline manifest signs metadata and hashes of exact local macOS arm64 DMG/ZIP and Windows x64 NSIS assets using private key **outside the repository**; verification requires independently trusted public key, commit, exact assets and version monotonicity. `beta:manifest:test` and `beta:manifest` scripts added to existing package. This authenticates owner-manifest contents and local asset bytes only. It is **not** Apple Developer ID signing, notarization, Windows Authenticode, OS trust, or an updater. Never sign in CI or ship a private key.
4. **Native polish:** Original existing `TerminalUxSettings` Guided/Professional, Comfort, Reduce Motion, Low-resource mode; existing P4 editor/Workbench, P10 packaged self-tests and P14 release preflight remain canonical. New surfaces use established design tokens, readable 14px+ content, keyboard-labelled inputs, user-driven expandable sections and responsive widths. No second theme/settings engine, new dependency or high-cost animation.
5. **Product marketing:** No unlicensed donor screenshots, fictional demo footage presented as live, or misleading install trust claims. Public website creative and actual screenshot-driven QA require separate deployment/access and accepted native capture; nothing is auto-published or purchased.

## Source-of-truth owner matrix

| Capability | Canonical authority | Phase 4 presentation |
| --- | --- | --- |
| P7 retained insights / timeline | `useProjectInsightLens`, `useProjectIntelligence` | `ProjectBriefingStudio`, `phase4Briefing` |
| Persist/edit/view Artifact | P4 `createArtifact`, Artifact Pane, Workbench | User-confirmed report save and existing Artifact focus |
| Runtime health | Internal P0 Registry + `runtimeFoundationRoutes` | `SystemDoctorDesk` read-only probe |
| Governing runtime repair | Existing SI-07/GM Doctor tools | No new mutation |
| Devices and pairing | `DevicesSettings`, `deviceRoutes` | Existing UI retained |
| Beta release custody | Existing $0 beta manifest, packaging + P14 | Explicit owner-operated local asset signature verification |
| Video/demo | `src/remotion/DemoVideo.tsx` | Fictional demo source remains isolated; no real briefing footage claimed |

## Regression commands

```bash
cd src
node --import tsx --test \
  client/src/lib/phase4Briefing.test.ts \
  client/src/lib/phase4RuntimeDoctor.test.ts \
  client/src/lib/phase4Integration.test.ts \
  client/src/components/terminal/Phase4Finish.test.tsx \
  client/src/lib/phase3InvestigationPresentation.test.ts \
  client/src/lib/phase2ProjectPresentation.test.ts
npm run beta:manifest:test
npm run check
npm run test:ux
npm run release:preflight:ci
```

## Native $0 beta closure: BLOCK until observed, not merely coded

- Produce actual macOS arm64 and Windows x64 unsigned/ad-hoc installer assets on an owner-controlled machine, without paid runner, cloud or license. Verify local disk/CI quota and built package footprint. Do not quietly use signed production channel.
- Run existing P10/P14 packaged/native self-tests on **both** OSes and verify Node backend, isolated Python sidecar, encrypted OS credential custody, update posture, saved Project/Artifact reopen, offline state, source entitlements, plugin permissions and device continuity. Keep P14 production-signed requirements unchanged and separately unmet where applicable.
- Capture actual macOS + Windows installed UI screenshots and screen reader/keyboard focus, 390px/768px/laptop, 200% zoom, light/dark, Reduced Motion and low memory. Measure startup responsiveness/memory against original performance budgets.
- Close installed end-to-end journey: sign in → Project → Investigation/Briefing → select source-backed P7 insights → save exact editable P4 report → edit version → reopen → P9 monitor review → Doctor (internal permissions only) → offline/reconnect. Record actual successes/errors and execution receipts.
- Using separately trusted owner public key, verify integrity manifest and exact sha/size; publish only after release approval and public GitHub Releases limits check. Disclose app is ad-hoc macOS/unsigned Windows with OS warnings and no notarization. Avoid recommending Gatekeeper/SmartScreen bypass.
- If any required step costs money, mark `BLOCKED_BY_ZERO_COST` with a non-pay alternative. Never weaken code-signing checks, production updater signature validation or local secret custody to force passing.

## Explicitly incomplete

- Source-only CI/presentation integration is not a packaged Electron acceptance. No Mac/Windows installer build, independent signoff or public release was performed here.
- Model-produced briefing scripts, independently licensed imagery, rendered audio/video, and direct PPTX export require more genuine renderer/rights work. F11 currently delivers **real editable P4 report** and its source-based storyboard.
- Full MapLibre native geospatial layer, generalized model-authored typed visual answers, verified causal impact and P11 scenario→P4 native acceptance remain Phase 3/open product gates, not rewritten as Phase 4 success.
- Marketing site pages, actual screenshots, external download links and release assets cannot be truthfully created/claimed without installed-app evidence and an authorized owner release decision.
- Concurrent zero-cost beta branch may already change `src/package.json`: resolve overlapping edits during integration; never silently overwrite either implementation.

**Merge sequence:** Phase 1 #237 → Phase 2 #248 → Phase 3 #251 → Phase 4 draft after test/UX review. Concurrent Phase 4 beta manifest branch retains upstream provenance and may need deduplication. Do not merge donor code twice or directly modify protected `main`.
