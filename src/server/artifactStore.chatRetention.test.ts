import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import type { ConversationArtifactDraft } from "@shared/conversationRuntime";
import { artifactContentSchema } from "@shared/artifactContracts";
import { trustManifestSchema } from "@shared/trustContracts";
import type { TenantContext } from "./tenantContext";

// db.ts captures the data root at module load; this test deliberately imports it after isolation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-chat-artifacts-"));
process.env.LIOS_DATA_ROOT = dataDir;
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations, projects, projectArtifacts, projectArtifactVersions, projectLedgerEvents } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat, promoteQuickChatToProject, trashProjectChat, restoreTrashedProjectChat, permanentlyDeleteProjectChat } = await import("./projectChatStore");
const {
  createArtifact, persistConversationDraft, keepConversationDraft, getArtifact, getArtifactVersion,
  createArtifactVersion, listArtifactVersions, listChatArtifacts, listProjectArtifacts,
  createArtifactReference, listArtifactReferences, forkArtifact, trashArtifact, restoreTrashedArtifact,
  keepConversationDraftVersion,
} = await import("./artifactStore");
const { getArtifactExportPlan } = await import("./artifactExport");
const { inspectArtifact } = await import("./artifactInspection");
const { registerArtifactRoutes } = await import("./artifactRoutes");
const { proposeArtifactComposition } = await import("./artifactComposition");
const { p7ResearchBranchingService } = await import("./p7ResearchBranching");

function draft(): ConversationArtifactDraft {
  return {
    schemaVersion: "1", artifactId: crypto.randomUUID(), artifactType: "report", title: "Standalone retained work",
    projectId: null, sourceRefs: ["user:explicit-test-input"], executionReceiptIds: [], persistence: "chat_candidate",
    data: { kind: "report", blocks: [{ id: "summary", type: "paragraph", text: "An explicit test assumption, not a provider fact.", attrs: {} }], sections: [] },
  };
}

