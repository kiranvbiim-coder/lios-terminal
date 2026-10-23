# WS-24 — Message Copy, Quote & Follow-up Actions

**Date:** 2026-10-23. **Canonical repo:** [kiranvbiim-coder/lios-terminal](https://github.com/kiranvbiim-coder/lios-terminal). **Track:** 65-workstream UX [plan PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) and master [issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Source audit — existing owner and actual gaps

- **PR [#115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115)** already owns `ChatMessageActions.tsx` (per-message Copy and assistant-only Quote) and the pure `chatMessageActions.ts`. This WS-24 branch is deliberately **stacked on `feat/tc-chat-message-actions-20261022`**, not on main, to preserve #115's original work. No second toolbar, action engine, message storage, provider call, permission or donor code.
- Existing `visibleChatMessageText` removes assistant machine directives from copied/quoted content; user text remains unchanged. Existing `copyChatMessageText` awaits the real browser Clipboard API and returns false on failure. The parent PR already has baseline tests and keyboard-readable copy/quote labels.
- **Real gap 1:** rapid repeated Quote clicks call `setInput(draft => quoteChatResponse(draft, sameMessage))` multiple times. The pure function appended duplicate 1,200-character excerpts rather than treating the operation as an idempotent user action.
- **Real gap 2:** existing `ConversationRuntimeTrace` `onFollowUp={(prompt)=>setInput(prompt)}` silently overwrote an unrelated unsent draft. `onRecoveryAction` did the same for ordinary suggestions; on a slash suggestion it **immediately invoked `runCommand(action)`**, although selecting a follow-up should stage an editable command rather than execute tools without a deliberate Send.
- **Real gap 3:** the clipboard button used React `copyState === "copying"` as its only guard, allowing two fast clicks before the state rerender to start concurrent clipboard writes. An older async clipboard result could update a toolbar after the selected Chat/message had changed. The original action target was only 32px tall.
- While a Home run is busy the composer is disabled. Quote-to-follow-up should be disabled at that time rather than staging text while pending Send or error settlement may modify the draft.

## Focused implementation

1. **`src/client/src/lib/chatMessageActions.ts`** retains the PR #115 quote format, directive stripping, 1,200-character excerpt and bounded copying. `quoteChatResponse` detects the already-staged **exact same quote block** and does not duplicate it. New pure `stageChatFollowUp(draft, suggestion)` preserves any current unsent text, appends only genuinely new user-invoked follow-ups (or slash recovery suggestions), and returns the existing draft on repeated selection or empty suggestion. These are string transformations, not Chat/agent sends, mutations or source authorization.
2. **`ChatMessageActions.tsx`** keeps PR #115's per-message Copy/Quote UI but uses a synchronous `useRef` clipboard mutex keyed by **role, message ID and content**. A stale resolved Clipboard Promise cannot mark a different active message as copied; state resets on message identity changes. Buttons now have 40px minimum height. An explicit `quoteDisabled` prop allows the caller to disable Quote while a response is running; Copy remains available. Copy success is still only based on fulfilled browser `writeText`; failure gives the original manual-copy fallback, not a false success.
3. **`ProjectExperienceShell.tsx`** passes the original `message.id` and current `busy` to the existing action toolbar. Its original Quote callback remains `setInput(draft => quoteChatResponse(...))`, which is now idempotent. The trace `onFollowUp` and `onRecoveryAction` use **functional `setInput(current => stageChatFollowUp(current,...))`** so racing UI interactions cannot overwrite a newer draft. Slash suggestions are **staged for user review** rather than immediately executing `runCommand`. Connection Center still opens on an explicit user recovery action, but any previous message is staged alongside unsent typing instead of overwriting it. Focus returns to the existing composer for ordinary suggestions. No automatic model/API call on Quote, Follow-up or slash-suggestion selection.
4. The separate [WS-22 PR #145](https://github.com/kiranvbiim-coder/lios-terminal/pull/145) already owns the execution-trace **Retry** semantics. WS-24 does **not** silently replace its work; reconcile #145's deliberate review-only Retry before protected-main merge. [WS-18 PR #139](https://github.com/kiranvbiim-coder/lios-terminal/pull/139) separately owns Send/Stop single-flight and draft settlement; retain its busy/draft behavior. [WS-23 PR #146](https://github.com/kiranvbiim-coder/lios-terminal/pull/146) owns Markdown table/code Copy, which remains separate from whole-message Copy.
5. **No new backend actions, data egress, source entitlement, citation resolver, connection setup, chat persistence, telemetry or clipboard storage.** Copied/quoted text is taken from the selected message only. Assistant machine directives remain excluded; repeated quote and recovery actions cannot implicitly run approved tools.

## Regression and acceptance

- Extended PR #115's existing `client/src/lib/chatMessageActions.test.ts` with **7 new executable cases** covering repeated identical quotes, different quotes, empty/hidden directives, idempotent text suggestions, slash suggestions staged only, and clipboard truth. Original parent tests remain unchanged.
- Added **9 source-level contract tests** `src/script/validate_ws24_message_actions.test.mjs` covering true owner/wiring, source sanitization, exact message identity, synchronous clipboard lock, Quote busy guard, functional draft updates, no recovery command auto-execution, and explicit outstanding acceptance.
- Run on the **exact current WS-24 stacked head** from `src/`:

```bash
node --import tsx --test client/src/lib/chatMessageActions.test.ts script/validate_ws24_message_actions.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Acceptance evidence | Status |
| --- | --- |
| 16 new test cases authored; source code committed to draft | IN_PR |
| Exact-head Node suite, TypeScript, hosted Linux/macOS/Windows CI | PENDING |
| Double-click Quote adds one excerpt while original draft survives | NOT_RUN |
| Different Quote clicks add distinct context in chronological order | NOT_RUN |
| Clipboard denial/delayed clipboard resolution during Chat switch | NOT_RUN |
| Slash suggestion and recovery actions never execute without explicit Send | NOT_RUN |
| Original Home/Retry/Send integration against WS-18 and WS-22 | NOT_RUN |
| 320/390/768/1280/1440px, 200% zoom, Tab/Enter/Escape and focus | NOT_RUN |
| VoiceOver/Narrator on actual macOS/Windows installed application | NOT_RUN |
| Parent #115 review/merge, cross-PR collision reconciliation, protected-main merge | PENDING |

## Dependency and merge safety

- **Merge [#115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115) through its existing integration dependency first**, then rebase/retarget WS-24 onto the current protected main; never cherry-pick/copy the message-action implementation twice. #115's base is `integration/tc-p4-p12-universal-20261022` and is not yet proof of main integration.
- The original `ProjectExperienceShell.tsx` is also touched by #98/#100/#102/#130, WS-14 #134, WS-15 #136, WS-16 #137, WS-17 #138, **#139**, WS-19 #140, WS-20 #141, WS-21 #143 and **#145**. Compare exact current heads and preserve their saved messages, Quick/Project/Temporary scope, real attachments, Send/Stop, search, keyboard and receipt safety. **No whole-file accept/reject strategy**.
- Browser Clipboard API behavior, cross-message asynchronous copy races and the actual accessibility of all actions must be tested with real signed-in user fixture accounts and installed native apps. Source checks and authored tests do not establish a shipped feature.

**Next:** WS-25 — Quick/Project/Temporary Chat persistence, coordinated with #100/#102 and actual chat stores.
