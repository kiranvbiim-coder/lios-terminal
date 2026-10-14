import assert from "node:assert/strict";
import test from "node:test";
import { getConversationTool } from "./conversationRuntime";

test("external MCP is an approval-bound external governed agent tool", () => {
  const tool = getConversationTool("lios.external-mcp.call");
  assert.ok(tool);
  assert.equal(tool.permissionClass, "user_confirm");
  assert.equal(tool.access, "write");
  assert.equal(tool.sideEffect, "external");
  assert.equal(tool.replaySafe, false);
  assert.equal(tool.maxOutputBytes, 256 * 1024);
  assert.equal(tool.cancel, null);

  assert.equal(tool.inputSchema.safeParse({
    connectionId: 41,
    toolId: "quotes.read",
    arguments: { symbol: "AAPL" },
  }).success, true);
  assert.equal(tool.inputSchema.safeParse({
    connectionId: 41,
    toolId: "quotes.read",
    arguments: {},
    approved: true,
  }).success, false);
});


test("external MCP descriptor rejects non-agent callers before any transport or source resolution", async () => {
  const tool = getConversationTool("lios.external-mcp.call");
  assert.ok(tool);
  await assert.rejects(
    () => tool.invoke(
      { connectionId: 41, toolId: "quotes.read", arguments: {} },
      new AbortController().signal,
      {
        source: "workflow",
        tenant: { userId: 7, organizationId: 9, role: "internal_analyst" },
        projectId: 77,
      },
    ),
    /canonical agent dispatch ledger/i,
  );
});
