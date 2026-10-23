/**
 * GM20 / SI02: offline planning-to-MCP integration seam.
 * This exercises the real LiOS agent kernel and the official MCP v2 client,
 * with a scripted model and an in-memory server instead of paid credentials.
 * Canonical L4 owner approval is tested separately in
 * conversationRuntime.agentLoop.test.ts and is NOT faked by this test.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnection } from "@shared/schema";
import {
  runAgentLoop, resumeAgentLoop,
  type AgentLoopDeps, type AgentLoopTool,
} from "./agentLoop";
import { getConversationTool } from "./conversationRuntime";
import { invokeGovernedExternalMcpTool } from "./governedExternalMcpTool";
import { callExternalMcpTool, type ExternalMcpServerConfig } from "./externalMcpClient";
import type { AgentEventInput } from "./exec/agent-run-events";

test("GM20 agent plan pauses before external MCP, then approved continuation reaches official SDK once", { timeout: 15_000 }, async () => {
  const endpoint = "https://8.8.8.8/mcp";
  const actualCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, endpoint, "plugin cannot redirect model-owned data to another host/path");
    const method = init?.method ?? "GET";
    if (method === "GET") return new Response(null, { status: 405 });
    if (method === "DELETE") return new Response(null, { status: 202 });
    const data = JSON.parse(await new Response(init?.body).text()) as {
      id?: string | number;
      method?: string;
      params?: { name?: string; arguments?: { symbol?: string } };
    };
    if (data.method === "tools/call") {
      actualCalls.push(String(data.params?.name ?? ""));
      assert.equal(data.params?.arguments?.symbol, "TEST");
    }
    if (data.id === undefined) return new Response(null, { status: 202 });
    const response = data.method === "server/discover"
      ? { jsonrpc: "2.0", id: data.id, error: { code: -32601, message: "Method not found" } }
      : { jsonrpc: "2.0", id: data.id, result: data.method === "initialize"
        ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "offline-mcp", version: "1" } }
        : data.method === "tools/call"
          ? { isError: false, content: [{ type: "text", text: "test observation" }] }
          : { tools: [] } };
    return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const descriptor = getConversationTool("lios.external-mcp.call");
  assert.ok(descriptor);
  assert.equal(descriptor.permissionClass, "user_confirm");
  const tool: AgentLoopTool = {
    id: descriptor.id,
    label: descriptor.label,
    kind: descriptor.kind,
    permissionClass: descriptor.permissionClass,
    sideEffect: descriptor.sideEffect,
    decision: "confirm",
    validateInput: input => descriptor.inputSchema.safeParse(input).success,
  };
  const connection = {
    id: 41, userId: 7, organizationId: 9, sourceType: "mcp", connectorId: "mcp",
    name: "Offline MCP", config: { endpoint, projectId: 77, allowedToolIds: "quotes.read" },
    credentialRef: null, status: "configured", statusDetail: null,
    lastTestedAt: null, lastHealthyAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  } as SourceConnection;
  const config: ExternalMcpServerConfig = {
    endpoint,
    policy: {
      projectId: 77, serverId: "source:41",
      allowedToolIds: ["quotes.read"],
      allowedResourcePrefixes: [],
      credentialRef: null,
      requireApprovalForTools: true,
      healthTimeoutMs: 5_000,
    },
  };
  const script = [
    JSON.stringify({ steps: [{
      id: "read", label: "Read a permitted quote", toolId: "lios.external-mcp.call",
      input: { connectionId: 41, toolId: "quotes.read", arguments: { symbol: "TEST" } },
      dependsOn: [],
    }] }),
    JSON.stringify({ decision: "complete", answer: "The connected MCP tool completed; its observation has not been released for model review." }),
  ];
  const modelCalls: string[] = [];
  const ledger: AgentEventInput[] = [];
  let ownerApproved = false;
  const runSignal = new AbortController().signal;
  const deps: AgentLoopDeps = {
    goal: "Retrieve a user-connected observation.",
    tools: [tool],
    budget: { maxSteps: 2, maxAiCalls: 3, maxRevisions: 0 },
    signal: runSignal,
    callModel: async call => {
      modelCalls.push(call.user);
      const reply = script.shift();
      if (!reply) throw new Error("Unexpected additional model call");
      return reply;
    },
    // Only a test harness approval bit: the product's real single-use owner
    // grant is enforced by conversationRuntime + conversationGrantStore.
    invokeTool: async ({ step }) => {
      if (!ownerApproved) return { kind: "denied", reason: "No server approval" };
      const result = await invokeGovernedExternalMcpTool(step.input,
        { userId: 7, organizationId: 9, projectId: 77 }, runSignal,
        {
          listConnections: async () => [connection],
          configForConnection: () => config,
          callTool: (selected, toolId, args, signal) =>
            callExternalMcpTool(selected, toolId, args, undefined, signal),
        });
      return {
        kind: "ok", summary: result.summary,
        deterministic: result.deterministic,
        sourceRefs: result.sourceRefs,
      };
    },
    ledger: async event => { ledger.push(event); },
    onPlan: async () => undefined,
    onStepStart: async () => undefined,
    onStepResult: async () => undefined,
    onRevise: async () => undefined,
  };

  try {
    const paused = await runAgentLoop(deps);
    assert.equal(paused.status, "awaiting_approval");
    assert.equal(paused.aiCalls, 1);
    assert.deepEqual(actualCalls, [], "planning cannot run the plugin without user review");
    assert.ok(paused.resume);
    assert.equal(ledger.at(-1)?.kind, "tool_call_waiting_approval");

    ownerApproved = true;
    const completed = await resumeAgentLoop(deps, paused.resume);
    assert.equal(completed.status, "completed");
    assert.deepEqual(actualCalls, ["quotes.read"], "only the reviewed step may invoke the MCP tool");
    assert.deepEqual(completed.steps[0]?.sourceRefs, ["mcp-server:source:41", "mcp-tool:quotes.read"]);
    assert.equal(modelCalls.length, 2, "resume inspects result without re-planning");
    // L4 tool execution consent is not AI-transmission consent. No raw MCP
    // response or fabricated "verified quote" may appear in the review prompt
    // until P7 source-specific rights and the owner's release are enforced.
    assert.equal(modelCalls[1]?.includes("test observation"), false);
    assert.match(modelCalls[1] ?? "", /External MCP tool quotes\.read completed/);
    assert.equal(completed.answer.includes("test observation"), false);
    assert.equal(ledger.filter(event => event.kind === "tool_call_finished"
      && event.status === "succeeded").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
