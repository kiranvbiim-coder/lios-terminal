# LiOS Website Assimilation B3 — Source-Grounded Flow and Comparison

**Date:** 27 October 2026  
**Tracker:** [#258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258)  
**Stack:** B3 → B2 #277 → B1 #274 → A4 #270 → A3 #266 → A2 #263 → A1 #261 → cumulative #253.

## What the code actually implements

LiOS already ships `echarts@6.1.0`, Recharts and `ResearchEvidenceComparison`; its canonical `PerspectivesExplorer` already has source-backed **supports, contradicts, supersedes, derived_from, affects and cites** records, filtered lanes and an inspectable source-to-source pair. Reinstalling Kibo comparison or beUI animation libraries would duplicate these features and unnecessarily change the lockfile.

The gap closed here is **an interactive/visual overview of exact stored evidence relationships**. B3 adds an optional, collapsed **Evidence relationship flow** within existing `RecordedPerspectivesBoard`, directly consuming that board's already-authorized **filtered** `PerspectiveLink[]`. The existing three lanes and source-comparison inspector remain the only evidence authoring/read authority; selecting a flow row focuses the same existing evidence-pair inspector.

### Source model and renderer

- `client/src/lib/recordedEvidenceFlow.ts` is a deterministic pure projection: one retained link ID → three *role-separated* nodes (`from:E#` → `relation:<recordId>` → `to:E#`). This prevents a recorded `A supports B` + `B contradicts A` cycle from breaking the Sankey DAG or implying that A's support is redirected into B's challenge. A single relationship has value **exactly 1**, interpreted **one recorded ledger edge**, never significance, economic value, certainty, proof, probability, source independence or consensus.
- Only relationships whose **both evidence endpoints are present in the canonical authorized Investigation** can enter. The current UI search/group filter also scopes the flow. Duplicate/invalid link IDs are excluded. Initial chart projection shows up to 16 of the filtered links (max 32 with pure projector), and discloses omitted count. Every link remains reviewable in the existing Perspectives lanes.
- `client/src/components/panels/RecordedEvidenceSankey.tsx` is a small **lazy** ECharts SVG chart runtime. Its `SankeyChart` extension and SVGRenderer are from **the existing installed ECharts 6.1.0**, with no new chart library/lockfile or data source. Drag/tooltip/animation are disabled, chart legend is outside, and a ResizeObserver cleans up on disposal. No network, AI call, write, or source navigation.
- `RecordedEvidenceFlowPanel.tsx` offers an opt-in visual summary plus a keyboard-accessible, exact-source relation table with source E#, relationship type and a concrete **Inspect** action reusing the board's selected relationship. If visual ECharts fails, the same table remains available. No inferred excerpts, numeric weights, or publisher stance are produced.

### Donor assessment and implementation decision

- **beUI Sankey** is a sophisticated motion/styling pattern for weighted stage flows, but its animated copy would add another chart engine on top of existing ECharts, while LiOS's data describes **unit-count qualitative relationships**, not real weighted financial flows. We adapt the useful **flow composition**, not the unverified weights or extra dependency. [beUI site](https://beui.dev/).
- **Kibo UI Compare** provides a prebuilt comparison surface but the existing evidence comparison already supports exact side-by-side excerpts, source URLs, notes, date provenance and permissioned ledger selection, so reimporting it would cause feature overlap. [Kibo Compare](https://www.kibo-ui.com/blocks/compare).
- This PR **does not claim beUI Sankey or Kibo Compare source was imported**. It implements the missing **source-grounded capability** using existing shipped dependencies.

### Tests and guards

```bash
cd src
npm run test:website-b3
npm run check
npm run test:offline
npm run build
```

Focused tests exercise unresolved or unauthorized endpoints, opposing/cyclic links, exact original labels, filtered subsets, normal and 16/32 bounded output, duplicate/invalid IDs, no fabricated numerical scores, collapsed SSR state, existing selection and side-by-side UX, **no new permission/network/store**, lazy installed ECharts SVG only. The existing free hosted Linux source-validation job runs `test:website-b3`.

**Source committed for review; tests and installed Electron UI still require actual CI/native acceptance.** The chart may be empty or visually simple when no author has entered relationships; the UI must never manufacture findings to make Sankey look impressive. Actual macOS/Windows keyboard/screen-reader, responsive 390px/768px/200% zoom, chart chunk and FPS/memory proof remain outstanding.

## Next planned work

Proceed to **C1 — governed AI visual answers**: typed requested visual intent, server-approved source/rights resolver, existing projection/renderers, no unsourced model-configured dashboard. Then **C2 P11 scenario calculation → reviewed P4 Artifact**, **C3 evidence-linked consequence analysis**, and **D1–D2** real briefing/UX proof. Do not return to a new shell/dashboard phase or import unneeded third-party code. #258 remains the single donor tracker; #91 is release gate.
