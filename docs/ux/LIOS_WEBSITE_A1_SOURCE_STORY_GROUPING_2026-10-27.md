# Website integration A1 — verified source-identity story grouping

**Date:** 27 October 2026  
**Owner tracker:** [#258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258)  
**Stack:** branch `feat/website-gap-a1-source-story-clusters-20261027` based on the complete four-phase candidate `integrate/lios-four-phase-closure-20261027`.

## Feature complete in source

The existing Watermelon/beUI-attributed `LiosPulseStoryCard` and canonical Wave D `FusionPulseBoard` now present safely grouped retained cards. This **reuses the already integrated card family**, the existing ranking and source projections, and the existing Chat/quote handoffs; no replacement feed, no new backend and no new donor/dependency are introduced.

- New presentation-only `pulseStoryClusters.ts` checks **same recorded kind, explicit subject/symbol, UTC event date, normalized exact title and shared retained evidence ID or safe URL**. It compares to the anchor, never transitive neighbors.
- The server still ranks every record. Lead score, kind, timestamps, urgency and headlines come from the original top-ranked server item, without recomputed model relevance or claimed independent verification.
- Exact distinct evidence items are assembled for inspection and Ask LiOS; unsafe URLs are not navigable or injected into prompts; separate subjects/stories are never clustered simply because they share a publisher name or title.
- Existing Pulse reads at most 24 already-authorized Wave D cards before selecting at most six story tiles; a cluster holds at most 60 distinct evidence references and clearly labels omitted source counts.
- The user sees **N matching records**, and the expanded card explicitly cautions that shared evidence is not independent corroboration. The existing source-link safety and direct Chat question route remain canonical.
- Missing evidence, malformed timestamps, unlinked subjects, offline data, and unsourced market fallback remain separate and honestly described.

## Contract and acceptance

**New tests:** `src/client/src/lib/pulseStoryClusters.test.ts` verifies precise positive matching, distinct events, disallowed URLs, no invented citations, bounded evidence and output, non-transitive clustering, source immutability and existing Wave D→Pulse→Chat integration.

```bash
cd src
node --import tsx --test client/src/lib/pulseStoryClusters.test.ts client/src/lib/pulseStoryPresentation.test.ts
npm run check
npm run test:offline
```

CI and installed Electron acceptance **not yet confirmed**. Read/verify original primary source and publisher rights before describing an item as confirmed news.

## Remaining work — same Workstream A, not another global phase

- **A2:** source-authorized rich media/image metadata (actual rights, local/cache entitlement, source attribution and permission revocation); conservative fallback where rights missing.
- **A3:** real user-owned Follow/Mute journey using existing authenticated watchlist/notification/preferences owner; server persists it, then canonical Wave D Following actually uses it across restart. Avoid generic unscoped localStorage and avoid new feed datastore.
- **A4:** high-quality Watermelon/beUI responsive discovery composition, no duplicate Home/sidebar, screen reader/200% zoom/390px, source→Ask→Watchroom→Project e2e proof, duplicate/source-cluster isolation and cross-domain scope.
- **B:** React Flow, map with rights-cleared tiles, targeted licensed comparison and chart components.
- **C:** approved server visual intents and actual P11→P4 receipt/Artifact flow.
- **D:** source-bound editable brief media/storyboards plus native appearance/performance QA.

Do not mark any pending A2–D or $0 desktop native acceptance complete because A1 is source-implemented.