# WS-32 — Checkpoints and truthful deep-research continuation

**Date:** 2026-10-24. **Owner:** stacked on [WS-27 PR #117](https://github.com/kiranvbiim-coder/lios-terminal/pull/117), which itself depends on [WS-29 PR #116](https://github.com/kiranvbiim-coder/lios-terminal/pull/116). **Plan:** TC/UX [#119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) / master [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Source-inspected runtime reality

- P2 already has a **canonical encrypted execution journal** and bounded native L3/L6 checkpoint. `agent-checkpoint.ts` records step statuses, hashed plan/policy/context, dispatch outcomes and server-only continuation. Raw tool inputs and continuation are not served in the execution history API.
- `GET /api/project-chats/:chatId/executions` authenticates the chat and scopes journal records to the user, project and chat. `executionRecordView` strips the actual continuation and returns only redacted checkpoint binding facts and a **server-derived** `resumable` boolean. Only `status: interrupted, resumable: true` can be offered; completed, cancelled, failed, waiting-approval, or outcome-unknown/checkpoint-less records do not qualify.
- `conversation.resume` accepts **only the canonical requestId**. The Home re-evaluates ownership, current policy, tool set, context, plan, attachment identity, AI authorization and journal reconciliation. Any drift or unsafe tool dispatch **refuses** continuation, instead of replaying side effects.
- `useInterruptedAgentRun` already discovered eligible server runs and exposed a person-clicked Resume button. The Chat control previously showed only “Stopped · Resume”, no checkpoint facts, partial-work qualifier or explanation that eligibility can expire. A thrown gateway/observer exception could also leave the UI busy indefinitely because cleanup ran only in the success `.then` branch.
- WS-27 [PR #117] already exposes actual live tool-event progress, up to 3 observed results and Stop/Show work. **Do not** add new research agents, fake background jobs or synthetic percentages.

## WS-32 changes (stacked, not duplicate)

1. `client/src/lib/researchCheckpoint.ts`: pure read-only projection of the **authenticated Home execution-history response** for the exact server-offered request ID. It counts **only explicitly completed checkpoint steps**, waiting-review steps and distinct saved evidence reference strings. It never serializes raw tool inputs, continuation, passwords, granted approvals, or provider secrets. Unexpected/mismatched/legacy/unsafe checkpoint metadata yields unknown counts, not inferred progress.
2. `ResearchCheckpointCard.tsx` replaces the tiny Resume chip with an explicit and keyboard-focusable checkpoint surface: saved step count (if recorded), reference count (not verified), partial-work qualification and clear indication of the Home's reauthorization/drift checks. If snapshot details are unavailable, it says so. Only the existing person-initiated `onResume` action is wired; no background execution.
3. `useInterruptedAgentRun` still requests eligibility from the same owner-scoped API, but hides Resume while the Home gateway is absent or execution history is refetching/errored. It passes **display-only** checkpoint counts to Chat and now releases busy state on **both** successful and thrown resumes, surfacing errors; refetches authoritative state after settling. The resume RPC still carries **only** the request ID.
4. `ConversationRuntimeTrace` retains its original busy/approval/Stop/Show work behavior and uses a separate recorded-checkpoint surface when and only when the existing server eligibility and resume callback are both present; no checkpoint is synthesized from an unrelated live run.
5. Fixed an observed WS-27 CI failure **in the existing parent PR #117**: the SSR test helper omitted the active requestId, causing foreign-plan findings to be selected despite the production component passing the ID. The parent branch was corrected before WS-32 was stacked.

## Tests

Targeted (run from `src/`):

```sh
node --import tsx --test client/src/lib/researchCheckpoint.test.ts client/src/lib/useInterruptedAgentRun.test.ts client/src/lib/observedResearchProgress.test.ts client/src/components/terminal/ConversationRuntimeTrace.test.ts
npm run check
npm run test:ux
npm run acceptance:ux
```

Added regression assertions for strict server-record eligibility; terminal/nonresumable exclusion; no foreign-request counts; invalid/duplicate/legacy/outcome-unknown checkpoint metadata; no fabricated progress; partial work copy; no sensitive continuation leak; absent action under busy/no callback; static exact-request-only RPC path; and shell busy cleanup on unexpected failure.

## Mandatory acceptance gaps

**NOT QUALIFIED until verified:** exact-head hosted Linux/macOS/Windows tests, secure owner/foreign tenant replay, policy/tool/context drift rejection, outcome-unknown external effects, Home restart and network-loss recovery in signed-in native apps, consent/approval pathway, screen readers, touch and 200% zoom, and protected-main PR merge. A `resumable` server flag is only an *eligibility hint*; the Home may still refuse execution on authoritative recheck. This is **not** an endlessly-running background research system or a new checkpoint storage API.

**Merge ordering:** #116 first; update/rebase #117 on latest #116, run checks; then rebase this WS-32 PR onto #117; reconcile unrelated #150/#153 Trust-panel changes before promotion. Never flatten these PRs without reviewing exact unique commits and tests.
