# LiOS A–D consolidated release-candidate handoff (27 Oct 2026)

This is the **single proposed review surface** for the website-source A1–D2 capability sequence on the existing four-phase LiOS integration spine. Earlier integration PR #253 and phase PRs #261 / #263 / #266 / #270 / #274 / #277 / #281 / #286 / #290 / #294 / #297 / #299 remain individual source-review references; **do not merge those and this aggregate PR independently**.

## Actual code

A: grouped source discovery, reviewed editorial media with rights/no redistribution, owned follow/mute and Home → Chat evidence continuity.

B: interactive grounded P7 evidence graph, bundled offline Natural Earth geography, sourced perspectives and evidence flows.

C: source-governed Chat charts/tables, explicitly reviewed saved P11 model run → P4 version, provenance-linked and nonexecuting consequence review.

D: source-pinned existing P4 editable report/Office-native chart and table, meaningful Office roundtrip source contracts, real desktop acceptance gate expanded to 23 criteria for both installed macOS ARM64 and Windows x64.

**Revocation integrity:** Current P7 graph/timeline and compiled insight lens now reuse the authenticated current-source eligibility filter already used by Project Search. Snapshot deltas referencing archived/excluded/revoked sources are removed from the current lens, with counts recomputed. Historical snapshots remain untouched and are not represented as current source authority. The source test rejects revoked, mixed-scope and snapshot-only findings.\n\n**Integration hardening**: before the ONLY briefing write, the Studio now also forces authenticated P7 insight-lens and Project intelligence/timeline refetches, rejects changed/missing/wrong-Project results, checks an identical canonical preview, and only then writes canonical P4. Existing P4 current-version/rights checks remain in place. This fixes a race in which unrefreshed P7 context could silently remain stale even though P4 visuals were freshly checked. Because P7 regenerates `generatedAt` on every request, the briefing body no longer incorporates that ephemeral timestamp as if it were a retained evidence revision; unchanged source facts compare equal after refresh. New/removed/changed insight or timeline contents still block the save. Source tests exercise changed insight, changed timeline and cross-Project denial plus source wiring.

## Merge and release sequence

1. Evaluate **this aggregate PR's exact HEAD**, with all 219+ changed paths, upstream ancestry, vendor attribution, public-domain map and source entitlements reviewed by a human. Other stacks become historical review sources rather than extra merges.
2. Require exact-head `npm run check`, `npm run test:phase-closure`, `npm run test:website-closure` plus existing named tests A3–D2, `npm run test:offline`, `npm run test:desktop`, deterministic Python tests, `npm run build`, `npm run media:verify`, `npm run release:preflight:ci` on **existing public standard source runners**. No bypassing queued Actions, no new paid minutes.
3. Desktop owner performs existing beta-package `app:beta:mac` and `app:beta:win` on actual target hardware. Verify no misrepresentation of unsigned/unnotarized releases; exact macOS DMG and Windows installer bytes must match manifest trust.
4. Native installed beta gate checks signed manifest hash and 23 required UX criteria, four different screen captures plus logs, on **both** macOS Apple Silicon and Windows x64. Include data/provider revocation and permitted Office roundtrip. Human must actually perform, not author `checks:true` speculatively.
5. Merge once, into protected `main`, **only after** CI and native evidence are green; publishing/download links only after that and owner approval.

## Execution commands

```bash
cd src
npm ci --no-audit --no-fund
npm run check
npm run test:phase-closure
npm run test:website-closure
npm run test:offline
npm run test:desktop
npm run media:verify
npm run release:preflight:ci
npm run build
```

## Current state (this source change)

Code is staged into a **draft integration branch**, not merged. Source CI and true packaged native acceptance cannot be certified through GitHub inspection alone. A queued workflow proves only a pending request, not a test pass. No private account tokens, paid services, source redistribution, release uploads or deployment action added. This handoff does not represent product launch approval.
