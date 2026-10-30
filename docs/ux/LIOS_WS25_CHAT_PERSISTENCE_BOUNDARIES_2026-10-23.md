# WS-25 — Quick, Project and Temporary Chat Persistence Boundaries

**Date:** 2026-10-23. **Project:** [LIOS terminal](https://github.com/kiranvbiim-coder/lios-terminal). **Track:** TC/UX [65-workstream plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119); [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Actual existing-code audit

- `src/client/src/lib/useProjects.ts` already uses authenticated **`POST /api/quick-chats`**, `POST /api/projects/:projectId/chats`, `GET /api/quick-chats`, `GET /api/project-chats/:chatId/messages` and Project Home queries. The existing `resolveComposerPersistenceTarget` sends new non-Project conversations to **saved Quick Chat**, and the original Project Chat continues under its Project. Server `runProjectChat` scopes owner, chat, persistent message history and working context; **do not duplicate the database or add a new chat store**.
- The server `startTemporaryRun` already starts a user-owned run with **`scope:"temporary", projectId:null, chatId:null, resources:[]`**, accepts in-memory history and owner-scoped working context, blocks persistent artifacts and attached files, and does not use `addProjectChatMessage`. The existing UI `temporaryMessages` array is component memory only. These constraints are retained.
- [PR #100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100) owns proper Quick Chat attachment persistence; [PR #102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102) owns wider universal-Chat and saved-file handoff work. [PR #137](https://github.com/kiranvbiim-coder/lios-terminal/pull/137) owns confirmation-before-discard and new Chat creation race handling. WS-25 is **stacked on #137** and is deliberately restricted to an additional scope isolation defect, not a replacement of these works.
- **Actual defect:** the original `startTemporary` cleared only the saved Chat ID, leaving **the previous selected Project ID** in React, the `lios.activeProjectId` bookmark and the LiOS location hash. At the same time the client built outgoing Temporary payloads with current `context.activeObjectRefs`, selected workspace text and active Artifact refs from the saved Project. The backend would refuse saved Artifact references, but this created misleading Temporary Chat state, avoidable authorization errors and unnecessary exposure of user-selected context to an ephemeral request. The inherited Project's `sourceScope` could continue appearing in the composer.
- `useProjectSelection` updated the URL for nonnull selections but did **not remove a recognized saved-work LiOS hash** when selection became completely empty. A freshly opened Temporary Chat could therefore still expose an old saved Project deep link after navigation/reload.
- A Temporary request sourced from `my_data` or `files` should not silently inherit the prior saved Project's private-data scope. The user may still deliberately select **Web** inside Temporary Chat, but that preference should not be stored as the new default for the next saved Quick Chat.

## Focused implementation

1. **`src/client/src/lib/chatPersistenceBoundary.ts`** defines a pure, testable persistence contract: `selectionForTemporaryChat` returns null Project/Chat identity; `contextForChatMode` removes all previous saved/selected Artifact refs and workspace text on Temporary sends; `savedChatIdForMode` ensures Temporary never issues a saved-message query; `sourceScopeForChatMode` coerces stale My Data/Files to Auto while retaining intentionally selected public Web; `shouldClearSavedChatAddress` clears only actual LIOS saved-work hashes when both IDs are null.
2. **Existing `ProjectExperienceShell.tsx`**: `startTemporary` now asks for WS-16's *deferred* draft-discard consent, clears the draft **only after consent**, nulls both saved Project and Chat identities, resets Temporary messages/working-context/run trace and last workflow request, and defaults to Auto. Saved Quick/Project server records are untouched. The existing authenticated `useProjectChatMessages` receives null in Temporary mode. The original outgoing `ConversationRequest` only includes `context` from saved modes, never Project context for Temporary. The same effective scope governs preflight and sent payload; Temporary scope changes are memory-only instead of overwriting persisted Quick/Project preferences.
3. **Existing `useProjects.ts`**: selecting no saved Project/Chat now removes an old **recognized LiOS address** via `history.replaceState`, preserving URL path, query, unrelated hash anchors and history state. Reload no longer restores the previous Project merely because its stale hash survived entering Temporary.
4. **No changes** to backend database, saved Chat persistence endpoints, cross-tenant authorization, Temporary server runtime, provider, attachments, message contents in localStorage, credentials, model execution, donor code or file imports.
5. WS-16 continues to own in-flight new-chat mutex and failure-safe draft confirmation. WS-18 [#139](https://github.com/kiranvbiim-coder/lios-terminal/pull/139) separately owns single-flight Send/Stop and retry draft settlement; its changes must be merged without regressing this boundary.

## Regression tests and real acceptance

- **10 executable pure unit cases:** `src/client/src/lib/chatPersistenceBoundary.test.ts` verify no Project/Chat identity or selected private context in Temporary, Quick/Project normal modes retained, Auto/Web behavior, no saved-history requests, and safe LiOS link removal.
- **9 source contract cases:** `src/script/validate_ws25_chat_persistence.test.mjs` assert original server-scoped Quick/Project persistence endpoints, existing Temporary server refusal of saved artifacts/files, confirm-before-discard, private context omission, current hash reset and original saved-mode status.
- Run on **the exact reviewed branch commit**, from `src/`:
```bash
node --import tsx --test client/src/lib/chatPersistenceBoundary.test.ts script/validate_ws25_chat_persistence.test.mjs
npm run test:ux
npm run validate:visual-environments
```

| Acceptance requirement | Status |
| --- | --- |
| Incremental code and 19 regression cases authored on WS-16 stack | IN_PR |
| Exact-head TypeScript, full Node tests, hosted Linux/macOS/Windows | PENDING |
| Saved Quick Chat title/history survive signed-in reload and app restart | NOT_RUN |
| Saved Project Chat messages remain in selected Project and owner tenant | NOT_RUN |
| Temporary Project→Temporary transition clears saved ID, URL and private context | NOT_RUN |
| Temporary new session erases previous ephemeral history on leave/re-enter/reload | NOT_RUN |
| Temporary Web selection deliberate; My Data/Files not inherited | NOT_RUN |
| Server unauthorized user/tenant/stale/trashed Chat denial fixtures | NOT_RUN |
| 320/390/768/1280/1440px and 200% zoom keyboard navigation | NOT_RUN |
| VoiceOver/Narrator in installed Windows/macOS app | NOT_RUN |
| Independent PR review, parent merge/rebase and protected-main integration | PENDING |

## PR ownership / merge order

- This work **targets the head branch of PR #137**, not main. Parent #137 must be reviewed/merged first; rebase/retarget WS-25 onto latest protected main. Do not duplicate its draft/creation safeguards.
- [#100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100) governs Quick file-backed persistence and [#102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102) governs additional saved-file/Chat workflows. Other original `ProjectExperienceShell.tsx` owners: #98/#115/#130/#134/#136/#138/**#139**/#140/#141/#143/#145/#147. Reconcile **exact heads** of these PRs, keeping WS-18 Send/Stop, WS-19 attachment upload, WS-20 references, WS-22 receipts and WS-24 draft-safe actions. WS-25 does not grant access to saved content through localStorage; server owner checks still apply.
- Before acceptance attach redacted fixture-based proof for authenticated reload, separate users/tenants, lost session, Temporary→Quick, hash/deep link, in-flight Chat creation and recovered app process. Real browser/network/native tests are essential. **Source assertion tests alone do not mean persistence is proved or the feature shipped.**

**Next:** WS-26 — natural research from the Chat surface, using the existing bounded P2/P7 research planning/runtime and real cited source availability.
