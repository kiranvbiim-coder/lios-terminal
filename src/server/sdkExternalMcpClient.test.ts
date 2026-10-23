import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import assert from "node:assert/strict";
import test from "node:test";
import { boundMcpResponse, scopedMcpFetch, MCP_MAX_RESPONSE_BYTES, LIOS_MCP_SDK_VERSION } from "./sdkExternalMcpClient";

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
    if (!request.id || request.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    let result: unknown;
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
  const client = new Client({ name: "LiOS-Test", version: "1.0.0" });
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
    assert.equal(methods.filter(x => x === "tools/list").length, 2, "the official SDK must aggregate cursor pages");
    assert.equal(methods.includes("tools/call"), true);
    assert.equal(methods.includes("resources/read"), true);
  } finally {
    await client.close();
  }
});
