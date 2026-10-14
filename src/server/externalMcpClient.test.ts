import assert from "node:assert/strict";
import test from "node:test";
import {
  callExternalMcpTool,
  externalMcpConfigForSourceConnection,
  liosMcpServerExposureContract,
  type McpHttpTransport,
} from "./externalMcpClient";

const config = {
  endpoint: "https://mcp.example.test",
  policy: {
    projectId: 1, serverId: "server-1", allowedToolIds: ["quotes.read"], allowedResourcePrefixes: ["project://safe/"],
    credentialRef: null, requireApprovalForTools: true, healthTimeoutMs: 5000,
  },
};

test("P5 external MCP tool call enforces the Project allow-list; approval is not decided at this layer", async () => {
  const transport: McpHttpTransport = async (_endpoint, request) => ({ jsonrpc: "2.0", id: request.id, result: { ok: true, secret: "should-redact-by-key" } });
  await assert.rejects(() => callExternalMcpTool(config, "admin.delete", {}, transport), /outside Project policy/i);
  assert.equal(callExternalMcpTool.length <= 4, true, "no caller-provided approval parameter");
  const result = await callExternalMcpTool(config, "quotes.read", {}, transport) as Record<string, unknown>;
  assert.equal(result.ok, true);
  assert.equal(result.secret, "[REDACTED]");
});

test("P5 future MCP server exposure contract cannot expose filesystem or secrets", () => {
  const exposure = liosMcpServerExposureContract({ tools: ["lios.quote"] });
  assert.equal(exposure.filesystemExposure, false);
  assert.equal(exposure.secretExposure, false);
  assert.equal(exposure.internalStateExposure, false);
});

test("the data-fabric MCP adapter cannot be approved by a request parameter: approval-required servers fail closed", async () => {
  const { createMcpProviderAdapter } = await import("./sourceConnectionProviderAdapter");
  const connection = {
    id: 1, name: "Quotes MCP", sourceType: "mcp", credentialRef: null,
    config: { endpoint: "https://mcp.example.test", projectId: 1, allowedToolIds: "quotes.read" },
  } as unknown as Parameters<typeof createMcpProviderAdapter>[0];
  const adapter = createMcpProviderAdapter(connection);
  await assert.rejects(
    () => adapter.fetch!({ parameters: { toolId: "quotes.read", arguments: {}, approved: true } } as never),
    /governed tool path/i,
  );
});


test("external MCP config is derived from the stored Project-bound source connection", () => {
  const derived = externalMcpConfigForSourceConnection({
    id: 88,
    sourceType: "mcp",
    credentialRef: "vault:mcp",
    config: {
      endpoint: "https://mcp.example.test",
      projectId: 77,
      allowedToolIds: "quotes.read, research.lookup",
      allowedResourcePrefixes: "project://safe/, https://example.test/",
      requireApprovalForTools: true,
      healthTimeoutMs: 4321,
    },
  } as never);
  assert.equal(derived.policy.projectId, 77);
  assert.equal(derived.policy.serverId, "source:88");
  assert.deepEqual(derived.policy.allowedToolIds, ["quotes.read", "research.lookup"]);
  assert.equal(derived.policy.credentialRef, "vault:mcp");
});

test("external MCP transport receives secret-safe canonical cancellation", async () => {
  const source = new AbortController();
  const secret = "private-external-mcp-cancel-reason";
  source.abort(new Error(secret));
  let seen: AbortSignal | undefined;

  const transport: McpHttpTransport = async (_endpoint, request, _bearer, signal) => {
    seen = signal;
    assert.equal(signal?.aborted, true);
    assert.equal(String(signal?.reason).includes(secret), false);
    throw signal?.reason ?? new Error("missing cancellation");
  };

  await assert.rejects(
    () => callExternalMcpTool(config, "quotes.read", {}, transport, source.signal),
    /cancel|AbortError/i,
  );
  assert.equal(seen?.aborted, true);
});
