import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SourceConnection } from "@shared/schema";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p3-mcp-verify-"));
const previousDir = process.env.LIMURIA_DATA_DIR;
process.env.LIMURIA_DATA_DIR = root;

const [
  { initDb, closeDb, getDb },
  { users },
  { createProject },
  { verifySavedMcpConnection },
] = await Promise.all([
  import("./db"),
  import("@shared/schema"),
  import("./projectStore"),
  import("./sourceConnectionService"),
]);

test("P3 MCP live verification checks saved owner and Project before any official SDK call", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousDir;
  });
  const [owner, stranger] = await Promise.all([
    getDb().insert(users).values({
      email: `mcp-probe-owner-${crypto.randomUUID()}@example.test`, passwordHash: "test",
      role: "internal_analyst", name: "Probe Owner",
    }).returning().then(rows => rows[0]),
    getDb().insert(users).values({
      email: `mcp-probe-other-${crypto.randomUUID()}@example.test`, passwordHash: "test",
      role: "internal_analyst", name: "Probe Other",
    }).returning().then(rows => rows[0]),
  ]);
  const ownerTenant = { userId: owner.id, organizationId: null, role: "internal_analyst" as const };
  const project = await createProject(ownerTenant, { name: "MCP verification" });
  const foreignProject = await createProject(
    { userId: stranger.id, organizationId: null, role: "internal_analyst" as const },
    { name: "Foreign MCP" },
  );
  const source = {
    id: 101, userId: owner.id, organizationId: null,
    sourceType: "mcp", credentialRef: null,
    config: {
      endpoint: "https://example.com/mcp",
      projectId: project.id,
      allowedToolIds: "reports.read,metrics.list",
      requireApprovalForTools: true,
    },
  } as unknown as SourceConnection;
  let probes = 0;
  const probe = async (config: { policy: { projectId: number; allowedToolIds: string[] } }) => {
    probes++;
    assert.equal(config.policy.projectId, project.id);
    assert.deepEqual(config.policy.allowedToolIds, ["reports.read", "metrics.list"]);
    return [{ name: "reports.read" }, { name: "metrics.list" }];
  };
  const verified = await verifySavedMcpConnection(source, ownerTenant, probe);
  assert.deepEqual(verified, { allowedToolCount: 2 });
  assert.equal(probes, 1, "no tools/call is required to verify an MCP server");

  await assert.rejects(
    () => verifySavedMcpConnection(
      { ...source, config: { ...source.config, projectId: foreignProject.id } }, ownerTenant, probe,
    ),
    /not found|not owned/i,
  );
  await assert.rejects(
    () => verifySavedMcpConnection(source, { ...ownerTenant, userId: stranger.id }, probe),
    /owner scope/i,
  );
  await assert.rejects(
    () => verifySavedMcpConnection({ ...source, organizationId: 55 }, ownerTenant, probe),
    /owner scope/i,
  );
  assert.equal(probes, 1, "foreign owner and Project are rejected before transport");

  await assert.rejects(
    () => verifySavedMcpConnection(source, ownerTenant, async () => {
      throw new Error("private bearer token must never be published");
    }),
    /private bearer token/,
  );
  assert.equal(probes, 1, "probe failure is not accepted as verified");
});

test("P3 MCP Verify route is genuinely live but never reports arbitrary tool execution", async () => {
  const { readFileSync } = await import("node:fs");
  const service = readFileSync(new URL("./sourceConnectionService.ts", import.meta.url), "utf8");
  assert.match(service, /connection\.sourceType === "mcp"/);
  assert.match(service, /const \{ allowedToolCount \} = await verifySavedMcpConnection/);
  assert.match(service, /Live MCP handshake and tools\/list succeeded/);
  assert.match(service, /No MCP tool was executed/);
  assert.doesNotMatch(service, /callExternalMcpTool/);
});
