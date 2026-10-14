import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import {
  AgentCheckpointBindingMismatchError,
  AgentCheckpointReconciliationRequiredError,
  assertAgentCheckpointResumeCurrent,
  createAgentCheckpointSnapshot,
} from "../agent-checkpoint";
import {
  createExecutionJournal,
  type ExecutionJournal,
  type ExecutionJournalOptions,
  type ExecutionOwner,
} from "./execution-journal";

const RUN = "81111111-1111-4111-8111-111111111111";
const OWNER: ExecutionOwner = { userId: 7, projectId: 12, chatId: 34 };
const OTHER: ExecutionOwner = { userId: 8, projectId: 12, chatId: 34 };
const PLAN = "a".repeat(64);
const TOOLS = "b".repeat(64);
const POLICY = "c".repeat(64);
const INPUT = "d".repeat(64);

function context(): ConversationContextEnvelope {
  return {
    schemaVersion: "1",
    identity: { userId: 7, organizationId: 9, role: "internal_analyst" },
    project: {
      projectId: 12,
      name: "Do not persist this Project name",
      instructionIncluded: true,
      resourceRefs: ["project://12/private/resource"],
    },
    conversation: {
      chatId: 34,
      scope: "project",
      sourceScope: "auto",
      branchId: "private-branch-id",
    },
    workspace: {
      sessionId: "private-session-id",
      view: "analysis",
      symbol: "AAPL",
    },
    active: {
      objectRefs: ["artifact:private-object"],
      selection: null,
    },
  };
}

function checkpointFor(
  requestId = RUN,
  toolOutcome: "none_pending" | "known_completed" | "known_failed" | "outcome_unknown" = "none_pending",
) {
  return createAgentCheckpointSnapshot({
    requestId,
    owner: OWNER,
    planSha256: PLAN,
    steps: [{
      stepId: "step-1",
      toolId: "project.read",
      inputSha256: INPUT,
      dependsOn: [],
      status: "completed",
      attempts: 1,
    }],
    toolSetSha256: TOOLS,
    policySha256: POLICY,
    projectInstructions: "Use only current permitted sources.",
    context: context(),
    evidenceRefs: ["source:checkpoint-test"],
    adapterId: "lios.native",
    checkpointRef: "agent-checkpoint:opaque-state-1",
    toolOutcome,
  });
}

async function fixture(t: TestContext): Promise<{
  journal: ExecutionJournal;
  options: ExecutionJournalOptions;
  directory: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-l6-checkpoint-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "execution-journal");
  const options: ExecutionJournalOptions = {
    directory,
    keyDirectory: path.join(root, "data"),
  };
  const journal = await createExecutionJournal(options);
  return { journal, options, directory };
}

test("structured checkpoint persists only inside the encrypted version-2 journal record", async (t) => {
  const { journal, directory } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });
  const snapshot = checkpointFor();
  await journal.writeAgentCheckpoint(RUN, OWNER, snapshot);

  assert.deepEqual(await journal.readAgentCheckpoint(RUN, OWNER), snapshot);
  assert.deepEqual((await journal.read(RUN, OWNER))?.checkpoint, snapshot);

  const bytes = await fs.readFile(path.join(directory, RUN));
  const raw = bytes.toString("utf8");
  for (const forbidden of [
    snapshot.checkpointRef,
    snapshot.planSha256,
    "Do not persist this Project name",
    "private-branch-id",
    "private-session-id",
  ]) {
    assert.equal(raw.includes(forbidden), false, `encrypted record leaked ${forbidden}`);
  }
});

test("unsafe later continuation revokes an earlier checkpoint without changing the active run", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });
  const snapshot = checkpointFor();
  await journal.writeAgentCheckpoint(RUN, OWNER, snapshot);
  assert.deepEqual(await journal.readAgentCheckpoint(RUN, OWNER), snapshot);
  await assert.rejects(journal.clearAgentCheckpoint(RUN, OTHER), /not found/i);
  assert.deepEqual(await journal.readAgentCheckpoint(RUN, OWNER), snapshot);
  await journal.clearAgentCheckpoint(RUN, OWNER);
  assert.equal(await journal.readAgentCheckpoint(RUN, OWNER), null);
  assert.equal((await journal.read(RUN, OWNER))?.status, "running");
});

test("checkpoint persistence is owner-scoped and cannot be attached to a plain version-1 run", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });

  await assert.rejects(
    journal.writeAgentCheckpoint(RUN, OTHER, checkpointFor()),
  );
  assert.equal(await journal.readAgentCheckpoint(RUN, OTHER), null);

  const plainId = "82222222-2222-4222-8222-222222222222";
  await journal.begin({ id: plainId, owner: OWNER, label: "Plain execution" });
  const wrongRunCheckpoint = checkpointFor(plainId);
  await assert.rejects(
    journal.writeAgentCheckpoint(plainId, OWNER, wrongRunCheckpoint),
    /version-2 agent run/,
  );
});

test("a checkpoint for another requestId is rejected before persistence", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });
  const foreign = checkpointFor("83333333-3333-4333-8333-333333333333");

  await assert.rejects(
    journal.writeAgentCheckpoint(RUN, OWNER, foreign),
    /does not match this execution/,
  );
  assert.equal(await journal.readAgentCheckpoint(RUN, OWNER), null);
});

