# WS-16 — Draft-Safe Conversations and Sidebar Lifecycle

**Date:** 2026-10-23. **Canonical plan:** UI/UX 65-workstream [PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). Original LiOS Chat remains the only persisted conversation runtime.

## Code-backed audit: what already exists

- **Existing and retained:** `AuthenticatedNavigation.tsx` provides New Chat, mobile Sheet, Projects, recents, account/Temporary Chat, Search and Trash & archive. `ProjectExperienceShell.tsx` already has Project/Quick/Temporary selection, editable composer, unsent attachments, voice transcripts, saved history, rename/pin/archive/restore/trash, contextual lifecycle dialogs and server-owned permissions.
- The current `confirmConversationSwitch` asked before discarding a draft but then **immediately cleared composer text, staged files, uploaded attachment refs and voice transcripts** before an asynchronous destination transition. A failed `createQuickChat()`, `createProjectChat()`, `createProject()`, or `promoteQuickChat()` could destroy the current unsent work although the backend had not committed.
- Active Chat/Project **archive and trash** actions could clear the selected object after server success **without asking** the unsent-draft guard. Trashing or archiving a selected **Quick Chat** then set `chatMode="project"` with no selected Project.
- Recent chats were concatenated from both `useAllProjectChats()` and `useQuickChats()`, potentially duplicating a Quick Chat, and the sidebar rendered an ordinary empty message while one/both queries failed.
- Rapid New Chat clicks could send multiple create requests while the previous one was pending.

## Implemented in original code

1. `client/src/lib/conversationSwitchPolicy.ts`: a tiny pure helper for draft presence (text, staged local files, uploaded attachment references, voice transcript), Quick/Project mode after removing a selected saved Chat, and stable active/nontrashed recent chat merge with deduplication, deterministic sort and the original 14-item limit. Does **not** persist data or invent new conversation identities.
2. `ProjectExperienceShell.tsx` now separates `discardConversationDraft` from consent. `confirmConversationSwitch(true)` requests permission **without clearing**; asynchronous creation/move/archive/trash discards only **after the backend mutation succeeds**. Failed requests and canceled confirmations retain unsent work and original selected Chat. Synchronous local-only switches retain the existing immediate consent/discard behavior.
3. Quick/Project New Chat uses one shared synchronous `chatCreationInFlightRef` guard plus visible `creatingChat` state. New Chat, composer textarea, file selector, Sources, Tools, voice and Send are disabled during creation; `finally` restores them after both success and failure. No new provider request, double-create or chat engine.
4. Active Quick/Project Chat archive and trash, and active Project archive/trash, now pass the same explicit unsent-draft and dirty-Artifact checks before the mutation. The existing destructive confirmation remains for Trash; cancellation or backend failure leaves current draft and selection alone. Successful Quick Chat removal returns to **Quick mode**, not a nonexistent Project.
5. Recent sidebar now shows deduplicated currently active records. Failed list queries show an honest `role=alert` with retry, loading shows `role=status`; only confirmed empty lists show the empty copy. Existing mobile Sheet and server owner-scope protections are retained.
6. No changes to server APIs, credential stores, entitlements, archived or trashed record persistence, data retention policy, original Radix dialogs, Artifact execution, or Workbench layout.

## Tests

- **8 executable unit cases** in `client/src/lib/conversationSwitchPolicy.test.ts`: text and attachment draft detection, Quick vs Project mode, active/trashed filter, duplicate Quick Chat from mixed read stores, invalid timestamps and bounded recent ordering.
- **10 source integration cases** in `script/validate_ws16_sidebar_lifecycle.test.mjs`: original navigation/menus, consent/deferred discard, remote operation success order, active archive/trash, failure-safe draft handling, duplicate creation protection, sidebar load/error and no-native-evidence boundary.
- Test discovery exists for `.test.ts` and `.test.mjs` in `src/script/run_project_tests.mjs`. From the **exact reviewed PR branch head**:

```bash
cd src
node --import tsx --test client/src/lib/conversationSwitchPolicy.test.ts script/validate_ws16_sidebar_lifecycle.test.mjs
npm run test:ux
npm run acceptance:ux
```

## PR ownership and collision matrix

- [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) owns original Chat integrations, changes both `ProjectExperienceShell.tsx` and `AuthenticatedNavigation.tsx`; this WS-16 branch changes only the former.
- [PR #102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102) owns universal saved Chat/Artifact, modifies `ProjectExperienceShell.tsx`. [PR #100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100) owns Quick Chat attachments, also modifies that original Chat file. [PR #115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115) owns message actions; [PR #130](https://github.com/kiranvbiim-coder/lios-terminal/pull/130) owns trusted recovery; [PR #134](https://github.com/kiranvbiim-coder/lios-terminal/pull/134) owns first-use guidance; [PR #136](https://github.com/kiranvbiim-coder/lios-terminal/pull/136) owns Workbench→canonical Chat return. All change the original Chat TSX; **before merging**, reconcile each current head rather than picking one branch as source authority or reverting feature work.
- WS-16 does **not** edit the shared navigation component, Project/Quick Chat API, licensed donors, or backend. `ProjectExperienceShell.tsx` is the canonical file for current integration. Keep this patch as a focused draft until conflict reconciliation, source CI, privacy and native user journey verification.

## Evidence and acceptance status

| Check | Status |
| --- | --- |
| Original Chat integration and 18 new regressions committed | IN_PR |
| Exact-head Node suite / typecheck / Linux/macOS/Windows CI | PENDING |
| Failed New Quick Chat / Project Chat creation leaves input and attachment refs intact | NOT_RUN |
| Duplicate New Chat clicks create exactly one server record | NOT_RUN |
| Active archive/trash: cancel, 403, 409, 5xx and retry preserve unsent drafts | NOT_RUN |
| Recents after rename/pin/archive/trash and on source error | NOT_RUN |
| 320/390/768/1280/1440 responsive screenshots | NOT_RUN |
| 200% zoom, keyboard-only lifecycle dialogs and focus restoration | NOT_RUN |
| VoiceOver/Narrator and installed native macOS/Windows | NOT_RUN |
| Independent review, merge to protected main and signed product | PENDING |

There is no local browser/installed desktop acceptance proof from source review alone. In particular test **mid-flight typing and concurrent lifecycle actions** before treating the changed draft-clear sequencing as exhaustive protection; pending creation disables primary composer controls, but other asynchronous action entry points still require full race and ownership verification. Attach exact SHA, OS/renderer, fake demo data, HTTP failure logs, screenshots and stage-by-stage effects to [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

**Next:** WS-17 — universal search and keyboard command palette, coordinated with existing #101/#114 work.
