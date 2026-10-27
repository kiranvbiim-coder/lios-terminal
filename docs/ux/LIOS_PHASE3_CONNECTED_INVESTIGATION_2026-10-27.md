# LiOS Phase 3 — Connected Investigation and Agent Action: Source Integration

**Date:** 27 October 2026  
**Repository:** `kiranvbiim-coder/lios-terminal`  
**Review branch:** `integrate/phase3-visual-investigation-agent-actions-20261027`  
**Merge baseline:** Phase 2 consolidated PR #248 (`feat/phase2-watchrooms-project-resume-20261027`)

## What is source-integrated now

Eight existing premium visual workstreams from TC integration PR #247 were transplanted as **the same 36 Git blob revisions** onto the completed Phase 2 source tree. A two-parent composition commit preserves both the complete Phase 2 source ancestry and the original TC feature-workstream ancestry. The 36 TC paths and 26 Phase 2 paths were checked for overlap (zero direct collisions); source behavior and native runtime acceptance still require testing.

| Existing visual workstream | Real code source/owner | Phase 3 implementation status |
| --- | --- | --- |
| Cross-domain graph / evidence-linked nodes | `GraphExplorer.tsx`, `graphExplorerPresentation.ts`, existing intelligence objects | Integrated existing recorded-relationship graph explorer; React Flow replacement has **not** been ported |
| Research evidence / compare | `ResearchInvestigationPanel.tsx`, `ResearchEvidencePresentation.tsx` | Integrated current investigation backend/read-only source presentation |
| Sourced perspectives | `RecordedPerspectivesBoard.tsx`, `PerspectivesExplorer.tsx` | Integrated record-based comparison (no invented political/bias scores) |
| Timeline / as-known-on | `ProjectIntelligenceTimeline.tsx`, P7 snapshots/continuity | Integrated Project timeline and existing Time Machine state |
| Analytical What Changed | `AnalyticalChangeStories.tsx`, existing typed source/series | Integrated deterministic recorded changes and source reference disclosure |
| Scenario comparison | `ScenarioComparisonBoard.tsx`, existing scenario registry/assumptions | Integrated input-delta preview; no synthetic simulation values |
| Saved Artifact previews | `ProjectArtifactGalleryCard.tsx`, `ProjectArtifactGalleryPreview.tsx`, P4 | Integrated exact saved-version preview path |
| News editorial family | `NewsEditorialStoryCard.tsx`, `NewsPanel.tsx` | Integrated sourced, readable news presentation |
| P7 relationship/context/evidence investigation | **New** `ProjectInvestigationDesk.tsx`, `phase3InvestigationPresentation.ts` | Typed `evidence/relationships/geography` views of a selected retained insight, source refs, direct recorded graph edges and bounded coordinate plot |
| Investigation → Chat | Existing `ProjectHome.onNewChat` guarded switch → P2 composer | Explicit user button stages Project-scoped prompt; requires separate Send; no new execution authority |
| Agent approvals/resume/receipts | Existing `ConversationRuntimeTrace`, `AgentExecutionReceipts`, GM/P2 | Reused and preserved, not duplicated |

## Product journey

1. Open a saved Project → choose **Investigation** (lazy, not an always-loaded dashboard).
2. Existing P7 Project Intelligence and Insight Lens load only for this current Project; choose a returned insight.
3. Inspect **Evidence** (actual recorded references), **Relationships** (direct exact graph edges plus type and linked evidence count), or **Geography** (explicit numeric coordinates on `geography` nodes only).
4. Choose **Investigate in Chat**. Existing Project Chat creation first confirms switching away from drafts; prompt names the recorded insight/source IDs and explicitly asks for source verification, conflicts, missing links and reviewed-only actions. The prompt is *not sent automatically*.
5. Work from existing Chat/Workbench: GraphExplorer, research evidence, perspectives, scenario comparisons, typed P4 editable Artifacts. Agent actions still require governed review, cancellation/resume policy and real execution receipts.
6. Existing Project Continuity and Phase 2 Watchrooms stay accessible. No second Project, memory, local automation scheduler, or P4 artifact owner is introduced.

## Explicit limits: do not overclaim

- **Geography:** A georeferenced-coordinate plot, NOT a full MapLibre basemap, country boundaries, geocoder or live geospatial event feed. With no verified numeric lat/lon, show an honest empty state. No tile/media rights, paid mapping service or location tracking dependency has been added.
- **Consequence Trail:** Bounded, exact **graph adjacency** with `mentions`, `supports`, `references`, etc. A linked entity is **not** itself proof of financial exposure, causal effect, supplier relationship or scenario impact. Those must be verified through existing engines and permissions.
- **AI Visual Answers:** A strict user-selected typed view intent exists. The **model-to-approved-renderer server resolution** remains separate future engineering; arbitrary model JSX/JS remains forbidden. Do not claim a model can render any visual schema yet.
- **Scenarios:** Recorded input comparisons and existing scenario tools are present. An end-to-end verified P11 deterministic calculation → explicitly saved P4 scenario version is **not native-accepted** on this branch.
- **Agent UX:** Existing P2/GM status, tool review, stop/resume and receipt UI is retained. No new agent action endpoint, blanket approval, permissions, automatic run or duplicate mutation handler is introduced.
- **Source evidence:** Graph refs are opaque identifiers. Their string form is never a safe-to-open external URL. No remote thumbnails or public link invention.
- **Costs:** no new package, subscription, cloud service, database, paid map tiles, AI provider or release spending.

## Source tests authored

```bash
cd src
node --import tsx --test \
  client/src/lib/phase3InvestigationPresentation.test.ts \
  client/src/components/terminal/ProjectInvestigationDesk.test.tsx \
  client/src/lib/phase3InvestigationIntegration.test.ts \
  client/src/lib/graphExplorerPresentation.test.ts \
  client/src/lib/researchPerspectives.test.ts \
  client/src/lib/scenarioInputComparison.test.ts \
  client/src/components/terminal/ProjectIntelligenceTimeline.test.ts \
  client/src/components/panels/ResearchEvidencePresentation.test.ts \
  client/src/components/terminal/ProjectArtifactGalleryCard.test.tsx \
  client/src/components/terminal/ProjectArtifactGalleryPreview.test.tsx
npm run check
npm run test:ux
```

## Required acceptance

- Check the hosted CI once at the end of this source phase. Then test all 36 imported TC blobs **together** with the Phase 2 stack, not just in their isolated PRs.
- Installed Electron macOS and Windows: Project → Investigation → switch selected insight/tabs → verify sources and geographic missing states → click Investigate in Chat → preserve/confirm unsent draft → explicitly Send → inspected evidence/contradictions → scenario input comparison → saved P4 Artifact → reopen exact revision → reviewed agent action with resulting observed receipt.
- Verify keyboard/VoiceOver, zoom 200%, light/dark, width 390/768/desktop, reduced motion, unstable provider, empty graph, wrong Project data and offline behavior. Capture screenshots and actual receipts.
- For MapLibre/geocoder, full P11 scenario-to-P4 save, generalized server-approved model visualization and auditable multi-hop causality, only claim completion once source contracts, permissions, data and real native tests exist.
- Review concurrent PRs. If this Phase 3 PR is accepted, **do not merge TC donor PR #247 again separately**, since its exact source files are already present in this composition. Merge Phase 1 then Phase 2 then Phase 3 after reviews/CI, preserving protected `main`.

**Truth:** source-integrated draft. Not installed-app accepted or released. 
