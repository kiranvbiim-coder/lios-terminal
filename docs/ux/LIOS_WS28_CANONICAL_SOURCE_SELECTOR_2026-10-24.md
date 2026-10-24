# WS-28 — Canonical Source Selector

**Date:** 2026-10-24. **Track:** [TC/UX 65-workstream plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Owner:** [#122](https://github.com/kiranvbiim-coder/lios-terminal/pull/122), stacked on [Quick Chat attachment parent #100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100).

## Verified original architecture (source inspection)

- `ChatSourcesControl.tsx` already holds the four P1 scope options: Auto, My Data, Web, Files. `ProjectExperienceShell` sends only `ConversationSourceScope` to the **existing** governed Conversation Runtime. No individual-provider permission toggles exist in that protocol. Do **not** invent them.
- The authenticated `GET /api/setup/source-registry` endpoint calls `getUserSourceRegistry`, which composes the existing connector registry, current process runtime health, and user-scoped saved source connections. Each `SourceRegistryItem` includes kind (catalog or connection), operational, adapterImplemented, original state, grouped capabilities and license caveat. This is the **only** catalogue authority; no copy or secondary store.
- PR #122 already adopts the MIT OpensourceUI search input, a display-only filter, accessible search, close-to-focus control, and connected-only view. Earlier exact-head hosted source checks on macOS/Linux/Windows passed.
- **Missing clarity:** a catalog entry can have `operational: true` without a saved account connection; saved connections can be unhealthy and still be marked `connected: true`; an adapter may be unavailable; and health is not an AI disclosure grant. The previous label `Connected · check status` did not clearly separate these facts.

## Incremental WS-28 work on existing #122 branch

1. `filterSourceCatalogue` now searches canonical group, name, category, connector ID, state, capability family, coverage and fields. Multiple terms are conjunctive; results remain the same server-owned records. No source is changed or selected.
2. Pure `sourceCatalogueStatus` presents catalog/saved status and verification/adapter state separately with conservative, rights-aware copy. `sourceCatalogueCoverage` surfaces recorded registry capabilities only (no inferred rights).
3. `ChatSourcesControl` displays original status and source detail, group, recorded capability families, license caveat and last recorded check date, plus the distinction between Auto *routing* and legal authorization. The saved-connections filter now explicitly includes unhealthy/unverified saved accounts; a verified **catalog-only** entry cannot masquerade as a user account.
4. Temporary Chat still disables My Data and Files. Stale invalid scope is flagged for user correction; the UI does not silently broaden an existing selection. Source catalogue failures cannot be represented as up-to-date source state.
5. All underlying endpoint authorization, provider grant decisions, source-scope persistence, source read rights, tenant ownership, non-Project Temporary restrictions and Connection Center remain untouched. No new schema, provider API, storage, entitlement grants, source fetch, donor dependency, inference or egress.

## Test and acceptance matrix

Target tests, run from `src/`:

```sh
node --import tsx --test client/src/lib/filterSourceCatalogue.test.ts client/src/lib/sourceCatalogueStatus.test.ts server/sourceRegistryService.test.ts server/p1cSourceScope.test.ts
npm run check
npm run test:ux
npm run acceptance:ux
```

New assertions cover canonical capability/coverage search, conjunctive terms, saved-vs-catalog status, adapter not implemented even with nominal healthy state, missing capability fields and absence of inferred rights. These assertions are **authored**, not a live product entitlement check. Hosted exact-branch CI must be inspected independently from the earlier green #122 commit before promotion.

**NOT RUN / NOT ACCEPTED until verified:** current-head full hosted CI; authenticated owner/foreign-user source catalogue context after account switch; live Connection Center health, revoked vendor entitlement and rate-limit handling; source-scope transmission denial against real connected sources; 320–1440 mobile/desktop layout and 200% zoom; keyboard Escape/refocus, screen-reader, Mac/Windows installed app; P14 and shipping-point evidence.

**Merge order:** parent #100 first; reconcile source-control ownership with #98, #122 and WS-25 #148 without whole-file overwrite; rebase current #122 and re-run its exact head before target main. Do not claim an individual-source selection feature; the canonical protocol exposes scope, not per-provider grants.
