# WS-07 — Readable Typography and Visual Hierarchy

**Owner:** TC / original LiOS shell. **Roadmap:** [65-workstream UX plan, PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119); **canonical progress issue:** [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Parent dependency:** [WS-06 PR #125](https://github.com/kiranvbiim-coder/lios-terminal/pull/125). **Parallel, deliberately untouched source owner:** [Connections accessibility PR #105](https://github.com/kiranvbiim-coder/lios-terminal/pull/105); **rendered baseline:** [WS-05 PR #124](https://github.com/kiranvbiim-coder/lios-terminal/pull/124).

## Code-first gap and scope

Current root styling already bundles offline **Inter** (UI) and **JetBrains Mono** (financial data), imported from Fontsource in `index.css`. The `terminalStyles.ts` entry loads `terminal-shell.css` as final structural authority before the intentionally final Visual Canvas.

Actual source still showed:

- Chat: action controls with explicit `text-[5px]` through `text-[10px]` utilities and reference navigation/Artifact actions with 9–10px font sizes. The existing Project body and composer already have readable overrides; preserve them.
- Workbench: `WorkspacePane.tsx` uses 7px shorthand labels, 8px tickers and 10px headers; the existing original Dockview chrome explicitly defines 10px tab typography.
- Connections: `DataConnectionCenter.tsx` has numerous 7–10px labels, buttons, field descriptions, error/status messages; its outer `Shell` is a **separate page outside `.terminal-root`**. An override limited to `.terminal-root` would not fix it. PR #105 already owns the dialog/focus/connection safety changes; this PR **does not edit** its component.

**Implementation:** one bounded typography addition at the **bottom of existing** `src/client/src/terminal-shell.css`. No new stylesheet, font asset, donor, theme lock, registry or runtime. Named CSS font tokens `--lios-ux-control-type: .75rem` (12px normal) and `--lios-ux-caption-type: .6875rem` (11px normal) are scoped to existing controls. The visual contrast/palette semantics and raw financial chart/data glyphs are not re-colored or indiscriminately resized.

The rule targets only Chat *interactive* microtype, visible original navigation/Artifact actions, WorkspacePane header actions/names and native Dockview tab variables. Connection microtype is scoped using the existing `[data-testid='connect-data']` marker via `body:has(...)`; this scope also reaches portals without touching unrelated sign-in or marketing pages. CSS `rem` units participate in browser font/zoom scaling. **This is source-intent, not measured browser computed CSS or proof of a 200% zoom pass.**

## Regression and evidence

`src/script/validate_ws07_typography.test.mjs` adds seven source-contract tests to the existing automatically discovered `src/script/run_project_tests.mjs` suite. They check actual route/class markers; CSS import order; bundled offline fonts; interactive selector grouping; >=11px caption and >=12px control CSS tokens; Dockview tab values; scoped Connections CSS; preserved finance semantics and the explicit no-native-evidence boundary.

Review these against exact Git commit, including a screenshot at **320, 390, 768, 1280 and 1440px** and tests with browser zoom. Import order and source-match checks cannot prove that every interactive control is readable at every responsive breakpoint.

| Acceptance | Status |
| --- | --- |
| Source styles and regression test code committed on PR | **IN_PR** |
| Exact-head Linux/macOS/Windows CI | **PENDING** |
| Chat/Artifact UI at normal text size | **NOT_RUN** |
| Connection Center actual dialogs/forms after PR #105 | **NOT_RUN** |
| Dockview actual tabs/actions after original P4/Workbench PRs | **NOT_RUN** |
| 200% zoom | **NOT_RUN** |
| Keyboard-only focus order, clipping, VoiceOver/Narrator | **NOT_RUN** |
| Native signed macOS and Windows app acceptance | **NOT_RUN** |

### Reproduction / follow-up

From `src/` on the exact reviewed branch with Node 22 and checked-in dependencies:

```bash
node --test script/validate_ws07_typography.test.mjs
npm run test:ux
npm run acceptance:ux
```

Then run the genuine rendered/installed app and check computed CSS (not just class names), zoom at normal/200%, overflow, readable status/label relation and keyboard focus. Use WS-05 evidence PR #124 and attach screenshots/logs to issue #91 with exact commit and OS/build. This PR should merge **after** its WS-06 parent #125 is approved/merged, rebased on the reviewed protected main, with #105 dialog changes preserved. Source passing alone does not close the WS-07 acceptance gate.

## Scope boundaries

No blanket 12px font applied to all analytical panes or charts. No oversized row/panel dimensions are asserted to fit narrow screen widths: WS-08 owns responsive geometry, and WS-05 owns rendered evidence. No data source, provider entitlement, AI execution, permission, office Artifact revision or financial semantic calculation changed.
