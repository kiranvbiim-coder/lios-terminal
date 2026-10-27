# LiOS — actual code → working product gap audit (2026-10-27)

**Scope:** public `kiranvbiim-coder/lios-terminal`, exact cumulative UI/visual feature heads `#306 → #309 → #312`, contrasted with stacked direct donor `#305`. This report records *observed* evidence, not a future release claim. The $0 extra-spend beta policy in `AGENTS.md` and `docs/technical/LIOS_ZERO_COST_RELEASE_EXECUTION.md` remains authoritative.

## Required vocabulary (use this on every next workstream)

- **SOURCE IMPLEMENTED**: actual imports/call sites exist on a named Git SHA; a PR title or README is insufficient.
- **SOURCE VERIFIED**: exact-head checks completed successfully on the named OS (TypeScript, offline tests, security/licence/asset checks, build). A green *subset* is not an all-green candidate.
- **UX EXERCISED**: run the real user journey with real Project/source scopes, denial, stale data, accessibility, resize, offline, cancellation and a retained screenshot/session record; source tests do not establish this.
- **NATIVE BETA QUALIFIED**: actual packaged Windows x64 and macOS ARM64 installations, sidecars, permissions, updates/rollback and P14 evidence have been exercised under the $0 beta rules. Never equate this with production signing/notarization.
- **MERGED/SHIPPED**: explicit GitHub merge/release event, not an unmerged draft or successful branch build.

## Findings from actual hosted GitHub Actions

