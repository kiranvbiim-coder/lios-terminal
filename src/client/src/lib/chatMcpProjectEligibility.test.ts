import assert from "node:assert/strict";
import test from "node:test";
import { canInspectMcpInChat } from "./chatMcpProjectEligibility";

test("P3 only matching Project MCP connections appear inspectable within Chat", () => {
  const matching = { projectId: 41, status: "healthy" as const };
  assert.equal(canInspectMcpInChat(41, matching), true);
  assert.equal(canInspectMcpInChat(42, matching), false);
  assert.equal(canInspectMcpInChat(null, matching), false);
  assert.equal(canInspectMcpInChat(0, matching), false);
  assert.equal(canInspectMcpInChat(Number.NaN, matching), false);
  assert.equal(canInspectMcpInChat(41, { ...matching, projectId: null }), false);
  assert.equal(canInspectMcpInChat(41, { ...matching, status: "invalid" }), false);
  assert.equal(canInspectMcpInChat(41, { ...matching, status: "configured" }), true,
    "configured means inspect locally approved policy, not remotely verified or executable");
});
