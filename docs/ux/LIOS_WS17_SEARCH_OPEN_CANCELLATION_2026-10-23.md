# WS-17 — Permission-Scoped Universal Search and Truthful Result Navigation

**Date:** 2026-10-23. **Track:** TC/UX WS-17 in [65-workstream plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Actual repo audit: avoid duplicating owners

- The existing server `src/server/workSearch.ts` already searches Projects, saved Chat titles/messages, saved Artifacts and Project file resources. Every SQL query uses `tenantClause` for **both the signed-in owner and organization**, excludes archived/trashed records, bounds result counts, and returns data through a strict `workSearchResponseSchema`. The frontend only calls the existing authenticated `/api/work-search`; **never** build a second local index of private work or infer access from search result labels.
- [PR #114](https://github.com/kiranvbiim-coder/lios-terminal/pull/114) already provides four kind filters, count/empty status, debounced and aborted searches, keyboard combobox/option semantics, selected result clamping and an in-flight open mutex. This WS-17 branch deliberately **starts from #114's head** instead of copying filters or conflicting with its dialog changes.
- [PR #101](https://github.com/kiranvbiim-coder/lios-terminal/pull/101) already provides accessible QuickSwitcher / tab/favorite/recent analytical navigation and focus handling. That is distinct from permission-scoped **saved-work search**, and is left untouched.
- Original `Terminal.tsx` already dispatches `lios:open-work-search` for Ctrl/Cmd+Shift+K on the Chat surface; original Chat already listens. Ctrl/Cmd+K and `/` open the separate command surface. **No duplicate global keyboard handler added**.
- **Real bug:** `WorkSearchDialog.run()` called `onClose()` after *any* resolved `onSelect()`. But `ProjectExperienceShell.openWorkSearchResult()` frequently returns early without throwing when a user cancels an unsent-draft guard or when busy. This erroneously closes search and loses its query even though the destination has **not opened**. The existing Quick Artifact result path also discarded unsent text via confirmation before verifying that subsequent Chat/Artifact fetches still resolved and matched the search hit. Saved Chat results from stale lists were not identity-revalidated before selection.

## Implemented without a new search engine

1. **`src/client/src/lib/workSearchNavigationPolicy.ts`**: pure identity checker `matchesSavedSearchChat` for exact Chat ID, Project owner, Quick/Project scope, active status and nontrashed record. This is *defense in depth*, not permission authorization: original backend query/detail routes remain authoritative. Separate `shouldCloseSearchAfterNavigation` only accepts explicit `true`, never a discarded/undefined promise.
2. **`WorkSearchDialog.tsx`** (stacked on #114): `onSelect` now returns a successful-open boolean. The dialog closes **only when the existing Chat reports a real navigation**, stays open on user cancellation (preserving query, filter, results and keyboard-selected entry), refocuses its input, and shows safe user-facing errors without echoing raw server response text. IME composition doesn't trigger Up/Down/Enter; descriptive keyboard help labels arrows, Enter and Escape. Closing returns focus to a still-connected original launcher; otherwise Radix manages fallback focus.
3. **`ProjectExperienceShell.tsx`**: original `openProject`, `openChat` and `openWorkSearchResult` propagate true/false navigation outcomes rather than conflating canceled dialogs with success. Existing saved conversations are still opened through their current owner-scoped methods.
4. For an Artifact owned by a **Quick Chat**, check the exact returned Chat ID/scope/status and `/api/artifacts/{id}` artifact ID, owning Chat and null Project **before** asking to discard the unsent composer draft; failure leaves the draft unchanged and the search open. The method **does not** grant access to any result; responses come from the existing authenticated object routes.
5. For Chat, Project, File and Project Artifact entries, do not follow stale/mismatched Chat or Project records. Show a safe error and keep the query instead of guessing the nearest object. Project result selection explicitly navigates to the existing Project/Home surface after draft consent. File/Artifact selection uses the existing `resolveWorkSearchLibraryTarget` identity validator and original Library panel.
6. No copy of Kibo/shadcn, new providers, database schema, storage of private search results, auth bypass, new API, AI capability, global shortcuts or command engine. There is **one** WorkSearchDialog and **one** QuickSwitcher.

## Regression tests and acceptance

- **8 pure executable policy tests** `src/client/src/lib/workSearchNavigationPolicy.test.ts`: exact Chat/Project ownership, stale/archived/trashed exclusions, Quick/Project scope mismatch, matching Artifact owner, wrong result kind, and canceled open.
- **9 feature/source tests** `src/script/validate_ws17_search_navigation.test.mjs`: original server tenant/owner clauses and strict schema, PR #114 filters and keyboard behavior, canceled search persistence, exact Chat/Artifact preflight, successful destination navigation, preserved command shortcut, and explicit unverified native evidence.
- Test auto-discovery is covered by original `src/script/run_project_tests.mjs`. Execute on the **exact reviewed stacked PR head**:
  ```bash
  cd src
  node --import tsx --test client/src/lib/workSearchNavigationPolicy.test.ts client/src/lib/workSearchFilters.test.ts script/validate_ws17_search_navigation.test.mjs
  npm run test:ux
  npm run acceptance:ux
  ```

| Evidence | Status |
| --- | --- |
| Code plus 17 new regressions on draft branch, retaining parent #114 | IN_PR |
| Exact-head Node tests, TS check, hosted Linux/macOS/Windows CI | PENDING |
| Backend permission-scoped tenant SQL used for all five stored work queries | SOURCE_CONFIRMED |
| Simulated 401/403/404/410, stale Chat and removed Artifact with real server | NOT_RUN |
| Cancel draft switch from search, dialog stays open and selection preserved | NOT_RUN |
| 320/390/768/1280/1440px real Search and QuickSwitcher journeys | NOT_RUN |
| 200% zoom, keyboard Tab/Arrow/Enter/Escape, IME and restored focus | NOT_RUN |
| VoiceOver/Narrator and installed native macOS/Windows | NOT_RUN |
| Authenticated user versus different tenant, real object-ownership attacks | NOT_RUN |
| Parent #114 merge, PR #101 review and cross-PR reconciliation | PENDING |

## Merge/ownership safety

This branch should be proposed as a **draft stacked PR targeting `feat/ux-work-search-filters-20261022`**, the actual head branch of [#114](https://github.com/kiranvbiim-coder/lios-terminal/pull/114). After #114 passes CI/review and merges to protected main, rebase/retarget WS-17 to the new main, preserving filtered search. **No claim that #114 is merged.**

[PR #101](https://github.com/kiranvbiim-coder/lios-terminal/pull/101) owns QuickSwitcher; no file overlap here. The original Chat component `ProjectExperienceShell.tsx` is independently modified by [#98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98), [#100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100), [#102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102), [#115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115), [#130](https://github.com/kiranvbiim-coder/lios-terminal/pull/130), [#134](https://github.com/kiranvbiim-coder/lios-terminal/pull/134), [#136](https://github.com/kiranvbiim-coder/lios-terminal/pull/136) and [#137](https://github.com/kiranvbiim-coder/lios-terminal/pull/137). **Reconcile exact current heads before merging** and preserve their composer draft, attachment/saved-work, safe recovery, first-use and Workbench handoff semantics. WS-16 #137 separately addresses draft discard before failed new-chat operations; WS-17 handles *search-specific* canceled and stale-target navigation.

Independent security and UX acceptance must use actual authorized and unauthorized fixture accounts to verify no cross-tenant results or private resource data and to prove cancel/no-source handling without leaking content. Source tests alone do not imply native accessibility, release, shipping or workstream closure.

**Next:** WS-18 composer and draft safety, coordinated with WS-16 #137 and the existing WorkspaceComposer owner.