test("restart recovery preserves the checkpoint but never resumes or executes it", async (t) => {
  const { journal, options } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });
  const snapshot = checkpointFor();
  await journal.writeAgentCheckpoint(RUN, OWNER, snapshot);

  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();

  const record = await restarted.read(RUN, OWNER);
  assert.equal(record?.status, "interrupted");
  assert.notEqual(record?.endedAt, null);
  assert.deepEqual(await restarted.readAgentCheckpoint(RUN, OWNER), snapshot);
  await assert.rejects(
    restarted.writeAgentCheckpoint(RUN, OWNER, snapshot),
    /only be written while the run is active/,
  );
});

test("explicit resume validation fails closed on stale policy before any adapter resume", async (t) => {
  const { journal, options } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });
  await journal.writeAgentCheckpoint(RUN, OWNER, checkpointFor());
  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();

  const stored = await restarted.readAgentCheckpoint(RUN, OWNER);
  assert.ok(stored);

  assert.throws(
    () => assertAgentCheckpointResumeCurrent({
      snapshot: stored!,
      requestId: RUN,
      owner: OWNER,
      planSha256: PLAN,
      toolSetSha256: TOOLS,
      policySha256: "e".repeat(64),
      projectInstructions: "Use only current permitted sources.",
      context: context(),
      adapterId: "lios.native",
    }),
    AgentCheckpointBindingMismatchError,
  );
});

test("outcome-unknown persisted checkpoint is reconciliation-required after restart", async (t) => {
  const { journal, options } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });
  await journal.writeAgentCheckpoint(RUN, OWNER, checkpointFor(RUN, "outcome_unknown"));

  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();
  const stored = await restarted.readAgentCheckpoint(RUN, OWNER);
  assert.ok(stored);

  assert.throws(
    () => assertAgentCheckpointResumeCurrent({
      snapshot: stored!,
      requestId: RUN,
      owner: OWNER,
      planSha256: PLAN,
      toolSetSha256: TOOLS,
      policySha256: POLICY,
      projectInstructions: "Use only current permitted sources.",
      context: context(),
      adapterId: "lios.native",
    }),
    AgentCheckpointReconciliationRequiredError,
  );
});

test("checkpoint cannot be written after terminal completion", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });
  const snapshot = checkpointFor();
  await journal.finish(RUN, "completed", null);
  await assert.rejects(
    journal.writeAgentCheckpoint(RUN, OWNER, snapshot),
    /only be written while the run is active/,
  );
});

test("checkpoint-aware Stop parks a checkpointed run as interrupted with an end time, and only that", async (t) => {
  const { journal, options } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent checkpoint", agentRun: true });
  const snapshot = checkpointFor();
  await journal.writeAgentCheckpoint(RUN, OWNER, snapshot);
  await journal.interruptCheckpointed(RUN, OWNER);

  const record = await journal.read(RUN, OWNER);
  assert.equal(record?.status, "interrupted");
  assert.notEqual(record?.endedAt, null);
  assert.equal(record?.exitCode, null);
  assert.deepEqual(record?.checkpoint, snapshot);

  // The parked record behaves like a recovered one: it can be explicitly reopened against its exact binding, once.
  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();
  assert.equal((await restarted.read(RUN, OWNER))?.status, "interrupted");
  await assert.rejects(restarted.interruptCheckpointed(RUN, OWNER), /Only a running or approval-paused/);
  const reopened = await restarted.resumeInterruptedAgentCheckpoint(RUN, OWNER, snapshot.bindingSha256);
  assert.equal(reopened.bindingSha256, snapshot.bindingSha256);
  assert.equal((await restarted.read(RUN, OWNER))?.status, "running");
  await assert.rejects(restarted.resumeInterruptedAgentCheckpoint(RUN, OWNER, snapshot.bindingSha256), /Only an interrupted/);
});

test("checkpoint-aware Stop refuses a run without a checkpoint, another owner, a plain run, an unknown outcome and terminal runs", async (t) => {
  const { journal } = await fixture(t);
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent run", agentRun: true });
  await assert.rejects(journal.interruptCheckpointed(RUN, OWNER), /no durable agent checkpoint/);
  assert.equal((await journal.read(RUN, OWNER))?.status, "running", "a refused interrupt changes nothing");

  await journal.writeAgentCheckpoint(RUN, OWNER, checkpointFor());
  await assert.rejects(journal.interruptCheckpointed(RUN, OTHER));
  assert.equal((await journal.read(RUN, OWNER))?.status, "running");

  const plainId = "84444444-4444-4444-8444-444444444444";
  await journal.begin({ id: plainId, owner: OWNER, label: "Plain execution" });
  await assert.rejects(journal.interruptCheckpointed(plainId, OWNER), /no durable agent checkpoint/);

  const unknownId = "85555555-5555-4555-8555-555555555555";
  await journal.begin({ id: unknownId, owner: OWNER, label: "Agent run", agentRun: true });
  await journal.writeAgentCheckpoint(unknownId, OWNER, checkpointFor(unknownId, "outcome_unknown"));
  await assert.rejects(journal.interruptCheckpointed(unknownId, OWNER), /outcome-unknown/);

  await journal.finish(RUN, "cancelled", null);
  await assert.rejects(journal.interruptCheckpointed(RUN, OWNER), /Only a running or approval-paused/);
  assert.equal((await journal.read(RUN, OWNER))?.status, "cancelled", "a terminal cancelled run is never reopened");
  await assert.rejects(journal.resumeInterruptedAgentCheckpoint(RUN, OWNER, checkpointFor().bindingSha256), /Only an interrupted/);
});
