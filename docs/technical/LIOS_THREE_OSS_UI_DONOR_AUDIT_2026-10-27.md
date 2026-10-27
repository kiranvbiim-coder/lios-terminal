# LiOS open-source UI audit and three-donor integration — 2026-10-27

## Audited codebase and target

Target: **public `kiranvbiim-coder/lios-terminal`**. Read the actual full recursive file trees: public `main` had **3,316 entries**; active reviewed UI branch based on PR #302 and preceding #305 had **3,485 entries**, untruncated, before this follow-on. Read `src/package.json`, `src/client/src/components/terminal/{GraphExplorer,ProjectEvidenceGraph,SpatialResearchCanvas,VisualIntelligenceSearch,ChatTerminalSurface,ProjectContinuityPanel,ProjectArtifactsPanel,FusionPulseBoard,WorkspaceComposer,ProjectAutomationPanel,ExecutionSessionPanel}.tsx`, the registered component/lock manifests, past donor integration branch and targeted tests. Feature claims are based on inspected source, **not** descriptions alone.

Existing tech is React 18, Tailwind 3, Framer Motion 11, Radix, `cmdk`, ECharts/Recharts, TipTap and Dockview. Existing capable local graph pan/zoom, compact lists, offline world map, analysis workspaces, Chat, existing P4 Artifact revision authority, P6 continuity, P9 automations and source-backed Pulse mean duplicating shells and adding large renderers is not an immediate priority.

## Selected three solid MIT donor repositories (real code, not theme references)

| Repository / pinned exact source | Existing LiOS problem | Imported and connected result |
|---|---|---|
| **`starc007/ui-components` (beUI)** `41a330ba66684696c445d58ca5d77c0133d4059a` `components/motion/tabs.tsx` and `fa3393a3891723d4d2daec1f1d82ead175442f44` `components/motion/button/base.tsx` | Four tiny unreadable Pulse channel buttons with no arrow/Home/End handling; static Workspace Apply action | `PulseDiscoveryTabs.tsx` replacing the existing Pulse buttons and forwarding the original channel handler; existing `vendor/beui/BeuiButton.tsx` in Workspace Composer retains its original guarded apply handler |
| **`WatermelonCorp/watermellon-registry`** `86052b8fd12bc19bf3bac07625a7f93736c42b17` `src/components/watermelon-ui/activities-card-base.tsx` | P6 Continuity had a hardcoded 8-row mini-list, weak disclosure, unscoped workflow-scroll action | `ProjectContinuationActivitiesCard.tsx` replaces the old list with accessible collapsible real P6 records; workflow review focuses exact visible P9 record, never executes or edits it |
| **`bidyut10/opensourceui`** `892f486fdf0d46a44b21ddf3fa32a41a3a71173a` `components/inputs/file-upload-field-input.tsx` | Existing Project Library file picker immediately invoked the importer with no file review | `ProjectSpreadsheetImportField.tsx` adds validated local XLSX/XLSM/CSV choice, explicit review and user confirmation before the **existing** canonical Project `importSpreadsheetArtifact` path; old immediate-upload input removed |

Existing **Kibo UI** (MIT `shadcnblocks/kibo`, `3d63cdb15b79d972e3dc38a10997987672f9b263`) is a fourth separate *earlier* bounded import already on this feature PR: Workspace tag selector and real P9/execution status. It was **not** incorrectly presented as a newly selected donor in this three-source audit.

## Alternatives audited and not imported

- **XYFlow/React Flow:** LiOS already has two source-owned, accessible graph renderers including a real viewport and keyboard list. Introducing a new graph runtime would add React dependencies and create a competing graph layer without evidence of an unresolved graph interaction failure. Reassess on a benchmark proving existing graph size, layout or editing insufficiency.
- **MapLibre/PMTiles:** PR #302 already brings a bundled public-domain offline geography path; neither a new hosted tile service nor another complex map runtime is necessary for the recorded Project investigation use case. Reassess only when validated zoomed geospatial tile needs exceed current offline map.
- **Full MUI/Chakra/HeroUI or commercial website kits:** they add a second component authority or require paid/restricted assets, not justified by a missing LiOS action.
- **Other UI galleries:** references only unless explicit source/licensing grant exists.

## Integration checks and source tracking

- **Single canonical owner:** no new router, feed, store, authorization, uploader or P4/P6/P9 execution authority. Existing screen components call existing handlers.
- **Three source tests copied with their components:** `PulseDiscoveryTabs.test.tsx`, `ProjectContinuationActivitiesCard.test.tsx`, `ProjectSpreadsheetImportField.test.tsx`. They assert source-level and SSR semantics, action ownership, file validation and duplicate uploader removal; not an installed Electron test.
- **Provenance:** new `third_party/components.json` entries `beui-pulse-tabs`, `watermelon-p6-activities`, `opensourceui-spreadsheet-review` plus exact `third_party/upstream-lock.json` pins and matching `third_party/universal-donor-adoption.json` snapshot hashes. Full MIT notices remain under `third_party/licenses/` and new source descriptions in `THIRD_PARTY_NOTICES.md`.
- **No npm changes:** uses installed React18, Radix, Framer Motion11, Lucide. No paid provider service, model, remote data, image, font or asset imported.
- **Not yet proven:** actual TypeScript compiler/test execution, browser input/focus interaction, installed Electron accessibility and native installer qualification. All require exact-head verification, then integrate with the cumulative PR #302 once and only after existing release gates.

### Suggested exact-head local/hosted validation commands

```bash
cd src
npm run check
node --import tsx --test \
  client/src/components/terminal/PulseDiscoveryTabs.test.tsx \
  client/src/components/terminal/ProjectContinuationActivitiesCard.test.tsx \
  client/src/components/terminal/ProjectSpreadsheetImportField.test.tsx
npm run audit:oss
node script/validate_universal_donor_adoption.mjs
npm run test:ux
```

This branch **remains stacked on PR #302**, and PR #272/older donor source branches are historical references, not separate merge targets. Do not merge #302 and this follow-on independently into protected `main`.
