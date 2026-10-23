# WS-22 — Observed Runtime, Exact Cancel, Draft-Only Retry and Receipts

**Date:** 2026-10-23. **Canonical target:** [lios-terminal](https://github.com/kiranvbiim-coder/lios-terminal). **Plan:** [65-workstream PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119). **Tracking:** [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Code audit — actual defects and retained ownership

- The existing `gateway/conversationRun.ts` subscribes by **exact** `requestId` and `runSeq`, deduplicates reconnection events and does **not restart runs on reconnect**. A distinct explicit `resumeConversationRun` uses the same request ID and lets Home establish authority. Keep all of this. But when Home restarted or re-subscribe failed after a run had started, its `interrupted()` called `complete()`, returning **`{ok:true,status:200}` with no observed final `done`**. That falsely equated an interrupted run with a finished run.
- `runtimeTraceSummary.ts` represented a nonempty trace with **no terminal `done`** as `running` even if `busy=false`; users could see a working or successful impression with no authoritative status.
- `ConversationRuntimeTrace.tsx` labeled any `done(completed)` as `data-testid="trace-receipt"`, **whether or not a separate `receipt` event was actually observed**.
- Original `ProjectExperienceShell.tsx` re-attaches on reconnection with `attachConversationRun`. It then parsed the **buffered/replayed final answer text** and ran `applyWorkspaceAction(...,"assistant")`, which can replay user-visible workspace side effects previously applied during the first UI session. The failed-run path also synthesized `error` and `done(failed)` locally as if Home had emitted them.
- The original trace's **Try again** callback immediately invoked a **new `send`** using the last message; a partially executed prior run may have performed consequential work even if its final receipt was missing. Original deny-review logic also inserted a fake local `done(cancelled)` without asking Home to cancel.
- Existing WS-18 [#139](https://github.com/kiranvbiim-coder/lios-terminal/pull/139) independently adds the composer Send/Stop mutex and draft guards; WS-22 does not rebuild those controls. Original server/HOME gateway approval/receipts, auth, tool governance, data scope and `runSeq` protocol remain the source of truth.

## Implementation

1. In original **`gateway/conversationRun.ts`**, interrupted observations now return `{status:503,ok:false,errorCode:"run_interrupted",events}`. The list preserves exactly the Home events actually observed, but **never adds a fabricated `done`**. Reconnection still subscribes from last seen `runSeq` for exactly the same `requestId`. The existing actual terminal events retain their semantics, including explicit approval pauses and voluntary cancellation.
2. `runtimeTraceSummary.ts` adds `interrupted`: if there are events but no actual terminal `done` and no active running observer, the status is **interrupted**, not running/completed. Normal `done(completed|failed|cancelled|waiting_approval)` states remain as originally defined. A pure `observedRunPolicy.ts` further requires **the exact `requestId`'s `done(completed)`** before any client-side UI action interprets a streamed result as completed, filters mixed trace events to the selected run, detects possible side effects and stages an editable retry draft without overwriting existing typing.
3. **`ConversationRuntimeTrace.tsx`** now labels a confirmed receipt only after an **observed `receipt` event** in that exact run and completed status. When Home completes without a separately observed receipt, copy says so without claiming the receipt exists. Nonterminal/unbusy runs get a visible, accessible *unconfirmed run status* alert: partial text is **not** a final answer or receipt. Errors' **Review request** button stages a draft rather than resending. The Stop button has `cancelPending` state, 40px target, and indicates **Requesting Stop** instead of claiming cancellation succeeded.
4. **`ProjectExperienceShell.tsx`** keeps `attachConversationRun` but **removes replay of workspace actions from buffered text**. Failed reattachments display an actionable notice, rather than synthesizing completion. Original persistent/Temporary successful answer directives are applied only if actual Home `done(completed)` was observed for that request; interrupted partial text never executes actions or gets saved as a final Temporary assistant answer. Original failed-request synthetic `done(failed)` events are replaced with client-local notices; the original Home events and receipt are never counterfeited.
5. **Cancel and deny** call only the existing `conversation.cancel` endpoint for exact Home request ID. A synchronous cancel mutex plus exact-run acknowledgement guard prevents duplicate requests even after Home acknowledges Stop; the UI displays **Stop requested** until the observed run settles. No `done(cancelled)` event is appended by the browser. Acknowledgement `cancelled:true` means the cancel **request** was acknowledged, not that the observer already saw the actual terminal `done(cancelled)`. A failed/denied cancellation shows an honest notice without erasing the trace. Explicit agent Resume remains a separate Home-authorized same-run operation, never implied by Retry.
6. The runtime error **Retry** and interrupted run actions now **prefill the previous message** for user review without automatically sending. Any unrelated unsent draft wins and is preserved. This avoids blind replay of potentially irreversible tools. Existing WS-18 Send guards must still be reconciled during merge; WS-22 does not authorize duplicate execution.

## Tests

- **8 executable policy tests** `src/client/src/lib/observedRunPolicy.test.ts` for exact run completion/status, partial text, mixed unrelated run events, uncertain tool side effects and draft-safe retry.
- **2 updated/new gateway integration assertions** (Home restart fail-closed and started-run re-subscribe failure with no automatic `conversation.start`) in existing `src/client/src/lib/gateway/conversationRun.test.ts`.
- **2 runtime summary cases** appended to existing `src/client/src/lib/runtimeTraceSummary.test.ts` for interrupted/no-done and actual observed terminal status.
- **Source integration tests** `src/script/validate_ws22_observed_runtime.test.mjs` checking trace receipt authenticity, exact cancel, no replays, no synthetic done, stage-only retry, original Gateway resume/reconnect and explicit native-evidence limits.
- Run on **exact reviewed WS-22 head** from `src/`:
```bash
node --import tsx --test client/src/lib/observedRunPolicy.test.ts client/src/lib/gateway/conversationRun.test.ts client/src/lib/runtimeTraceSummary.test.ts script/validate_ws22_observed_runtime.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Acceptance requirement | Status |
| --- | --- |
| Source implementation committed and new regression tests authored | IN_PR |
| Exact-head Node tests, TS check, hosted Linux/macOS/Windows CI | PENDING |
| Real Home restart/disconnect/reconnect, delayed re-subscribe, original requestId and runSeq | NOT_RUN |
| Actual multi-step tool with irreversible side effects, no duplicate retry | NOT_RUN |
| Consent denial and explicit cancel acknowledgement versus observed terminal done | NOT_RUN |
| Execution receipt persisted and restored for exact saved Chat/run owner | NOT_RUN |
| Temporary Chat partial-output preservation, no false finished answer | NOT_RUN |
| 320/390/768/1280/1440 browser screenshots, 200% zoom and keyboard only | NOT_RUN |
| VoiceOver/Narrator and native macOS/Windows app accessibility | NOT_RUN |
| Independent review, conflict reconciliation and protected-main merge | PENDING |

## Merge collisions / owner coordination

WS-22 is a **main-based draft** to fix the original gateway and runtime trace without importing an unrelated Chat feature stack. [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) also changes the trace; [PR #139](https://github.com/kiranvbiim-coder/lios-terminal/pull/139) already owns composer Stop/Send and draft safety. Original Chat also overlaps #100/#102/#115/#130/#134/#136/#137/#138/#140/#141. **Reconcile their exact current heads before merge**, especially preserving WS-18's Stop mutex and unmodified saved Chat/Artifact/approved mutation handlers. Do not overwrite #98's other trace features or use a whole-file accept strategy. Server Home is the authority for execution status, governance and receipts; client display is not proof of actual side effects. There is no new provider, backend endpoint, schema, storage, donor, licence or auto-retry.

**Next:** WS-23 — readable, trustworthy responses/code and copy UX, coordinated with existing ChatMarkdown owners.
