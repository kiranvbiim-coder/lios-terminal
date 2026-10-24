import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { AIProviderError, createAttribution } from "./byoaiRouter";
import { currentConversationToolApprovalPolicy, executeConversationRuntime, getConversationTool, registerConversationTool, type ConversationRuntimeInput, type ConversationRuntimeResult } from "./conversationRuntime";
import type { AgentEventInput } from "./exec/agent-run-events";
import { z } from "zod";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { callExternalMcpTool, type ExternalMcpServerConfig } from "./externalMcpClient";
import type { ConversationToolDefinition } from "./conversationRuntime";
import {
  proposeGovernedToolOperation,
  resolveGovernedToolOperation,
  reviewGovernedToolOperation,
} from "./conversationGrantStore";


const anyInput = z.object({}).passthrough();
const anyResult = z.object({ output: z.unknown(), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }).strict();
const governed = (tool: Pick<ConversationToolDefinition, "id" | "label" | "kind" | "permissionClass" | "invoke">, extra: Partial<ConversationToolDefinition> = {}): ConversationToolDefinition => ({
  access: "read", sideEffect: "none", replaySafe: true, inputSchema: anyInput, outputSchema: anyResult, cancel: null, ...tool, ...extra,
} as ConversationToolDefinition);
const seen: Array<Record<string, unknown>> = [];
registerConversationTool(governed({
  id: "test.agent.echo", label: "Echo quote", kind: "retrieve", permissionClass: "safe_auto",
  invoke: async (input, _signal, call) => {
    // Scope comes from the trusted call, never from the model's input.
    seen.push({ ...input, tenant: call.tenant, projectId: call.projectId });
    return { output: { ok: true }, summary: `echo ${String(input.symbol ?? "")}`, deterministic: true, sourceRefs: ["test:echo"] };
  },
}));
registerConversationTool(governed({
  id: "test.agent.leaky", label: "Fails with a secret", kind: "retrieve", permissionClass: "safe_auto",
  invoke: async () => { throw new Error("upstream said password=hunter2 while reading /Users/kiran/.ssh/id_rsa"); },
}));
registerConversationTool(governed({
  id: "test.agent.confirm", label: "Needs approval", kind: "calculate", permissionClass: "user_confirm",
  invoke: async () => { throw new Error("must never run without a server-issued approval"); },
}));
const gatedRuns: string[] = [];
registerConversationTool(governed({
  id: "test.agent.gated", label: "Runs after approval", kind: "calculate", permissionClass: "user_confirm",
  invoke: async (input) => { gatedRuns.push(String(input.symbol)); return { output: null, summary: "gated done", deterministic: true, sourceRefs: ["test:gated"] }; },
}));
registerConversationTool(governed({
  id: "test.agent.slow", label: "Waits for cancel", kind: "retrieve", permissionClass: "safe_auto",
  invoke: async (_input, signal) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 5_000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
    return { output: null, summary: "slow done", deterministic: true, sourceRefs: [] };
  },
}));

const planJson = (steps: unknown[]) => JSON.stringify({ steps });
const step = (id: string, toolId: string, input: Record<string, unknown> = { symbol: "TEST" }) => ({ id, toolId, label: `Run ${id}`, input, dependsOn: [] });
const answer = (text: string) => JSON.stringify({ decision: "complete", answer: text });

function request(requestId: string, executionMode: "ai_assisted" | "deterministic_first" = "ai_assisted") {
  return {
    requestId, continuationOf: null, message: "Compare the quote for TEST", executionMode, aiDirectApproved: false, approvals: [],
    transmissionPolicy: {
      mode: "configured" as const, providerAllow: [], providerDeny: [], allowProjectInstructions: true,
      allowResourceReferences: false, allowSelection: true, allowToolCalling: true, dataClassification: "private" as const,
    },
    attachments: [],
  };
}

