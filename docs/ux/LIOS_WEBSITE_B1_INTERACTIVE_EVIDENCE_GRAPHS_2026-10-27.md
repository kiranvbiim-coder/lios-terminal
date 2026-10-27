# LiOS Website Donor B1 — Interactive Evidence Graph Integration

**Date:** 27 October 2026. **Tracker:** [#258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258). **Base:** A4 [#270](https://github.com/kiranvbiim-coder/lios-terminal/pull/270), which stacks on A3 #266, A2 #263, A1 #261 and consolidated integration #253.

## Ground-truth owner audit

Two existing graph owners have different data/permission semantics:

1. **Project P7 Investigation → Relationships**, formerly a text-only list of a selected insight's recorded P7 graph edges. Its source authority is `P7ContextGraph` and `recordedConsequenceTrail(projectId,graph,insight)`. It is **not** the same graph as the terminal's local cross-domain objects.
2. **GraphExplorer**, an established modal reading `loadIntelligenceObjects()` and `buildCrossDomainGraph`. Its deterministic SVG/absolute node presentation already handles cross-domain filters, search, detail inspection and owned object actions.

B1 improves **both existing owners** in place, without adding a third domain model, new API, source index, record store, paid provider or any automatic tool call.

## Source changes

- `projectEvidenceGraphPresentation.ts`: pure bounded projection of **only one Project's exact P7 adjacency** and selected insight evidence, via the existing P7 selector. Stable non-semantic layout, at most **40 nodes / 48 fetched graph edges** (some trimmed if endpoints are not in those 40), actual source IDs and honest omission counts. Orphan endpoints, unrelated nodes, mismatched Project ID, absent P7 Insight and inferred causal relations never enter projection.
- `ProjectEvidenceGraph.tsx`: first-class Project Relationships graph, native pointer-drag pan, scroll-on-focus zoom, plus/minus zoom, Fit, keyboard arrow-key panning on the focusable canvas and Tab-accessible actual graph nodes. Read-only node inspector and linked edge list with explicit **stored evidence references, including missing-reference disclosures**; no link click substitutes for rights authorization. Bounded 900×540 logical viewport fits narrow layout without forced horizontal scroll; no server/model writes.
- `ProjectInvestigationDesk.tsx` now shows that graph in the original **relationships** tab. The existing evidence and geographic tabs, selected insight, source prompt handoff and permissions are unchanged. There is no duplicate Relationship list alongside the new accessible graph/edge inspector.
- `GraphExplorer.tsx` independently gains explicit Fit, Zoom In/Out, bounded zoom, pointer pan, arrow-key pan and account-independent responsive viewport controls. Its existing graph-object source, direct-link filters, modal focus trap, selected object detail/action ownership and domain taxonomy remain intact. No React Flow dependency or new graph store added.
- New source/presentation/SSR tests verify Project scope, exact link and source refs, orphan isolation, noncausal display, bounds, stable layout, empty graph, keyboard/viewport source wiring and no unexpected network/tool execution; focused `test:website-b1` added to the **existing** public Linux source-validation workflow.

## React Flow decision (transparent, no invented import)

**Reviewed donor:** React Flow [`@xyflow/react@12.12.0`](https://www.npmjs.com/package/@xyflow/react), open source MIT, supported documented zoom/pan/fit and custom nodes. Integrating the package would require an exact `src/package-lock.json` update plus a reliable `npm ci`, React 18 compatibility proof and bundle/performance/visual regression checks. The connected GitHub editing environment could read the repository lock but could **not access npm registry metadata for a reproducibly regenerated lock**. Therefore this PR **does not claim React Flow was imported** and intentionally does not introduce a declared but unlocked dependency that breaks CI. Instead it delivers the needed read-only interaction with existing React, SVG and event handlers and no dependency/install cost. Treat full React Flow port as a **conditional follow-up only if native usability/perf evidence demonstrates that this bounded viewer is inadequate**. Do not replace the source P7 graph with demo React Flow nodes or borrow donor Pro samples.

License reference: [xyflow MIT upstream](https://github.com/xyflow/xyflow/blob/main/README.md). No donor code copied or redistributed in this PR; only a feature comparison was used.

## Source review and native acceptance

```bash
cd src
npm run test:website-b1
npm run check
npm run test:offline
npm run build
```

Required manual tests: responsive 390px/768px/desktop, keyboard focus from tabs to graph viewport to nodes to relationship list, screen reader labels, 200% zoom, high-density graphs, scroll behavior, drag/touch pan, Focus/Tab traps, offline and Project-switch denial, actual macOS ARM64 and Windows x64 packaged desktop. Test that selecting a node never opens or edits another Project's data, and that recorded adjacency is never spoken as proven causation.

**Status:** Source changes committed for review. CI, native UX and actual installer release acceptance **not confirmed**. Do not merge protected `main` or claim the full React Flow donor imported.

## Next

**B2:** full rights-cleared/offline map over explicit existing P7 geography and its associated evidence, with no speculative geocoding, external tile/API data leaks or paid map token. The coordinate-only diagram remains a fallback until real map redistribution/offline tiles are lawfully available. Continue #258 only, not a new parallel roadmap.
