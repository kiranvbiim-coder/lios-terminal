import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { createAttribution } from "./byoaiRouter";
import {
  currentConversationToolApprovalPolicy,
  executeConversationRuntime,
  getConversationTool,
  registerConversationTool,
  registerAgentFrameworkAdapter,
  type ConversationRuntimeInput,
  type ConversationRuntimeResult,
  type ConversationToolDefinition,
} from "./conversationRuntime";
import {
  proposeGovernedToolOperation,
  resolveGovernedToolOperation,
  reviewGovernedToolOperation,
} from "./conversationGrantStore";
import type { AgentEventInput } from "./exec/agent-run-events";
import { deriveAgentToolIdempotencyKey } from "./exec/agent-idempotency";
import { AgentDispatchOutcomeUnknownError, agentInputSha256 } from "./agentLoop";
import { governedExternalMcpInputSchema, invokeGovernedExternalMcpTool } from "./governedExternalMcpTool";

const inputSchema = z.object({ symbol: z.string().min(1).max(20) }).strict();
const outputSchema = z.object({
  output: z.unknown(),
  summary: z.string(),
  deterministic: z.boolean(),
  sourceRefs: z.array(z.string()),
}).strict();

const effects = { committed: 0, ambiguous: 0 };
let abortAfterExternalEntry: AbortController | null = null;

function externalTool(
  id: string,
  invoke: ConversationToolDefinition["invoke"],
): ConversationToolDefinition {
  return {
    id,
    label: id,
    kind: "calculate",
    permissionClass: "user_confirm",
    access: "write",
    sideEffect: "external",
    replaySafe: false,
    inputSchema,
    outputSchema,
    maxOutputBytes: 16_384,
    cancel: null,
    invoke,
  };
}

registerConversationTool(externalTool("test.l5.external.ok", async (input) => {
  effects.committed += 1;
  return {
    output: { symbol: input.symbol },
    summary: "external write committed",
    deterministic: true,
    sourceRefs: ["test:l5:commit"],
  };
}));

registerConversationTool(externalTool("test.l5.external.ambiguous", async () => {
  effects.ambiguous += 1;
  throw new Error("provider disconnected after accepting the write");
}));
registerConversationTool(externalTool("test.l5.external.abort-unknown", async () => {
  effects.ambiguous += 1;
  abortAfterExternalEntry?.abort("private cancellation reason");
  throw new Error("provider accepted the write but the result was lost");
}));

let externalMcpRemoteCalls = 0;
registerConversationTool({
  id: "test.l10.external-mcp",
  label: "Test governed external MCP",
  kind: "retrieve",
  permissionClass: "user_confirm",
  access: "write",
  sideEffect: "external",
  replaySafe: false,
  inputSchema: governedExternalMcpInputSchema,
  outputSchema,
  maxOutputBytes: 16_384,
  cancel: null,
  invoke: async (input, signal) => invokeGovernedExternalMcpTool(
    input,
    { userId: 7, organizationId: null, projectId: 77 },
    signal,
    {
      listConnections: async () => [{
        id: 41,
        userId: 7,
        organizationId: null,
        connectorId: "mcp",
        name: "Test MCP",
        sourceType: "mcp",
        config: {
          endpoint: "https://mcp.example.test",
          projectId: 77,
          allowedToolIds: "quotes.read",
          requireApprovalForTools: true,
        },
        credentialRef: null,
        status: "configured",
        lastTestedAt: null,
        lastHealthyAt: null,
        statusDetail: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }] as never,
      configForConnection: () => ({
        endpoint: "https://mcp.example.test",
        policy: {
          projectId: 77,
          serverId: "source:41",
          allowedToolIds: ["quotes.read"],
          allowedResourcePrefixes: [],
          credentialRef: null,
          requireApprovalForTools: true,
          healthTimeoutMs: 5_000,
        },
      }),
      callTool: async (_config, toolId, argumentsValue, childSignal) => {
        assert.equal(childSignal.aborted, false);
        assert.equal(toolId, "quotes.read");
        assert.deepEqual(argumentsValue, { symbol: "AAPL" });
        externalMcpRemoteCalls += 1;
        return { price: 123 };
      },
    },
  ),
});

const planJson = (toolId: string) => JSON.stringify({
  steps: [{
    id: "write",
    toolId,
    label: "Write once",
    input: { symbol: "TEST" },
    dependsOn: [],
  }],
});
const answer = (text: string) => JSON.stringify({ decision: "complete", answer: text });