function run(requestId: string, scripted: Array<string | Error>, options: {
  mode?: "ai_assisted" | "deterministic_first";
  projectId?: number | null;
  signal?: AbortSignal;
  agentLoop?: ConversationRuntimeInput["agentLoop"];
} = {}) {
  const events: ConversationRuntimeEvent[] = [];
  const ledger: AgentEventInput[] = [];
  const queue = [...scripted];
  let aiCalls = 0;
  const prompts: string[] = [];
  const promise = executeConversationRuntime({
    tenant: { userId: 7, organizationId: null, role: "internal_analyst" },
    ...(options.projectId === null ? { scope: "temporary" as const, chatId: null, projectId: null } : { scope: "project" as const, chatId: 2, projectId: 3 }), resources: [], history: [],
    request: request(requestId, options.mode),
    ...(options.signal ? { signal: options.signal } : {}),
    agentLoop: { ledger: async (event) => { ledger.push(event); }, ...options.agentLoop },
    aiCompletion: async (completion) => {
      aiCalls += 1;
      prompts.push(JSON.stringify(completion));
      const next = queue.shift();
      if (next === undefined) throw new Error("model called more often than scripted");
      if (next instanceof Error) throw next;
      return { provider: "openai", model: "gpt-4o", text: next, attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "p", output: next }) };
    },
    emit: (event) => { events.push(event); },
  });
  return { promise, events, ledger, prompts, calls: () => aiCalls };
}

const types = (events: ConversationRuntimeEvent[]) => events.map((event) => event.type);

test("an agent run plans, executes governed tools, reviews, and completes with an AI-derived answer and a receipt", async () => {
  seen.length = 0;
  const r = run("a1111111-1111-4111-8111-111111111111", [planJson([step("fetch", "test.agent.echo")]), answer("TEST is echoed.")]);
  const result = await r.promise;
  assert.equal(result.cancelled, false);
  assert.equal(result.label, "ai_derived");
  assert.equal(result.text, "TEST is echoed.");
  assert.equal(result.receiptIds.length, 1);
  const plan = r.events.find((event) => event.type === "plan");
  assert.ok(plan && plan.type === "plan");
  assert.equal(plan.plan.steps[0]?.kind, "agent");
  assert.equal(plan.plan.steps[0]?.componentId, "test.agent.echo");
  assert.deepEqual(types(r.events).filter((type) => ["plan", "tool_start", "tool_result", "receipt", "text", "done"].includes(type)), ["plan", "tool_start", "tool_result", "receipt", "text", "done"]);
  assert.equal((r.events.at(-1) as { status: string }).status, "completed");
  assert.deepEqual(r.ledger.map((event) => event.kind), ["step_started", "tool_call_started", "tool_call_finished", "step_finished"]);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]!.tenant, { userId: 7, organizationId: null, role: "internal_analyst" });
  assert.equal(seen[0]!.projectId, 3);
  assert.equal(r.calls(), 2, "exactly the planning and review calls; no extra synthesis call");
});

test("the model cannot set tenant or Project scope for a tool", async () => {
  seen.length = 0;
  const r = run("a2222222-2222-4222-8222-222222222222", [planJson([step("fetch", "test.agent.echo", { symbol: "X", projectId: 999, tenant: { userId: 1 } })])], { agentLoop: { maxRevisions: 0 } });
  await assert.rejects(r.promise, /reserved field/);
  assert.equal(seen.length, 0);
  assert.equal((r.events.at(-1) as { status?: string }).status, "failed");
});

test("an agent run needs AI-assisted mode and never degrades to a model-less answer", async () => {
  const r = run("a3333333-3333-4333-8333-333333333333", [], { mode: "deterministic_first" });
  await assert.rejects(r.promise);
  const gap = r.events.find((event) => event.type === "data_gap");
  assert.ok(gap && gap.type === "data_gap");
  assert.equal(gap.gap.field, "execution_mode");
  assert.equal(r.calls(), 0);
  assert.equal(r.events.some((event) => event.type === "text"), false);
});

test("an unavailable model is an honest data gap, not a fabricated answer", async () => {
  const r = run("a4444444-4444-4444-8444-444444444444", [new AIProviderError("not_configured", "No AI provider is configured.")]);
  await assert.rejects(r.promise);
  const gap = r.events.find((event) => event.type === "data_gap");
  assert.ok(gap && gap.type === "data_gap");
  assert.equal(gap.gap.field, "ai_provider");
  assert.equal(gap.gap.reason, "not_connected");
  assert.equal(r.events.some((event) => event.type === "text"), false);
});

test("a confirm-class tool ends the run waiting for approval and is never invoked", async () => {
  const r = run("a5555555-5555-4555-8555-555555555555", [planJson([step("ask", "test.agent.confirm")])]);
  const result = await r.promise;
  assert.equal(result.awaitingApproval, true);
  assert.ok(result.agentPause && /^[0-9a-f]{64}$/.test(result.agentPause.planSha256), "pause exposes the plan hash and exact paused step for L4");
  assert.equal(result.agentPause?.resume.paused.stepId, result.agentPause?.stepId);
  assert.match(result.text, /test\.agent\.confirm/);
  assert.equal((r.events.at(-1) as { status: string }).status, "waiting_approval");
  assert.equal(r.calls(), 1);
});

