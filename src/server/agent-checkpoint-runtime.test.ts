import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import { createExecutionJournal } from "./exec/execution-journal";
import { registerAgentFrameworkAdapter } from "./conversationRuntime";
import {
  persistBoundedAgentCheckpoint,
  resumePersistedBoundedAgentCheckpoint,
} from "./agent-checkpoint-runtime";

const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const OWNER = { userId: 17, projectId: 27, chatId: 37 };
const PLAN = "a".repeat(64);
const TOOLSET = "b".repeat(64);
const POLICY = "c".repeat(64);
const INPUT = "d".repeat(64);
const ADAPTER_ID = "test.l6.explicit-resume";

function context(): ConversationContextEnvelope {
  return {
    schemaVersion: "1",
    identity: { userId: OWNER.userId, organizationId: 99, role: "internal_analyst" },
    project: {
      projectId: OWNER.projectId,
      name: "Checkpoint test project",
      instructionIncluded: true,
      resourceRefs: ["project://27/source-1"],
    },
    conversation: {
      chatId: OWNER.chatId,
      scope: "project",
      sourceScope: "auto",
      branchId: null,
    },
    workspace: {
      sessionId: null,
      view: "analysis",
      symbol: "AAPL",
    },
    active: {
      objectRefs: [],
      selection: null,
    },
  };
}

test("recovery never auto-resumes; explicit L6 resume uses the same persisted checkpoint and journal record", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-l6-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  let checkpoints = 0;
  let resumes = 0;
  registerAgentFrameworkAdapter({
    id: ADAPTER_ID,
    framework: "lios_native",
    roles: ["research"],
    execute: async () => {
      throw new Error("execute must not be called by checkpoint resume");
    },
    checkpoint: async (requestId) => {
      checkpoints += 1;
      assert.equal(requestId, REQUEST_ID);
      return "agent-checkpoint:l6-runtime-state";
    },
    resume: async (checkpointRef, input) => {
      resumes += 1;
      assert.equal(checkpointRef, "agent-checkpoint:l6-runtime-state");
      assert.equal(input.requestId, REQUEST_ID);
      return {
        output: { resumed: true },
        deterministic: true,
        aiDerived: false,
        sourceRefs: ["source:l6-runtime"],
      };
    },
  });

  const options = {
    directory: path.join(root, "execution-journal"),
    keyDirectory: path.join(root, "data"),
  };
  const journal = await createExecutionJournal(options);
  await journal.begin({ id: REQUEST_ID, owner: OWNER, label: "L6 explicit resume", agentRun: true });

  const snapshot = await persistBoundedAgentCheckpoint({
    journal,
    requestId: REQUEST_ID,
    owner: OWNER,
    adapterId: ADAPTER_ID,
    planSha256: PLAN,
    steps: [{
      stepId: "research",
      toolId: "project.read",
      inputSha256: INPUT,
      dependsOn: [],
      status: "running",
      attempts: 1,
    }],
    toolSetSha256: TOOLSET,
    policySha256: POLICY,
    projectInstructions: "Use only current permitted sources.",
    context: context(),
    evidenceRefs: ["source:l6-runtime"],
    toolOutcome: "none_pending",
  });
  assert.ok(snapshot);
  assert.equal(checkpoints, 1);
  assert.equal(resumes, 0);

  // Simulate process restart. Recovery records interruption only and executes nothing.
  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();
  assert.equal((await restarted.read(REQUEST_ID, OWNER))?.status, "interrupted");
  assert.equal(resumes, 0);

  const result = await resumePersistedBoundedAgentCheckpoint({
    journal: restarted,
    requestId: REQUEST_ID,
    owner: OWNER,
    adapterId: ADAPTER_ID,
    role: "research",
    objective: "Resume the persisted research task.",
    planSha256: PLAN,
    toolSetSha256: TOOLSET,
    policySha256: POLICY,
    context: context(),
    projectInstructions: "Use only current permitted sources.",
    revalidateAuthorization: async (checkpoint) => {
      assert.equal(checkpoint.requestId, REQUEST_ID);
    },
  });

  assert.equal(resumes, 1);
  assert.deepEqual(result.output, { resumed: true });
  const record = await restarted.read(REQUEST_ID, OWNER);
  assert.equal(record?.status, "completed");
  assert.equal(record?.checkpoint?.bindingSha256, snapshot!.bindingSha256);
});

