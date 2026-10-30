import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createExecutionJournal } from "./exec/execution-journal";
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

test("an invoked adapter failure retains terminal delegation evidence without inventing zero usage", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-delegate-terminal-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const journal = await createExecutionJournal({ directory: path.join(root, "journal"), keyDirectory: path.join(root, "keys") });
  const requestId = crypto.randomUUID();
  const owner = { userId: 7, projectId: null, chatId: null };
  await journal.begin({ id: requestId, owner, label: "Bounded delegate", agentRun: true });
  const original = new Error("private adapter failure text must not enter evidence");
  let calls = 0;
  const adapterId = "test.delegate-terminal.failure";
  registerAgentFrameworkAdapter({
    id: adapterId, framework: "lios_native", roles: ["research"],
    execute: async () => { calls++; throw original; },
  });
  const tool = getConversationTool("lios.agent.delegate")!;
  const context = {
    schemaVersion: "1" as const,
    identity: { userId: 7, organizationId: null, role: "internal_analyst" as const },
    project: { projectId: null, name: null, instructionIncluded: false, resourceRefs: [] },
    conversation: { chatId: null, scope: "temporary" as const, sourceScope: "auto" as const, branchId: null },
    workspace: { sessionId: null, view: "research", symbol: null },
    active: { objectRefs: [], selection: null },
  };
  await assert.rejects(tool.invoke({
    adapterId, role: "research", objective: "Review bounded evidence.",
    budget: { maxSteps: 1, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 1_000 },
  }, new AbortController().signal, {
    source: "agent", tenant: { userId: 7, organizationId: null, role: "internal_analyst" },
    requestId, projectId: null, chatId: null, toolCallId: "delegate-failure",
    delegation: {
      context, depth: 0, parentDelegationId: "root:terminal-test",
      allocateBudget: budget => Object.freeze({ ...budget }),
      recordReceipt: async ref => { await journal.appendAgentEvent(requestId, { kind: "evidence", role: "source", ref }); },
    },
  }), error => error === original);
  assert.equal(calls, 1);
  const retained = await journal.read(requestId, owner);
  const evidence = retained!.events!.filter(event => event.kind === "evidence");
  assert.equal(evidence.length, 1, "a failed child must retain its own terminal delegation evidence");
  assert.match(evidence[0].ref, /^delegate-receipt:v2:[a-f0-9]{32}:[a-f0-9]{32}:research:failed:unknown:/);
  assert.equal(JSON.stringify(retained).includes(original.message), false);
});

test("delegation distinguishes trusted Stop and deadline from adapter errors and never fabricates failed usage", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-delegate-outcomes-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const journal = await createExecutionJournal({ directory: path.join(root, "journal"), keyDirectory: path.join(root, "keys") });
  const owner = { userId: 7, projectId: null, chatId: null };
  const context = {
    schemaVersion: "1" as const,
    identity: { userId: 7, organizationId: null, role: "internal_analyst" as const },
    project: { projectId: null, name: null, instructionIncluded: false, resourceRefs: [] },
    conversation: { chatId: null, scope: "temporary" as const, sourceScope: "auto" as const, branchId: null },
    workspace: { sessionId: null, view: "research", symbol: null },
    active: { objectRefs: [], selection: null },
  };
  const success = () => ({ output: { value: 42 }, deterministic: true, aiDerived: false,
    usage: { stepsUsed: 1, aiCallsUsed: 0, revisionsUsed: 0, durationMs: 1 } });
  for (const scenario of ["before-entry", "stop", "deadline", "missing-usage", "invalid-usage", "checkpoint", "forged-abort", "journal-refused"] as const) {
    await t.test(scenario, async () => {
      const requestId = crypto.randomUUID();
      await journal.begin({ id: requestId, owner, label: "Bounded delegate outcome", agentRun: true });
      const controller = new AbortController();
      const original = new Error("private fixture failure");
      let calls = 0;
      let writes = 0;
      const adapterId = `test.delegate-terminal.${scenario}`;
      registerAgentFrameworkAdapter({
        id: adapterId, framework: "lios_native", roles: ["research"],
        execute: async ({ signal }) => {
          calls++;
          if (scenario === "stop") {
            controller.abort("private Stop reason");
            throw original;
          }
          if (scenario === "deadline") {
            // Keep this real test process alive while AbortSignal.timeout's unref timer fires.
            const hold = setTimeout(() => {}, 2_000);
            try { await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(original), { once: true })); }
            finally { clearTimeout(hold); }
          }
          if (scenario === "journal-refused") {
            await journal.finish(requestId, "failed", null);
            throw original;
          }
          if (scenario === "forged-abort") { original.name = "AbortError"; throw original; }
          if (scenario === "missing-usage") return { output: { value: 42 }, deterministic: true, aiDerived: false };
          if (scenario === "invalid-usage") return { ...success(), usage: { ...success().usage, aiCallsUsed: 2 } };
          return success();
        },
        ...(scenario === "checkpoint" ? { checkpoint: async () => { throw original; } } : {}),
      });
      if (scenario === "before-entry") controller.abort("private pre-entry reason");
      const tool = getConversationTool("lios.agent.delegate")!;
      await assert.rejects(tool.invoke({
        adapterId, role: "research", objective: "Review bounded evidence.",
        budget: { maxSteps: 1, maxAiCalls: 1, maxRevisions: 0, maxDurationMs: 1_000 },
      }, controller.signal, {
        source: "agent", tenant: { userId: 7, organizationId: null, role: "internal_analyst" },
        requestId, projectId: null, chatId: null, toolCallId: `delegate-${scenario}`,
        delegation: {
          context, depth: 0, parentDelegationId: "root:terminal-test",
          allocateBudget: budget => Object.freeze({ ...budget }),
          recordReceipt: async ref => { writes++; await journal.appendAgentEvent(requestId, { kind: "evidence", role: "source", ref }); },
        },
      }), error => {
        if (scenario === "journal-refused") {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.cause, original);
          assert.equal(error.errors[0], original);
        }
        return true;
      });
      const retained = await journal.read(requestId, owner);
      const evidence = retained!.events!.filter(event => event.kind === "evidence");
      assert.equal(calls, scenario === "before-entry" ? 0 : 1);
      assert.equal(writes, scenario === "before-entry" ? 0 : 1);
      assert.equal(evidence.length, scenario === "before-entry" || scenario === "journal-refused" ? 0 : 1);
      if (evidence.length) {
        const status = scenario === "stop" ? "cancelled" : scenario === "deadline" ? "timed_out" : "failed";
        assert.match(evidence[0].ref, new RegExp(`:research:${status}:unknown:`));
      }
      assert.equal(JSON.stringify(retained).includes("private"), false);
    });
  }
});
