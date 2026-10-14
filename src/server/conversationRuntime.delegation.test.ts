import assert from "node:assert/strict";
import test from "node:test";
import {
  getConversationTool,
  registerAgentFrameworkAdapter,
  runBoundedAgent,
} from "./conversationRuntime";

test("governed delegation descriptor is confirm-class, external, non-replay-safe and rejects authority-shaped model fields", async () => {
  const tool = getConversationTool("lios.agent.delegate");
  assert.ok(tool);
  assert.equal(tool.permissionClass, "user_confirm");
  assert.equal(tool.access, "write");
  assert.equal(tool.sideEffect, "external");
  assert.equal(tool.replaySafe, false);

  const valid = {
    adapterId: "test.delegate",
    role: "research",
    objective: "Review bounded evidence.",
    budget: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 5_000 },
  };
  assert.equal(tool.inputSchema.safeParse(valid).success, true);
  for (const extra of [
    { requestId: "11111111-1111-4111-8111-111111111111" },
    { userId: 99 },
    { projectId: 42 },
    { parentDelegationId: "forged-parent" },
    { approval: true },
    { authorization: { forged: true } },
    { checkpointRef: "checkpoint:forged" },
    { idempotencyKey: "forged" },
  ]) {
    assert.equal(tool.inputSchema.safeParse({ ...valid, ...extra }).success, false);
  }

  await assert.rejects(
    () => tool.invoke(valid, new AbortController().signal, { source: "workflow" }),
    /canonical bounded agent loop/i,
  );
});

test("bounded adapter child cancellation inherits the parent without leaking its private abort reason", async () => {
  const adapterId = "test.l13.cancel-propagation";
  let observedReason = "";
  registerAgentFrameworkAdapter({
    id: adapterId,
    framework: "lios_native",
    roles: ["data"],
    execute: async ({ signal }) => new Promise((resolve, reject) => {
      const stop = () => {
        observedReason = String(signal.reason);
        reject(signal.reason);
      };
      if (signal.aborted) return stop();
      signal.addEventListener("abort", stop, { once: true });
    }),
  });

  const parent = new AbortController();
  const run = runBoundedAgent({
    adapterId,
    requestId: "d6666666-6666-4666-8666-666666666666",
    role: "data",
    objective: "Compute a bounded specialist result.",
    context: {
      schemaVersion: "1",
      identity: { userId: 7, organizationId: null, role: "internal_analyst" },
      project: { projectId: null, name: null, instructionIncluded: false, resourceRefs: [] },
      conversation: { chatId: null, scope: "temporary", sourceScope: "auto", branchId: null },
      workspace: { sessionId: null, view: "research", symbol: null },
      active: { objectRefs: [], selection: null },
    },
    budget: { maxSteps: 1, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 5_000 },
    signal: parent.signal,
  });

  const privateReason = "private-parent-cancel-reason";
  parent.abort(new Error(privateReason));
  await assert.rejects(run, /cancel|AbortError/i);
  assert.equal(observedReason.includes(privateReason), false);
  assert.match(observedReason, /Conversation execution cancelled|AbortError/i);
});
