import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  assertAgentEventChain,
  foldAgentToolDispatchState,
  type AgentEventInput,
  type AgentRunEvent,
} from "./agent-run-events";
import {
  decideAgentToolRecovery,
  deriveAgentToolIdempotencyKey,
} from "./agent-idempotency";
import {
  createExecutionJournal,
  type ExecutionJournal,
  type ExecutionOwner,
} from "./execution-journal";

const OWNER: ExecutionOwner = { userId: 11, projectId: 22, chatId: 33 };
const RUN = "750e8400-e29b-41d4-a716-446655440000";
const STEP_ID = "write-step";
const TOOL_ID = "external.write";
const INPUT_SHA256 = "a".repeat(64);

const step: AgentEventInput = { kind: "step_started", stepId: STEP_ID, label: "Write once" };
const call: AgentEventInput = {
  kind: "tool_call_started",
  toolCallId: "write-call",
  stepId: STEP_ID,
  toolId: TOOL_ID,
  inputSha256: INPUT_SHA256,
  decision: "confirm",
  permissionClass: "user_confirm",
  sideEffect: "external",
};

const prepared: AgentEventInput = {
  kind: "tool_call_execution_prepared",
  toolCallId: "write-call",
  operationDigest: "1".repeat(64),
  approvalDigest: "2".repeat(64),
  policyRevision: "3".repeat(64),
  backendId: "sandbox.exec",
  backendGenerationId: null,
};

function key(requestId = RUN): string {
  return deriveAgentToolIdempotencyKey({
    requestId,
    stepId: STEP_ID,
    toolId: TOOL_ID,
    inputSha256: INPUT_SHA256,
  });
}

function intent(attempt = 1, idempotencyKey = key()): AgentEventInput {
  return {
    kind: "tool_call_dispatch_intent",
    toolCallId: "write-call",
    idempotencyKey,
    attempt,
  };
}

function noEffect(attempt = 1, idempotencyKey = key()): AgentEventInput {
  return {
    kind: "tool_call_dispatch_no_effect",
    toolCallId: "write-call",
    idempotencyKey,
    attempt,
    reconciliationRef: `provider-reconcile:no-effect-${attempt}`,
  };
}

function committed(attempt = 1, idempotencyKey = key()): AgentEventInput {
  return {
    kind: "tool_call_dispatch_committed",
    toolCallId: "write-call",
    idempotencyKey,
    attempt,
    commitRef: `provider-receipt:commit-${attempt}`,
  };
}

async function fixture(t: TestContext): Promise<ExecutionJournal> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-l5-ledger-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const journal = await createExecutionJournal({
    directory: path.join(root, "execution-journal"),
    keyDirectory: path.join(root, "data"),
  });
  await journal.begin({ id: RUN, owner: OWNER, label: "L5 idempotency", agentRun: true });
  await journal.appendAgentEvent(RUN, step);
  await journal.appendAgentEvent(RUN, call);
  await journal.appendAgentEvent(RUN, prepared);
  await journal.appendAgentEvent(RUN, { kind: "tool_call_waiting_approval", toolCallId: "write-call" });
  await journal.markWaitingApproval(RUN);
  await journal.resumeAfterApproval(RUN, OWNER, "write-call", "approval:" + "c".repeat(64));
  return journal;
}

test("confirm-class external dispatch cannot begin before durable approval release", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-l5-preapproval-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const journal = await createExecutionJournal({
    directory: path.join(root, "execution-journal"),
    keyDirectory: path.join(root, "data"),
  });
  await journal.begin({ id: RUN, owner: OWNER, label: "L5 preapproval", agentRun: true });
  await journal.appendAgentEvent(RUN, step);
  await journal.appendAgentEvent(RUN, call);
  await assert.rejects(
    journal.appendAgentEvent(RUN, intent()),
    /must be durably resumed before dispatch/,
  );
});