const externalMcpPlanJson = JSON.stringify({
  steps: [{
    id: "mcp-call",
    toolId: "test.l10.external-mcp",
    label: "Call external MCP once",
    input: { connectionId: 41, toolId: "quotes.read", arguments: { symbol: "AAPL" } },
    dependsOn: [],
  }],
});

let delegatedAdapterCalls = 0;
registerAgentFrameworkAdapter({
  id: "test.l13.delegate-adapter",
  framework: "lios_native",
  roles: ["research"],
  execute: async ({ requestId, role, objective, context, budget, signal }) => {
    assert.equal(signal.aborted, false);
    assert.equal(requestId.startsWith("c5"), true);
    assert.equal(role, "research");
    assert.equal(objective, "Review the bounded evidence set.");
    assert.equal(context.project.projectId, null);
    assert.deepEqual(budget, {
      maxSteps: 2,
      maxAiCalls: 1,
      maxRevisions: 0,
      maxDurationMs: 5_000,
    });
    delegatedAdapterCalls += 1;
    return {
      output: { finding: "bounded specialist result" },
      deterministic: false,
      aiDerived: true,
      sourceRefs: ["source:delegate-test"],
      usage: { stepsUsed: 1, aiCallsUsed: 1, revisionsUsed: 0, durationMs: 50 },
    };
  },
});

const delegationPlanJson = JSON.stringify({
  steps: [{
    id: "delegate",
    toolId: "lios.agent.delegate",
    label: "Delegate bounded research",
    input: {
      adapterId: "test.l13.delegate-adapter",
      role: "research",
      objective: "Review the bounded evidence set.",
      budget: {
        maxSteps: 2,
        maxAiCalls: 1,
        maxRevisions: 0,
        maxDurationMs: 5_000,
      },
    },
    dependsOn: [],
  }],
});


function request(requestId: string) {
  return {
    requestId,
    continuationOf: null,
    message: "Perform the approved external write",
    executionMode: "ai_assisted" as const,
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured" as const,
      providerAllow: [],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: false,
      allowSelection: true,
      allowToolCalling: true,
      dataClassification: "private" as const,
    },
    attachments: [],
  };
}

function run(
  requestId: string,
  scripted: string[],
  signal: AbortSignal,
  agentLoop: ConversationRuntimeInput["agentLoop"],
  onLedger?: (event: AgentEventInput) => void,
) {
  const events: ConversationRuntimeEvent[] = [];
  const ledger: AgentEventInput[] = [];
  const queue = [...scripted];
  const promise = executeConversationRuntime({
    tenant: { userId: 7, organizationId: null, role: "internal_analyst" },
    scope: "temporary",
    chatId: null,
    projectId: null,
    resources: [],
    history: [],
    request: request(requestId),
    signal,
    agentLoop: {
      ...agentLoop,
      ledger: async (event) => {
        ledger.push(event);
        onLedger?.(event);
      },
    },
    aiCompletion: async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error("model called more often than scripted");
      return {
        provider: "openai",
        model: "gpt-4o",
        text: next,
        attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "p", output: next }),
      };
    },
    emit: (event) => { events.push(event); },
  });
  return { promise, events, ledger };
}

const grantUser = { id: 7, organizationId: null, role: "internal_analyst" as const };

async function authorizePause(
  requestId: string,
  pause: NonNullable<ConversationRuntimeResult["agentPause"]>,
  runSignal: AbortSignal,
) {
  const step = pause.resume.steps.find((candidate) => candidate.id === pause.stepId);
  const descriptor = getConversationTool(pause.toolId);
  assert.ok(step && descriptor);
  const policy = currentConversationToolApprovalPolicy(pause.toolId);
  const proposal = await proposeGovernedToolOperation({
    user: grantUser,
    projectId: null,
    chatId: null,
    requestId,
    stepId: pause.stepId,
    toolCallId: pause.resume.paused.toolCallId,
    toolId: pause.toolId,
    input: step.input,
    descriptor,
    planHash: pause.planSha256,
    policy,
    currentPolicy: () => currentConversationToolApprovalPolicy(pause.toolId),
    runSignal,
  });
  await reviewGovernedToolOperation({
    user: grantUser,
    requestId,
    reviewId: proposal.reviewId,
    allow: true,
    scope: "once",
  });
  return resolveGovernedToolOperation({ user: grantUser, requestId, reviewId: proposal.reviewId });
}

