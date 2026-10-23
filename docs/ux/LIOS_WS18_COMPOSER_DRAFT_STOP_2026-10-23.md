# WS-18 — Reliable Send, Visible Stop and Draft-Safe Recovery

**Date:** 2026-10-23. **Track:** TC/UX WS-18 of [65-workstream plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). This is a focused source implementation in the existing LiOS universal Chat, not a new conversation runtime.

## Audited original behavior and ownership

- **Canonical Chat composer:** `src/client/src/components/terminal/ProjectExperienceShell.tsx` owns text Send, Shift+Enter, voice transcripts, real-file attachment staging, Quick/Project/Temporary flows, retry approvals and server-governed `runConversation`. The similarly named `src/client/src/components/terminal/WorkspaceComposer.tsx` composes *analytical panes*, not Chat messages; it is **out of scope**.
- Before WS-18, `send()` only checked the React `busy` state at entry. Back-to-back keyboard Enter/click or an AI retry could arrive before React committed the busy update, sending two requests and potentially creating two saved chats. The existing `busyRef` was synchronized on render rather than acquired synchronously for Send.
- The editor is disabled while `busy`. The only direct keyboard Stop path in the composer was Escape **on that disabled editor**, so a keyboard-only user could not depend on it. The separate runtime trace already offered Cancel; this PR preserves it and adds a visible composer Stop action.
- The send path cleared the editor before awaiting the runtime, then indiscriminately called `setInput(message)` on errors and HTTP 428. When `send({message: lastSubmittedMessage})` retried an older request and a different unsent draft existed, this could replace the newer draft with the older message. A successful retry could likewise clear unrelated text. File-ref/voice semantics are not reimplemented.
- The existing `runConversation` and `cancelConversationRun` APIs remain the server/governed execution authority. No client-side fake answer, local abort-only replacement, authorization bypass, new provider or altered attachment entitlement is introduced.

## Implementation

1. **Small pure draft policy:** `src/client/src/lib/composerDraftSafety.ts` provides `mayClearComposerDraft`, `clearSubmittedComposerDraft` and `restoreFailedComposerDraft`. A normal Send clears only the exact matching snapshot; continuation/retry or an unrelated editor draft remains intact. A failed request restores its prior draft only when the current editor is empty, never overwriting newer text. No storage, server authority, data logging or background persistence.
2. **Synchronous single-flight Send:** in the **original** `ProjectExperienceShell.tsx`, use `sendInFlightRef` *before* command dispatch, chat creation, file upload or `runConversation`. Gate on the existing busy/creatingChat state. Release the guard in a complete `finally`, including early validation/command returns and thrown preflight. Input settlement in both Temporary and saved-chat paths now uses the guarded draft functions. Explicit notice on preflight exceptions, not an unhandled keyboard/click rejection.
3. **Visible and accurate Stop:** when a real response is busy and `runtimeRequestId` exists, the composer shows a keyboard-accessible, focus-visible **Stop** action instead of a disabled Send button. Only the original `cancelConversationRun(requireGateway(), runtimeRequestId)` is called. One synchronous `stopInFlightRef` stops duplicate cancellation commands; request progress is visible as **Requesting Stop… / Stopping…**. Acknowledgement does **not** claim the server has already completed cancellation or mark `busy=false`; only the underlying runtime settles that state. If Stop cannot be confirmed, show an actionable warning rather than silently pretending cancellation succeeded. Existing runtime trace Cancel continues to work.
4. **Original composition semantics preserved:** IME composition still does not trigger Send, Shift+Enter still inserts newlines; quick commands still use the existing `runCommand`. The five-attachment cap, Project-only file privacy scope, voice transcript approval, provider approvals and server-owned retries remain unchanged. All transport failures and HTTP 428 that restore input use the protected editor policy.

## Tests, PR dependencies and acceptance

- **9 pure helper tests** `client/src/lib/composerDraftSafety.test.ts`: normal success, newer-typed text, unrelated retry draft, continuations, failed normal/failed retry restoration, empty original and whitespace.
- **9 source contract tests** `script/validate_ws18_composer_draft_stop.test.mjs`: one Chat execution route, synchronous Send guard, fail/retry input settlement, original attachment and transcript gates, visible reachable Stop, no duplicate Stop, keyboard/IME and native-evidence honesty.
- Run on the exact PR head from `src/`:
  ```bash
  node --import tsx --test client/src/lib/composerDraftSafety.test.ts script/validate_ws18_composer_draft_stop.test.mjs
  npm run test:ux
  npm run acceptance:ux
  ```

**Stacked merge order:** WS-18 is branched from [WS-16 PR #137](https://github.com/kiranvbiim-coder/lios-terminal/pull/137) (`fix/tc-ws16-draft-safe-conversation-lifecycle-20261023`) because that owner protects draft switching, chat creation and existing composer disabled states. **Merge #137 first, then rebase/retarget WS-18** before protected-main integration. [PR #100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100) owns real-file/attachment work, [#98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98), [#102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102), [#115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115), [#130](https://github.com/kiranvbiim-coder/lios-terminal/pull/130), [#134](https://github.com/kiranvbiim-coder/lios-terminal/pull/134), [#136](https://github.com/kiranvbiim-coder/lios-terminal/pull/136), and search [#138](https://github.com/kiranvbiim-coder/lios-terminal/pull/138) all overlap the canonical Chat component. Carefully reconcile their real source heads without dropping attachment, saved Artifact, navigation, first-use, permission or search behavior. This is **not** a claim that prior PRs merged.

| Acceptance evidence | Status |
| --- | --- |
| Implementation and 18 new regression tests in draft PR | IN_PR |
| Exact-head Node tests, hosted Linux/macOS/Windows CI, TypeScript | PENDING |
| Rapid Enter/Send while chat creation is slow causes only one backend request | NOT_RUN |
| Retry with unrelated unsent composer draft retains the unrelated draft | NOT_RUN |
| Real Stop request/ack, Stop failure, reconnect and resumed run | NOT_RUN |
| Real file/voice/HTTP 428 error retains correct editor state | NOT_RUN |
| 320/390/768/1280/1440px and 200% zoom keyboard-only usability | NOT_RUN |
| VoiceOver/Narrator in actual native macOS/Windows apps | NOT_RUN |
| Merge collision reconciliation, independent approval, protected-main merge | PENDING |

**No source assertion substitutes for actual server/provider/keyboard/native acceptance.** Exact SHA, OS, private-data-free demo input, runtime event IDs and screenshots should be attached to [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). In particular test intentional Stop versus a failed Stop when a running request reattaches from the server; until then do not claim the workstream shipped.

**Next:** WS-19 — actual file import/upload user experience, coordinated with #100 and governed attachment policy.
