import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnection } from "@shared/schema";
import {
  governedExternalMcpInputSchema,
  invokeGovernedExternalMcpTool,
} from "./governedExternalMcpTool";
import type { ExternalMcpServerConfig } from "./externalMcpClient";

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