| Workstream | Exact source | Observed evidence | Status |
|---|---|---|---|
| Four-phase P0 convergence | [#306](https://github.com/kiranvbiim-coder/lios-terminal/pull/306) head `c893d4d`, [run 40496922525](https://github.com/kiranvbiim-coder/lios-terminal/actions/runs/40496922525) | Linux and Windows completed **success**, including typecheck, offline contracts, B3/C1/C2/C3/D1/D2, Phase 4 source controls, donor/OSS audits, desktop source tests, Python and build; macOS was queued when checked | Source verified only on Linux and Windows; **not** installed QA |
| Sprint B standalone (inherited Sprint A) | [#307](https://github.com/kiranvbiim-coder/lios-terminal/pull/307), [run 40496392310](https://github.com/kiranvbiim-coder/lios-terminal/actions/runs/40496392310) | Linux/Windows/macOS source jobs **failed**; log reports malformed JSX in `ProvenanceDrawer.tsx` | Not working as compilable whole app |
| Combined source A/B + valuation | [#312](https://github.com/kiranvbiim-coder/lios-terminal/pull/312) head `8e0cc26`, [run 40502817960](https://github.com/kiranvbiim-coder/lios-terminal/actions/runs/40502817960) | Linux completed offline, B3–D2, OSS, desktop source, Python tests **success**. Typecheck failed with TS2657 line 64 and TS1005 line 92; build failed with missing JSX closing brace line 89; asset-budget step then failed because build did not produce required output. Other OS jobs were in progress at inspection | Feature code/test presence does **not** mean compilable app |
| Corrective workstream | Current draft branch `fix/p0-sprintab-provenance-jsx-ci-20261027` | Closed missing JSX `}` after Sources-tab summary; added `typescript.transpileModule` TSX parse assertion to existing Sprint B integration test, which previously only searched source text | Patch committed; exact-head hosted checks and installed exercise still required |

A passing *source-text-only* test such as `assert.match(ui, /filterPublishedSources/)` does not prove the component parses, mounts or responds to a user. The regression assertion is now added, not claimed green until exercised in CI.

## Donor import reality, not checklist inference

Compared the **actual file blobs** on #305 and the audited branch:
- `PulseDiscoveryTabs.tsx`: exact same blob `09949f2`; imported by `FusionPulseBoard.tsx` and rendered in the real channel navigation.
- `ProjectContinuationActivitiesCard.tsx`: exact same blob `5b1f4f5`; imported and rendered by `ProjectContinuityPanel.tsx`.
- `ProjectSpreadsheetImportField.tsx`: exact same blob `a662f3b`; imported and rendered by `ProjectArtifactsPanel.tsx`, still calling the preexisting governed `importSpreadsheetArtifact(projectId, file)`.
- Parent *screens* differ because #306's cumulative app has additional Project/Pulse features; **never overwrite those screens with #305's old variants**. Source/registry rights and installed drag/drop/accessibility checks are still distinct.
- A source pin/notice entry confirms donor rights metadata, **not** that every upstream feature was imported or that a native user journey works.

## Highest-priority gaps after this patch

- [ ] **P0 compilation:** exact-head Linux/Windows/macOS `npm run check`, `npm run build`. Inspect every failure, not just this first syntax error. Keep draft on any red check.
- [ ] **P0 feature behavior:** exercise Sprint A Omnibox (keyboard/focus and command authority), layout save/default with unsaved P4 draft, observed AI activity/Stop/approval, contextual actions.
- [ ] **P0 research behavior:** mount graph/compact-list with large/empty/denied sources; test relationship filtering, source inspector/revoked or malicious links; exercise provenance search and filter with real published data and empty states; compare distinct receipts and warnings.
- [ ] **P0 source correctness:** run full `npm run test:offline`, `npm run test:desktop`, B3–D2 targeted suites, `npm run audit:oss`, `npm run audit:licenses`, `npm run release:preflight:ci`; verify 56 pinned donor entries and snapshot hashes remain consistent.
- [ ] **P0 packaged valuation:** #309 added authenticated reverse-DCF **sidecar** known-answer smoke; no installed Electron → Node API → Python response evidence yet proves the previously observed HTTP 502 is gone.
- [ ] **P0 native qualification:** real $0 beta package installs on Windows x64 and macOS ARM64; authentication, permissions, source revocation, Office native editable round-trip, 390px, 200% zoom, keyboard/screen reader, secrets, update/rollback and native screenshots/logs.
- [ ] **P1 branch consolidation:** review precise #305 overlap, avoid second donor import; reconcile candidates only after checks. Existing #304/#307 ancestry is already included in #312; do not merge stacked originals again.
- [ ] **P1 merge/release:** enforce `main → #306 → #309 → #312 → corrective patch` or an explicitly reviewed one-time squashed equivalent. Unmerged code is not shipped.

## Actionable validation recipe

On the **final exact commit**, from `src` (no paid CI or new services):

```bash
npm ci --no-audit --no-fund
npm run check
node --import tsx --test client/src/lib/sprintBIntelligenceIntegration.test.ts
npm run test:offline
npm run test:desktop
npm run audit:oss
npm run audit:licenses
npm run release:preflight:ci
npm run build
```

Run on supported CI OSes; retain real logs. Native beta validation stays **separate** and cannot be certified by this recipe. A source-only fix cannot independently justify closing the product readiness issue [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). Re-open/fix any newly revealed compiler or test error before continuing donor or UX expansion.


## Continued exact-source repair after initial audit (same draft PR)

The first TSX repair closed the SyntaxError on the original Sprint B branch, but the **new** #313 hosted jobs still showed Typecheck failure on their first head `0cd7cf5`. An independent cumulative CI recovery effort, [#311](https://github.com/kiranvbiim-coder/lios-terminal/pull/311), documented a concrete next diagnostic: `ConversationRuntimeTrace.tsx` passes an existing `ConversationRuntimeEvent[]` whose `stepId` may be `null`, whereas the imported `observedRunActivity` originally accepted only `stepId?: string` (TS2345). Do not create a second agent state owner; the display-only helper can simply accept nullable source event identifiers and continue to ignore them.

### Additional corrections committed on this draft

- [x] Reused the **exact #311 source blobs** for `sprintAObservedActivity.ts` (`3664fae`) and its nullable-status regression (`0ea7d3e`): `stepId?: string | null`, zero invented completed steps. This does not bypass governed approvals.
- [x] Reused exact #311 `server/acp/runtime-capabilities.ts` blob (`49d7e6c`) plus added its existing test: the actual built server uses CommonJS; default capability read must not dereference unsupported `import.meta.url`. The read-only inventory still reports no executable agent authority.
- [x] Reused exact #311 `desktopPythonSidecar.cjs` (`56d3048`) and `desktopPythonSidecar.test.cjs` (`410a008`): redact diagnostic bodies and captured stderr, preserve safe route/status classification, drain worker pipes, and cover HTTP 502/secret-leak regressions. This improves diagnostic security **without** proving the old packaged 502 is resolved.
- [ ] Verify all of the above on **the updated exact PR head**, not the earlier failed `0cd7cf5`. The GitHub source write confirms bytes, not test execution.
- [ ] Native installed Electron → Node → authenticated Python route and real user-level visual/keyboard/accessibility acceptance remain separate hard blocks.

### Consolidation guard

#311 is itself a divergent main-targeting cumulative draft containing additional Sprint C/D/E changes. Only the **verified-needed, narrowly overlapping** helper, capability and diagnostic files above were selectively carried here. Do **not** call #311 completely integrated or close/merge it merely because these bugs were fixed on this branch. Its remainder needs separate file-level reconciliation with #306/#309/#312/#313.
