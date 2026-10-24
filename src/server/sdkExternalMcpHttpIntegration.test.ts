/**
 * D1 / GM20: real loopback HTTP integration of the official MCP client.
 *
 * No provider keys, customer data, mock global fetch, or external network.
 * The real L4 owner grant is exercised separately in conversationRuntime.agentLoop.test.ts;
 * this suite proves the bounded L10 source / actual Node HTTP transport seam.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { SourceConnection } from "@shared/schema";
import { callExternalMcpTool, type ExternalMcpServerConfig } from "./externalMcpClient";
import { invokeGovernedExternalMcpTool } from "./governedExternalMcpTool";

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

async function withLoopbackMcpServer<T>(
  execute: (fixture: { endpoint: string; methods: string[]; calls: string[] }) => Promise<T>,
  interceptTool?: (request: RpcRequest, response: ServerResponse) => boolean,
): Promise<T> {
  const methods: string[] = [];
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(req.method === "GET" ? 405 : 202).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcRequest;
      methods.push(request.method ?? "notification");
      if (request.method === "tools/call") calls.push(String(request.params?.name ?? ""));
      if (request.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      if (request.method === "tools/call" && interceptTool?.(request, res)) return;
      const result: unknown = request.method === "initialize" ? {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "real-local-fixture", version: "1.0.0" },
      } : request.method === "tools/list" ? {
        tools: [{ name: "quotes.read", inputSchema: { type: "object", properties: {} } }],
      } : request.method === "tools/call" && request.params?.name === "quotes.read" ? {
        isError: false,
        content: [{ type: "text", text: "local test observation for TEST" }],
      } : null;
      const payload = result === null
        ? { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }
        : { jsonrpc: "2.0", id: request.id, result };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
    } catch {
      if (!res.destroyed) res.writeHead(400).end();
    }
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const addr = server.address() as AddressInfo;
    return await execute({ endpoint: `http://127.0.0.1:${addr.port}/mcp`, methods, calls });
  } finally {
    // A cancelled tool may still have a pending HTTP reply; force-close its
    // local fixture socket, not an external operation or a product connection.
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function fixture(endpoint: string) {
  const connection = {
    id: 41, userId: 7, organizationId: 9, sourceType: "mcp", connectorId: "mcp",
    name: "User-owned local test MCP", config: { endpoint, projectId: 77, allowedToolIds: "quotes.read" },
    credentialRef: null, status: "configured", statusDetail: null,
    lastTestedAt: null, lastHealthyAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  } as SourceConnection;
  const config: ExternalMcpServerConfig = {
    endpoint,
    policy: {
      projectId: 77, serverId: "source:41", allowedToolIds: ["quotes.read"],
      allowedResourcePrefixes: [], credentialRef: null,
      requireApprovalForTools: true, healthTimeoutMs: 4_000,
    },
  };
  const deps = {
    listConnections: async () => [connection],
    configForConnection: () => config,
    callTool: (server: ExternalMcpServerConfig, toolId: string, args: Record<string, unknown>, signal: AbortSignal) =>
      callExternalMcpTool(server, toolId, args, undefined, signal),
  };
  const input = { connectionId: 41, toolId: "quotes.read", arguments: { symbol: "TEST" } };
  const context = { userId: 7, organizationId: 9, projectId: 77 };
  return { connection, config, deps, input, context };
}

test("GM20 real loopback HTTP MCP tool succeeds exactly once after Project/source admission", { timeout: 15_000 }, async () => {
  await withLoopbackMcpServer(async ({ endpoint, methods, calls }) => {
    const f = fixture(endpoint);
    const blocked = invokeGovernedExternalMcpTool(
      { ...f.input, toolId: "admin.delete" }, f.context, new AbortController().signal, f.deps,
    );
    await assert.rejects(blocked, /outside Project policy/i);
    assert.deepEqual(calls, [], "allow-list failure cannot reach a real MCP server");

    const result = await invokeGovernedExternalMcpTool(f.input, f.context, new AbortController().signal, f.deps);
    const response = result.output as { content?: Array<{ type?: string; text?: string }> };
    assert.equal(response.content?.[0]?.text, "local test observation for TEST");
    assert.equal(result.deterministic, false);
    assert.deepEqual(result.sourceRefs, ["mcp-server:source:41", "mcp-tool:quotes.read"]);
    assert.deepEqual(calls, ["quotes.read"]);
    assert.equal(methods.includes("initialize"), true, "real SDK must negotiate over actual Node fetch");

    f.connection.status = "invalid";
    await assert.rejects(
      invokeGovernedExternalMcpTool(f.input, f.context, new AbortController().signal, f.deps),
      /invalid or no longer authorized/i,
    );
    await assert.rejects(
      invokeGovernedExternalMcpTool(f.input, { ...f.context, organizationId: 88 }, new AbortController().signal, f.deps),
      /unavailable in this tenant/i,
    );
    assert.deepEqual(calls, ["quotes.read"], "revoked or cross-tenant requests must not dispatch");
  });
});

test("GM20 Stop aborts a real in-flight MCP HTTP tool with no successful result", { timeout: 15_000 }, async () => {
  let enteredTool!: () => void;
  const toolEntered = new Promise<void>(resolve => { enteredTool = resolve; });
  await withLoopbackMcpServer(async ({ endpoint, calls }) => {
    const f = fixture(endpoint);
    const controller = new AbortController();
    const pending = invokeGovernedExternalMcpTool(f.input, f.context, controller.signal, f.deps);
    try {
      await Promise.race([
        toolEntered,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MCP tool did not enter HTTP dispatch")), 6_000)),
      ]);
      assert.deepEqual(calls, ["quotes.read"]);
      controller.abort();
      await assert.rejects(pending, /cancel|abort|request failed/i);
    } finally {
      controller.abort();
      // If handshake failed before tools/call, surface it through the
      // awaited assertion rather than letting an unhandled rejection escape.
      await pending.catch(() => undefined);
    }
  }, (_request, _response) => {
    enteredTool();
    return true; // deliberately withhold a response until Stop aborts fetch
  });
});
