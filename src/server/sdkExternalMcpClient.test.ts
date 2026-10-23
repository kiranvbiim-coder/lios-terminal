import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import assert from "node:assert/strict";
import test from "node:test";
import { boundMcpResponse, scopedMcpFetch, withOfficialMcpClient, MCP_MAX_RESPONSE_BYTES, LIOS_MCP_SDK_VERSION } from "./sdkExternalMcpClient";

test("GM20 official MCP transport denies missing owner credential before first request", async () => {
  let operationCalled = false;
  await assert.rejects(() => withOfficialMcpClient({
    endpoint: "https://8.8.8.8/mcp",
    policy: {
      projectId: 77,
      serverId: "source:41",
      allowedToolIds: ["quotes.read"],
      allowedResourcePrefixes: [],
      credentialRef: "vault:gm20-absent-revoked-source-secret-20261023",
      requireApprovalForTools: true,
      healthTimeoutMs: 2_000,
    },
  }, async () => { operationCalled = true; }), /credential is unavailable or revoked/i);
  assert.equal(operationCalled, false, "revoked MCP credentials must prevent client initialization");
});

test("D1 officially pinned client SDK preserves an exact transport budget", async () => {
  assert.equal(LIOS_MCP_SDK_VERSION, "2.3.1");
  const clean = new Response(JSON.stringify({ jsonrpc: "2.0", result: { ok: true } }), {
    headers: { "Content-Type": "application/json" },
  });
  assert.deepEqual(await boundMcpResponse(clean).json(), { jsonrpc: "2.0", result: { ok: true } });
  const oversized = new Response("anything", { headers: { "Content-Length": String(MCP_MAX_RESPONSE_BYTES + 1) } });
  assert.throws(() => boundMcpResponse(oversized), /read limit/i);
});

test("D1 streamed MCP responses are denied before exceeding total byte budget", async () => {
  const streamed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("first"));
      controller.enqueue(new TextEncoder().encode("next"));
      controller.close();
    },
  });
  const bounded = boundMcpResponse(new Response(streamed), 7);
  await assert.rejects(() => bounded.text(), /read limit/i);
});

test("D1 transport blocks redirecting SDK calls to unapproved hosts or paths before fetch", async () => {
  let invoked = false;
  const scoped = scopedMcpFetch("https://mcp.example.test/mcp", async () => {
    invoked = true;
    return new Response("impossible");
  });
  await assert.rejects(() => scoped("https://internal.example.test/"), /unapproved endpoint/i);
  await assert.rejects(() => scoped("https://mcp.example.test/secret"), /unapproved endpoint/i);
  await assert.rejects(() => scoped("https://attacker.test/mcp"), /unapproved endpoint/i);
  assert.equal(invoked, false, "a forged SDK endpoint cannot issue a network request");
});


test("GM20 SDK connects to user-owned desktop loopback MCP with zero redirects, but never in hosted mode", async () => {
  const previousHost = process.env.HOST;
  const previousDatabase = process.env.DATABASE_URL;
  const endpoint = "http://127.0.0.1:4318/mcp";
  const requests: Array<{ url: string; allowLocalhost: boolean | undefined; redirects: number | undefined }> = [];
  const fakeFetch = async (url: string, _options?: Omit<RequestInit, "redirect">,
    allowLocalhost?: boolean, redirects?: number) => {
    requests.push({ url, allowLocalhost, redirects });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "test", result: {} }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    delete process.env.HOST;
    process.env.DATABASE_URL = "postgres://user-desktop-local-db";
    const desktopFetch = scopedMcpFetch(endpoint, fakeFetch);
    const response = await desktopFetch(endpoint, { method: "POST" });
    assert.equal(response.ok, true);
    assert.deepEqual(requests, [{ url: endpoint, allowLocalhost: true, redirects: 0 }]);
    process.env.HOST = "0.0.0.0";
    await assert.rejects(() => desktopFetch(endpoint, { method: "POST" }), /source policy/i);
    assert.equal(requests.length, 1, "hosted mode must reject loopback before any network call");
  } finally {
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  }
});

test("D1 actual official SDK initializes, aggregates tool pages and invokes a tool through LiOS-scoped HTTP without network", async () => {
  const endpoint = "https://8.8.8.8/mcp";
  const methods: string[] = [];
  const fakeFetch = async (_endpoint: string, options?: Omit<RequestInit, "redirect">): Promise<Response> => {
    const verb = options?.method ?? "GET";
    if (verb === "GET") return new Response(null, { status: 405 });
    if (verb === "DELETE") return new Response(null, { status: 202 });
    // SDK v2 may send a streamed BodyInit, not just a plain string.
    // Reading the real body is essential: otherwise the mock silently
    // returns HTTP 202 and the official client waits for a reply forever.
    const raw = await new Response(options?.body).text();
    const request = JSON.parse(raw) as { jsonrpc?: string; id?: string | number; method?: string; params?: { cursor?: string; name?: string } };
    methods.push(request.method ?? "unknown");
    // JSON-RPC request ID 0 is valid and must receive a correlated response.
    // Treating it as a notification stalls the official SDK until timeout.
    if (request.id === undefined || request.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    let result: unknown;
    if (request.method === "server/discover") {
      // The modern-version probe must get a *correlated* method-not-found,
      // so the v2 SDK can safely select its legacy fallback.
      return new Response(JSON.stringify({
        jsonrpc: "2.0", id: request.id,
        error: { code: -32601, message: "Method not found" },
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (request.method === "initialize") {
      result = { protocolVersion: "2025-11-25", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "offline-test", version: "1" } };
    } else if (request.method === "tools/list") {
      result = request.params?.cursor
        ? { tools: [{ name: "quotes.read", inputSchema: { type: "object", properties: {} } }] }
        : { tools: [{ name: "filings.read", inputSchema: { type: "object", properties: {} } }], nextCursor: "page-2" };
    } else if (request.method === "tools/call") {
      result = { content: [{ type: "text", text: "known observation" }], isError: false };
    } else if (request.method === "resources/read") {
      result = { contents: [{ uri: "project://safe/report", text: "known source" }] };
    } else {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new Client({ name: "LiOS-Test", version: "1.0.0" }, {
    versionNegotiation: { mode: "auto", probe: { timeoutMs: 1000 } },
    listMaxPages: 16,
  });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: scopedMcpFetch(endpoint, fakeFetch),
  });
  try {
    await client.connect(transport, { timeout: 2500 });
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["filings.read", "quotes.read"]);
    const observation = await client.callTool({ name: "quotes.read", arguments: { symbol: "ABC" } });
    assert.equal(observation.isError, false);
    assert.equal(observation.content[0]?.type, "text");
    const resource = await client.readResource({ uri: "project://safe/report" });
    assert.equal(resource.contents[0]?.uri, "project://safe/report");
    assert.equal(methods.includes("server/discover"), true, "official MCP v2 probe must be exercised before legacy fallback");
    assert.equal(methods.filter(x => x === "tools/list").length, 2, "the official SDK must aggregate cursor pages");
    assert.equal(methods.includes("tools/call"), true);
    assert.equal(methods.includes("resources/read"), true);
  } finally {
    await client.close();
  }
});
