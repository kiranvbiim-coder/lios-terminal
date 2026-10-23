# WS-11 — Reduced Motion, Focus Restoration and Truthful Interaction Feedback

**Date:** 2026-10-23. **Plan:** TC/UX 65-workstream execution plan ([PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119)), tracked under [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). Implementation is in original LiOS source, not a second animation system, UI framework, telemetry service or new interaction state registry.

## Verified preexisting code and gaps

- `terminal-shell.css` **already** disables transition/animation timing under `@media (prefers-reduced-motion: reduce)` for `.terminal-root` and honors `data-reduced-motion=true`. `project-conversation-shell.css` covers Chat descendants. **Radix dialogs/dropdown menus portalled into document.body fall outside `.terminal-root`**, so these rules alone cannot guarantee reduced motion for floating menus and overlays. [WS-09 PR #129](https://github.com/kiranvbiim-coder/lios-terminal/pull/129) adds `motion-reduce` classes to shared Dialog/Sheet; this PR supplements that without editing the same components.
- `ProjectLifecycleDialog.tsx` had explicit focus return, but deferred it with `requestAnimationFrame`, which can move keyboard focus a frame **after** dismissal. It also called the request's `resolve` function each time close/submission occurred; a close event and submit/cancel could potentially resolve twice.
- The existing `LifecycleCenter.tsx` ran asynchronous archive/trash/restore/permanent-delete actions with no operation lock or `aria-busy` feedback; rapid repeated actions could send duplicate mutations. `window.confirm` cancellation still called `onInvalidate()`, falsely implying that an operation had succeeded. Error handling and the original explicit permanent-delete confirmations already existed: preserve them.

## Implementation scope

1. Append a single `@media (prefers-reduced-motion: reduce)` rule to **original** `src/client/src/index.css`, applying to document-level Radix dialog, menu, popper, and open/closed overlays including pseudo-elements. Set only tiny animation/transition timing and nonanimated focus scrolling; do **not** hide, disable, unmount or alter UI semantics. Existing terminal-level motion preferences remain authoritative for in-shell elements. This honors **OS/browser reduced motion**, not an implied guarantee that the app-specific terminal preference propagates to every body portal.
2. `src/client/src/components/terminal/ProjectLifecycleDialog.tsx`: guard settlement by identity of the exact lifecycle request so submit/dismissal can resolve it **once**. Restore the provided connected focus target synchronously in Radix's `onCloseAutoFocus`, with `preventScroll`, rather than scheduling focus theft in a later animation frame. Provide actual required-name semantics, visible keyboard focus/minimum height for Cancel/Confirm, and a truthful **Confirm** label when the action is not a rename. No new modal implementation: Radix owns open/close, Escape and trapping.
3. `src/client/src/components/terminal/LifecycleCenter.tsx`: synchronously lock an in-flight lifecycle action before React re-renders, show accessible `role=status` / `aria-busy` **only while truly applying**, and disable subsequent restore/delete actions through the original `ObjectActionMenu` contract. Disable switching tabs/closing while applying. Treat native confirmation **Cancel** as `false`, so no optimistic refresh or success event is emitted. Preserve existing data permissions, server callbacks, dependent-object warnings and retries/error feedback.

## Tests, overlaps and evidence

- `src/script/validate_ws11_motion_focus_feedback.test.mjs`: ten source contract cases, auto-discovered by `src/script/run_project_tests.mjs`, covering *actual* portal scope, existing reduced-motion rules, no hiding of motion-sensitive UI, exact once resolution, synchronous focus return, label semantics, early busy lock, native cancellation, and existing menu disable propagation.
- **No donor/third-party source imported, no new packages, lock changes, CSS theme fork or API changes.** [PR #114](https://github.com/kiranvbiim-coder/lios-terminal/pull/114) already owns WorkSearchDialog (async and dismissal logic), and [PR #129](https://github.com/kiranvbiim-coder/lios-terminal/pull/129) owns shared Radix dialogs/menus; this PR deliberately avoids both component files. Existing WS-06/07/08 CSS PR chain #125→#126→#127 changes `terminal-shell.css` and `project-conversation-shell.css`; this PR edits `index.css` only for motion CSS, so it can target main independently. Confirm merge conflicts again against latest PR heads.

| Check | Status |
| --- | --- |
| Source implementation and ten regression tests authored on draft PR | IN_PR |
| Exact-branch Node/TypeScript test command + hosted CI | PENDING |
| Real Radix portal at 320/390/768/1280/1440px, keyboard tab and Escape | NOT_RUN |
| 200% zoom, focus restoration after cancel/save | NOT_RUN |
| Actual double-click/delete-confirm Cancel, slow network, retry sequence | NOT_RUN |
| VoiceOver/Narrator plus installed macOS/Windows app | NOT_RUN |
| Independent review, protected-main merge and release acceptance | PENDING |

On the exact reviewed head in `src/`:

```bash
node --test script/validate_ws11_motion_focus_feedback.test.mjs
npm run test:ux
npm run acceptance:ux
```

Then run **real** desktop/browser fixtures including OS reduced motion on/off; keyboard Tab/Shift+Tab/Escape/Enter through portalled dialogs and dropdowns; focus on the original launching control after modal dismissal (including when the original control has been removed); lifecycle buttons during simulated slow mutations and after cancellation, success and error; and 200% zoom. Record exact SHA, OS, renderer, screenshots and any limitations under issue #91. Source assertions are **not** browser, screen-reader, performance or signed-native acceptance.

**Next:** WS-12 contextual visual environments; it must preserve these reduced-motion and focus constraints when choosing local visual scenes.