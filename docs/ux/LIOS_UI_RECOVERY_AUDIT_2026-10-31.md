# UI/UX recovery audit: what was actually unmerged (2026-10-31)

Method: fetched the head of every closed/unmerged PR (297 with number >= 50) and compared its tree with `origin/main`
(605cbd0) by blob hash, not by title or by trust in PR descriptions.

## Result
- 398 PRs in total: 57 merged, 340 closed unmerged, 1 open (#403). 208 of the closed ones were stacked on other branches, and
  the large `integrate(P0/UI A/B)` bundles (#324-#343) are cumulative copies of work that landed through #194, #322, #364 and #389.
- **Source files added by an unmerged PR and absent from main: 16 distinct files**, across 26 PRs. Test-only and docs-only files excluded.
- **Files where an unmerged PR's change never reached main: 21** (main still equals the PR's merge-base version).
- Client components not imported by anything: only the shadcn primitives in `components/ui/`. No feature component is stranded.

## Disposition of that residue
| Item | Decision |
|---|---|
| #403 (Workbench action, Project shortcuts, visuals in Chat, readable fallback viewer, typed P9 event filters) | Merged into this integration branch |
| #252 changes to TickerTape, CorrelationPanel, runtimeTraceSummary, artifactPackage, others | Left out: they would revert newer logic already on main (reduced-motion handling, shared Pearson helper, version-history replay) |
| `PulseSubjectActions`, `reconcileUnconfirmedRunPrompt`, `clampConversationSidecarWidth`, `sourceCatalogueStatus`, `useAccessibleDialog` | Left out: no importer on main and the feature exists elsewhere (Follow/Mute in `FusionPulseBoard`/`LiosPulseStoryCard`, "Inspect original run history", keyboard-resizable sidecar) |
| Source-text "integration" tests (`website*Integration.test.ts` etc.) | Not re-added: they pin file contents, not behaviour |
| Dependency-bump PRs | Out of scope |

## Conclusion
The reported fragmentation was not missing code. The visible gaps were reachability and rough edges in the product:
Workbench from Chat, Project tools, saved visuals in Chat, raw JSON, hidden admin views, Chat and Workbench disagreeing about
market data, and the Chat->Workbench autosave trap. Those are what this PR changes.

## Duplicates removed in this PR
A parallel `ReadableValue` component was folded into the existing `ReadableValueTable`/`artifactReadableFormat` (21 call sites),
and the earlier session's removal of the P7-P14 acceptance validators and their `package.json` gates was reverted.

## Smoke of the exact branch (packaged beta.11, `--dir`, ad-hoc, isolated profile)
First run to workspace; Chat analysis with the analysis card and the "Workbench" action; Project home with Research/Briefings/Watchrooms;
Briefings shortcut opens Briefing Studio with an honest empty state; no renderer errors. Windows, VoiceOver, installer and live paid providers not exercised.

## Needs owner confirmation
The earlier session's UI deletions remain: the old `IntelligencePulse` overlay (Pulse now lives in the experience shell), `IntegrationTrackerPanel`,
`MinimalProjectsHeader`, `SignatureEntryBackdrop`, `EnvironmentSetup`, `ExperienceCenter`, `PersonaOnboarding`, `ws-controls-smoke`, and `publicRoutes` (anonymous lead capture).

## Second pass: the donor UI was imported but hidden (Discover integration)
The owner reported seeing no UI/UX update. A separate check against the local 455-commit integration branch `omp/finance-terminal-chat` found only 208 of its 7,601 added client lines (2.7%) absent from this branch; the lines are older revisions of components main has since rewritten (receipt list, `ChatTerminalControl`, source-list href helper), so nothing needed recovery. The cause was reachability:

- **Pulse discovery (the beUI tabs/citations and Watermelon story-card work, #264-#356) opened only with `Ctrl+Shift+U` (or `⌘⇧U`) and, when opened, swapped the whole app into the legacy sidebar and header.** Explore, Signals and Library had the same behaviour. The main navigation had no entry for any of them.
- The relationship graph, impact map, scenarios, decisions, trust ledger, evidence and research tray overlays opened only through other keyboard chords.

Change: `Discover` is now a section of the Chat shell (`DiscoverSurface`, hosting the existing `WaveCExperienceShell` with its legacy brand/Master-AI header removed and Pulse/Explore/Signals/Library as tabs). It sits in the same sidebar, compact rail and mobile sheet as Chat. "Ask LiOS" on a story stages the existing reviewed draft in Chat (nothing is sent). Every old entry point (shortcut, command palette, dock, stored surface) now lands in this section, and the duplicate full-screen mount in `Terminal.tsx` was removed. The seven analysis overlays have visible buttons in Discover and in the composer's Tools menu from one registry, `lib/intelligenceViews.ts`. `discover` is also a command-palette destination (aliases: pulse, explore, stories, news).

Exercised in a fresh isolated source Home with local Ollama: Discover shows eight live-feed stories; the card Inspect / Follow / Mute / Ask / Open analysis controls render; Ask puts the story question in the composer; Explore tab and Relationship graph overlay open; 390 px width has no horizontal overflow. `npm run check` passes. The React render tests first failed here with "Cannot read properties of null (reading 'useMemo')" because the local worktree held a stray nested `node_modules/node_modules` (a second React copy from an earlier clone); after removing that local artifact the navigation test (now expecting the Discover label) and the licence-banner and editorial-image render tests pass.

Not done: the Workbench keeps its dense terminal styling (it is the specialist surface); unimported beUI families (Sankey/treemap/funnel charts, tool-approval, streaming-response, prompt-input, toast stack) and further Watermelon dashboard pieces remain candidates, none claimed.