test("write-ahead dispatch intent and commit are durable and secret-safe", async (t) => {
  const journal = await fixture(t);
  await journal.appendAgentEvent(RUN, intent());
  let record = await journal.read(RUN, OWNER);
  let dispatch = foldAgentToolDispatchState(record!.events!, RUN);
  assert.deepEqual(dispatch, [{
    toolCallId: "write-call",
    idempotencyKey: key(),
    attempt: 1,
    status: "outcome_unknown",
    evidenceRef: null,
  }]);

  await journal.appendAgentEvent(RUN, committed());
  await journal.appendAgentEvent(RUN, {
    kind: "tool_call_finished",
    toolCallId: "write-call",
    status: "succeeded",
    outputRef: "execution-receipt:abc",
  });
  await journal.appendAgentEvent(RUN, { kind: "step_finished", stepId: STEP_ID, status: "completed" });
  await journal.finish(RUN, "completed", null);

  record = await journal.read(RUN, OWNER);
  dispatch = foldAgentToolDispatchState(record!.events!, RUN);
  assert.equal(dispatch[0]?.status, "committed");
  assert.equal(dispatch[0]?.evidenceRef, "provider-receipt:commit-1");
  assert.equal(JSON.stringify(record).includes("Write once") && JSON.stringify(record).includes(INPUT_SHA256), true);
  assert.equal(JSON.stringify(dispatch).includes("quantity"), false);
});

test("journal rejects an idempotency key not bound to the persisted request/step/tool/input", async (t) => {
  const journal = await fixture(t);
  await assert.rejects(
    journal.appendAgentEvent(RUN, intent(1, key("750e8400-e29b-41d4-a716-446655440099"))),
    /idempotency key does not match/,
  );
  assert.equal((await journal.read(RUN, OWNER))?.events?.length, 5);
});

test("a dispatch can retry only after proven-no-effect reconciliation, with the same key and next attempt", async (t) => {
  const journal = await fixture(t);
  await journal.appendAgentEvent(RUN, intent(1));

  await assert.rejects(
    journal.appendAgentEvent(RUN, intent(2)),
    /already outcome-unknown/,
  );

  await journal.appendAgentEvent(RUN, noEffect(1));
  await assert.rejects(
    journal.appendAgentEvent(RUN, intent(3)),
    /increase by one/,
  );
  await assert.rejects(
    journal.appendAgentEvent(RUN, intent(2, "agent-tool:v1:" + "b".repeat(64))),
    /idempotency key does not match|same idempotency key/,
  );

  await journal.appendAgentEvent(RUN, intent(2));
  await journal.appendAgentEvent(RUN, committed(2));
  await assert.rejects(
    journal.appendAgentEvent(RUN, intent(3)),
    /committed tool call cannot dispatch again/,
  );

  const state = foldAgentToolDispatchState((await journal.read(RUN, OWNER))!.events!, RUN);
  assert.deepEqual(state, [{
    toolCallId: "write-call",
    idempotencyKey: key(),
    attempt: 2,
    status: "committed",
    evidenceRef: "provider-receipt:commit-2",
  }]);
});

test("an outcome-unknown dispatch cannot be terminalized as an ordinary failure", async (t) => {
  const journal = await fixture(t);
  await journal.appendAgentEvent(RUN, intent());

  await assert.rejects(
    journal.appendAgentEvent(RUN, {
      kind: "tool_call_finished",
      toolCallId: "write-call",
      status: "failed",
      outputRef: null,
    }),
    /outcome-unknown dispatch must be reconciled/,
  );
});

test("outcome-unknown dispatch cannot be finalized as ordinary failure and transitions only to interrupted reconciliation state", async (t) => {
  const journal = await fixture(t);
  await journal.appendAgentEvent(RUN, intent());

  await assert.rejects(
    journal.finish(RUN, "failed", null),
    /requires reconciliation|cannot be finalized normally/,
  );
  assert.equal((await journal.read(RUN, OWNER))?.status, "running");

  await journal.markAgentReconciliationRequired(RUN);
  const record = await journal.read(RUN, OWNER);
  assert.equal(record?.status, "interrupted");
  assert.equal(record?.exitCode, null);
  const dispatch = foldAgentToolDispatchState(record!.events!, RUN);
  assert.equal(dispatch[0]?.status, "outcome_unknown");

  await assert.rejects(
    journal.appendAgentEvent(RUN, intent(2)),
    /already finalized/,
  );
});

test("reconciliation-required terminalization is refused without an unresolved dispatch", async (t) => {
  const journal = await fixture(t);
  await assert.rejects(
    journal.markAgentReconciliationRequired(RUN),
    /no outcome-unknown tool dispatch/,
  );
});