test("external agent dispatch writes intent before effect and commit before terminal success", async () => {
  effects.committed = 0;
  const requestId = "c1111111-1111-4111-8111-111111111111";
  const controller = new AbortController();

  const first = run(requestId, [planJson("test.l5.external.ok")], controller.signal, {});
  const paused = await first.promise;
  assert.equal(paused.awaitingApproval, true);
  assert.equal(effects.committed, 0);

  const authorization = await authorizePause(requestId, paused.agentPause!, controller.signal);
  const second = run(
    requestId,
    [answer("done")],
    controller.signal,
    { resume: { state: paused.agentPause!.resume, authorization } },
  );
  const completed = await second.promise;

  assert.equal(completed.awaitingApproval, false);
  assert.equal(effects.committed, 1);
  assert.deepEqual(second.ledger.map((event) => event.kind), [
    "tool_call_dispatch_intent",
    "tool_call_dispatch_committed",
    "tool_call_finished",
    "step_finished",
  ]);

  const inputSha256 = agentInputSha256({ symbol: "TEST" });
  const expectedKey = deriveAgentToolIdempotencyKey({
    requestId,
    stepId: "write",
    toolId: "test.l5.external.ok",
    inputSha256,
  });
  const intent = second.ledger[0];
  const commit = second.ledger[1];
  assert.ok(intent?.kind === "tool_call_dispatch_intent");
  assert.ok(commit?.kind === "tool_call_dispatch_committed");
  assert.equal(intent.idempotencyKey, expectedKey);
  assert.equal(commit.idempotencyKey, expectedKey);
  assert.equal(intent.attempt, 1);
  assert.equal(commit.attempt, 1);
});

test("cancellation after write-ahead but before tool entry is durably proven no-effect", async () => {
  effects.committed = 0;
  const requestId = "c3333333-3333-4333-8333-333333333333";
  const controller = new AbortController();

  const first = run(requestId, [planJson("test.l5.external.ok")], controller.signal, {});
  const paused = await first.promise;
  const authorization = await authorizePause(requestId, paused.agentPause!, controller.signal);
  const second = run(
    requestId,
    [],
    controller.signal,
    { resume: { state: paused.agentPause!.resume, authorization } },
    (event) => {
      if (event.kind === "tool_call_dispatch_intent") controller.abort();
    },
  );

  const result = await second.promise;
  assert.equal(result.cancelled, true);
  assert.equal(effects.committed, 0, "tool.invoke is never entered after the pre-effect cancellation");
  assert.deepEqual(second.ledger.map((event) => event.kind), [
    "tool_call_dispatch_intent",
    "tool_call_dispatch_no_effect",
    "tool_call_finished",
    "step_finished",
  ]);
  const noEffect = second.ledger[1];
  assert.ok(noEffect?.kind === "tool_call_dispatch_no_effect");
  assert.match(noEffect.reconciliationRef, /^tool-reconcile:no-effect:[a-f0-9]{64}$/);
});

test("external effect followed by an exception remains outcome-unknown with no false terminal event", async () => {
  effects.ambiguous = 0;
  const requestId = "c2222222-2222-4222-8222-222222222222";
  const controller = new AbortController();

  const first = run(requestId, [planJson("test.l5.external.ambiguous")], controller.signal, {});
  const paused = await first.promise;
  const authorization = await authorizePause(requestId, paused.agentPause!, controller.signal);
  const second = run(
    requestId,
    [],
    controller.signal,
    { resume: { state: paused.agentPause!.resume, authorization } },
  );

  await assert.rejects(second.promise);
  assert.equal(effects.ambiguous, 1);
  assert.deepEqual(second.ledger.map((event) => event.kind), ["tool_call_dispatch_intent"]);
  assert.equal(second.ledger.some((event) => event.kind === "tool_call_dispatch_committed"), false);
  assert.equal(second.ledger.some((event) => event.kind === "tool_call_finished"), false);
  assert.equal(second.ledger.some((event) => event.kind === "step_finished"), false);
});
test("Stop cannot swallow outcome-unknown dispatch reconciliation", async () => {
  effects.ambiguous = 0;
  const requestId = "c6666666-6666-4666-8666-666666666666";
  const controller = new AbortController();
  abortAfterExternalEntry = controller;
  try {
    const first = run(requestId, [planJson("test.l5.external.abort-unknown")], controller.signal, {});
    const paused = await first.promise;
    const authorization = await authorizePause(requestId, paused.agentPause!, controller.signal);
    const second = run(
      requestId,
      [],
      controller.signal,
      { resume: { state: paused.agentPause!.resume, authorization } },
    );

    await assert.rejects(second.promise, AgentDispatchOutcomeUnknownError);
    assert.equal(effects.ambiguous, 1);
    assert.equal(second.events.some((event) => event.type === "done" && event.status === "cancelled"), false);
    assert.deepEqual(second.ledger.map((event) => event.kind), ["tool_call_dispatch_intent"]);
  } finally {
    abortAfterExternalEntry = null;
  }
});


