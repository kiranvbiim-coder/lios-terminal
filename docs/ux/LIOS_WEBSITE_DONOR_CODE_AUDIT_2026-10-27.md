# LIOS — User-supplied website reuse: real integration check (27 Oct 2026)

**Decision:** NOT all useful donor code has been imported. Import is not the same as a fork, a planning entry, a source pattern, a `package.json` dependency, or a passed installed-product test.

**Source of this audit:** public `main` plus draft PR [#250](https://github.com/kiranvbiim-coder/lios-terminal/pull/250) (combined Phase 1–3 UI), stacked draft [#256](https://github.com/kiranvbiim-coder/lios-terminal/pull/256) (P4 storyboard), and donor strategy [#229](https://github.com/kiranvbiim-coder/lios-terminal/pull/229), checked 2026-10-27. This new PR adds **one** demonstrable beUI adaptation while leaving both other draft validation heads untouched.

## What is real versus remaining

| Owner-supplied source | Verified LIOS code now | Still useful, not yet delivered | Treatment |
| --- | --- | --- | --- |
| **Watermelon UI** (`ui.watermelon.sh`; `WatermelonCorp/watermellon-registry`, `watermelon-platform`) | PR #250 `NewsEditorialStoryCard.tsx`, `LiosPulseStoryCard.tsx`, `ProjectArtifactGalleryCard.tsx` adapt pinned `expandable-event-card`/Bento interactions. Source notice under `third_party/licenses/`. | Cohesive **activities-card/chronological Project desk**, contextual Ask bar, useful accessible disclosure and layout primitives. No proof the whole donor family was imported. | **P1**: port only if superior to current Project/Home and readable under zoom; reuse existing P6/P7/P2 data |
| **beUI** (`beui.dev`, `starc007/ui-components`) | PR #250 `LiosPulseStoryCard.tsx` adapts pinned Citations and `AgentExecutionReceipts.tsx` is **inspired**, not a byte-for-byte AgentActivity/ToolApproval port. **This PR** adds pinned adapted `PulseDiscoveryTabs.tsx`. | Source-first Chat citations and genuine, controlled streaming/tool approval UI still need source-to-event mapping; chart families only with real values and preserved P4/P11 computations. | **P1**: keyboard and source grounded; never swap P2 runtime/approval authority |
| **Opensource UI** (`github.com/bidyut10/opensourceui`, `opensourceui.in`) | Already on `main`: pinned `SourceCatalogueSearch.tsx` from `components/inputs/search-input.tsx`; MIT notice, source test and current source registry consumer. | Small reusable source/connector chooser patterns, data table/search empty/loading states where present LIOS surfaces are weaker. | **P1**: port targeted pieces only, do not import Next.js/React19/Tailwind4 root |
| **Uiverse** (`uiverse.io`) | No concrete Uiverse element provenance or bundled component found in audited current UI paths/dependency list. Site publishes community UI elements as MIT. | Helpful *minimal* loading/action feedback where a real LIOS operation lacks it, not decorative glowing dashboards. | **P2**: choose exact author/design, preserve license, reduce motion, then integrate existing actions |
| **Material UI** (`mui/material-ui`) | No `@mui/*` runtime package in `src/package.json`; existing Radix/shadcn primitives already own UI controls. | Possible selective accessibility patterns and table UX, not a second design system. | **Keep as benchmark** unless proven missing interaction |
| **Chakra UI** (`chakra-ui/chakra-ui`) | No `@chakra-ui/*` runtime package; existing LIOS Tailwind/Radix control layer. | Form accessibility/compound-control reference if current implementation fails keyboard/contrast acceptance. | **Keep as benchmark**, avoid conflicting provider/theming |
| **HeroUI** (`heroui-inc/heroui`) | No `@heroui/*` runtime package; latest upstream v3 targets React19/Tailwind4 whereas LIOS has React18/Tailwind3. | Specific accessible listbox, selection or overlay behavior if a current screen actually needs it. | **Evaluate later**, do not migrate whole UI for aesthetics |
| **Kibo UI** (`shadcnblocks/kibo`) | Not found as a direct component package/source in the audited combined UI. | Comparison/side-by-side evidence or **file dropzone**, but existing Perspectives, Artifact import and source controls must be compared first. | **P2** only if it replaces a worse current mechanism |
| **React Flow / XYFlow** | Current `GraphExplorer.tsx` is an LIOS-owned, recorded-edge SVG + compact list, **not** React Flow. No `@xyflow/react` package. | True zoom/pan/layout of recorded graph, evidence drilldown, keyboard accessible fallback. | **P2** after real graph interaction benchmarks; do not create new graph datastore |
| **MapLibre / PMTiles** | No new World Map/tiles from these libraries on audited combined UI; `ImpactMap` and provider `CoverageMapPanel` are different. | Source-backed geographic events with licensable/offline map tiles. | **P3**: do not confuse geographic map with provider coverage |
| **Installed rendering stack** (ECharts, Recharts, lightweight-charts, Framer Motion, Embla, Radix/Dockview) | Real dependencies in `src/package.json`; existing LIOS visual/chart/workspace owners use them. | Better chart and card composition can be built using these before adding another heavyweight renderer. | **Reuse first** |

**Evidence files:** `THIRD_PARTY_NOTICES.md`, `third_party/components.json`, `docs/technical/LIOS_OPENSOURCEUI_ADOPTION_2026-10-23.md`; exact current source headers in `NewsEditorialStoryCard.tsx`, `ProjectArtifactGalleryCard.tsx`, `LiosPulseStoryCard.tsx`, `AgentExecutionReceipts.tsx` and `SourceCatalogueSearch.tsx`. For the motion-tabs port, beUI exact pin `41a330ba66684696c445d58ca5d77c0133d4059a`, file `components/motion/tabs.tsx`, blob `ed65ffad1ea648850ce29a874ea6eee28d032896`, MIT grant retained in `third_party/licenses/beui-MIT.txt`.

### Other owner-supplied sites — what to do with them

These were planned chiefly as **design/process inspiration**, not permissively importable runtime repositories. Treating them as uninstalled packages is the wrong success metric.

- **Design and motion references:** `skill-issue.in` (agent-skill discovery only), `promptmotion.org`, `motionin.design`, `60fps.design`, `recent.design`, `on.design`, `godly.website` (Recent), `mobbin.com`, `HorizonX.so`. Apply to current Chat/Pulse/Project journeys, using code only after an exact-source rights check. No broad licensed media import is asserted.
- **Public product marketing references:** `modulify.ai/templates`, `landdding.com`, `footer.design`, `posts.design`, `wonderlist.design`, `iconly.design`, `fontinlogo.com`, `backgrounds.supply`, `paperanimation.ai`. These may guide the later website, icon, typography and launch presentation, not the intelligence runtime. **Do not bundle third-party shots, fonts, templates, or media without distribution rights.**
- **Optional external services:** `sent.dm` (paid notifications) and `closeit.fast` (external e-sign). No forced integration for the user-owned $0 beta; add only after explicit user value and separately reviewed cost/privacy permissions.

## Next donor-only work order (one improvement at a time, no parallel architectures)

1. **Done in this PR:** beUI-inspired *actual code* adaptation: replace 6px LIOS Pulse channel controls with a labelled, accessible, Framer Motion-led 44px segmented channel selector. Preserve the current Wave D channel callback, source receipts and storage. SSR and keyboard transition contract tests.
2. **Next:** Watermelon *activities-card / journal* reuse to transform dense Project Continuity into a clear vertical timeline with existing P6/P7 data and native source actions. Compare against current `ProjectIntelligenceTimeline` to avoid duplicate UI.
3. **Then:** beUI agent-source/approval/streaming visual primitives — adapt only around genuine P2/GM events. Show evidence and pending/stale states; never infer an approved or successful action.
4. **Then:** a targeted Kibo comparison/file-chooser pattern or Opensource UI search/feedback when actual user tasks outperform existing screens; skip duplicate components.
5. **Conditional only:** React Flow for graph zoom/keyboard if actual installed graph needs it; MapLibre when real geocoded, authorized source data and offline tile rights exist.
6. **Visual polish:** pick a very small number of suitable Uiverse interactions after testing reduced motion and 390px/200% zoom; add an attributable pinned source entry for each copy. Evaluate MUI/Chakra/HeroUI as alternatives only if a concrete current accessibility gap remains.

## Acceptance / exclusions

A vendor is **not done** just because there is a fork, link, dependency or registry row. Each imported piece must be reachable in the relevant existing LIOS screen, sourced from pinned code with its license, use real recorded data and current user permissions, retain canonical AI/Project/Artifact/Automation ownership, pass tests, and be exercised in installed Electron across zoom/keyboard and offline modes.

Current draft PRs #250 and #256 have separate CI/acceptance gates. This donor slice must not be blindly merged ahead of its base. No provider photos, code-export paywalls, commercial templates, Pro UI packages, unrelated service dependencies, new state store, or unnecessary design-system migration.
