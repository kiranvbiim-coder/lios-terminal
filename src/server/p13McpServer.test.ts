import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import type { ToolAdapter, RuntimeComponentDescriptor } from "@shared/runtimeContracts";
import { P13McpServer } from "./p13McpServer";

function descriptor(): RuntimeComponentDescriptor {
  return {
    contractVersion: "1",
    id: "plugin.p13.mcp.echo",
    kind: "tool",
    name: "Echo",
    version: "1.0.0",
    lifecycle: "external",
    executionScopes: ["external_process"],
    capabilities: ["plugin.mcp.echo"],
    permissions: [],
    runtimePackId: null,
    replaceable: true,
    source: { origin: "external", importedPaths: [], modified: false },
  };
}

function server(rightsApprovedToolIds = ["plugin.p13.mcp.echo"]) {
  const registry = new RuntimeRegistry();
  const tool: ToolAdapter = {
    descriptor: descriptor(),
    invoke: async (input) => ({ echoed: input }),
  };
  registry.register(tool);
  return new P13McpServer(registry, {
    exposure: {
      version: "1",
      exposedTools: ["plugin.p13.mcp.echo"],
      exposedResources: [],
      filesystemExposure: false,
      secretExposure: false,
      internalStateExposure: false,
      tenantScoped: true,
    },
    organizationId: 9,
    allowedProjectIds: [77],
    rightsApprovedToolIds,
    requireExplicitApproval: true,
  });
}

test("P13 MCP server lists rights-cleared tools but never treats caller approval IDs as authority", async () => {
  const registry = new RuntimeRegistry();
  let invoked = false;
  registry.register({
    descriptor: descriptor(),
    invoke: async (input) => {
      invoked = true;
      return { echoed: input };
    },
  });
  const instance = new P13McpServer(registry, {
    exposure: {
      version: "1",
      exposedTools: ["plugin.p13.mcp.echo"],
      exposedResources: [],
      filesystemExposure: false,
      secretExposure: false,
      internalStateExposure: false,
      tenantScoped: true,
    },
    organizationId: 9,
    allowedProjectIds: [77],
    rightsApprovedToolIds: ["plugin.p13.mcp.echo"],
    requireExplicitApproval: true,
  });
  const listed = await instance.handle(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { userId: 4, organizationId: 9, projectId: 77 },
  );
  assert.deepEqual((listed.result as { tools: Array<{ name: string }> }).tools.map((item) => item.name), [
    "plugin.p13.mcp.echo",
  ]);
  const called = await instance.handle(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "plugin.p13.mcp.echo", arguments: { value: 42 } },
    },
    { userId: 4, organizationId: 9, projectId: 77 },
  );
  assert.equal(called.error?.code, -32004);
  assert.equal(invoked, false);
});

test("P13 MCP server fails closed for missing data-rights approval", async () => {
  const instance = server([]);
  const response = await instance.handle(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "plugin.p13.mcp.echo", arguments: {} },
    },
    { userId: 4, organizationId: 9, projectId: 77 },
  );
  assert.equal(response.error?.code, -32003);
});

test("P13 MCP server requires project scope and canonical approval", async () => {
  const instance = server();
  const wrongProject = await instance.handle(
    { jsonrpc: "2.0", id: 4, method: "tools/list" },
    { userId: 4, organizationId: 9, projectId: 78 },
  );
  assert.equal(wrongProject.error?.code, -32001);

  const unapproved = await instance.handle(
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "plugin.p13.mcp.echo", arguments: {} },
    },
    { userId: 4, organizationId: 9, projectId: 77 },
  );
  assert.equal(unapproved.error?.code, -32004);
});


test("P13 MCP server never invokes a tool or reflects internal data without canonical approval", async () => {
  const registry = new RuntimeRegistry();
  let invoked = false;
  const tool: ToolAdapter = {
    descriptor: descriptor(),
    invoke: async () => {
      invoked = true;
      throw new Error("api_key=super-secret internal path /Users/example/private");
    },
  };
  registry.register(tool);
  const instance = new P13McpServer(registry, {
    exposure: {
      version: "1",
      exposedTools: ["plugin.p13.mcp.echo"],
      exposedResources: [],
      filesystemExposure: false,
      secretExposure: false,
      internalStateExposure: false,
      tenantScoped: true,
    },
    organizationId: 9,
    allowedProjectIds: [77],
    rightsApprovedToolIds: ["plugin.p13.mcp.echo"],
    requireExplicitApproval: true,
  });
  const response = await instance.handle(
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "plugin.p13.mcp.echo", arguments: {} },
    },
    { userId: 4, organizationId: 9, projectId: 77 },
  );
  assert.equal(response.error?.code, -32004);
  assert.equal(response.error?.message, "Tool requires canonical governed approval.");
  assert.equal(invoked, false);
  assert.equal(JSON.stringify(response).includes("super-secret"), false);
});

test("P13 MCP server rejects requests from a different organization than its bound tenant", async () => {
  const instance = server();
  const crossTenant = await instance.handle(
    { jsonrpc: "2.0", id: 7, method: "tools/list" },
    { userId: 4, organizationId: 999, projectId: 77 },
  );
  assert.equal(crossTenant.error?.code, -32005);

  const crossTenantCall = await instance.handle(
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "plugin.p13.mcp.echo", arguments: {} },
    },
    { userId: 4, organizationId: 999, projectId: 77 },
  );
  assert.equal(crossTenantCall.error?.code, -32005);
});
