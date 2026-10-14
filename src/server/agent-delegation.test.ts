import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import {
  MAX_AGENT_DELEGATION_DEPTH,
  agentDelegationContextSha256,
  allocateAgentDelegationBudget,
  createAgentDelegationReceipt,
  createAgentDelegationRecord,
} from "./agent-delegation";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OWNER = { userId: 7, organizationId: 9 };

function context(): ConversationContextEnvelope {
  return {
    schemaVersion: "1",
    identity: { userId: 7, organizationId: 9, role: "owner" },
    project: { projectId: 42, name: "Alpha", instructionIncluded: true, resourceRefs: ["source:one"] },
    conversation: { chatId: 5, scope: "project", sourceScope: "auto", branchId: null },
    workspace: { sessionId: "session-1", view: "research", symbol: "SAFE" },
    active: { objectRefs: ["artifact:1"], selection: null },
  };
}

test("child budget is a strict slice of the parent remaining budget", () => {
  const allocation = allocateAgentDelegationBudget(
    { maxSteps: 10, maxAiCalls: 6, maxRevisions: 3, maxDurationMs: 90_000 },
    { maxSteps: 4, maxAiCalls: 2, maxRevisions: 1, maxDurationMs: 30_000 },
  );

  assert.deepEqual(allocation.child, {
    maxSteps: 4,
    maxAiCalls: 2,
    maxRevisions: 1,
    maxDurationMs: 30_000,
  });
  assert.deepEqual(allocation.remainingParent, {
    maxSteps: 6,
    maxAiCalls: 4,
    maxRevisions: 2,
    maxDurationMs: 60_000,
  });
});

test("delegation budget cannot oversubscribe any parent dimension", () => {
  const parent = { maxSteps: 4, maxAiCalls: 2, maxRevisions: 1, maxDurationMs: 20_000 };
  for (const child of [
    { ...parent, maxSteps: 5 },
    { ...parent, maxAiCalls: 3 },
    { ...parent, maxRevisions: 2 },
    { ...parent, maxDurationMs: 20_001 },
  ]) {
    assert.throws(() => allocateAgentDelegationBudget(parent, child), /exceeds the parent remaining budget/);
  }
});

test("delegation preserves the canonical requestId instead of minting a child session", () => {
  const objective = "Review valuation assumptions without changing project state.";
  const record = createAgentDelegationRecord({
    requestId: REQUEST_ID,
    delegationId: "delegate-valuation-1",
    parentDelegationId: "delegate-root",
    depth: 1,
    role: "valuation",
    objective,
    parentOwner: OWNER,
    childOwner: OWNER,
    parentContext: context(),
    childContext: context(),
    budget: { maxSteps: 3, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 15_000 },
  });

  assert.equal(record.requestId, REQUEST_ID);
  assert.equal("childRequestId" in record, false);
  assert.equal(record.parentDelegationId, "delegate-root");
  assert.match(record.contextSha256, /^[a-f0-9]{64}$/);
  assert.match(record.objectiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(record).includes(objective), false, "raw delegate objective is not persisted in the record");
});

test("delegation context hash is stable for the same five-level envelope", () => {
  assert.equal(agentDelegationContextSha256(context()), agentDelegationContextSha256(context()));
});

test("delegation refuses owner changes", () => {
  assert.throws(() => createAgentDelegationRecord({
    requestId: REQUEST_ID,
    delegationId: "delegate-1",
    parentDelegationId: "delegate-root",
    depth: 1,
    role: "research",
    objective: "Research the supplied evidence.",
    parentOwner: OWNER,
    childOwner: { userId: 8, organizationId: 9 },
    parentContext: context(),
    childContext: context(),
    budget: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 10_000 },
  }), /cannot change run ownership/);
});

