import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-phase3-mcp-chat-"));
const prior = process.env.LIMURIA_DATA_DIR;
process.env.LIMURIA_DATA_DIR = root;

const [
  { initDb, closeDb, getDb },
  { users, sourceConnections },
  { createProject },
  { chatMcpDiscoveryTool },
  { invokeConversationTool },
] = await Promise.all([
  import("./db"),
  import("@shared/schema"),
  import("./projectStore"),
  import("./chatMcpDiscoveryTool"),
  import("./conversationRuntime"),
]);

test("P3 configured MCP allowlist can be read by its owning Project in Chat without remote I/O", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
    if (prior === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = prior;
  });
  const [owner, other] = await Promise.all([
    getDb().insert(users).values({ email: `mcp-owner-${crypto.randomUUID()}@example.test`, passwordHash: "unused", role: "internal_admin", name: "MCP Owner" }).returning().then(x => x[0]),
    getDb().insert(users).values({ email: `mcp-other-${crypto.randomUUID()}@example.test`, passwordHash: "unused", role: "client_user", name: "Other User" }).returning().then(x => x[0]),
  ]);
  const ownerTenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ownerTenant, { name: "MCP Chat Access" });
  const otherProject = await createProject({ userId: other.id, organizationId: null, role: other.role }, { name: "Foreign Project" });
  const [connection] = await getDb().insert(sourceConnections).values({
    userId: owner.id,
    organizationId: null,
    connectorId: "custom_mcp",
    name: "Private MCP",
    sourceType: "mcp",
    credentialRef: "vault:mcp-secret",
    config: {
      endpoint: "https://private.example.test/mcp",
      projectId: project.id,
      allowedToolIds: "lookup.record,review.search",
      requireApprovalForTools: true,
    },
    status: "configured",
  }).returning();

  const call = {
    source: "agent" as const,
    userId: owner.id,
    tenant: ownerTenant,
    projectId: project.id,
    sourceScope: "my_data" as const,
    resourceTransmissionAllowed: true,
    requestId: crypto.randomUUID(),
  };
  const input = { connectionId: connection.id };
  const result = await invokeConversationTool("lios.external-mcp.allowed_tools", input, new AbortController().signal, call);
  const output = result.output as { allowedToolIds: string[]; remoteDiscoveryPerformed: boolean; sourceStatus: string; requiresExactUserApproval: boolean };
  assert.deepEqual(output.allowedToolIds, ["lookup.record", "review.search"]);
  assert.ok(result.summary.includes('"lookup.record"'));
  assert.ok(result.summary.includes('"review.search"'));
  assert.equal(output.remoteDiscoveryPerformed, false);
  assert.equal(output.requiresExactUserApproval, true);
  assert.equal(output.sourceStatus, "configured");
  assert.deepEqual(result.sourceRefs, [`source-connection:${connection.id}`]);
  assert.equal(JSON.stringify(result).includes("private.example.test"), false);
  assert.equal(JSON.stringify(result).includes("mcp-secret"), false);

  await assert.rejects(
    () => chatMcpDiscoveryTool.invoke(input, new AbortController().signal, { ...call, projectId: otherProject.id }),
    /not owned|not found|does not exist/i,
  );
  await assert.rejects(
    () => chatMcpDiscoveryTool.invoke(input, new AbortController().signal, { ...call, resourceTransmissionAllowed: false }),
    /transmission|source/i,
  );
  await assert.rejects(
    () => chatMcpDiscoveryTool.invoke(input, new AbortController().signal, {
      ...call,
      researchSourcePolicy: { mode: "only_refs", allowedSourceRefs: [], providerAllow: [], providerDeny: [] },
    }),
    /excluded/i,
  );
  await assert.rejects(
    () => chatMcpDiscoveryTool.invoke(input, new AbortController().signal, { ...call, userId: other.id, tenant: { userId: other.id, organizationId: null, role: other.role } }),
    /not owned|not found|does not exist/i,
  );

  await getDb().update(sourceConnections).set({ status: "invalid" }).where(eq(sourceConnections.id, connection.id));
  await assert.rejects(
    () => chatMcpDiscoveryTool.invoke(input, new AbortController().signal, call),
    /not available/i,
  );
});

test("P3 MCP disclosure descriptor is safe-auto read-only, not remote execution", () => {
  assert.equal(chatMcpDiscoveryTool.id, "lios.external-mcp.allowed_tools");
  assert.equal(chatMcpDiscoveryTool.permissionClass, "safe_auto");
  assert.equal(chatMcpDiscoveryTool.access, "read");
  assert.equal(chatMcpDiscoveryTool.sideEffect, "none");
  assert.equal(chatMcpDiscoveryTool.replaySafe, true);
  assert.equal(chatMcpDiscoveryTool.inputSchema.safeParse({ connectionId: 12, approved: true }).success, false);
});
