# SI-01 Governed Output Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing bounded workspace write-return transport usable through the canonical GM-11 approval path without adding a second executor or filesystem authority.

**Architecture:** Keep the existing stdout-framed workspace transport and GM-10 runner. Treat raw output callbacks and `acceptExit` as one lifecycle-bound private transport: GM-11 admits it only when the spawn callbacks are exactly the backend lifecycle callbacks, snapshots the lifecycle with the approved launch, and the canonical runner sanitizes the exit after native extinction before finalization.

**Tech Stack:** TypeScript, Node.js, GM-10 process supervisor, GM-11 governed execution, existing container/workspace-transfer backend.

**Spec:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`, `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`, issue #192, PR #271.

## Global Constraints

- One GM-10/GM-11 execution authority only; no second process runner.
- Reuse the existing `workspace-transfer` framing; do not add another file-transfer authority.
- Raw framed bytes must never appear in the user-visible command result or trust facts.
- Backend transport callbacks are accepted only when bound by identity to the approved backend lifecycle.
- Native extinction precedes `acceptExit`; `acceptExit` precedes `finalize`; cleanup/finalization still runs if transport acceptance fails.
- Backend finalization data remains private to the execution authority; generic `CommandResult` is not widened with returned file buffers.
- Risk R3: focused V1 plus relevant V2 required; V3 remains deferred to SP-01/#250.

## Review Focus

- Arbitrary backend-supplied raw output callbacks must still fail closed.
- A mutated lifecycle after approval must not alter the prepared transport behavior.
- Framing/transport failure must not skip backend cleanup/extinction proof.
- Normal local backend execution without private transport must remain unchanged.
- Approval digest must distinguish private transport without changing the ordinary captured-output digest shape.

---

### Task 1: Pin the governed transport contract

**Files:**
- Add: `src/server/exec/authority/governed-output-transport.test.ts`

**Interfaces:**
- Consumes: existing `ExecutionBackendLifecycle.acceptExit`, `SpawnInput.onStdoutRaw/onStderrRaw`.
- Produces: regression contract for lifecycle-bound private transport and ordering.

- [x] Add a governed-command test where a backend supplies `captureOutput=false`, lifecycle-bound raw callbacks and `acceptExit`; preparation must be accepted only when callback identities match the lifecycle.
- [x] Add a negative test where raw callbacks are not lifecycle-bound; preparation must fail with `backend-control-field-unsupported`.
- [x] Add a runner test proving `acceptExit` runs only after native extinction, before `finalize`, and sanitized stdout is returned.
- [x] Add a runner test proving `finalize` still executes when `acceptExit` throws.
- [ ] Execute the focused tests and record fresh output. The connector-created branch workflow did not dispatch, so no RED/GREEN execution claim is made from this session.

### Task 2: Preserve and admit the private transport through GM-11

**Files:**
- Modify: `src/server/exec/backends/types.ts`
- Modify: `src/server/exec/backends/container-lifecycle.ts`
- Modify: `src/server/exec/backends/container.ts`
- Modify: `src/server/exec/authority/governed-command.ts`

**Interfaces:**
- Produces: lifecycle-bound `onStdoutRaw`, `onStderrRaw`, `acceptExit` retained in `PreparedGovernedCommand`.

- [x] Extend `ExecutionBackendLifecycle` with optional raw stdout/stderr transport callbacks.
- [x] Make container lifecycle expose the exact output-stream callbacks and make the spawn plan reference those same functions.
- [x] Change GM-11 admission so `captureOutput=false` is permitted only for a complete lifecycle-bound private transport; continue rejecting arbitrary/unbound callbacks.
- [x] Snapshot/bind `acceptExit` and raw callbacks with the prepared lifecycle so later backend mutation cannot change approved behavior.
- [x] Include private-transport mode only in private-transport approval digests, preserving ordinary captured-output digest shape.
- [ ] Execute governed-command/container focused tests and `npm run check`.

### Task 3: Consume private transport in the canonical GM-10 join

**Files:**
- Modify: `src/server/exec/run-command.ts`

**Interfaces:**
- Consumes: `ExecutionBackendLifecycle.acceptExit`.
- Produces: sanitized `RunExit` used for command success/failure and result output; finalization remains private.

- [x] After `run.wait()` and positive native extinction, call `lifecycle.acceptExit(result)` when present.
- [x] Always call `lifecycle.finalize()` after proven extinction even when `acceptExit` fails; aggregate/propagate transport/finalization errors after cleanup.
- [x] Use only the sanitized exit for truncation/success checks and returned stdout/stderr.
- [x] Keep backend finalization data out of generic `CommandResult`.
- [ ] Execute runner + governed + container/workspace focused suites and `npm run check`.

### Task 4: Integration handoff

**Files:**
- PR #272 / PR #271 evidence only.

- [x] Record base candidate SHA `9f8650b95b7038ddfbfa2f3e224184279cc543a2` and bounded PR #272.
- [x] Record validation limitation truthfully: no self-hosted run was dispatched from this connector session.
- [ ] Run focused V1 on self-hosted macOS and record exact command/output.
- [ ] Run relevant SI-01.12 V2 only after focused green evidence; do not run full SP-01 V3 here.
- [ ] Merge into the integrated candidate only after required R3 evidence is green.
