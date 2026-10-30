# WS-36 — Resizable canonical Artifact sidecar / Focus / Expand

**Date:** 2026-10-24 · **Plan:** [TC/UX #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) / [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91) · **Canonical Artifact parent:** [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) · **Responsive CSS owner:** [WS-08 PR #127](https://github.com/kiranvbiim-coder/lios-terminal/pull/127).

## Source audit: existing ownership and gaps

- The existing **one** `ConversationArtifactSidecar` mounts the **one** `ArtifactPane`, already supports pointer drag, left/right arrow resize, non-destructive Focus / Exit Focus, and an Expand button. `ProjectExperienceShell` already checks the displayed Artifact identity, exact requested revision, current Chat/Project and dirty editor state before `navigateWorkbench`; `ArtifactPane` only reports versions from non-placeholder, matched P4 reads.
- Previous keyboard resize started from an arbitrary **600px** when the sidecar had no explicit width. Drag used `window.innerWidth`, ignoring the navigation sidebar and minimum Chat reading space. It had no `aria-valuenow`, range or keyboard Home/End, no pointercancel/Escape rollback, and no focus return to the Chat opener. A dirty editor could still enable the Expand button even though the shell correctly refused the navigation.
- The separately-owned WS-08 responsive PR #127 had a `width:clamp(...) !important` rule that would make the user-dragged width ineffective after both workstreams were merged; **its original branch was updated in place** to use `var(--lios-sidecar-width, clamp(...)) !important`, keeping its 900px narrow-mode hidden/focus behavior and its original fallback.

## WS-36 implementation

1. New pure `client/src/lib/artifactSidecarSizing.ts`: measured conversation-container width, min **320px** sidecar when physically possible, **360px Chat remaining**, max **80%** of container, collapsed safe bounds for undersized containers; keyboard `ArrowLeft/ArrowRight` ±40px, `Shift` ±80px, `Home` minimum, `End` maximum. No `window.innerWidth` heuristic.
2. Updated the existing sidecar to measure **its real parent** using `ResizeObserver` plus window-resize fallback. The user width is a component-local preference, bounded again on container resize and published as `--lios-sidecar-width` to coordinate with responsive CSS; no app-wide persistence or second panel.
3. Pointer-captured drag uses exact pointer ID, releases cleanly on PointerUp, restores start width on PointerCancel, lost capture or Escape and cleans up on focus/unmount. The actual percentage layout is unchanged until measured.
4. Keyboard-separator uses ARIA orientation, min/max/now, text about remaining Chat width and hidden instructions; Focus gives initial keyboard focus to **Exit Focus**; Exit Focus returns it to the Chat header's **Open artifact** button using `requestAnimationFrame`. Sidecar has a visible Focus button at desktop sizes, and Focus mode never exposes resizing.
5. **Expand is fail-closed** for unavailable/wrong loaded identity, stale displayed/requested version or unsaved edit; it keeps the existing `ArtifactPane` `onDirtyChange`, the shell's redundant guard and version-exact Workbench navigation. No synthetic content or version head jump; local dirty draft is preserved until save/reset.
6. No change to P4 store, artifact version schema, sidecar renderer, notes, model providers, Chat persistence or Workbench router. Temporary Chat still uses its separate **ephemeral** terminal surface and is not promoted or persisted.

## Regression tests and qualification

Added `client/src/lib/artifactSidecarSizing.test.ts` for measured-width bounds, 320–1800px, keyboard min/max and clamping, non-finite values, exact revision / dirty guards, one ArtifactPane, keyboard focus-return, pointer-cancel/Escape and no new persistence or `window.innerWidth` dependency.

From `src/`:

```sh
node --import tsx --test client/src/lib/artifactSidecarSizing.test.ts
npm run check
npm run test:ux
npm run validate:visual-environments
```

On the **separate #127 WS-08 branch**, run `node --test script/validate_ws08_responsive_shell.test.mjs`; that script is not part of parent #98 or this isolated WS-36 child until the two stacks are integrated.

**Live acceptance still required:** signed-in real desktop and packaged Electron Mac/Windows resize from 320/390/768/900/1024/1440px at 100% and 200% zoom; keyboard-only Left/Right/Shift/Home/End; mouse/touch pointer cancellation, narrow Focus/back and focus indicators, dirty document/spreadsheet preservation during Focus/Expand, identical Artifact ID/version under owner/Chat switch, P4 ACL negative cases and independent PR review. **Do not claim release/merge or native validation merely from authored source tests.**

**Merge order:** Parent #98 first. Rebase this WS-36 child after #98. Separately coordinate already-updated CSS/test branch #127 with its #125/#126 parent stack, then run shared test gates after integration. Sibling #163 (WS-34) and #167 (WS-35) touch adjacent Artifact flows and must be reconciled rather than overwritten.
