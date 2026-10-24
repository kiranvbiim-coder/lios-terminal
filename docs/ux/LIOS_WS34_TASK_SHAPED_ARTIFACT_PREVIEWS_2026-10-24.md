# WS-34 — Task-shaped previews from canonical saved Artifacts

**Date:** 2026-10-24. **Owner implementation:** stacked on [PR #98 — Original finance terminal as canonical Chat Artifacts](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) instead of replacing its `SavedArtifactCards` or P4 storage. **Plan:** [TC 65-workstream #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), tracked in [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Real code audit

- `SavedArtifactCards` already reopens an exact `metadata.persistedArtifacts[].{id,version}` pointer after saved Chat reload; `SavedArtifactCardList` is keyboard-activatable and the canonical P4 `ArtifactPane` edits a versioned object through existing access-checked routes.
- Before WS-34 each result was the same simple title/kind/version/“Open” row; there was no indication of what a chart, table, document, portfolio or analysis contained.
- Saved message metadata's `title`/`kind` are **display snapshots, not authorized content**; list metadata can be stale, archived results may be absent, and a newer head must not replace the version retained by the message.
- The P4 `GET /api/artifacts/:id?version=X` endpoint checks server authorization. Client also requires exact `artifact.id === ref.id`, `version.artifactId === ref.id`, `version.version === ref.version`, matching content kind and current Project/owning Chat scope before showing any task preview. `Temporary` has no saved cards.

## Changes

1. `client/src/lib/recordedArtifactPreview.ts` is a pure, bounded, deterministic projection of **typed exact-version content**: recorded chart series/points, table dimensions, saved spreadsheet sheets, declared data rows, portfolio holdings, saved report sections/blocks, research question, model type, backtest recorded status/trade count, decision objective or saved screen. It never computes an investment result or displays arbitrary raw records, credentials, sourceRefs, formula cells, hidden portfolio rows or hallucinated values.
2. Existing `SavedArtifactCards` calls the P4 exact-version query for every retained reference (a bounded list of at most 20) rather than only items absent from the active-list page, and shows the preview **only** from a **fresh-after-mount, non-fetching, non-error** exact-identity, exact-version, current-scope record. A cached result from a different browser session cannot immediately surface as preview content while fresh authorization is unresolved. An authorized exact P4 kind overrides a conflicting saved-message kind snapshot; the original retained title/version and `onOpen(artifactId,version)` remain unchanged.
3. Cards with a not-yet-authorized, missing or failing exact-detail read do not show invented content; existing open/unavailable affordances remain. No new persistence, provider calls, AI execution, auto-save, list merge, P4 authority or sidecar.
4. Regression tests cover source counts, no raw secret leaks, bounded text, empty content, status caution wording, exact version and Project/Chat custody, read-only keyboard card presentation, metadata-only and pending query fallback. Existing saved card tests updated to include the `preview: null` extension.

## Test commands

From `src/`:

```sh
node --import tsx --test client/src/lib/recordedArtifactPreview.test.ts client/src/components/terminal/SavedArtifactCards.test.ts shared/conversationArtifactRefs.test.ts shared/artifactContracts.test.ts
npm run check
npm run test:p4
npm run test:ux
npm run acceptance:ux
```

All new tests require **exact-head CI**, including macOS/Linux/Windows. Passing an older parent SHA would not qualify new code.

## Explicit boundaries and remaining acceptance

- **No fake output:** A content-derived count or a historical `status` is only a recorded P4 field. No source has been independently validated and no financial conclusion should be inferred from a preview.
- **No authority shortcut:** P4 GET plus same-scope/exact-version checks; data is not created from arbitrary Chat metadata or a current head.
- **Not full interactive preview:** Chart plots, document editing, spreadsheet formulas and authoritative sidecars stay in `ArtifactPane` and upcoming WS-36–40. This work intentionally avoids a second editor or rendering engine.
- **Still needed:** hosted exact-head tests/types, authenticated cross-user/tenant Project/Quick/Temporary HTTP denial, removed/revoked Artifact negative UI journey, browser keyboard/screen reader/narrow viewport and native packaged Mac/Windows P14/SP acceptance, PR review and merge.
- **Merge order:** This work is intentionally stacked on #98. If #98 moves, reconcile exact new commits and re-run tests before retargeting; independent Chat integration #102 also stacks on #98 and must be considered when merging.
