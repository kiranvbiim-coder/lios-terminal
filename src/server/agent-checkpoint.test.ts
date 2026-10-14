import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import {
  AgentCheckpointBindingMismatchError,
  AgentCheckpointReconciliationRequiredError,
  assertAgentCheckpointResumeCurrent,
  assertAgentCheckpointStoredFor,
  checkpointContextFromEnvelope,
  checkpointRequiresReconciliation,
  createAgentCheckpointSnapshot,
  parseAgentCheckpointSnapshot,
} from "./agent-checkpoint";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OWNER = { userId: 7, projectId: 12, chatId: 34 };
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

function context(): ConversationContextEnvelope {
  return {
    schemaVersion: "1",
    identity: { userId: 7, organizationId: 9, role: "internal_analyst" },
    project: {
      projectId: 12,
      name: "Sensitive project name",
      instructionIncluded: true,
      resourceRefs: ["project://12/file/private-model.xlsx"],
    },
    conversation: {
      chatId: 34,
      scope: "project",
      sourceScope: "auto",
      branchId: "branch-private",
    },
    workspace: {
      sessionId: "desktop-session-private",
      view: "analysis",
      symbol: "AAPL",
    },
    active: {
      objectRefs: ["artifact:private-model"],
      selection: {
        kind: "text",
        id: "selection-1",
        label: "Private selection",
        text: "sensitive selected text",
        view: "sheet",
        symbol: "AAPL",
      },
    },
  };
}

function input(toolOutcome: "none_pending" | "known_completed" | "known_failed" | "outcome_unknown" = "none_pending") {
  return {
    requestId: REQUEST_ID,
    owner: OWNER,
    planSha256: A,
    steps: [
      {
        stepId: "inspect",
        toolId: "project.read",
        inputSha256: B,
        dependsOn: [],
        status: "completed" as const,
        attempts: 1,
      },
      {
        stepId: "write",
        toolId: "external.write",
        inputSha256: C,
        dependsOn: ["inspect"],
        status: "pending" as const,
        attempts: 0,
      },
    ],
    toolSetSha256: B,
    policySha256: C,
    projectInstructions: "Use only permitted Project evidence.",
    sourceMessageId: 45,
    context: context(),
    evidenceRefs: ["source:quote-AAPL", "assumption:growth-5pct"],
    adapterId: "lios.native",
    checkpointRef: "agent-checkpoint:adapter-state-1",
    toolOutcome,
  };
}

test("structured checkpoint is deterministic, bounded and minimizes sensitive context", () => {
  const first = createAgentCheckpointSnapshot(input());
  const second = createAgentCheckpointSnapshot(input());
  assert.deepEqual(first, second);
  assert.match(first.bindingSha256, /^[a-f0-9]{64}$/);
  assert.match(first.ownerSha256, /^[a-f0-9]{64}$/);
  assert.match(first.contextSha256, /^[a-f0-9]{64}$/);

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("Sensitive project name"), false);
  assert.equal(serialized.includes("private-model.xlsx"), false);
  assert.equal(serialized.includes("sensitive selected text"), false);
  assert.equal(serialized.includes("desktop-session-private"), false);
  assert.equal(serialized.includes("branch-private"), false);
  assert.equal(Object.isFrozen(first), true);
});

test("context projection remains structurally bound to owner and active context", () => {
  const projected = checkpointContextFromEnvelope(context(), "Use only permitted Project evidence.");
  assert.throws(() => checkpointContextFromEnvelope(context()), AgentCheckpointBindingMismatchError);
  assert.equal(projected.identity.userId, OWNER.userId);
  assert.equal(projected.project.projectId, OWNER.projectId);
  assert.equal(projected.conversation.chatId, OWNER.chatId);
  assert.equal(projected.project.resourceRefSha256s.length, 1);
  assert.equal(projected.active.objectRefSha256s.length, 1);
  assert.notEqual(projected.active.selectionSha256, null);
});

test("temporary conversation and owner/context mismatch cannot create a durable checkpoint", () => {
  assert.throws(
    () => createAgentCheckpointSnapshot({
      ...input(),
      owner: { ...OWNER, userId: 8 },
    }),
    AgentCheckpointBindingMismatchError,
  );

  const temporary = context();
  temporary.project.projectId = null;
  temporary.conversation.chatId = null;
  temporary.conversation.scope = "temporary";
  assert.throws(
    () => createAgentCheckpointSnapshot({
      ...input(),
      owner: { userId: 7, projectId: null, chatId: null },
      context: temporary,
    }),
    /Temporary conversations/,
  );
});

