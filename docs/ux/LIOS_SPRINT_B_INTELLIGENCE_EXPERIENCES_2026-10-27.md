# Sprint B — recorded intelligence experiences (draft)

**Repository:** `kiranvbiim-coder/lios-terminal`  
**Parent:** Sprint A draft [#304](https://github.com/kiranvbiim-coder/lios-terminal/pull/304) at `7979578bfe4c6795bb2004cbe4ba6c3770c0de97`.  
**Status:** Source implementation on a dependent, unmerged branch. **Not shipped.**

## What is now integrated

1. **Financial and cross-domain relationship graph:** the existing Intelligence Graph's user-selectable recorded relation type (`supports`, `affects`, etc.) constrains the links, participating nodes, search-neighbor expansion and selected-object inspector together. No probabilistic links, simulated exposure weights, data queries or new graph service. Existing screen-reader/narrow-width list continues to receive exactly the same filtered node set. Selected recorded source shows known freshness, effective/as-of date and source ID, explicitly naming missing fields.
2. **Source-credibility inspection:** the existing Evidence & Provenance drawer shows counts of *published* sources, review flags (recorded quality warning/unavailable, fallback/conflict, stale/unavailable), stale/unavailable records, and missing as-of timestamps. Search and review lens filter only this published snapshot. A source may be opened only through an explicit safe HTTPS URL without embedded credentials, using `noopener noreferrer`. A publisher's recorded `verified` status is not an independent integrity certification.
3. **Rich analytical insight:** the existing Analytical Studio Flow tab reuses the saved-capture `RecordedAnalyticalDifference` component for large, readable, before/after records instead of another generated insight feed. The interface explicitly states that saved local changes are not financial causes, live alerts or authenticated source citations. Missing history produces an empty state.
4. **Intelligent comparison:** the existing comparison slots show their capture context and whether a real calculation receipt was attached. Captures of the same view + normalized symbol present deterministic field deltas. Cross-context field comparison defaults hidden unless the user explicitly chooses to view the potentially noncomparable fields. The receipt comparison requires **two different** published receipt selections and surfaces actual added/removed warnings and changed-field counts. No calculation, model write or hidden inference is initiated.

## Source and licence discipline

- No new dependency, API endpoint, graph authority, storage schema, provider, service or permission grant.
- Same `terminalIntelligenceObjects`, `terminalEvidence`, `terminalComparison`, `terminalChangeIntelligence` records as Sprint A.
- Reference design inspiration only: 60fps.design (spatial motion restraint), Recent/Mobbin (scannable financial cards and review flows). **No website source, template, 3D engine or unlicensed donor code imported by Sprint B.** Previously imported and attributed source belongs to the parent stack; separate #305 and #272/#278/#280 donor branches should be reconciled to avoid duplicate adoption.

## Exact-head source checks and release blockers

From `src/`, on the Sprint B commit and all target OSes:

```bash
npm run check
node --import tsx --test client/src/lib/graphExplorerPresentation.test.ts client/src/lib/sprintBSourceReview.test.ts client/src/lib/sprintBComparisonContext.test.ts client/src/lib/sprintBIntelligenceIntegration.test.ts client/src/components/terminal/GraphExplorerCompactList.test.tsx client/src/components/terminal/AnalyticalChangeStories.test.ts
npm run test:offline
npm run test:desktop
npm run build
npm run audit:oss
npm run audit:licenses
npm run release:preflight:ci
```

Installed Electron manual cases: graph with 0 / 1 / 120+ recorded objects; link type and direction; 390px compact list; keyboard-only/Tab/Escape/screen reader/200% zoom; source metadata absent, conflicting, stale and malicious URL; fresh vs expired evidence; comparison A/B across symbols and different views, same receipt selection and actual warning deltas; large captures; source revocation and permission changes; unsaved P4 Artifact guard inherited from Sprint A.

Do not merge/deploy or claim completed release from source commits, CI summaries or fixture screenshots. Inherited release issues remain: signed Windows/macOS/Linux installed runs, SP-01/P14 performance, governed secrets/permissions and unresolved packaged valuation HTTP 502. All blocked until verifiable native evidence and maintainer review.
