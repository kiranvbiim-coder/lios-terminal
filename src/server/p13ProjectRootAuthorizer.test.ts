import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";

// Real PGlite database under an isolated data root; db.ts binds its location at module evaluation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-root-authorizer-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations } = await import("@shared/schema");
const { createProject, trashProject } = await import("./projectStore");
const { createP13PluginFileAuxiliaryHandler } = await import("./p13PluginFileBroker");
const { createProjectRootFileReadAuthorizer, ensureProjectWorkspaceRoot, projectWorkspaceRoot } = await import("./p13ProjectRootAuthorizer");

const componentId = "plugin.files.echo";
const executionRequestId = "22222222-2222-4222-8222-222222222222";
const manifest = liosPluginManifestV1Schema.parse({
  apiVersion: "1", id: "com.example.rootauth", name: "Root auth", version: "1.0.0", publisher: "Example",
  lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null }, runtime: { kind: "node_process", entrypoint: "plugin.mjs" },
  dependencies: [], permissions: ["filesystem.project.read"], connectors: [],
  tools: [{ id: "echo", componentId, name: "Echo", capabilities: ["plugin.file"] }], artifacts: [], agents: [], integrity: null, signer: null,
});

test("Project root authorizer binds plugin file reads to the live owner, organization and canonical root", async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const [orgA, orgB] = await getDb().insert(organizations).values([
    { name: "Root auth A", slug: `root-a-${crypto.randomUUID()}` }, { name: "Root auth B", slug: `root-b-${crypto.randomUUID()}` },
  ]).returning();
  const [owner, intruderSameOrg, intruderOtherOrg] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "x", name: "Owner", role: "internal_analyst" as const, organizationId: orgA!.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "x", name: "Same org", role: "internal_analyst" as const, organizationId: orgA!.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "x", name: "Other org", role: "internal_analyst" as const, organizationId: orgB!.id },
  ]).returning();
  const ownerCtx = { userId: owner!.id, organizationId: orgA!.id, role: owner!.role };
  const project = await createProject(ownerCtx, { name: "Plugin readable" });
  const otherProject = await createProject(ownerCtx, { name: "Another Project" });
  const root = ensureProjectWorkspaceRoot(orgA!.id, project.id);
  const otherRoot = ensureProjectWorkspaceRoot(orgA!.id, otherProject.id);
  fs.writeFileSync(path.join(root, "input.txt"), "owned bytes");
  fs.writeFileSync(path.join(otherRoot, "input.txt"), "a different Project");

  const authorize = createProjectRootFileReadAuthorizer();
  const as = (userId: number, organizationId: number, projectId: number): RuntimeExecutionContext => ({
    requestId: "11111111-1111-4111-8111-111111111111", userId, organizationId, projectId, sessionId: null,
    conversationId: null, activeObjectId: null, dataClassification: "private", approvedActions: [],
  });
  const call = (context: RuntimeExecutionContext, grantedRoot = root, scope: "project" | "user_selected" = "project", rootIndex = 0) =>
    authorize({ context, componentId, scope, root: grantedRoot, rootIndex });

  assert.equal(await call(as(owner!.id, orgA!.id, project.id)), true, "the owner may read the canonical Project root");
  assert.equal(await call(as(intruderSameOrg!.id, orgA!.id, project.id)), false, "another user in the same organization is denied");
  assert.equal(await call(as(intruderOtherOrg!.id, orgB!.id, project.id)), false, "a user in another organization is denied");
  assert.equal(await call(as(owner!.id, orgB!.id, project.id)), false, "the right owner under the wrong organization is denied");
  assert.equal(await call(as(owner!.id, orgA!.id, project.id), otherRoot), false, "another Project's root is never granted");
  assert.equal(await call(as(owner!.id, orgA!.id, project.id), path.join(root, "nested-not-root")), false, "a missing or non-canonical root is denied");
  assert.equal(await call(as(owner!.id, orgA!.id, project.id), "relative/root"), false, "relative roots are denied");
  assert.equal(await call(as(owner!.id, orgA!.id, project.id), root, "user_selected"), false, "user-selected roots stay denied");
  assert.equal(await call(as(owner!.id, orgA!.id, project.id), root, "project", 1), false, "only root index 0 is a Project root");
  for (const value of [null, 0, -1, 0.5, Number.NaN]) {
    assert.equal(await call({ ...as(owner!.id, orgA!.id, project.id), organizationId: value as never }), false, `organization ${String(value)}`);
    assert.equal(await call({ ...as(owner!.id, orgA!.id, project.id), projectId: value as never }), false, `project ${String(value)}`);
  }
  assert.equal(await call(as(owner!.id, orgA!.id, 999_999), projectWorkspaceRoot(orgA!.id, 999_999)), false, "an unknown Project is denied");

  // End to end through the real broker: bytes flow, then revocation takes effect on the very next read.
  let active = true;
  // The broker compares binding identity before and after a read, so one stable object models one live execution.
  const binding = { componentId, context: as(owner!.id, orgA!.id, project.id) };
  const handler = createP13PluginFileAuxiliaryHandler({
    manifest,
    grant: { projectRoot: root, userSelectedReadRoots: [], userSelectedWriteRoots: [], networkHosts: [], allowProcessSpawn: false },
    lookupExecution: (id) => (id === executionRequestId && active ? binding : null),
    authorizeFileRead: authorize,
  });
  const request = {
    protocol: "lios-plugin-broker/1", kind: "filesystem.read", requestId: "33333333-3333-4333-8333-333333333333",
    executionRequestId, componentId, scope: "project", rootIndex: 0, relativePath: "input.txt", maxBytes: 128,
  } as const;
  const allowed = await handler(request) as { kind: string; bodyBase64: string };
  assert.equal(allowed.kind, "filesystem.response", JSON.stringify(allowed));
  assert.equal(Buffer.from(allowed.bodyBase64, "base64").toString(), "owned bytes");
  await trashProject(ownerCtx, project.id);
  const revoked = await handler(request) as { kind: string; code: string; bodyBase64?: string };
  assert.equal(revoked.kind, "filesystem.error");
  assert.equal(revoked.code, "filesystem_execution_scope_invalid", "a trashed Project revokes access on the next read");
  assert.equal(revoked.bodyBase64, undefined, "no bytes leave after revocation");
  active = false;
});

test("the canonical Project root is derived only from positive authenticated identifiers", () => {
  for (const [org, project] of [[0, 1], [1, 0], [-1, 1], [1, 1.5], [Number.NaN, 1]] as const) {
    assert.throws(() => projectWorkspaceRoot(org, project), /positive organization and Project ids/);
  }
  const root = projectWorkspaceRoot(7, 9);
  assert.ok(root.endsWith(path.join("project-workspaces", "7", "9")));
});
