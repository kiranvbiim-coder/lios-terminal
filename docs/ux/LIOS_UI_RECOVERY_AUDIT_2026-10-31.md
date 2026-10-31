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