test("governed external MCP pause/resume records one durable dispatch and consumed approval cannot redispatch", async () => {
  externalMcpRemoteCalls = 0;
  const requestId = "c4444444-4444-4444-8444-444444444444";
  const controller = new AbortController();

  const first = run(requestId, [externalMcpPlanJson], controller.signal, {});
  const paused = await first.promise;
  assert.equal(paused.awaitingApproval, true);
  assert.equal(externalMcpRemoteCalls, 0, "transport must not run before approval");
  assert.equal(first.ledger.filter((event) => event.kind === "tool_call_waiting_approval").length, 1);

  const authorization = await authorizePause(requestId, paused.agentPause!, controller.signal);
  const second = run(
    requestId,
    [answer("external MCP completed")],
    controller.signal,
    { resume: { state: paused.agentPause!.resume, authorization } },
  );
  const completed = await second.promise;

  assert.equal(completed.awaitingApproval, false);
  assert.equal(externalMcpRemoteCalls, 1);
  assert.equal(second.ledger.filter((event) => event.kind === "tool_call_dispatch_intent").length, 1);
  assert.equal(second.ledger.filter((event) => event.kind === "tool_call_dispatch_committed").length, 1);

  const dispatchKinds = second.ledger
    .filter((event) => event.kind === "tool_call_dispatch_intent" || event.kind === "tool_call_dispatch_committed")
    .map((event) => event.kind);
  assert.deepEqual(dispatchKinds, ["tool_call_dispatch_intent", "tool_call_dispatch_committed"]);

  const replay = run(
    requestId,
    [answer("replay was denied")],
    controller.signal,
    { resume: { state: paused.agentPause!.resume, authorization } },
  );
  await replay.promise;

  assert.equal(externalMcpRemoteCalls, 1, "a consumed authorization cannot produce a second remote MCP dispatch");
  assert.equal(replay.ledger.some((event) => event.kind === "tool_call_dispatch_intent"), false);
  assert.equal(replay.ledger.some((event) => event.kind === "tool_call_dispatch_committed"), false);
});


test("governed delegation pauses, resumes once, records L5 dispatch and emits a secret-safe delegate receipt", async () => {
  delegatedAdapterCalls = 0;
  const requestId = "c5555555-5555-4555-8555-555555555555";
  const controller = new AbortController();

  const first = run(requestId, [delegationPlanJson], controller.signal, {});
  const paused = await first.promise;
  assert.equal(paused.awaitingApproval, true);
  assert.equal(delegatedAdapterCalls, 0, "delegate adapter cannot run before canonical approval");
  assert.equal(first.ledger.filter((event) => event.kind === "tool_call_waiting_approval").length, 1);

  const authorization = await authorizePause(requestId, paused.agentPause!, controller.signal);
  const second = run(
    requestId,
    [answer("delegated analysis completed")],
    controller.signal,
    { resume: { state: paused.agentPause!.resume, authorization } },
  );
  const completed = await second.promise;

  assert.equal(completed.awaitingApproval, false);
  assert.equal(delegatedAdapterCalls, 1);
  assert.equal(second.ledger.filter((event) => event.kind === "tool_call_dispatch_intent").length, 1);
  assert.equal(second.ledger.filter((event) => event.kind === "tool_call_dispatch_committed").length, 1);
  const evidence = second.ledger.find((event) => event.kind === "evidence");
  assert.ok(evidence?.kind === "evidence");
  assert.match(
    evidence.ref,
    /^delegate-receipt:v1:[a-f0-9]{32}:[a-f0-9]{32}:research:[a-f0-9]{32}:[a-f0-9]{64}$/,
  );

  const replay = run(
    requestId,
    [answer("replay denied")],
    controller.signal,
    { resume: { state: paused.agentPause!.resume, authorization } },
  );
  await replay.promise;

  assert.equal(delegatedAdapterCalls, 1, "consumed authorization cannot launch a duplicate delegate");
  assert.equal(replay.ledger.some((event) => event.kind === "tool_call_dispatch_intent"), false);
  assert.equal(replay.ledger.some((event) => event.kind === "tool_call_dispatch_committed"), false);
});