test("Quick Chat uses canonical durable P4 ownership without manufacturing a Project", { timeout: 90_000 }, async t => {
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  await initDb();
  const [owner, stranger] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Chat owner", role: "internal_analyst" as const, organizationId: null },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Other owner", role: "internal_analyst" as const, organizationId: null },
  ]).returning();
  const tenant: TenantContext = { userId: owner.id, organizationId: null, role: owner.role };
  const foreign: TenantContext = { userId: stranger.id, organizationId: null, role: stranger.role };
  const [org] = await getDb().insert(organizations).values({ name: "Isolated artifact organization", slug: `chat-artifacts-${crypto.randomUUID()}` }).returning();
  const wrongOrg = { ...tenant, organizationId: org.id };
  const quick = await createProjectChat(tenant, { scope: "quick" });
  const otherQuick = await createProjectChat(tenant, { scope: "quick" });
  const foreignQuick = await createProjectChat(foreign, { scope: "quick" });
  const input = { projectId: null, owningChatId: quick.id, requestId: crypto.randomUUID(), draft: draft() };
  const projectsBefore = await getDb().select({ id: projects.id }).from(projects);
  const retained = await persistConversationDraft(tenant, input);

  await t.test("save and retry share one canonical identity/version and Chat Ledger", async () => {
    const retries = await Promise.all(Array.from({ length: 4 }, () => persistConversationDraft(tenant, structuredClone(input))));
    assert.ok(retries.every(result => result.artifact.id === retained.artifact.id && result.version.id === retained.version.id));
    assert.equal(retained.artifact.projectId, null);
    assert.equal(retained.artifact.owningChatId, quick.id);
    assert.deepEqual(await getDb().select({ id: projects.id }).from(projects), projectsBefore);
    assert.equal((await listChatArtifacts(tenant, quick.id)).length, 1);
    const ledger = await getDb().select().from(projectLedgerEvents).where(eq(projectLedgerEvents.chatId, quick.id));
    assert.equal(ledger.filter(row => row.payload.artifactId === retained.artifact.id).length, 1);
    assert.ok(ledger.every(row => row.projectId === null));
    const other = await persistConversationDraft(tenant, { ...input, owningChatId: otherQuick.id });
    assert.notEqual(other.artifact.id, retained.artifact.id, "same request/draft in different Chats must not collide");
    await assert.rejects(persistConversationDraft(tenant, { ...input, draft: { ...input.draft, title: "Changed replay" } }), /different content/);
  });

  await t.test("reviewed draft append refuses a stale acknowledged target revision", async () => {
    const initial = await persistConversationDraft(tenant, { ...input, requestId: crypto.randomUUID(), draft: draft() });
    const update = { ...draft(), title: "Reviewed update" };
    const saved = await keepConversationDraftVersion(tenant, { artifactId: initial.artifact.id, baseVersion: 1, draft: update });
    assert.equal(saved.version.version, 2);
    await assert.rejects(keepConversationDraftVersion(tenant, {
      artifactId: initial.artifact.id, baseVersion: 1, draft: { ...update, title: "Stale acknowledgment" },
    }));
    assert.equal((await getArtifact(tenant, initial.artifact.id)).headVersion, 2);
  });

  await t.test("real HTTP Chat routes derive ownership and reopen exact P4 revisions", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { isAuthenticated: () => true, user: req.headers["x-test-owner"] === "foreign" ? stranger : owner });
      next();
    });
    registerArtifactRoutes(app);
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      const saved = await fetch(`${base}/api/chats/${quick.id}/artifacts/keep-draft`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft: draft(), requestId: crypto.randomUUID(), trustManifest: null, dependencyRefs: ["user:explicit-test-input"], refreshSpec: null }),
      });
      assert.equal(saved.status, 200);
      const body: unknown = await saved.json();
      assert.ok(body && typeof body === "object" && "artifact" in body && body.artifact && typeof body.artifact === "object" && "id" in body.artifact && typeof body.artifact.id === "string");
      const artifactId = body.artifact.id;
      const reopened = await fetch(`${base}/api/artifacts/${encodeURIComponent(artifactId)}?version=1`);
      assert.equal(reopened.status, 200);
      const foreignRead = await fetch(`${base}/api/artifacts/${encodeURIComponent(artifactId)}?version=1`, { headers: { "x-test-owner": "foreign" } });
      assert.equal(foreignRead.status, 404);
      const foreignKeep = await fetch(`${base}/api/chats/${quick.id}/artifacts/keep-draft`, {
        method: "POST", headers: { "content-type": "application/json", "x-test-owner": "foreign" }, body: JSON.stringify({ draft: draft() }),
      });
      assert.equal(foreignKeep.status, 404);
      const list = await fetch(`${base}/api/chats/${quick.id}/artifacts?status=active`);
      assert.equal(list.status, 200);
      const listed: unknown = await list.json();
      assert.ok(Array.isArray(listed) && listed.some(item => item.id === artifactId && item.projectId === null && item.owningChatId === quick.id));
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  await t.test("owner/org/Chat spoofing and Temporary/no-owner writes fail before canonical writes", async () => {
    const before = await getDb().select({ id: projectArtifacts.id }).from(projectArtifacts);
    for (const ctx of [foreign, wrongOrg]) {
      await assert.rejects(getArtifact(ctx, retained.artifact.id), /not found|not owned/);
      await assert.rejects(getArtifactVersion(ctx, retained.artifact.id, 1), /not found|not owned/);
      await assert.rejects(listChatArtifacts(ctx, quick.id), /not found|boundary/);
      await assert.rejects(persistConversationDraft(ctx, input), /not found|boundary/);
      await assert.rejects(createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: 1, content: artifactContentSchema.parse(retained.version.content) }), /not found|not owned/);
      await assert.rejects(getArtifactExportPlan(ctx, retained.artifact.id, 1), /not found|not owned/);
      await assert.rejects(createArtifactReference(ctx, { artifactId: retained.artifact.id, targetType: "chat", targetRef: String(quick.id) }), /not found|not owned/);
    }
    await assert.rejects(persistConversationDraft(tenant, { ...input, owningChatId: foreignQuick.id }), /not found|boundary/);
    await assert.rejects(persistConversationDraft(tenant, { ...input, owningChatId: undefined }), /persistent Chat/);
    await assert.rejects(persistConversationDraft(tenant, { ...input, draft: { ...input.draft, persistence: "ephemeral" } }), /Temporary/);
    await assert.rejects(keepConversationDraft(tenant, { ...input, draft: { ...input.draft, persistence: "ephemeral" } }), /Temporary/);
    await assert.rejects(createArtifact(tenant, { projectId: null, content: artifactContentSchema.parse({ kind: "report", blocks: [], sections: [] }), title: "No owner" }), /persistent Chat/);
    await assert.rejects(createArtifactReference(tenant, { artifactId: retained.artifact.id, targetType: "chat", targetRef: String(otherQuick.id) }), /boundary/);
    assert.deepEqual(await getDb().select({ id: projectArtifacts.id }).from(projectArtifacts), before);
  });

  await t.test("Chat composition preserves Chat custody while Project-only attachments and research branching refuse Quick", async () => {
    const selected = await persistConversationDraft(tenant, { ...input, requestId: crypto.randomUUID(), draft: draft() });
    const proposal = await proposeArtifactComposition(tenant, retained.artifact.id, {
      baseVersion: 1, kind: "artifact", sourceId: selected.artifact.id, sourceVersion: 1,
    });
    assert.equal(proposal.block.attrs.sourceArtifactId, selected.artifact.id);
    const outside = await persistConversationDraft(tenant, { ...input, owningChatId: otherQuick.id, requestId: crypto.randomUUID(), draft: draft() });
    await assert.rejects(proposeArtifactComposition(tenant, retained.artifact.id, {
      baseVersion: 1, kind: "artifact", sourceId: outside.artifact.id, sourceVersion: 1,
    }), /different Artifact ownership context/);
    await assert.rejects(proposeArtifactComposition(tenant, retained.artifact.id, {
      baseVersion: 1, kind: "image", sourceId: crypto.randomUUID(),
    }), /owning Project/);
    await assert.rejects(p7ResearchBranchingService.createBranch(tenant, { artifactId: retained.artifact.id, baseVersion: 1 }), /owning Project/);
  });
  await t.test("export rejects explicit revoked evidence without blocking a separate authorized revision", async () => {
    const manifest = trustManifestSchema.parse({
      schemaVersion: "1", trustId: crypto.randomUUID(), requestId: crypto.randomUUID(),
      generatedAt: new Date().toISOString(), sourceScope: "my_data",
      summary: { freshness: "manual", quality: "high", confidence: "high", conflictState: "none", evidenceCoveragePct: 100, sourceCount: 1, receiptCount: 0, missingCount: 0 },
      evidence: [{ evidenceId: crypto.randomUUID(), sourceRef: "user:explicit-test-input", providerLabel: "Owned test input",
        kind: "manual", observedAt: new Date().toISOString(), freshness: "manual", quality: "high", confidence: "high", access: { state: "rights-revoked" } }],
    });
    const denied = await persistConversationDraft(tenant, { ...input, requestId: crypto.randomUUID(), draft: draft(), trustManifest: manifest });
    await assert.rejects(getArtifactExportPlan(tenant, denied.artifact.id, 1), (cause: unknown) =>
      cause instanceof Error && "status" in cause && cause.status === 403);
    const allowed = await persistConversationDraft(tenant, { ...input, requestId: crypto.randomUUID(), draft: draft(),
      trustManifest: { ...manifest, trustId: crypto.randomUUID(), evidence: manifest.evidence.map(item => ({ ...item, access: { ...item.access!, state: "allowed" } })) } });
    assert.equal((await getArtifactExportPlan(tenant, allowed.artifact.id, 1)).contentHash, allowed.version.contentHash);
  });

  await t.test("reopen, immutable revisions, references, export and inspection use the original identity", async () => {
    await closeDb();
    await initDb();
    assert.deepEqual(await getArtifact(tenant, retained.artifact.id), retained.artifact);
    assert.deepEqual(await getArtifactVersion(tenant, retained.artifact.id, 1), retained.version);
    const version2 = await createArtifactVersion(tenant, {
      artifactId: retained.artifact.id, baseVersion: 1,
      content: artifactContentSchema.parse({ kind: "report", blocks: [{ id: "summary", type: "paragraph", text: "Explicit revision two", attrs: {} }], sections: [] }),
    });
    assert.equal(version2.version, 2);
    assert.equal(version2.parentVersionId, retained.version.id);
    assert.equal((await listArtifactVersions(tenant, retained.artifact.id)).length, 2);
    assert.deepEqual((await getArtifactVersion(tenant, retained.artifact.id, 1)).content, retained.version.content);
    await createArtifactReference(tenant, { artifactId: retained.artifact.id, version: 2, targetType: "chat", targetRef: String(quick.id) });
    assert.equal((await listArtifactReferences(tenant, retained.artifact.id))[0].projectId, null);
    assert.equal((await getArtifactExportPlan(tenant, retained.artifact.id, 2)).contentHash, version2.contentHash);
    const inspected = await inspectArtifact(tenant, { artifactId: retained.artifact.id, version: 2, contentHash: version2.contentHash });
    assert.equal(inspected.projectId, null);
    const fork = await forkArtifact(tenant, { artifactId: retained.artifact.id, version: 2 });
    assert.equal(fork.artifact.projectId, null);
    assert.equal(fork.artifact.owningChatId, quick.id);
    await trashArtifact(tenant, fork.artifact.id);
    assert.ok((await listChatArtifacts(tenant, quick.id, { trash: true })).some(row => row.id === fork.artifact.id));
    await restoreTrashedArtifact(tenant, fork.artifact.id);
    await closeDb();
    await initDb();
    assert.equal((await getArtifact(tenant, retained.artifact.id)).headVersion, 2);
  });

  await t.test("explicit Project adoption preserves identity and migrates references; ordinary Project retention remains compatible", async () => {
    const project = await createProject(tenant, { name: "Explicitly selected Project" });
    await promoteQuickChatToProject(tenant, quick.id, project.id);
    assert.equal((await getArtifact(tenant, retained.artifact.id)).projectId, project.id);
    assert.equal((await getArtifact(tenant, retained.artifact.id)).owningChatId, null);
    assert.equal((await listArtifactReferences(tenant, retained.artifact.id))[0].projectId, project.id);
    assert.ok((await listProjectArtifacts(tenant, project.id)).some(row => row.id === retained.artifact.id));
    assert.equal((await listChatArtifacts(tenant, quick.id)).length, 0, "adoption transfers lifecycle ownership away from the originating Chat");
    const projectDraft = { ...draft(), projectId: project.id, persistence: "project_candidate" as const };
    const kept = await persistConversationDraft(tenant, { projectId: project.id, owningChatId: quick.id, requestId: crypto.randomUUID(), draft: projectDraft });
    assert.equal(kept.artifact.projectId, project.id);
    assert.equal(kept.artifact.owningChatId, null);
    await assert.rejects(persistConversationDraft(tenant, { projectId: project.id, owningChatId: otherQuick.id, requestId: crypto.randomUUID(), draft: projectDraft }), /boundary/);
    await createArtifactReference(tenant, { artifactId: kept.artifact.id, version: 1, targetType: "chat", targetRef: String(quick.id) });
    await trashProjectChat(tenant, quick.id);
    assert.equal((await getArtifact(tenant, retained.artifact.id)).projectId, project.id, "Chat trash cannot hide adopted Project work");
    assert.equal((await getArtifactVersion(tenant, retained.artifact.id, 2)).version, 2);
    assert.equal((await getArtifact(tenant, kept.artifact.id)).projectId, project.id, "new Project outputs cannot depend on Chat lifetime");
    await permanentlyDeleteProjectChat(tenant, quick.id);
    for (const artifact of [retained.artifact, kept.artifact]) {
      assert.equal((await getArtifact(tenant, artifact.id)).projectId, project.id);
      assert.equal((await getArtifact(tenant, artifact.id)).owningChatId, null);
      assert.equal((await getArtifactVersion(tenant, artifact.id, 1)).version, 1);
      assert.ok((await listProjectArtifacts(tenant, project.id)).some(row => row.id === artifact.id));
      assert.ok((await listArtifactReferences(tenant, artifact.id)).some(ref => ref.targetType === "chat" && ref.targetRef === String(quick.id)), "historical Chat provenance is preserved independently");
    }
    assert.equal((await getArtifactVersion(tenant, retained.artifact.id, 2)).version, 2);
  });

  await t.test("Chat trash blocks retained reads, restore recovers them, permanent deletion cascades P4 versions", async () => {
    const doomed = await persistConversationDraft(tenant, { projectId: null, owningChatId: otherQuick.id, requestId: crypto.randomUUID(), draft: draft() });
    await trashProjectChat(tenant, otherQuick.id);
    await assert.rejects(getArtifact(tenant, doomed.artifact.id), /boundary/);
    await restoreTrashedProjectChat(tenant, otherQuick.id);
    assert.equal((await getArtifact(tenant, doomed.artifact.id)).id, doomed.artifact.id);
    await trashProjectChat(tenant, otherQuick.id);
    await permanentlyDeleteProjectChat(tenant, otherQuick.id);
    assert.equal((await getDb().select().from(projectArtifacts).where(eq(projectArtifacts.id, doomed.artifact.id))).length, 0);
    assert.equal((await getDb().select().from(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, doomed.artifact.id))).length, 0);
  });
});
