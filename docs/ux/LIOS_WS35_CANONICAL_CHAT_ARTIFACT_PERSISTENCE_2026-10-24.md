# WS-35 — Chat-owned canonical Artifact persistence

**Date:** 2026-10-24. **TC/UX plan:** [PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Parent:** [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98), the existing P4/Chat retention authority; [PR #102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102) separately owns universal signed-in Chat integration. Avoid duplicate P4 storage, Chat messages or invented Projects.

## Audit: what already exists

- `conversationRunService` owns persistent Project/Quick runtime turns. Real P4 writes pass through `persistConversationDraft` in the existing Artifact store, with deterministic ID based on owner/organization, Chat or Project, request and draft; retry is idempotent. Existing persisted Artifact events are independently fetched from P4 to verify exact owner and saved version.
- After successful work, the runtime adds an assistant Chat message holding `metadata.persistedArtifacts` with **actual** `{id, version, title, kind}` from `retainedArtifactMessageRef`. `SavedArtifactCards` dereferences exact saved versions via the access-checked P4 route. Later revisions must not silently replace saved history.
- Quick Chat persists under `owningChatId` without fabricated Project. The server enforces same-owner/organization/Chat access; existing HTTP/DB tests verify reopen, version lifecycle and denial.
- `startTemporaryRun` is a separate memory-only path. It does **not** call the P4 persistence function or append saved Chat messages, even when the runtime emits an ephemeral Artifact. Client disables `onKeepArtifact` in Temporary Chat; P4 rejects `persistence: ephemeral` drafts.

## Real gap found

Previously, the persistent run used `const saved = Boolean(result.text) && !result.cancelled && !result.awaitingApproval`. If a successfully executed tool produced a saved P4 Artifact **without response narration**, the Artifact was retained and its runtime event emitted, but **no assistant message was written**. After restart, the user could not reopen this result from the message's canonical Artifact cards because there was no message referencing it. A whitespace-only response could also be incorrectly considered meaningful.

Separately, the pending Artifact auto-retention gate did not explicitly exclude a runtime that returned with `held.errored` or an observed `done:failed` event. Failed work should not be promoted to saved P4 output.

## Implemented increment

1. `server/savedChatArtifactAnswer.ts` returns an answer for meaningful successful text unchanged, or a conservative, **non-financial** Chat message when confirmed P4 writes exist without text. The wording promises only that the recorded Artifact was saved, with a link through the existing saved cards; it does not imply data verified, a finished financial calculation, or arbitrary ephemeral drafts.
2. `conversationRunService.ts` computes the answer **after** actual P4 writes; both the existing encrypted transcript recorder and durable assistant Chat message use the same finalized text, with actual `persistedArtifacts` metadata unmodified. Working Context continues to carry the last real P4 ID only on successful durable saves.
3. Only an explicitly observed **completed** terminal event can retain pending drafts or a durable assistant message. Cancelled, missing-terminal, approval-paused, failed and errored turns do not create synthetic success messages; the pending-draft write gate uses the same strict terminal boundary. Existing persisted Artifact events continue to be verified against P4 before being referenced.
4. No new Chat DB/store, simulated persistence, provider calls, source entitlement, data transmission, permission grant, artificial Project or retained Temporary Artifact was added.

## Added tests / targets

- `server/savedChatArtifactAnswer.test.ts`: exact retained-answer fallback for single/multiple confirmed writes, whitespace-only outputs, byte-for-byte nonempty text, false-count refusal, cancellation, approval pause, failure and original runtime custody source checks.
- Expanded `server/conversationRunService.journal.test.ts` original DB/HTTP integration: exercises **real Project and Quick** artifact retention, parses saved assistant message metadata via the canonical `savedMessageArtifactRefs` reader to assert exact ID, version, title and kind; extends storage-refusal assertions to forbid saved assistant cards on a failed turn. Existing test already proves Temporary produced no journal, P4 Artifact/version or saved message.

Run from `src/`:

```sh
node --import tsx --test server/savedChatArtifactAnswer.test.ts server/conversationRunService.journal.test.ts server/artifactStore.chatRetention.test.ts
npm run check
npm run test:p4
npm run test:ux
npm run acceptance:ux
```

**Status/qualification:** Exact-head GitHub Linux/macOS/Windows CI, authenticated real app replay/restart/owner tests, 320px keyboard screen-reader and native installed-app checks, full SP/P14 signoff and protected-main merge are pending until demonstrated. The parent PR #98 had green cross-platform checks on SHA `1725e1b`; those checks **do not** certify this increment.

**Dependency:** This work is stacked on #98. #102 is also on #98 and #163 (WS-34) is another child; reconcile before merging, especially if the Chat shell/Artifact card paths advance. Keep this PR draft until exact-head CI passes.