test("hitting the AI-call budget stops honestly and does not trigger an extra synthesis call", async () => {
  const r = run("a6666666-6666-4666-8666-666666666666", [planJson([step("fetch", "test.agent.echo")])], { agentLoop: { maxAiCalls: 1 } });
  const result = await r.promise;
  assert.match(result.text, /Stopped before finishing: the ai calls limit/);
  assert.equal(result.label, "deterministic");
  assert.equal(r.calls(), 1);
  assert.equal((r.events.at(-1) as { status: string }).status, "completed");
});

test("the wall-clock budget is enforced through the plan budget", { timeout: 15_000 }, async () => {
  const r = run("a7777777-7777-4777-8777-777777777777", [planJson([step("slow", "test.agent.slow")])], { agentLoop: { maxDurationMs: 1_000 } });
  await assert.rejects(r.promise, /bounded runtime budget/);
  assert.equal((r.events.at(-1) as { status: string }).status, "failed");
});

test("aborting the supplied run signal mid-tool cancels it and records the cancellation in the ledger", { timeout: 15_000 }, async () => {
  const id = "a8888888-8888-4888-8888-888888888888";
  const controller = new AbortController();
  const r = run(id, [planJson([step("slow", "test.agent.slow")])], { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const result = await r.promise;
  assert.equal(result.cancelled, true);
  assert.equal((r.events.at(-1) as { status: string }).status, "cancelled");
  assert.equal(r.ledger.at(-1)?.kind, "step_finished");
  assert.equal((r.ledger.at(-1) as { status: string }).status, "cancelled");
});

test("a tool's exception text never reaches the model or the client", async () => {
  const r = run("a9999999-9999-4999-8999-999999999999", [planJson([step("leak", "test.agent.leaky")]), answer("The tool could not run.")]);
  await r.promise;
  const everything = JSON.stringify([r.events, r.prompts]);
  assert.equal(everything.includes("hunter2"), false);
  assert.equal(everything.includes("/Users/kiran"), false);
  const result = r.events.find((event) => event.type === "tool_result");
  assert.ok(result && result.type === "tool_result");
  assert.match(result.summary, /unexpected error/);
});

test("a model cannot silently turn a failed tool into a verified execution success", async () => {
  const r = run("c4444444-4444-4444-8444-444444444444", [
    planJson([step("failed-source", "test.agent.leaky")]),
    answer("All tasks completed successfully and the result has been saved."),
  ]);
  const result = await r.promise;
  assert.equal(result.label, "ai_derived", "The model is still only the source of the explanation");
  assert.match(result.text, /^LiOS execution record: 1 failed tool step\(s\) did not complete\./);
  assert.match(result.text, /The AI answer below is not proof that those actions ran\./);
  assert.match(result.text, /All tasks completed successfully and the result has been saved\./);
  assert.equal(r.ledger.some((event) => event.kind === "tool_call_finished" && event.status === "failed"), true);
  assert.equal(r.ledger.some((event) => event.kind === "tool_call_finished" && event.status === "succeeded"), false);
  const receipt = r.events.find((event) => event.type === "receipt");
  assert.ok(receipt && receipt.type === "receipt");
  assert.equal(receipt.receipt.warnings.some((warning) => warning.includes("1 failed tool step(s)")), true);
  assert.equal(receipt.receipt.output && JSON.stringify(receipt.receipt.output).includes('"status":"failed"'), true);
  assert.equal(JSON.stringify([r.events, r.prompts]).includes("hunter2"), false);
});

test("an approval wait leaves the step and call open in the ledger", async () => {
  const r = run("b1111111-1111-4111-8111-111111111111", [planJson([step("ask", "test.agent.confirm")])]);
  await r.promise;
  assert.deepEqual(r.ledger.map((event) => event.kind), ["step_started", "tool_call_started", "tool_call_waiting_approval"]);
});


const grantUser = { id: 7, organizationId: null, role: "internal_analyst" as const };

/**
 * L4 stand-in: propose the exact paused operation, owner-review it once, then resolve the live authorization through the
 * canonical GM-11a authority. Returns the registry-owned run signal the authorization is bound to.
 */
async function grantPausedStep(
  requestId: string,
  toolId: string,
  pause: NonNullable<ConversationRuntimeResult["agentPause"]>,
  runSignal: AbortSignal,
) {
  const planned = pause.resume.steps.find((candidate) => candidate.id === pause.stepId)!;
  const descriptor = getConversationTool(toolId)!;
  const policy = currentConversationToolApprovalPolicy(toolId);
  const proposal = await proposeGovernedToolOperation({
    user: grantUser, projectId: null, chatId: null, requestId, stepId: pause.stepId, toolCallId: pause.resume.paused.toolCallId,
    toolId, input: planned.input, descriptor, planHash: pause.planSha256,
    policy, runSignal,
    currentPolicy: () => currentConversationToolApprovalPolicy(toolId),
  });
  await reviewGovernedToolOperation({ user: grantUser, requestId, reviewId: proposal.reviewId, allow: true, scope: "once" });
  return resolveGovernedToolOperation({ user: grantUser, requestId, reviewId: proposal.reviewId });
}

test("resume continues the same plan from the paused step with a live GM-11a authorization, no re-plan and no second resume event", async () => {
  const id = "b1111111-1111-4111-8111-111111111111";
  const runController = new AbortController();
  const first = run(id, [planJson([step("ask", "test.agent.gated"), { ...step("after", "test.agent.echo"), dependsOn: ["ask"] }])], {
    projectId: null,
    signal: runController.signal,
  });
  const paused = await first.promise;
  assert.equal(paused.awaitingApproval, true);
  assert.equal(gatedRuns.length, 0);
  const pause = paused.agentPause!;

  // L4: the once grant is consumed by GM-11a BEFORE the L2 release; the live authorization is then handed to the resumed run.
  const authorization = await grantPausedStep(id, "test.agent.gated", pause, runController.signal);
  const second = run(id, [answer("Approved and finished.")], { projectId: null, signal: runController.signal, agentLoop: { resume: { state: pause.resume, authorization } } });
  const done = await second.promise;
  assert.equal(done.awaitingApproval, false);
  assert.equal(done.label, "ai_derived");
  assert.equal(done.text, "Approved and finished.");
  assert.equal(second.calls(), 1, "only the review call: the model is not asked for a new plan");
  assert.deepEqual(gatedRuns, ["TEST"]);
  assert.equal(second.ledger.some((event) => event.kind === "tool_call_resumed"), false, "L2 owns the durable release");
  assert.equal(second.events.some((event) => event.type === "plan"), false, "no re-plan event");
  assert.equal((second.events.at(-1) as { status: string }).status, "completed");
});

test("resume with a copied, reused or missing authorization is denied and the gated tool never runs", async () => {
  const id = "b2222222-2222-4222-8222-222222222222";
  const runController = new AbortController();
  const first = run(id, [planJson([step("ask", "test.agent.gated")])], { projectId: null, signal: runController.signal });
  const pause = (await first.promise).agentPause!;
  gatedRuns.length = 0;
  const real = await grantPausedStep(id, "test.agent.gated", pause, runController.signal);
  const forged = { ...real };
  const second = run(id, [answer("Could not run it.")], { projectId: null, signal: runController.signal, agentLoop: { resume: { state: pause.resume, authorization: forged as typeof real } } });
  const outcome = await second.promise;
  assert.equal(gatedRuns.length, 0);
  assert.notEqual(outcome.awaitingApproval, true, "a refused authorization does not loop back into waiting");
  assert.equal(second.ledger.some((event) => event.kind === "tool_call_finished" && event.status === "denied"), true);
});

test("the runtime passes the server-set prepareApproval through: confirm-class only, before the wait, no execution", async () => {
  const id = "b3333333-3333-4333-8333-333333333333";
  const prepared: string[] = [];
  const r = run(id, [planJson([step("ok", "test.agent.echo"), { ...step("ask", "test.agent.gated"), dependsOn: ["ok"] }])], {
    projectId: null,
    agentLoop: {
      prepareApproval: async ({ step: planned, toolCallId }) => { prepared.push(`${planned.id}:${toolCallId}`); },
    },
  });
  gatedRuns.length = 0;
  const result = await r.promise;
  assert.equal(result.awaitingApproval, true);
  assert.deepEqual(prepared, ["ask:ask-call"]);
  assert.equal(gatedRuns.length, 0);
});

/**
 * D1 / L4+L5+L10 joined source test: the canonical pause/one-time approval
 * and durable external dispatch release are connected to the actual official
 * MCP SDK over a local HTTP socket. It intentionally uses a test-only tool
 * descriptor: production's Project-owned source lookup and rights policy
 * retain separate acceptance gates.
 */
test("GM20 real L4 owner approval resumes one durable MCP dispatch over the official SDK", { timeout: 20_000 }, async () => {
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
    if (request.method === "GET") { response.writeHead(405).end(); return; }
    if (request.method !== "POST") { response.writeHead(202).end(); return; }
    const body: Buffer[] = [];
    for await (const part of request) body.push(Buffer.from(part));
    const rpc = JSON.parse(Buffer.concat(body).toString("utf8")) as {
      id?: number | string; method?: string; params?: { name?: string; arguments?: { symbol?: string } };
    };
    if (rpc.id === undefined) { response.writeHead(202).end(); return; }
    if (rpc.method === "tools/call") {
      requests.push(String(rpc.params?.name));
      assert.equal(rpc.params?.arguments?.symbol, "TEST");
    }
    const result = rpc.method === "initialize"
      ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "joined-offline", version: "1" } }
      : rpc.method === "tools/call"
        ? { isError: false, content: [{ type: "text", text: "untrusted local observation" }] }
        : rpc.method === "tools/list" ? { tools: [] } : null;
    const payload = result === null
      ? { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } }
      : { jsonrpc: "2.0", id: rpc.id, result };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const config: ExternalMcpServerConfig = {
      endpoint: `http://127.0.0.1:${port}/mcp`,
      policy: {
        projectId: 77, serverId: "joined-test", allowedToolIds: ["quotes.read"],
        allowedResourcePrefixes: [], credentialRef: null,
        requireApprovalForTools: true, healthTimeoutMs: 5_000,
      },
    };
    // The test-only descriptor preserves real GM11a authorization and L5
    // external-side-effect dispatch. It cannot create a product MCP source.
    registerConversationTool(governed({
      id: "test.agent.joined-mcp-sdk",
      label: "Test joined MCP SDK",
      kind: "retrieve",
      permissionClass: "user_confirm",
      invoke: async (value, signal) => {
        const output = await callExternalMcpTool(
          config, "quotes.read", { symbol: String(value.symbol) }, undefined, signal,
        );
        return {
          output, summary: "External MCP transport completed; content withheld from AI review.",
          deterministic: false, sourceRefs: ["mcp-server:joined-test", "mcp-tool:quotes.read"],
        };
      },
    }, {
      access: "write", sideEffect: "external", replaySafe: false,
      inputSchema: z.object({ symbol: z.string().trim().min(1) }).strict(),
    }));

    const id = "c1111111-1111-4111-8111-111111111111";
    const controller = new AbortController();
    const first = run(id, [planJson([step("read", "test.agent.joined-mcp-sdk", { symbol: "TEST" })])], {
      projectId: null, signal: controller.signal,
    });
    const paused = await first.promise;
    assert.equal(paused.awaitingApproval, true);
    assert.deepEqual(requests, [], "no MCP traffic before the authenticated L4 owner review");
    assert.ok(paused.agentPause);
    assert.equal(first.ledger.at(-1)?.kind, "tool_call_waiting_approval");

    const authorization = await grantPausedStep(id, "test.agent.joined-mcp-sdk", paused.agentPause, controller.signal);
    const resumed = run(id, [answer("The connected tool completed. Observation was not released to the model.")], {
      projectId: null, signal: controller.signal,
      agentLoop: { resume: { state: paused.agentPause.resume, authorization } },
    });
    const result = await resumed.promise;
    assert.equal(result.awaitingApproval, false);
    assert.equal(result.label, "ai_derived");
    assert.deepEqual(requests, ["quotes.read"]);
    assert.equal(resumed.calls(), 1, "one model review with no new plan");
    assert.equal(resumed.prompts.some(prompt => prompt.includes("untrusted local observation")), false,
      "tool execution consent must not become observation transmission consent");
    assert.equal(resumed.ledger.filter(event => event.kind === "tool_call_dispatch_intent").length, 1);
    assert.equal(resumed.ledger.filter(event => event.kind === "tool_call_dispatch_committed").length, 1);
    assert.equal(resumed.ledger.filter(event => event.kind === "tool_call_finished"
      && event.status === "succeeded").length, 1);
    assert.equal(resumed.events.some(event => event.type === "receipt"), true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