test("explicit resume refuses policy drift before reopening or invoking the adapter", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-l6-policy-drift-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const options = {
    directory: path.join(root, "execution-journal"),
    keyDirectory: path.join(root, "data"),
  };
  const journal = await createExecutionJournal(options);
  await journal.begin({ id: REQUEST_ID, owner: OWNER, label: "L6 drift", agentRun: true });
  await persistBoundedAgentCheckpoint({
    journal,
    requestId: REQUEST_ID,
    owner: OWNER,
    adapterId: ADAPTER_ID,
    planSha256: PLAN,
    steps: [{
      stepId: "research",
      toolId: "project.read",
      inputSha256: INPUT,
      dependsOn: [],
      status: "running",
      attempts: 1,
    }],
    toolSetSha256: TOOLSET,
    policySha256: POLICY,
    projectInstructions: "Use only permitted Project sources.",
    context: context(),
    toolOutcome: "none_pending",
  });
  await journal.recoverInterrupted();

  await assert.rejects(
    resumePersistedBoundedAgentCheckpoint({
      journal,
      requestId: REQUEST_ID,
      owner: OWNER,
      adapterId: ADAPTER_ID,
      role: "research",
      objective: "Resume the persisted research task.",
      planSha256: PLAN,
      toolSetSha256: TOOLSET,
      policySha256: "e".repeat(64),
      projectInstructions: "Use only permitted Project sources.",
      context: context(),
      revalidateAuthorization: async () => undefined,
    }),
    /checkpoint|matches|policy/i,
  );
  assert.equal((await journal.read(REQUEST_ID, OWNER))?.status, "interrupted");
});


test("explicit resume denial leaves the checkpoint interrupted and never invokes the adapter", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-l6-approval-denial-"));
  const deniedAdapterId = "test.l6.denied-resume";
  let resumeCalls = 0;
  registerAgentFrameworkAdapter({
    id: deniedAdapterId,
    framework: "lios_native",
    roles: ["research"],
    execute: async () => {
      throw new Error("execute must not be called by checkpoint resume");
    },
    checkpoint: async () => "agent-checkpoint:l6-denied-state",
    resume: async () => {
      resumeCalls += 1;
      throw new Error("resume must not run after authorization denial");
    },
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const options = {
    directory: path.join(root, "execution-journal"),
    keyDirectory: path.join(root, "data"),
  };
  const journal = await createExecutionJournal(options);
  await journal.begin({ id: REQUEST_ID, owner: OWNER, label: "L6 approval denial", agentRun: true });
  await persistBoundedAgentCheckpoint({
    journal,
    requestId: REQUEST_ID,
    owner: OWNER,
    adapterId: deniedAdapterId,
    planSha256: PLAN,
    steps: [{
      stepId: "research",
      toolId: "project.read",
      inputSha256: INPUT,
      dependsOn: [],
      status: "running",
      attempts: 1,
    }],
    toolSetSha256: TOOLSET,
    policySha256: POLICY,
    projectInstructions: "Use only permitted Project sources.",
    context: context(),
    toolOutcome: "none_pending",
  });
  await journal.recoverInterrupted();

  let authorizationChecks = 0;
  await assert.rejects(
    resumePersistedBoundedAgentCheckpoint({
      journal,
      requestId: REQUEST_ID,
      owner: OWNER,
      adapterId: deniedAdapterId,
      role: "research",
      objective: "Resume the persisted research task.",
      planSha256: PLAN,
      toolSetSha256: TOOLSET,
      policySha256: POLICY,
      projectInstructions: "Use only permitted Project sources.",
      context: context(),
      revalidateAuthorization: async (checkpoint) => {
        authorizationChecks += 1;
        assert.equal(checkpoint.bindingSha256.length, 64);
        throw new Error("current approval lease is absent");
      },
    }),
    /approval lease is absent/,
  );

  assert.equal(authorizationChecks, 1);
  assert.equal(resumeCalls, 0);
  assert.equal((await journal.read(REQUEST_ID, OWNER))?.status, "interrupted");
});
