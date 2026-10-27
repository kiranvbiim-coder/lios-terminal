# LiOS Phase 4 — integrated release qualification

**Status:** SOURCE IMPLEMENTATION IN REVIEW — NOT A RELEASE. The Phase 1–3
features remain stacked draft pull requests. This checklist does not authorize
merging, publishing or declaring packaged desktop runtime complete.

## Dependency and merge direction

Current cumulative product ancestry:

`main → #253 (premium UX candidate) → #259 (licensed donor adaptations) →
#271 (Phase 1) → #288 (Phase 2) → #291 (Phase 3) →
Phase 4 cumulative candidate`.

Review the latest cumulative branch **against its direct parent**. Merge from
the bottom of the stack, after checks and approval, or produce a single
maintainer-reviewed squash/release candidate with the same final tree. Never
merge historical overlapping feature PRs independently. Keep original Git
history and donor attribution in `THIRD_PARTY_NOTICES.md` and
`third_party/`. Zero new paid third-party services are permitted by this gate.

## What CI can prove (source only)

From `src/`:

```sh
npm ci --no-audit --no-fund
npm run check
npm run test:offline
npm run test:desktop
npm run test:ux
npm run phase4:source
npm run audit:oss
npm run audit:licenses
npm run release:preflight:ci
npm run build
npm run phase4:assets
```

The hosted workflow runs a subset of these alongside Python engine tests on
Linux, Windows, macOS. Its source asset budget is an **upper safety ceiling**:
single JS <=32 MiB, total JS <=100 MiB, total CSS <=20 MiB. This is **not**
LCP, interaction latency, responsiveness, CPU/RAM or user-perceived performance
qualification. The canonical native P14 report remains the timing/memory
authority. Failed or absent builds fail the size check rather than passing
without assets.

`npm run phase4:source` intentionally emits a **BLOCKED release evidence**
inventory in a successful source job. An all-green source job is *not* native
evidence. Source CI must never invoke live providers, model billing, user
secrets, signing endpoints, paid browsing or a deployment.

## Native / external acceptance matrix

Every row below requires a real retained report for the **same exact commit**:

| Gate | Required original observation |
| --- | --- |
| source-linux / source-windows / source-macos | Finished hosted source run with all required source steps green |
| signed-macos | Signed, hardened, notarized, stapled release artifact |
| signed-windows | Valid Authenticode installer and bundled native dependencies |
| clean-install-macos / clean-install-windows | Genuine clean-machine install plus bundled Python health/self-test |
| update-rollback-macos / update-rollback-windows | Two signed versions, HTTPS update, failure/rollback and recovered saved work |
| accessibility-macos / accessibility-windows | Native screen reader, keyboard, 390px pane and 200% zoom journey |
| performance-macos / performance-windows | Packaged P14 performance probe (not source fixture) |
| sp01-packaged-journey | Installed Project/Chat/approval/denial/restore journey including governed runtime |
| packaged-valuation-http | Real packaged valuation route returns a valid successful result, no HTTP 502 |

### Packaged numerical sidecar coverage (release follow-through)

The existing `desktopPythonSidecar.cjs` and `desktopSelfTest.cjs` now also
exercise the authenticated HTTP `POST /advanced/valuation/reverse-dcf`
directly against the **frozen packaged Python sidecar**, using SP-01's
independently checked numerical fixture. A missing route, 503, wrong
number, nonfinite value or missing result fails the desktop self-test.
The native result is recorded under `pythonSidecar.valuationRoute`
and the sidecar evidence report. This is not a mock runtime probe:
the unit test's mocked HTTP endpoints only verify the test harness itself.

**This does not finish the packaged valuation HTTP acceptance row.** The
separate installed Electron → Node server API → numerical runtime pathway
must still be exercised with the authenticated user/Project context,
including response and error trace evidence. A green sidecar-only smoke
must never be relabelled an end-to-end 502 fix.

**Known unresolved risk:** the packaged valuation HTTP 502 reported during
earlier development has **not** been proven resolved. It is a **hard release
blocker** until the actual installed packaged route is exercised and its
successful response/trace retained. A fixed CI test or HTTP mock does not
satisfy this row.

## Offline release inventory tool

The inventory contract is in `script/phase4_release_evidence.mjs`. Each
original observation needs the exact git commit, appropriate platform/scope,
dated `passed` status, a **relative** retained artifact path and SHA-256 of
the actual file. A report cannot qualify its own fixtures, a mismatched
commit, a missing gate, or a stale/failed result.

```sh
# Source/release evidence report; no native records automatically invented.
npm run phase4:release:report

# After collecting REAL platform evidence in a private evidence directory:
node script/phase4_release_report.mjs --evidence /secure/release-evidence.json \
  --base-dir /secure/retained-reports --require-ready
```

`--require-ready` rejects any missing required record or nonmatching
retained byte digest. It independently reads the repository's `git rev-parse HEAD`
and rejects reports for another commit or with modified staged/unstaged tracked
source files. Run it from the exact, clean release checkout—not a copied or
altered working tree. The tool **only verifies the inventory and file bytes**;
a local SHA-256 file alone is not cryptographic provenance or a trusted
attestation that a real physical test was run. The release owner must inspect
original GitHub run links, signed installer fingerprints, original unmodified
runtime probe files, verified machine identity and signing chain outside this
tool. No production secrets or private test files belong in the public repo.
A positive synthetic unit test checks the evaluator algorithm only.

## Required user-journey acceptance (installed)

1. No-connection first use: ask-first, optional connection and Projects.
2. Project A → B while continuity refresh, workflow receipt and saved Work
   requests are in-flight; no old status or data should appear in B.
3. Chat response copy, denial, quote selection and pending message change.
4. Saved source registry first-load failure / stale cached results / GET retry.
5. Live voice picker cancel/slow native dialog, ffmpeg absent and read-only
   readiness retry; no false transcription capability.
6. Four-pane Workbench keyboard reordering of a pinned saved Artifact, dirty
   draft Apply rejection and focus return.
7. Chat Artifact v3 → v4 → latest overlapping GETs; never launch a stale exact
   revision or lose unsaved edits.
8. Home Wave D stale Pulse and Action Inbox review, Project resource context
   rights, saved-work search cancellation and backtracking.
9. Consent-first Limuria advisory: GET list error must not say zero requests;
   explicit form POST, rapid double click, preserved draft on failure, no
   automatic charge or implicit opt-in.
10. Signed installed application boot, clean shutdown, workspace restart and
    restore, update and rollback, Python sidecar and valuation HTTP success.

Collect responsive screenshots at 390×844, 768×1024, 1440×900 and 200% zoom,
keyboard-only traversals with visible focus, reduced motion, and real VoiceOver
or Narrator observations. The existing `docs/technical/LIOS_THEME_VISUAL_ACCEPTANCE.md`
and P14/SP01 tools remain authoritative. Fixture screenshots and source tests
**cannot** substitute for authenticated installed experiences.

## Honest exit criteria

A release candidate needs exact-head passing source checks on all three OSes,
a clean licensed donor and supply-chain audit, a passing compiled asset budget,
all required native evidence and a human security/UX/license review. Any failed,
unavailable, outdated or unreconciled check is a **no-ship** result.

This document and its automation intentionally do not perform a merge,
deployment, install, release signing, customer billing, or unattended monitor.