test("delegation refuses any context-envelope widening or substitution", () => {
  const variants: ConversationContextEnvelope[] = [
    { ...context(), identity: { ...context().identity, userId: 8 } },
    { ...context(), project: { ...context().project, projectId: 43 } },
    { ...context(), conversation: { ...context().conversation, sourceScope: "web" } },
    { ...context(), workspace: { ...context().workspace, symbol: "OTHER" } },
    { ...context(), active: { ...context().active, objectRefs: ["artifact:2"] } },
  ];

  for (const childContext of variants) {
    assert.throws(() => createAgentDelegationRecord({
      requestId: REQUEST_ID,
      delegationId: "delegate-1",
      parentDelegationId: "delegate-root",
      depth: 1,
      role: "research",
      objective: "Research the supplied evidence.",
      parentOwner: OWNER,
      childOwner: OWNER,
      parentContext: context(),
      childContext,
      budget: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 10_000 },
    }), /cannot widen or replace/);
  }
});

test("delegation tree depth and parent linkage are bounded", () => {
  const base = {
    requestId: REQUEST_ID,
    role: "research" as const,
    objective: "Research the supplied evidence.",
    parentOwner: OWNER,
    childOwner: OWNER,
    parentContext: context(),
    childContext: context(),
    budget: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 10_000 },
  };

  assert.throws(() => createAgentDelegationRecord({
    ...base,
    delegationId: "root",
    parentDelegationId: "parent",
    depth: 0,
  }), /Root delegation cannot/);

  assert.throws(() => createAgentDelegationRecord({
    ...base,
    delegationId: "child",
    parentDelegationId: null,
    depth: 1,
  }), /requires a parent/);

  assert.throws(() => createAgentDelegationRecord({
    ...base,
    delegationId: "too-deep",
    parentDelegationId: "parent",
    depth: MAX_AGENT_DELEGATION_DEPTH + 1,
  }), /depth must be between/);

  assert.throws(() => createAgentDelegationRecord({
    ...base,
    delegationId: "same",
    parentDelegationId: "same",
    depth: 1,
  }), /cannot be its own parent/);
});


test("an exhausted parent budget is representable but cannot fund another child", () => {
  assert.throws(() => allocateAgentDelegationBudget(
    { maxSteps: 0, maxAiCalls: 0, maxRevisions: 0, maxDurationMs: 0 },
    { maxSteps: 1, maxAiCalls: 0, maxRevisions: 0, maxDurationMs: 1_000 },
  ), /exceeds the parent remaining budget/);
});

test("delegation owner must match the identity inside the bound context", () => {
  const mismatched = context();
  mismatched.identity = { ...mismatched.identity, userId: 8 };
  assert.throws(() => createAgentDelegationRecord({
    requestId: REQUEST_ID,
    delegationId: "delegate-identity",
    parentDelegationId: "delegate-root",
    depth: 1,
    role: "research",
    objective: "Research the supplied evidence.",
    parentOwner: OWNER,
    childOwner: OWNER,
    parentContext: mismatched,
    childContext: mismatched,
    budget: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 10_000 },
  }), /owner does not match/);
});

test("delegation role is runtime-validated, not only TypeScript-validated", () => {
  assert.throws(() => createAgentDelegationRecord({
    requestId: REQUEST_ID,
    delegationId: "delegate-role",
    parentDelegationId: "delegate-root",
    depth: 1,
    role: "root_admin" as never,
    objective: "Research the supplied evidence.",
    parentOwner: OWNER,
    childOwner: OWNER,
    parentContext: context(),
    childContext: context(),
    budget: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 10_000 },
  }), /role is invalid/);
});


test("delegation refuses noncanonical requestId casing instead of normalizing session identity", () => {
  assert.throws(() => createAgentDelegationRecord({
    requestId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    delegationId: "delegate-case",
    parentDelegationId: "delegate-root",
    depth: 1,
    role: "research",
    objective: "Research the supplied evidence.",
    parentOwner: OWNER,
    childOwner: OWNER,
    parentContext: context(),
    childContext: context(),
    budget: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 10_000 },
  }), /canonical lowercase UUID/);
});


