# WS-08 — Responsive Shell and Density: Chat, Artifact, Workbench

**Date:** 2026-10-23. **Plan:** [TC/UX 65-workstream plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Parent:** [WS-07 #126](https://github.com/kiranvbiim-coder/lios-terminal/pull/126) → [WS-06 #125](https://github.com/kiranvbiim-coder/lios-terminal/pull/125). **Evidence owner:** [WS-05 #124](https://github.com/kiranvbiim-coder/lios-terminal/pull/124).

## Actual source findings

- The Chat/Artifact layout is a single `lios-project-chat-surface` (`container-type:inline-size; container-name:conversation`), while a previously forced **348px** non-focused `lios-artifact-sidecar` competes with the 260px desktop sidebar and conversation at widths around 768–1000px. Viewport-only mobile rules do not protect this case. Existing code has an **Open artifact** button in the Chat header; the same `ConversationArtifactSidecar` supports `focus` and **Exit Focus**. The Artifact preserves local unsaved edits and may not be evicted merely to fit.
- At narrow conversation widths, `lios-conversation-header` contained a no-wrap title plus multiple actions in one row. Source CSS only keyed header wrapping on **viewport 760px**, not a 560px remaining container (e.g. a 1024px window with navigation).
- The existing composer owns Sources, Tools, Voice and Send in one flex row. At narrow widths/200% zoom, flex children can be clipped instead of wrapping.
- Real Workbench renders `WorkspacePane` with a `lios-pane-header` whose actions have `shrink-0` but the header has `overflow-hidden`; Dockview may shrink a single pane even in a wide overall window. Existing `ProfessionalWorkspaceGrid` already has mobile one-pane-with-scrollable-switcher semantics; **do not** introduce another pane renderer or drop any pane.
- [PR #107](https://github.com/kiranvbiim-coder/lios-terminal/pull/107) already owns accessible WorkspaceComposer/mobile responsive object library and pane creation. [PR #102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102) owns Chat and saved Artifact interaction state. This PR avoids editing those React components.

## Implemented, without duplicate architecture

1. Append scoped `@container conversation` rules to the **existing** `src/client/src/components/terminal/project-conversation-shell.css`. Below **900px actual conversation width**, hide only the non-focus Artifact column via `display:none`; it **stays mounted** and Chat can reopen its focus layout via existing `Open artifact`. A focused Artifact lacks the non-focused CSS class, so it remains visible with **Exit Focus**. Above 900px, use bounded `clamp(20rem,36%,28rem)` rather than frozen 348px split.
2. At **560px conversation width**, let the Chat header title occupy its own row and allow subsequent actions to wrap. At **420px**, wrap the existing composer controls without replacing or resetting its draft.
3. In the original canonical `src/client/src/terminal-shell.css` (after inherited WS-06/07 rules), name a container for existing workspace panes; below **480px actual pane width**, make clipped pane header commands *horizontally scrollable*, retaining every close/maximize/context control. Give the original mobile pane switcher scroll padding, readable labels and visible keyboard focus.
4. Add eight source regression tests under `src/script/validate_ws08_responsive_shell.test.mjs` to detect regressions in container scopes, focus/no-focus Artifact states, unmodified Chat composer actions, Workbench tab switching and draft-preserving behavior.

## Verification matrix

| Check | Status |
| --- | --- |
| Implementation committed on WS-08 branch and PR | IN_PR |
| Exact-head Node source tests, hosted Linux/macOS/Windows | PENDING |
| 320 / 390 / 768 / 1280 / 1440 viewport images, real controls and geometry | NOT_RUN |
| 200% zoom: all Chat, Artifact, pane actions reachable | NOT_RUN |
| Keyboard-only: pane header horizontal scroll and focus order | NOT_RUN |
| VoiceOver/Narrator: installed macOS/Windows | NOT_RUN |
| Real authenticated Chat + saved Artifact dirty-draft survival during resize | NOT_RUN |
| Signed Desktop/native shippability or SP/P14 acceptance | NOT_RUN |

### Test commands

From exact checked-out branch head in `src/`:

```bash
node --test script/validate_ws08_responsive_shell.test.mjs
npm run test:ux
npm run acceptance:ux
```

For runtime acceptance, record **computed** panel widths and horizontal overflow, focused/keyboard-reachable buttons, and before/after Artifact dirty-draft state at each listed size. Check opening an Artifact at narrow width, exiting Artifact Focus, resizing wide/narrow and switching every Workbench pane in both directions. Capture actual screenshots from [WS-05 #124](https://github.com/kiranvbiim-coder/lios-terminal/pull/124) plus a signed-in local target (never real credentials or user data in public artifacts). Document exact commit, OS, renderer target, input method and outcome under issue #91.

## Merge and ownership safety

WS-08 branches from WS-07 #126 because both edit the single canonical `terminal-shell.css`; #126 branches from WS-06 #125. The WS-08 PR should target #126, then be rebased/retargeted to protected main **in order** after independent review/CI, without confusing the source-only improvements for finished acceptance. Other Chat/Composer/Artifact PRs retain their own owners. WS-09 owns shared accessible controls, not this layout patch.
