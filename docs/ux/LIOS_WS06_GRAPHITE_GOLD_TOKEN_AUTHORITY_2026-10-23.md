# WS-06 — One Graphite/Gold Design-Token Authority

**Workstream:** WS-06, Phase 2 of the [65-WS adaptive UX plan](https://github.com/kiranvbiim-coder/lios-terminal/pull/119). **Product owner:** existing TC/UX; **canonical master issue:** [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). This is a targeted implementation/evidence note, not a new roadmap or duplicate acceptance register.

## Existing main audit (2026-10-23)

- `src/client/src/main.tsx` imports `terminalStyles.ts`; `visualSmoke.tsx` also uses that same import for the Electron synthetic screenshots.
- `terminalStyles.ts` already imports `index.css` first and `terminal-shell.css` last **except for the deliberately final Visual Intelligence Canvas**. The shell is the one real structural/palette arbitration layer. Do not import a second theme.
- `terminal-shell.css` defines the approved **graphite** app/panel hierarchy (`#09090b`, `#07070a`, `#111115`) and **gold** brand (`#d4a017`); `index.css` provides Tailwind and legacy HSL defaults that are overridden by that canonical shell. Consumer styles use both full-color `--lios-*` and the HSL `--primary`/`--up`/`--down` bridge.
- Unimported `terminal-theme-lock.css` still held a conflicting prior `#050505`/`#f69f0a` palette and claimed to load last; code search and active entry inspection did **not** find an import. It is retired by this PR without replacing the existing active styles.
- The **real crash recovery fallback** in `main.tsx`, which renders outside `.terminal-root`, used old hard-coded `#050505`, `#080808` and `#F69F0A` color classes even though the canonical shell has newer tokens.

## Change boundary and rationale

1. **No new theme/framework/import.** Delete the unused competing `terminal-theme-lock.css`. Keep the canonical `terminalStyles.ts` import order and palette source intact.
2. **Fix one actual consumer:** connect crash recovery app/panel backgrounds and gold copy/action to existing `--lios-bg-app`, `--lios-bg-panel`, `--lios-brand` variables. Add a scoped hover/focus rule to `terminal-shell.css` so the recovery action has a visible keyboard focus ring. Keep red failure semantics independent from finance up/down.
3. **Prevent regression:** `src/script/validate_ui_token_authority.mjs` fails on another active or retained theme lock, duplicate/reordered shell imports, altered canonical palette, mismatch between RGB colors and HSL semantic bridges, or source token combinations below 4.5:1 readability contrast. It reports **source-contract-pass**, not browser or native acceptance.
4. **Negative test coverage:** `src/script/validate_ui_token_authority.test.mjs` exercises theme duplication, wrong import order, mismatched finance direction, illegible text, crash-fallback drift and the unqualified native-evidence boundary. It is automatically picked up by the existing `src/script/run_project_tests.mjs` script group.

## Verify

From a clean checkout of this exact PR head, in `src/`:

```bash
node script/validate_ui_token_authority.mjs
node --test script/validate_ui_token_authority.test.mjs
npm run test:ux
npm run acceptance:ux
```

Review the repository-wide hosted Linux/macOS/Windows checks on the **exact PR SHA**; keep source checks distinct from actual rendered evidence.

**What remains NOT_RUN here:** browser-computed style snapshots at 320/390/768/1280/1440px, error fallback screenshot/keyboard walkthrough, actual packaged Mac/Windows, VoiceOver/Narrator, and real signed-in Chat/Artifact/Workbench journeys. WS-05 [draft PR #124](https://github.com/kiranvbiim-coder/lios-terminal/pull/124) owns the visual evidence and should be reviewed independently before claiming a fully accepted WS-06. WS-07 owns microtype/size and WS-08 owns responsive layout, not this theme cleanup.

## Exit criteria

- [x] Unique active graphite/gold design-token source preserved (same imported terminal shell).
- [x] Unused conflicting theme-lock stylesheet removed in this PR.
- [x] Crash fallback switched to canonical token references, with focus-visible styling.
- [x] Source guard and negative regression tests added.
- [ ] Exact-head source CI passed, independent review, merged to protected main.
- [ ] WS-05 computed rendering and installed-product accessibility evidence linked and reviewed.

**Scope:** no framework/donor import, no changed semantic market colors, no financial data, no new UI runtime, no second style/permission/store authority.
