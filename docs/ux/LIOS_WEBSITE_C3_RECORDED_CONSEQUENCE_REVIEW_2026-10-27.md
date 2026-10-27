# Website assimilation C3 — recorded P7 consequence review

**27 October 2026** · Source gap tracker #258 · Parent C2 PR #290

## Actual implementation

Reuses the existing authenticated P7 Project Intelligence graph, Insight Lens and Investigate → Relationships surface. A collapsed `ProjectConsequenceReview` uses only the selected Project/insight and existing P7 graph to expose saved edge IDs, relation types, actual from/to direction, and each stored edge's evidence references. Up to two explicit hops can connect source-backed insights to existing decision, portfolio, scenario, assumption or thesis references.

These are *references for review*, not proven economic effects, risk exposures, portfolio positions or automatic decision outcomes. Reverse traversal through a shared entity is plainly marked. The existing interactive evidence graph remains untouched.

A deliberate **Review path in Chat** stages a bounded evidence/snapshot-hash question through the existing `onInvestigate` handler. That draft instructs the model to recheck source permission, current facts, contrary evidence and missing links, and forbids tool use/writes without approval. No new route, store, data collector, release cost, third-party library, external tiles/media or background agent.

## Safety/performance boundary

The graph and selected insight must match the current Project. A seed is eligible only if its sourceRef maps to an actual content-hashed P7 node. All traversed nodes must exist within that Project's graph, excluding external placeholders and Project-wide contains hub. Every traversed link requires recorded evidenceRefs, all matched to actual content-hashed P7 source nodes; orphan, missing, unsigned, external and unowned refs fail closed. Traversal is capped at two hops, 25 seed nodes, 10,000 graph nodes/edges and 24 displayed targets. Denials, empty states and omission counts are visible.

The existing P7 Project response is the source of record for the read-only graph. A graph snapshot is **not a real-time provider entitlement** and can be stale; the Chat review must check current access before any downstream action. This does not add an investment recommendation, quantified exposure model, automatic P9 rule, or a financial execution API.

## Validation

Added pure function tests for cross-Project denial, missing sources, stored direction, source-free/orphan/external rejection, deterministic bounds and non-execution prompts. SSR tests verify opt-in controls and safe escaping of hostile source labels. The existing Project SSR test is also included in `test:website-c3`.

`cd src && npm run test:website-c3 && npm run check && npm run test:offline && npm run build`.

This is a code implementation, **not native Electron acceptance**. CI on exact branch HEAD and installed Mac/Windows app keyboard, screen-reader, 390px, 200% zoom, permission revocation, project switch, offline and reduced-motion QA remain required before merging. Do not merge the stacked PR independently or assert protected `main` is updated.

**Next:** D1 source-bound P4 editable Briefing Studio, D2 cross-platform visual/native and $0 release QA.