test("persisted checkpoint parses only when all integrity bindings remain intact", () => {
  const snapshot = createAgentCheckpointSnapshot(input());
  assert.deepEqual(parseAgentCheckpointSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);

  for (const tampered of [
    { ...snapshot, planSha256: D },
    { ...snapshot, ownerSha256: D },
    { ...snapshot, contextSha256: D },
    { ...snapshot, bindingSha256: D },
  ]) {
    assert.throws(() => parseAgentCheckpointSnapshot(tampered), AgentCheckpointBindingMismatchError);
  }
});

test("checkpoint is bound to the exact journal request and owner", () => {
  const snapshot = createAgentCheckpointSnapshot(input());
  assert.equal(assertAgentCheckpointStoredFor({ snapshot, requestId: REQUEST_ID, owner: OWNER }).requestId, REQUEST_ID);

  assert.throws(
    () => assertAgentCheckpointStoredFor({
      snapshot,
      requestId: "22222222-2222-4222-8222-222222222222",
      owner: OWNER,
    }),
    AgentCheckpointBindingMismatchError,
  );
  assert.throws(
    () => assertAgentCheckpointStoredFor({
      snapshot,
      requestId: REQUEST_ID,
      owner: { ...OWNER, chatId: 35 },
    }),
    AgentCheckpointBindingMismatchError,
  );
});

test("explicit resume accepts only the same owner, plan, tool set, policy, context and adapter", () => {
  const snapshot = createAgentCheckpointSnapshot(input());
  const base = {
    snapshot,
    projectInstructions: input().projectInstructions,
    sourceMessageId: input().sourceMessageId,
    requestId: REQUEST_ID,
    owner: OWNER,
    planSha256: A,
    toolSetSha256: B,
    policySha256: C,
    context: context(),
    adapterId: "lios.native",
  };
  assert.equal(assertAgentCheckpointResumeCurrent(base).checkpointRef, "agent-checkpoint:adapter-state-1");

  const changedContext = context();
  changedContext.workspace.symbol = "MSFT";
  for (const override of [
    { planSha256: D },
    { toolSetSha256: D },
    { policySha256: D },
    { adapterId: "other.adapter" },
    { context: changedContext },
    { sourceMessageId: 46 },
    { projectInstructions: "Changed Project instructions" },
  ]) {
    assert.throws(
      () => assertAgentCheckpointResumeCurrent({ ...base, ...override }),
      AgentCheckpointBindingMismatchError,
    );
  }
});

test("outcome-unknown checkpoint requires reconciliation before explicit resume", () => {
  const snapshot = createAgentCheckpointSnapshot(input("outcome_unknown"));
  assert.equal(checkpointRequiresReconciliation(snapshot), true);
  assert.throws(
    () => assertAgentCheckpointResumeCurrent({
      snapshot,
      requestId: REQUEST_ID,
      owner: OWNER,
      planSha256: A,
      toolSetSha256: B,
      policySha256: C,
      projectInstructions: input().projectInstructions,
      sourceMessageId: input().sourceMessageId,
      context: context(),
      adapterId: "lios.native",
    }),
    AgentCheckpointReconciliationRequiredError,
  );
});

test("checkpoint rejects duplicate or malformed structural state", () => {
  const duplicateSteps = input();
  duplicateSteps.steps = [
    duplicateSteps.steps[0]!,
    { ...duplicateSteps.steps[0]! },
  ];
  assert.throws(() => createAgentCheckpointSnapshot(duplicateSteps), /step ids must be unique/);

  const unknownDependency = input();
  unknownDependency.steps = [
    { ...unknownDependency.steps[0]!, dependsOn: ["missing"] },
  ];
  assert.throws(() => createAgentCheckpointSnapshot(unknownDependency), /depends on unknown step/);

  const cyclic = input();
  cyclic.steps = [
    { ...cyclic.steps[0]!, dependsOn: ["write"] },
    { ...cyclic.steps[1]!, dependsOn: ["inspect"] },
  ];
  assert.throws(() => createAgentCheckpointSnapshot(cyclic), /dependency cycle/);

  assert.throws(
    () => createAgentCheckpointSnapshot({ ...input(), checkpointRef: "token:do-not-store" }),
    /credentials/,
  );
  assert.throws(
    () => createAgentCheckpointSnapshot({ ...input(), evidenceRefs: ["api-key-secret"] }),
  );
});
