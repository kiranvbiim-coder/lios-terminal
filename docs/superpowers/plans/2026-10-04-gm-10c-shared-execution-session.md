# GM-10c Shared Execution Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SI-01.10 by making Project/Chat execution and the optional Terminal pane attach to the same canonical execution session with replay, input, cancel, reconnect and restart-safe persistence semantics.

**Architecture:** Extend the existing GM-10 supervisor, PTY backend, execution journal and Gateway/session contracts. Do not create separate chat-terminal and terminal-terminal runtimes. Chat remains the default surface; terminal is an optional view/control surface for the same session.

**Tech Stack:** TypeScript, Node.js, existing `server/exec/**`, Gateway protocol/runtime, Project conversation runtime, Electron client.

**Spec:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`, `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md`, issue #233.

## Global Constraints
- Single canonical execution/session authority only.
- Privileged interactive input remains blocked until GM-11 authority is available.
- Reuse existing PTY, output ring/backpressure, execution journal, Gateway and Project/Chat ownership.
- No automatic command resume after app restart.
- Risk R3; V0 + V1 + relevant V2. V3 deferred to SP-01.

## Review Focus
- attach/replay must never cross user/Project/Chat boundaries;
- reconnect must not duplicate or restart execution;
- cancellation must terminate the same process/session seen by chat and terminal;
- restart may restore transcript/receipt state but must not auto-resume an interrupted process;
- backpressure/bounded replay must prevent unbounded memory growth.

---

### Task 1: Canonical execution-session identity
- [x] Use the existing Conversation Runtime requestId as the canonical execution session id; carry user/Project/Chat ownership in the same live run summary.
- [x] Extend the existing ConversationRunRegistry only; no second session registry or process authority.
- [x] Add focused contract tests proving exact user/Project/Chat scoped access. Repository V1 remains pending.

### Task 2: Gateway attach/replay/cancel contract
- [x] Add typed `execution.session.attach`, `execution.session.detach`, `execution.session.cancel` and `execution.session.event` contracts to the existing Gateway protocol catalogue.
- [x] Reuse the ConversationRunRegistry replay buffer and sequence; Terminal attach does not create or restart execution.
- [x] Add tests for same-sequence Chat/Terminal replay, wrong-user/Project/Chat denial, detach and cancel ownership. Repository V1/V2 remains pending.

### Task 3: Governed interactive input
- [ ] After GM-11 authority is available, add bounded terminal input on the same session.
- [ ] Revalidate authority before input/side effects as required by the canonical policy.
- [ ] Test denied/stale/cancelled input and no hidden alternate shell path.

### Task 4: Conversation + optional Terminal UI
- [x] Keep the compact execution card in Chat as the default and add a progressive-disclosure Terminal handoff.
- [x] Attach a read-only optional Execution Terminal panel to the same canonical session id through the scoped Gateway contract; no second websocket/session/runtime.
- [x] Bound client replay, collapse cumulative text, support same-session cancel, and close/detach back to Chat without affecting execution. Server contract tests prove attach/detach does not create or restart a run; repository TypeScript/V1 remains pending.
- [ ] Add governed interactive input only with Task 3 once GM-11 authority is stable.

### Task 5: Restart/recovery evidence
- [x] Expose the existing encrypted execution journal through scoped Gateway `execution.session.read/history` methods using the same session id; no second persistence store.
- [x] Add contract coverage showing an `interrupted` persisted transcript is readable while the live registry remains empty, so history reads cannot resume/recreate execution.
- [x] Consume the canonical GM-11d encrypted journal trust facts from #267 in scoped `execution.session.read/history`; project history displays approved/denied evidence without starting a live run. The receipt producer still requires GM-11 convergence.
- [ ] Run relevant V1/V2 suites on the self-hosted Mac and record exact evidence.
