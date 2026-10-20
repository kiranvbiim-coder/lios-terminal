import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { savedMessageArtifactRefs } from "@shared/conversationArtifactRefs";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

// DB-dependent modules load after the data directory is set: db.ts binds it at module evaluation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-conversation-artifact-restore-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat, listProjectChatMessages } = await import("./projectChatStore");
const { startProjectChatRun } = await import("./conversationRunService");
const { conversationRuns } = await import("./conversationRunRegistry");
const { getArtifact, getArtifactVersion } = await import("./artifactStore");

const offline = { sourceScope: "my_data", executionMode: "deterministic_first" } as const;

async function seedUser() {
  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Restore tester", role: "internal_analyst", organizationId: null,
  }).returning();
  return user!;
}

async function eventsOf(requestId: string, userId: number): Promise<ConversationRuntimeEvent[]> {
  const events: ConversationRuntimeEvent[] = [];
  const done = Promise.withResolvers<void>();
  const subscription = conversationRuns.subscribe(requestId, userId, -1, ({ event }) => {
    events.push(event);
    if (event.type === "done") done.resolve();
  });
  assert.ok(subscription);
  try {
    await done.promise;
    return events;
  } finally {
    subscription.detach();
  }
}

test("a retained run Artifact reference survives message reload and resolves only inside its tenant", { timeout: 60_000 }, async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const user = await seedUser();
  const foreign = await seedUser();
  const tenant = { userId: user.id, role: user.role, organizationId: null };
  const foreignTenant = { userId: foreign.id, role: foreign.role, organizationId: null };
  const project = await createProject(tenant, { name: "Restore project" });
  const chat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });

  const requestId = crypto.randomUUID();
  await startProjectChatRun(user, chat.id, {
    requestId, ...offline, message: "Calculate my personal finances",
    context: { personalFinance: {
      schemaVersion: "1", asOf: "2026-09-22",
      accounts: [{ id: "bank", kind: "bank", balance: 200000, currency: "INR" }],
      transactions: [], debts: [], goals: [], retirement: null,
    } },
  });
  const live = await eventsOf(requestId, user.id);
  const artifactEvent = live.find((event) => event.type === "artifact");
  assert.ok(artifactEvent?.type === "artifact" && artifactEvent.persistedArtifact, "the run retained its Artifact in the Project");
  const retained = artifactEvent.persistedArtifact;

  // Restore: a fresh read of the chat's persisted messages (what reload/restart performs), no runtime events.
  const reloaded = await listProjectChatMessages(tenant, chat.id);
  const assistant = reloaded.find((message) => message.role === "assistant" && message.metadata.runtimeRequestId === requestId);
  assert.ok(assistant, "the assistant message was persisted");
  const refs = savedMessageArtifactRefs(assistant.metadata);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]!.id, retained.id);
  assert.equal(refs[0]!.version, retained.version);
  assert.ok(refs[0]!.title, "title snapshot is persisted for the card");
  assert.ok(refs[0]!.kind, "kind snapshot is persisted for the card");

  // The reference resolves to the SAME canonical Artifact through the access-checked store.
  const artifact = await getArtifact(tenant, refs[0]!.id);
  assert.equal(artifact.id, retained.id);
  assert.equal(artifact.title, refs[0]!.title);
  assert.equal(artifact.kind, refs[0]!.kind);
  assert.equal((await getArtifactVersion(tenant, refs[0]!.id, refs[0]!.version)).version, retained.version);

  // Another tenant can neither read the chat that carries the reference nor resolve the Artifact it names.
  await assert.rejects(() => listProjectChatMessages(foreignTenant, chat.id));
  await assert.rejects(() => getArtifact(foreignTenant, refs[0]!.id), /not found or not owned/i);
  await assert.rejects(() => getArtifactVersion(foreignTenant, refs[0]!.id, refs[0]!.version), /not found or not owned/i);
});

test("saved-Artifact references tolerate older and malformed message metadata", () => {
  const id = "artifact:11111111-1111-4111-8111-111111111111";
  assert.deepEqual(savedMessageArtifactRefs({}), []);
  assert.deepEqual(savedMessageArtifactRefs({ persistedArtifacts: "nope" }), []);
  assert.deepEqual(savedMessageArtifactRefs(null), []);
  // Messages written before title/kind were retained carry only id + version and stay valid.
  assert.deepEqual(savedMessageArtifactRefs({ persistedArtifacts: [{ id, version: 2 }] }), [{ id, version: 2, title: null, kind: null }]);
  // Invalid ids/versions are dropped; duplicates collapse.
  assert.deepEqual(
    savedMessageArtifactRefs({ persistedArtifacts: [{ id: "../../etc/passwd", version: 1 }, { id, version: 0 }, { id, version: 1, title: "Q3", kind: "report" }, { id, version: 9 }] }),
    [{ id, version: 1, title: "Q3", kind: "report" }],
  );
});