function delegation() {
  return createAgentDelegationRecord({
    requestId: REQUEST_ID,
    delegationId: "delegate-receipt-1",
    parentDelegationId: "delegate-root",
    depth: 1,
    role: "research",
    objective: "Research the supplied evidence without changing project state.",
    parentOwner: OWNER,
    childOwner: OWNER,
    parentContext: context(),
    childContext: context(),
    budget: { maxSteps: 4, maxAiCalls: 2, maxRevisions: 1, maxDurationMs: 30_000 },
  });
}

test("delegate receipt is concise, secret-safe and tied to the same request/delegation", () => {
  const record = delegation();
  const receipt = createAgentDelegationReceipt(record, {
    status: "completed",
    used: { stepsUsed: 3, aiCallsUsed: 1, revisionsUsed: 1, durationMs: 12_000 },
    sourceRefs: ["source:filing-1"],
    toolReceiptRefs: ["execution-receipt:11111111-1111-4111-8111-111111111112"],
    resultRef: "artifact:11111111-1111-4111-8111-111111111113",
  });

  assert.equal(receipt.requestId, REQUEST_ID);
  assert.equal(receipt.delegationId, record.delegationId);
  assert.equal(receipt.contextSha256, record.contextSha256);
  assert.equal(receipt.objectiveSha256, record.objectiveSha256);
  assert.deepEqual(receipt.allocatedBudget, record.budget);
  assert.deepEqual(receipt.used, {
    stepsUsed: 3,
    aiCallsUsed: 1,
    revisionsUsed: 1,
    durationMs: 12_000,
  });
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes("Research the supplied"), false);
  assert.equal(serialized.includes("prompt"), false);
  assert.equal(serialized.includes("reasoning"), false);
});

test("delegate receipt cannot claim more budget than the child received", () => {
  const record = delegation();
  for (const used of [
    { stepsUsed: 5, aiCallsUsed: 1, revisionsUsed: 0, durationMs: 1_000 },
    { stepsUsed: 1, aiCallsUsed: 3, revisionsUsed: 0, durationMs: 1_000 },
    { stepsUsed: 1, aiCallsUsed: 1, revisionsUsed: 2, durationMs: 1_000 },
    { stepsUsed: 1, aiCallsUsed: 1, revisionsUsed: 0, durationMs: 30_001 },
  ]) {
    assert.throws(
      () => createAgentDelegationReceipt(record, { status: "failed", used }),
      /exceeds the allocated child budget/,
    );
  }
});

test("delegate receipt rejects duplicate, oversized and credential-looking refs", () => {
  const record = delegation();
  const used = { stepsUsed: 1, aiCallsUsed: 0, revisionsUsed: 0, durationMs: 1_000 };

  assert.throws(
    () => createAgentDelegationReceipt(record, {
      status: "completed",
      used,
      sourceRefs: ["source:a", "source:a"],
    }),
    /must be unique/,
  );
  assert.throws(
    () => createAgentDelegationReceipt(record, {
      status: "completed",
      used,
      resultRef: "bearer:super-secret",
    }),
    /secret-safe/,
  );
  assert.throws(
    () => createAgentDelegationReceipt(record, {
      status: "completed",
      used,
      toolReceiptRefs: Array.from({ length: 101 }, (_, index) => `receipt:${index}`),
    }),
    /exceeds the receipt bound/,
  );
});

test("delegate receipt has terminal-only status and nonnegative usage", () => {
  const record = delegation();
  assert.throws(
    () => createAgentDelegationReceipt(record, {
      status: "running" as never,
      used: { stepsUsed: 0, aiCallsUsed: 0, revisionsUsed: 0, durationMs: 0 },
    }),
    /status is invalid/,
  );
  assert.throws(
    () => createAgentDelegationReceipt(record, {
      status: "cancelled",
      used: { stepsUsed: -1, aiCallsUsed: 0, revisionsUsed: 0, durationMs: 0 },
    }),
    /stepsUsed is invalid/,
  );
});
