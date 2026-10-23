# WS-09 — Shared Accessible Components, Scoped to Original LiOS

**Date:** 2026-10-23. **UX plan:** [65 workstreams PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), **tracking:** [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). Follow-on WS-09 implements existing `src/client/src/components/ui` primitives instead of introducing another component system or duplicating feature UX owners.

## Actual source inventory / attribution

- `src/components.json` declares the **shadcn** source-component configuration (style `new-york`, CSS variables, `@/components/ui` alias). The implementation is local source; the Radix dependencies already appear in `src/package.json` and its lockfile.
- Canonical wrappers already exist: `dialog.tsx` and `sheet.tsx` use Radix Dialog; `dropdown-menu.tsx` uses Radix DropdownMenu; `label.tsx` uses Radix Label; `input.tsx` and `button.tsx` use the existing Tailwind/CVA patterns; `form.tsx` uses the existing react-hook-form primitives.
- **No Kibo or donor source copied and no new dependency introduced.** This PR changes **LiOS-local** wrappers, retains their original upstream imports/exports, and leaves the existing [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md), pinned npm lockfile, upstream component licensing and source attribution in force. It does not claim a new upstream snapshot or a donor-rights audit.
- [PR #105](https://github.com/kiranvbiim-coder/lios-terminal/pull/105) already owns the Data Connection Center modal and credential UX; [PR #107](https://github.com/kiranvbiim-coder/lios-terminal/pull/107) owns WorkspaceComposer; [PR #111](https://github.com/kiranvbiim-coder/lios-terminal/pull/111) owns Macro Manager; [WS-08 #127](https://github.com/kiranvbiim-coder/lios-terminal/pull/127) owns shell geometry. These components consume the shared Radix wrappers, so the common default should be corrected **once**. Do not rewrite their flows or invent additional modal state machines here.

## Source-level gaps and implementation

1. **Dialogs:** original shared `DialogContent` was fixed at 50%/50% with `w-full max-w-lg`, without a viewport-height cap or scrolling. At short windows or 200% browser zoom, actions in lengthy forms could be physically unreachable. It now has bounded **`100vw - 2rem` width, `100dvh - 2rem` maximum height**, internal vertical scrolling and a clearly focused 40×40px named Close button. Radix still owns Escape, focus trap, dismissal and return focus. Reduced-motion support on the portal overlay/content is preserved.
2. **Sheets:** original left/right `SheetContent` could exceed very short windows; add bounded width/height and vertical scrolling to the actual Radix dialog-backed sheet without replacing `Sheet`, and use a named, keyboard-visible close target. The existing navigation drawer remains the sole owner of its open state.
3. **Dropdowns:** the main Radix portal menu already had an available-height cap but not a viewport-width cap; the nested `SubContent` lacked both height caps and vertical scrolling. Both now constrain width to `100vw - 1rem` and height to the corresponding Radix available-height CSS variable. Item, radio, checkbox and submenu triggers get a **40px minimum target**, preserving keyboard selection and Radix's checked/disabled semantics.
4. **Input:** the existing shadcn-style shared field now uses a 40px minimum height, `min-width:0`, and explicit Tailwind error/focus styling when `aria-invalid=true`, with the existing `ref`, `type`, keyboard focus and disabled forwarding intact.
5. **Real adopter:** `ProjectDestinationDialog.tsx` now uses existing `Label`, `Input` and `Button` wrappers rather than an unrelated raw styling convention. The native Project selector is retained (keyboard accessibility and IDs); explicit `htmlFor`, `aria-describedby`, `aria-invalid` and `role=alert` connect guidance and errors. The **unchanged** `pendingRef` prevents duplicate submission, `setCreated(project)` prevents creating a second Project after a failed move, and permissions/confirmation remain governed by the original onConfirm callback. No credential or tenant logic changed.

## Evidence and validation

**Committed source:** the five shared/adopter source files described above and eight `node:test` source regressions in `src/script/validate_ws09_accessible_primitives.test.mjs`, picked up by the existing `run_project_tests.mjs` test discovery. Source guards confirm the actual Radix wrappers/label/input/consumer and the no-new-state/no-data-egress boundaries. They do **not** prove the runtime's keyboard or CSS behavior.

| Acceptance surface | Status |
| --- | --- |
| Shared component refactor and Project destination adopter committed | IN_PR |
| Source regression tests + exact-head GitHub Linux/macOS/Windows checks | PENDING |
| Real 320/390/768/1280/1440px screenshots | NOT_RUN |
| Native keyboard/screen-reader/200% zoom, long form + nested submenu | NOT_RUN |
| Mac/Windows packaged UI, VoiceOver/Narrator, focus return | NOT_RUN |
| End-to-end saved work destination access and retry/permissions | NOT_RUN |
| Protected-main merge + independent review | PENDING |

Run from the exact reviewed PR head in `src/`:

```bash
node --test script/validate_ws09_accessible_primitives.test.mjs
npm run test:ux
npm run acceptance:ux
```

Then **render** shared Dialog/Sheet/Menu/Input in the installed and browser targets. Inspect Tab/Shift-Tab, Escape, dismissal, focus return, 200% browser zoom, keyboard scrolling to a bottom Save/Cancel action, nested menus at viewport edge, long labels, screen-reader label/error relationships and consent/tenant guards. Compare each with [WS-05 evidence owner #124](https://github.com/kiranvbiim-coder/lios-terminal/pull/124) and link exact SHA+OS+renderer+screenshots/observations to issue #91. Do not equate source-contract passing with WS-09 acceptance or product release.

## Branch and merge safety

This PR deliberately branches from **main**, not stacked #125→#126→#127, because none of those change the selected shared component/adopter files. It can be independently reviewed and merged after exact-head checks without waiting for unrelated CSS feature branches; recheck their changed-files lists before merging. No npm/vendor/donor addition, financial calculations, AI/provider egress, user data, security permissions or extra global UX registry.
