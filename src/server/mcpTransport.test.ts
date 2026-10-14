import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { GovernedToolApprovalRequiredError } from "./governedTools";
import { invokeMCPTool, type MCPToolHandler } from "./mcpTransport";

const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function context() {
  return {
    requestId: REQUEST_ID,
    userId: 4,
    organizationId: 9,
    role: "internal_analyst",
    projectId: null,
  };
}

function handler(input: {
  permissionClass?: "safe_auto" | "user_confirm";
  allowedRoles?: readonly string[];
  calls?: string[];
} = {}): MCPToolHandler {
  const permissionClass = input.permissionClass ?? "safe_auto";
  return {
    descriptor: {
      id: "lios.test.mcp",
      label: "MCP test",
      kind: "mcp",
      permissionClass,
      allowedRoles: input.allowedRoles ?? ["internal_analyst"],
      access: permissionClass === "safe_auto" ? "read" : "write",
      sideEffect: permissionClass === "safe_auto" ? "none" : "internal_write",
      replaySafe: permissionClass === "safe_auto",
      inputSchema: z.object({ symbol: z.string().min(1) }).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      maxOutputBytes: 1024,
      cancel: null,
    },
    invoke: async () => {
      input.calls?.push("invoked");
      return { ok: true };
    },
  };
}

test("MCP safe-auto tools execute through governed metadata and return request/tenant attribution", async () => {
  const calls: string[] = [];
  const result = await invokeMCPTool("lios.test.mcp", { symbol: "AAPL" }, context(), [handler({ calls })]);
  assert.deepEqual(result.output, { ok: true });
  assert.equal(result.attribution.requestId, REQUEST_ID);
  assert.equal(result.attribution.toolId, "lios.test.mcp");
  assert.equal(result.attribution.organizationId, 9);
  assert.equal(result.attribution.inputHash.length, 64);
  assert.equal(result.attribution.outputHash.length, 64);
  assert.deepEqual(calls, ["invoked"]);
});

test("MCP confirm tools ignore approval-shaped caller fields and never invoke without canonical live authority", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => invokeMCPTool(
      "lios.test.mcp",
      { symbol: "AAPL" },
      {
        ...context(),
        approvedTools: ["lios.test.mcp"],
        approved: true,
        approval: { scope: "once" },
      } as never,
      [handler({ permissionClass: "user_confirm", calls })],
    ),
    GovernedToolApprovalRequiredError,
  );
  assert.deepEqual(calls, []);
});

test("MCP transport enforces governed role and input-schema boundaries", async () => {
  const roleCalls: string[] = [];
  await assert.rejects(
    () => invokeMCPTool("lios.test.mcp", { symbol: "AAPL" }, context(), [handler({ allowedRoles: ["internal_admin"], calls: roleCalls })]),
    /denied|not allowed/i,
  );
  assert.deepEqual(roleCalls, []);

  const inputCalls: string[] = [];
  await assert.rejects(
    () => invokeMCPTool("lios.test.mcp", { symbol: "", ownerUserId: 999 }, context(), [handler({ calls: inputCalls })]),
    /input did not satisfy/i,
  );
  assert.deepEqual(inputCalls, []);
});

test("MCP transport preserves the canonical run signal and refuses a pre-aborted invocation", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  controller.abort(new Error("private canonical cancellation cause"));

  await assert.rejects(
    () => invokeMCPTool(
      "lios.test.mcp",
      { symbol: "AAPL" },
      { ...context(), signal: controller.signal },
      [handler({ calls })],
    ),
    /abort|cancel/i,
  );
  assert.deepEqual(calls, []);
});
