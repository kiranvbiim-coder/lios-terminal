# TC / SI-07 — Theme and typography visual acceptance

**Scope:** Stacked #221 → #222 → visual convergence PR. This document defines
how to check the existing LiOS-owned shell, not a new UI/theme subsystem.
Follow the canonical [UX contract](../LIOS_UX_SYSTEM.md), issue #91, and
[P14 native qualification](P14_DESKTOP_LAUNCH_QUALIFICATION.md).

## Source regression and contrast

- `npm run check`
- `node --import tsx --test client/src/lib/liosProductPalette.test.ts client/src/lib/liosProductExperience.test.ts client/src/lib/terminalThemeLock.test.ts`
- `npm run test:ux`
- `npm run test:offline`
- `npm run build`

The automated typography/theme test checks WCAG AA 4.5:1 *normal-text*
contrast for primary/secondary labels, links and small action text on the
main app surface across four reference themes. It separately checks Claude
Light's warm panel accent and verifies that its decorative terracotta is
**not** reused as low-contrast small text. These **source-level** checks are
not screenshots, browser-computed style checks or formal WCAG certification.

## Deterministic screenshot entry points

The existing visual-smoke browser harness now accepts a **test-only**
`palette` query string without reading or persisting an actual user's
Appearance preference. An absent/invalid parameter uses LiOS Classic so
previous fixtures and smoke screenshot baselines remain stable.

When the local client test server serves `/visual-smoke.html`, open
`/visual-smoke.html?case=conversation&palette=chatgpt-dark`,
`/visual-smoke.html?case=conversation&palette=chatgpt-light`,
`/visual-smoke.html?case=conversation-artifact&palette=claude-light`,
`/visual-smoke.html?case=project-home&palette=claude-dark`, and
`/visual-smoke.html?case=workbench-real&palette=lios-classic`.
Also compare the **same case** under all five palettes, at 390×844,
768×1024, and 1440×900. Wait until `data-visual-smoke-ready="true"`
before capturing a screenshot. Capture the DOM's `data-lios-palette`
and `data-theme` together with the screenshot. These are
**deterministic source fixtures**, not authenticated real-user journeys;
native acceptance below remains mandatory.

## Rendered journey / native acceptance checklist (evidence pending)

Test **ChatGPT Dark, ChatGPT Light, Claude Light, Claude Dark and LiOS Classic**
on an actually installed application on **macOS and Windows**; verify both
standard and low-resource modes where applicable. Capture OS, install/package
hash, target commit, active palette, screenshots and explicit pass/fail.

1. **Signed-in regular Chat**: first visit, empty-state hero, prompt starters,
   2-line composer, suggestions/mentions, new and existing messages, code block,
   citations, link, quote, long tables, error/status and copy actions.
2. **Navigation and Appearance**: sidebar rail, expanded/collapsed projects,
   Account → Appearance submenu, swatches, selected radio state, focus return,
   keyboard navigation, user avatar, narrow-mobile drawer, logout.
3. **User-owned persistence**: select a palette, reload/restart, return to a
   saved Quick Chat and existing Project; verify palette persisted **locally**
   and Chat drafts, IDs, permissions, Artifact revisions were not changed.
   Temporary Chat content must remain non-persistent.
4. **Projects and Artifacts**: Project Home cards, edit Project name, saved
   Artifact chip, open original sidecar, Artifact/Evidence/History tabs,
   unsaved edit warning, focus mode and keyboard scroll, return to Chat
   with the exact same context and revision.
5. **Connections and Plugins**: after the existing #219/#220 connection
   chain is reconciled, open modal and embedded drawer from Chat. Check
   backgrounds, form inputs, disabled/approval/warning states, error text,
   dark/light contrast, return focus, and preserved Chat draft.
6. **Professional Workbench**: Expand Workspace and return, verify Dockview
   tabs, source/data panels, tabular-number/code fonts, market up/down semantics,
   no hidden or cut-off finance controls, screenshot parity across palettes.
7. **Viewport/a11y**: 390px, 768px, 1280px+ widths; high DPI, 200% text zoom;
   light-mode contrast, no forced white-on-white or black-on-black text,
   44px touch targets where required, accessible focused input/buttons and
   horizontal scroll in markdown tables. Test reduced motion and keyboard/
   screen-reader labels for user vs LiOS responses.

**Release truth:** This checklist is NOT evidence that the installed targets,
signed builds or P14 were validated. Hosted source CI does not prove native
installed UX. Mark individual scenarios accepted only with reproducible
screenshot/video, build ID and actual observed outcomes. Never auto-merge
stacked theme PRs based solely on static assertions.
