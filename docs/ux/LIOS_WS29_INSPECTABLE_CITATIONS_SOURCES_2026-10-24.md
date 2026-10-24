# WS-29 — Inspectable Citations and Sources

**Track:** [TC/UX 65 workstreams #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Owner:** [PR #116](https://github.com/kiranvbiim-coder/lios-terminal/pull/116). **Increment date:** 2026-10-24.

## Existing evidence and ownership

- PR #116 already added a bounded expandable source inspector `ResearchSourceList` in Chat Show work, with recorded links only, URL restrictions and read-only presentation. It is the canonical WS-29 owner, not a new component to duplicate.
- The existing answer renderer `ChatMarkdown` already turns real matched citation markers into chips; ambiguous or unnumbered numeric markers remain literal text, and saved answers resolve against their own saved metadata.
- Before this increment the inline renderer checked only `safeHref(source.href)`. A synthetic link attached to a provider handle or an unrelated recorded document ID could become clickable even when the source inspector correctly refused to open it.
- Before this increment the inspector called `collectCitationSources(events)` without explicit request binding and the pure collector aggregated references from all events, including foreign or superseded plans when mixed events were passed.

## Changes on original #116 branch

1. Reused **one pure link custody rule** `inspectableSourceHref` defined in the existing `chatMarkdown.ts` module. It returns an external http(s) destination only if the source ID and href both independently pass existing `safeHref` and normalize to the **exact same URL**. `ResearchSourceList` preserves its named export for existing consumers.
2. Inline citation chips now use that same rule. Provider handles, mismatched URLs, credentialed URLs, unsafe schemes, and document-less references remain inspectable by label **without a navigable link**. Inline popover explicitly calls such references unlinked.
3. `collectCitationSources(events, requestId?)` respects the active request and discards pre-last-plan references when replanning. Without an explicit request ID, the most recent actual plan is preferred; only in plan-less traces does it infer the latest source-bearing request. A mismatched trust manifest request does not launder another request's evidence.
4. `ConversationRuntimeTrace` and streaming `ProjectExperienceShell` pass the active `requestId`, while saved-answer metadata retains its existing per-message boundary. Source-list accessibility language identifies **recorded references**, not independently verified source usage. No new registry, storage, provider retrieval, permission authority, AI call or source claim.

## Test coverage added

- `ResearchSourceList.test.ts`: forged source homepage, swapped document URL, exact URL, mixed request source leakage, replan isolation and mismatched trust manifest.
- `ChatMarkdown.test.ts`: inline citation navigation only for an exact recorded document and saved metadata cannot redirect to arbitrary provider homepages.
- `ConversationRuntimeTrace.test.ts`: Show work excludes old and foreign request references while retaining the current exact recorded URL.

### Target validation

Run from `src/`:

```sh
node --import tsx --test client/src/components/terminal/ResearchSourceList.test.ts client/src/components/terminal/ChatMarkdown.test.ts client/src/components/terminal/ConversationRuntimeTrace.test.ts client/src/lib/workspaceShellConvergence.test.ts
npm run check
npm run test:ux
npm run acceptance:ux
```

**Acceptance caution:** Authored tests do not prove installed-product behavior. Verify the updated exact-head Linux/macOS/Windows hosted source CI independently, and test signed-in source provenance/expiry, allowlisted safe URLs, browser/Electron external navigation, keyboard disclosure + screen reader, disabled/expired source access, saved-message reload and denial/revocation behavior. Source reference is **not** independently validated truth, document-rights permission, or an AI verification certificate.

## Integration dependencies

- [#117](https://github.com/kiranvbiim-coder/lios-terminal/pull/117) is deliberately stacked on #116 and owns WS-27 progress summaries. Merge/validate #116 before rebasing or retargeting #117, then rerun CI for the reconciled branch.
- [#146](https://github.com/kiranvbiim-coder/lios-terminal/pull/146) and other message-renderer feature branches also edit `ChatMarkdown.tsx`. Reconcile their specific hunks, preserve source validation, and rerun combined tests before main integration. Do not overwrite whole files across concurrent owners.
- Do not mark WS-29 shipped or claim P14/SP acceptance until actual CI/review/native checks pass.
