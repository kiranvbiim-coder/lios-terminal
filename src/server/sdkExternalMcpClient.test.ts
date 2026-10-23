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