test("restart preserves an unresolved dispatch as reconciliation-required and never retries it", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-l5-recovery-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = {
    directory: path.join(root, "execution-journal"),
    keyDirectory: path.join(root, "data"),
  };
  const journal = await createExecutionJournal(options);
  await journal.begin({ id: RUN, owner: OWNER, label: "L5 recovery", agentRun: true });
  await journal.appendAgentEvent(RUN, step);
  await journal.appendAgentEvent(RUN, call);
  await journal.appendAgentEvent(RUN, prepared);
  await journal.appendAgentEvent(RUN, { kind: "tool_call_waiting_approval", toolCallId: "write-call" });
  await journal.markWaitingApproval(RUN);
  await journal.resumeAfterApproval(RUN, OWNER, "write-call", "approval:" + "d".repeat(64));
  await journal.appendAgentEvent(RUN, intent());

  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();
  const record = await restarted.read(RUN, OWNER);
  assert.equal(record?.status, "interrupted");

  const dispatch = foldAgentToolDispatchState(record!.events!, RUN);
  assert.equal(dispatch[0]?.status, "outcome_unknown");
  assert.deepEqual(decideAgentToolRecovery({
    outcome: "dispatched_outcome_unknown",
    replaySafe: true,
    externalSideEffect: true,
    attempt: dispatch[0]!.attempt,
    maxAttempts: 3,
  }), {
    action: "reconcile",
    reason: "ambiguous_post_dispatch",
  });

  await assert.rejects(restarted.appendAgentEvent(RUN, intent(2)), /already finalized/);
});

test("stored dispatch key tampering fails chain validation against the request identity", async (t) => {
  const journal = await fixture(t);
  await journal.appendAgentEvent(RUN, intent());
  const record = await journal.read(RUN, OWNER);
  const events = record!.events!.map((event) => ({ ...event })) as AgentRunEvent[];
  const index = events.findIndex((event) => event.kind === "tool_call_dispatch_intent");
  assert.notEqual(index, -1);
  events[index] = {
    ...events[index]!,
    idempotencyKey: "agent-tool:v1:" + "f".repeat(64),
  } as AgentRunEvent;

  assert.throws(
    () => assertAgentEventChain(events, RUN),
    /idempotency key does not match/,
  );
});

test("dispatch reconciliation and commit evidence refs stay secret-safe", async (t) => {
  const journal = await fixture(t);
  await journal.appendAgentEvent(RUN, intent());
  await assert.rejects(
    journal.appendAgentEvent(RUN, {
      ...noEffect(),
      reconciliationRef: "token:should-not-persist",
    }),
    /invalid|raw content/i,
  );
  await assert.rejects(
    journal.appendAgentEvent(RUN, {
      ...committed(),
      commitRef: "api-key-secret",
    }),
    /invalid|raw content/i,
  );
});


test("once dispatch tracking starts, terminal status cannot contradict durable dispatch evidence", async (t) => {
  const noEffectJournal = await fixture(t);
  await noEffectJournal.appendAgentEvent(RUN, intent());
  await noEffectJournal.appendAgentEvent(RUN, noEffect());
  await assert.rejects(
    noEffectJournal.appendAgentEvent(RUN, {
      kind: "tool_call_finished",
      toolCallId: "write-call",
      status: "succeeded",
      outputRef: "execution-receipt:impossible",
    }),
    /proven to have no effect cannot finish as succeeded/,
  );

  const committedJournal = await fixture(t);
  await committedJournal.appendAgentEvent(RUN, intent());
  await committedJournal.appendAgentEvent(RUN, committed());
  for (const status of ["failed", "cancelled"] as const) {
    await assert.rejects(
      committedJournal.appendAgentEvent(RUN, {
        kind: "tool_call_finished",
        toolCallId: "write-call",
        status,
        outputRef: null,
      }),
      /committed dispatch must finish as succeeded/,
    );
  }
});

test("dispatch attempt metadata cannot be rewritten after reconciliation or commit", async (t) => {
  const journal = await fixture(t);
  await journal.appendAgentEvent(RUN, intent());
  await journal.appendAgentEvent(RUN, noEffect());

  await assert.rejects(
    journal.appendAgentEvent(RUN, {
      ...committed(),
      attempt: 1,
    }),
    /requires one unresolved dispatch intent/,
  );

  await journal.appendAgentEvent(RUN, intent(2));
  await journal.appendAgentEvent(RUN, committed(2));

  await assert.rejects(
    journal.appendAgentEvent(RUN, {
      ...noEffect(2),
      reconciliationRef: "provider-reconcile:late",
    }),
    /requires one unresolved dispatch intent/,
  );
});
