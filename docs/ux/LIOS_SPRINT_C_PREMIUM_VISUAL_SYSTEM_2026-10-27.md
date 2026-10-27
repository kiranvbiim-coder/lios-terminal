# Sprint C — LiOS Premium Visual System (source candidate)

**Repository:** `kiranvbiim-coder/lios-terminal`  
**Parent:** Sprint B draft [#307](https://github.com/kiranvbiim-coder/lios-terminal/pull/307), pin `4b93c49b6913a254e7d9f9be4fdaa960436803e5`.  
**Status:** Source implementation on a stacked draft, not released or merged.

## Design rationale
LiOS already has a **single** canonical `terminal-shell.css`, `VisualCanvas`, active-market chart engines (Recharts, ECharts and lightweight charts), and `terminal-visualization-v5.css`. This sprint **does not** introduce an animated background provider, another design token owner, new UI framework, or fabricated financial visuals. The purpose is to make the premium system readable, calm and usable in dense, narrow windows.

## Implemented
1. **Market Canvas: chart-to-data correspondence.** `recordedBreadthRows` projects the same provider data into Recharts and a native, optional `details/table` view. Date, advancing share, declining share and reported net breadth are available without reading chart pixels. Invalid/zero-total observations do not produce fake zeros, percentage bars or chart lines. Source records are limited to 1W/1M/3M, capped at 90. The user can inspect all valid rows for their selected window with no extra network call.
2. **Truthful state / chart language.** "Recorded observations" replaces an unsourced live label in Market Canvas. Missing valid breadth remains unavailable; market mover tiles have explicit accessible names; chart bars are nonanimated already. The positive declining share in the data table is labelled separately from the chart's negative-axis drawing convention.
3. **Premium visual polish.** New `sprint-c-intelligence-visuals.css` is imported in the existing `terminalStyles.ts` **before** the canonical shell arbiter. It is scoped to `data-sprint-c-visual` hooks on the existing Market Canvas, Graph Explorer, Evidence drawer and Analytical Studio. Selectors do not alter the underlying calculation/provider/source semantics, Dockview geometry, workspace state or Chat palette.
4. **Responsive/accessibility contract.** Named market container queries handle workbench panes that are narrow even on a wide desktop; 560px and 800px breakpoints preserve full-width chart/table and prioritize one-column reading. Larger touch targets, focus-visible rings, readable data text and native keyboard operation for the table. Motion is state-based and restrained; `prefers-reduced-motion`, LiOS `data-reduced-motion` and `data-low-resource-mode` disable it.
5. **Regression checks.** New pure market projection tests and a screen/CSS integration contract; source hook order and no fake data/animation timers/remote styling are asserted.

## Donor / source use
60fps.design and Recent.design are visual references for restrained motion and readable financial cards, not copied licensed code. All implementation is authored in the LiOS repository; no new website template source, icon/font binary, new package, external tracking, data provider or third-party scripts.

## Source validation (run on exact PR head)
From `src/` with the locked dependencies installed:
```sh
npm run check
node --import tsx --test client/src/lib/sprintCMarketCanvas.test.ts client/src/lib/sprintCVisualIntegration.test.ts
npm run test:offline
npm run test:desktop
npm run build
npm run audit:oss
npm run audit:licenses
npm run release:preflight:ci
```
Also inspect Linux / Windows / macOS GitHub Actions completed logs; pass verdict is **not** established merely by jobs being queued or running.

## Installed app acceptance
- At ~390px and narrower dock panes: header controls remain usable, charts do not overlap or horizontally scroll the entire workspace, values table scrolls within its container.
- 200% zoom + keyboard only + screen reader: range buttons announce selected state, chart observation count agrees with table, `details/summary` toggles without loss of focus, table has labelled columns and dates, tile actions name the selected symbol.
- Reduced-motion OS setting and both LiOS motion/resource settings: no pulse loops, transforms, animated bars or hidden network requests.
- Missing provider, malformed negative/NaN/infinite/zero-total records and missing calendar dates: no false zero percentages, invalid dates or synthetic provenance. Case of no data is visibly explained.
- Live installed native, source rights, permission scope and inherited Sprint A/B guards must be verified. Regressions in packaged valuation HTTP 502, installed SP-01/P14, notarization/signing or privacy remain **release-blocking**, not waived by visual polish.

**Merge policy:** Draft PR only. Merge ancestor sequence once, under explicit maintainer review, full exact-head green source CI and native release evidence. No deployment or release action occurs from this branch.
