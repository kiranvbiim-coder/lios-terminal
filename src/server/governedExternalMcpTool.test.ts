import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnection } from "@shared/schema";
import {
  governedExternalMcpInputSchema,
  invokeGovernedExternalMcpTool,
} from "./governedExternalMcpTool";
import { callExternalMcpTool, type ExternalMcpServerConfig } from "./externalMcpClient";

const connection = {
  id: 41,
  userId: 7,
  organizationId: 9,
  connectorId: "mcp",
  name: "Research MCP",
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
} as SourceConnection;

function config(): ExternalMcpServerConfig {
  return {
    endpoint: "https://mcp.example.test",
    policy: {
      projectId: 77,
      serverId: "source:41",
      allowedToolIds: ["quotes.read"],
      allowedResourcePrefixes: [],
      credentialRef: null,
      requireApprovalForTools: true,
      healthTimeoutMs: 5000,
    },
  };
}

test("governed external MCP activation is tenant/project-bound and preserves the run signal", async () => {
  const controller = new AbortController();
  let seenSignal: AbortSignal | null = null;
  let calls = 0;

  const result = await invokeGovernedExternalMcpTool(
    { connectionId: 41, toolId: "quotes.read", arguments: { symbol: "AAPL" } },
    { userId: 7, organizationId: 9, projectId: 77 },
    controller.signal,
    {
      listConnections: async () => [connection],
      configForConnection: () => config(),
      callTool: async (_config, toolId, args, signal) => {
        calls += 1;
        seenSignal = signal;
        assert.equal(toolId, "quotes.read");
        assert.deepEqual(args, { symbol: "AAPL" });
        return { price: 123 };
      },
    },
  );

  assert.equal(calls, 1);
  assert.equal(seenSignal, controller.signal);
  assert.deepEqual(result.output, { price: 123 });
  assert.deepEqual(result.sourceRefs, ["mcp-server:source:41", "mcp-tool:quotes.read"]);
});

test("governed external MCP activation fails closed across Project or tenant scope", async () => {
  let calls = 0;
  const deps = {
    listConnections: async () => [connection],
    configForConnection: () => config(),
    callTool: async () => {
      calls += 1;
      return {};
    },
  };

  await assert.rejects(
    invokeGovernedExternalMcpTool(
      { connectionId: 41, toolId: "quotes.read", arguments: {} },
      { userId: 7, organizationId: 9, projectId: 78 },
      new AbortController().signal,
      deps,
    ),
    /Project/,
  );
  await assert.rejects(
    invokeGovernedExternalMcpTool(
      { connectionId: 41, toolId: "quotes.read", arguments: {} },
      { userId: 7, organizationId: 10, projectId: 77 },
      new AbortController().signal,
      deps,
    ),
    /tenant/,
  );
  assert.equal(calls, 0);
});

test("governed external MCP input is bounded and cannot carry approval-shaped top-level fields", () => {
  assert.equal(governedExternalMcpInputSchema.safeParse({
    connectionId: 41,
    toolId: "quotes.read",
    arguments: {},
    approved: true,
  }).success, false);

  assert.equal(governedExternalMcpInputSchema.safeParse({
    connectionId: 41,
    toolId: "quotes.read",
    arguments: { payload: "x".repeat(70 * 1024) },
  }).success, false);

  assert.equal(governedExternalMcpInputSchema.safeParse({
    connectionId: 41,
    toolId: "quotes.read\nadmin.delete",
    arguments: {},
  }).success, false);
});

test("pre-cancelled governed external MCP activation performs no transport call", async () => {
  const controller = new AbortController();
  controller.abort(new Error("private cancellation reason"));
  let calls = 0;
  await assert.rejects(
    invokeGovernedExternalMcpTool(
      { connectionId: 41, toolId: "quotes.read", arguments: {} },
      { userId: 7, organizationId: 9, projectId: 77 },
      controller.signal,
      {
        listConnections: async () => [connection],
        configForConnection: () => config(),
        callTool: async () => {
          calls += 1;
          return {};
        },
      },
    ),
    /cancel/i,
  );
  assert.equal(calls, 0);
});


test("GM20 the governed Project path executes through the real official MCP v2 SDK and rejects unauthorized tools before transport", async () => {
  const endpoint = "https://8.8.8.8/mcp";
  const urls: string[] = [];
  const verbs: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const method = init?.method ?? "GET";
    if (method === "GET") return new Response(null, { status: 405 });
    if (method === "DELETE") return new Response(null, { status: 202 });
    const payload = JSON.parse(await new Response(init?.body).text()) as {
      id?: string | number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> };
    };
    verbs.push(payload.method ?? "notification");
    if (payload.id === undefined) return new Response(null, { status: 202 });
    if (payload.method === "server/discover") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0", id: payload.id,
        error: { code: -32601, message: "Method not found" },
      }), { headers: { "Content-Type": "application/json" } });
    }
    const result = payload.method === "initialize" ? {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "governed-test-mcp", version: "1" },
    } : payload.method === "tools/list" ? {
      tools: [{ name: "quotes.read", inputSchema: { type: "object", properties: {} } }],
    } : payload.method === "tools/call" && payload.params?.name === "quotes.read" ? {
      isError: false, content: [{ type: "text", text: "verified test observation" }],
    } : null;
    return new Response(JSON.stringify(result === null
      ? { jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "Method not found" } }
      : { jsonrpc: "2.0", id: payload.id, result }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const deps = {
    listConnections: async () => [{
      ...connection, config: { ...connection.config, endpoint },
    }],
    configForConnection: () => ({
      ...config(), endpoint,
    }),
    callTool: (selected: ExternalMcpServerConfig, id: string, args: Record<string, unknown>, signal: AbortSignal) =>
      callExternalMcpTool(selected, id, args, undefined, signal),
  };
  try {
    const context = { userId: 7, organizationId: 9, projectId: 77 };
    const denied = await assert.rejects(
      () => invokeGovernedExternalMcpTool(
        { connectionId: 41, toolId: "admin.delete", arguments: {} },
        context, new AbortController().signal, deps,
      ),
      /outside Project policy/,
    );
    assert.equal(denied, undefined);
    assert.equal(urls.length, 0, "unapproved tool id cannot reach any provider network endpoint");

    const result = await invokeGovernedExternalMcpTool(
      { connectionId: 41, toolId: "quotes.read", arguments: { symbol: "TEST" } },
      context, new AbortController().signal, deps,
    );
    assert.equal((result.output as { content: Array<{ text: string }> }).content[0]?.text, "verified test observation");
    assert.deepEqual(result.sourceRefs, ["mcp-server:source:41", "mcp-tool:quotes.read"]);
    assert.equal(verbs.includes("server/discover"), true);
    assert.equal(verbs.includes("tools/call"), true);
    assert.equal(urls.every(url => url === endpoint), true, "MCP transport never contacts another path/host");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
