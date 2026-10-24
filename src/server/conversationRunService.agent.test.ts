import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

// DB-dependent modules load after the data directory is set, because db.ts binds it at module evaluation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-conversation-agent-"));
process.env.LIMURIA_DATA_DIR = dataDir;
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[key];
const { initDb, closeDb, getDb } = await import("./db");
const { users, domains } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createProject } = await import("./projectStore");
const { createProjectChat, listProjectChatMessages } = await import("./projectChatStore");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const { getArtifactVersion, getArtifact, listProjectArtifacts } = await import("./artifactStore");
const { createAttribution } = await import("./byoaiRouter");
const { artifactContentSchema } = await import("@shared/artifactContracts");
const { savedMessageArtifactRefs } = await import("@shared/conversationArtifactRefs");
const { registerArtifactRoutes } = await import("./artifactRoutes");
const { startProjectChatRun, ConversationStartError } = await import("./conversationRunService");
const { conversationRuns } = await import("./conversationRunRegistry");
const { getConversationExecutionJournal } = await import("./exec/execution-scope");
const { getPersonaPreferences, upsertPersonaPreferences } = await import("./personaPreferenceService");

async function seedUser() {
  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Agent tester", role: "internal_analyst", organizationId: null,
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

test("agent runs are opt-in, need AI-assisted mode, and are journaled as version-2 records", { timeout: 60_000 }, async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const [finance] = await getDb().select().from(domains).where(eq(domains.slug, "finance")).limit(1);
  if (!finance) await getDb().insert(domains).values({ slug: "finance", name: "Finance", active: true });
  const user = await seedUser();
  const tenant = { userId: user.id, role: user.role, organizationId: null };
  const project = await createProject(tenant, { name: "Agent project" });
  const chat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });
  const owner = { userId: user.id, projectId: project.id, chatId: chat.id };
  const journal = await getConversationExecutionJournal();
  const conversationUser = { id: user.id, email: user.email, role: user.role, organizationId: null };
  const personaUser = { id: user.id, email: user.email, role: user.role as "internal_analyst", organizationId: null };
  const current = await getPersonaPreferences(personaUser);
  await upsertPersonaPreferences(personaUser, { preferences: { ...current.preferences.preferences, waveCMasterAi: { state: "on", mode: "ai_assist", updatedAt: new Date().toISOString() } } });

  await t.test("a deterministic-first request cannot be an agent run", async () => {
    const requestId = crypto.randomUUID();
    await assert.rejects(
      startProjectChatRun(conversationUser, chat.id, { requestId, message: "Compare quotes", executionMode: "deterministic_first", agent: true }),
      (error: unknown) => error instanceof ConversationStartError && error.status === 409,
    );
    assert.equal(await journal.read(requestId, owner), null, "a refused run leaves no journal record");
  });

  await t.test("an agent run with no configured model ends in an honest data gap and keeps a v2 record", async () => {
    const requestId = crypto.randomUUID();
    const started = await startProjectChatRun(conversationUser, chat.id, { requestId, message: "Compare the latest quotes for two companies", executionMode: "ai_assisted", agent: true });
    assert.equal(started.requestId, requestId);
    const events = await eventsOf(requestId, user.id);
    assert.ok(events.some((event) => event.type === "data_gap" && event.gap.field === "ai_provider"));
    assert.equal(events.some((event) => event.type === "text"), false, "no fabricated answer");
    assert.equal((events.at(-1) as { status: string }).status, "failed");
    const record = await journal.read(requestId, owner);
    assert.equal(record?.version, 2);
    assert.equal(record?.label, "Agent run");
    assert.equal(record?.status, "failed");
    assert.deepEqual(record?.events, []);
  });

  await t.test("a governed AI-written P4 evidence digest appears as the same saved Chat Artifact after restart without a duplicate write", async () => {
    const sourceRef = "document:synthetic-accessibility-survey";
    await indexProjectDocument(tenant, {
      projectId: project.id,
      sourceType: "document",
      sourceRef,
      title: "Synthetic accessibility survey",
      body: "Office accessibility: the northern entrance has a step-free ramp and the southern entrance has stairs.",
      occurredAt: "2026-10-01T12:00:00Z",
    });
    const priorCount = (await listProjectArtifacts(tenant, project.id)).length;
    const requestId = crypto.randomUUID();
    const replies = [
      JSON.stringify({ steps: [{
        id: "save-site-evidence", toolId: "lios.project.evidence_artifact", label: "Save cited office accessibility evidence",
        input: { query: "office accessibility", title: "Accessibility evidence digest" }, dependsOn: [],
      }] }),
      JSON.stringify({ decision: "complete", answer: "The cited accessibility evidence digest was saved." }),
    ];
    await startProjectChatRun(conversationUser, chat.id, {
      requestId, agent: true, executionMode: "ai_assisted", sourceScope: "my_data",
      message: "Create a cited Project Research Artifact using lios.project.evidence_artifact for office accessibility.",
    }, {
      aiCompletion: async () => {
        const text = replies.shift();
        assert.ok(text, "Only plan and completion model calls are permitted.");
        return {
          provider: "openai", model: "gpt-4o", text,
          attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "synthetic-test", output: text }),
        };
      },
    });
    const emitted = await eventsOf(requestId, user.id);
    const terminal = emitted.at(-1);
    assert.ok(terminal && terminal.type === "done");
    assert.equal(terminal.status, "completed");
    const savedEvent = emitted.find((event) => event.type === "artifact");
    assert.ok(savedEvent && savedEvent.type === "artifact" && savedEvent.persistedArtifact,
      "already-written P4 must be surfaced using the normal saved Chat Artifact event");
    assert.equal(savedEvent.artifact.title, "Accessibility evidence digest");
    assert.equal(savedEvent.artifact.projectId, project.id);
    const saved = savedEvent.persistedArtifact;
    assert.equal(saved.version, 1);
    assert.equal((await listProjectArtifacts(tenant, project.id)).length, priorCount + 1,
      "the Chat retention path must NOT create another Artifact or version");
    const artifact = await getArtifact(tenant, saved.id);
    assert.equal(artifact.title, savedEvent.artifact.title);
    const immutable = await getArtifactVersion(tenant, saved.id, saved.version);
    const content = artifactContentSchema.parse(immutable.content);
    assert.equal(content.kind, "research");
    if (content.kind !== "research") assert.fail("Research content expected.");
    assert.equal(content.evidence.some((item) => item.sourceRef === sourceRef), true,
      "the cited synthetic source must survive even when the searchable Project index includes ledger/Chat provenance");
    assert.equal(content.evidence.every((item) => item.sourceRef === sourceRef ||
      item.sourceRef.startsWith("ledger:") || item.sourceRef.startsWith(`chat:${chat.id}:message:`)), true,
      "only this Project's indexed provenance and the cited survey may appear in this synthetic digest");
    assert.equal(content.claims.length, 0);

    const messages = await listProjectChatMessages(tenant, chat.id);
    const assistant = messages.find((item) => item.role === "assistant" && item.metadata.runtimeRequestId === requestId);
    assert.ok(assistant, "completed agent message must be persisted");
    assert.deepEqual(savedMessageArtifactRefs(assistant.metadata).map((item) => ({ id: item.id, version: item.version })),
      [{ id: saved.id, version: saved.version }], "normal restored Chat cards must reference the original P4 version");

    // Reconstruct the *same* Home database from its on-disk data root. This
    // proves the saved message and underlying P4 record survive a restart,
    // rather than merely remaining in this process's memory.
    await closeDb();
    await initDb();
    const reloaded = await listProjectChatMessages(tenant, chat.id);
    const restoredAssistant = reloaded.find((item) => item.role === "assistant" && item.metadata.runtimeRequestId === requestId);
    assert.ok(restoredAssistant, "the saved AI turn must survive the database reopen");
    assert.deepEqual(savedMessageArtifactRefs(restoredAssistant.metadata).map((item) => ({ id: item.id, version: item.version })),
      [{ id: saved.id, version: saved.version }]);
    const restoredArtifact = await getArtifact(tenant, saved.id);
    assert.equal(restoredArtifact.id, saved.id);
    assert.equal((await getArtifactVersion(tenant, saved.id, saved.version)).contentHash, immutable.contentHash,
      "the saved Chat pointer must resolve to the same immutable P4 version");
    assert.equal((await listProjectArtifacts(tenant, project.id)).length, priorCount + 1,
      "restart must not create an extra Artifact");
    const [foreign] = await getDb().insert(users).values({
      email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Unrelated Artifact reader",
      role: "internal_analyst", organizationId: null,
    }).returning();
    const foreignTenant = { userId: foreign.id, role: foreign.role, organizationId: null };
    await assert.rejects(() => listProjectChatMessages(foreignTenant, chat.id),
      "an unrelated account cannot read saved Chat references");
    await assert.rejects(() => getArtifactVersion(foreignTenant, saved.id, saved.version),
      "an unrelated account cannot resolve the referenced P4 version");

    // Exercise the actual access-checked HTTP route the existing Workbench
    // useArtifact hook calls. A saved card must open the exact recorded v1,
    // not a model-generated copy, an unspecified head, or another tenant's P4.
    const app = express();
    let httpUser = user;
    app.use((req, _res, next) => {
      req.user = httpUser;
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
    registerArtifactRoutes(app);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/api/artifacts/${encodeURIComponent(saved.id)}?version=${saved.version}`;
      const opened = await fetch(url);
      assert.equal(opened.status, 200, "Workbench's canonical GET must open the saved card's exact version");
      const detail = await opened.json() as { artifact: { id: string; projectId: number | null }; version: { version: number; contentHash: string } };
      assert.equal(detail.artifact.id, saved.id);
      assert.equal(detail.artifact.projectId, project.id);
      assert.equal(detail.version.version, saved.version);
      assert.equal(detail.version.contentHash, immutable.contentHash);
      httpUser = foreign;
      const denied = await fetch(url);
      assert.equal(denied.status, 404, "the same saved card URL cannot disclose another tenant's P4");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    const finished = (await journal.read(requestId, owner));
    assert.equal(finished?.status, "completed");
    assert.equal(finished?.events?.filter((event) => event.kind === "tool_call_finished" && event.status === "succeeded").length, 1);
    assert.equal(finished?.events?.filter((event) => event.kind === "step_finished" && event.status === "completed").length, 1);
  });

  await t.test("without the flag a run is an ordinary version-1 record", async () => {
    const requestId = crypto.randomUUID();
    await startProjectChatRun(conversationUser, chat.id, { requestId, message: "technical analysis AAPL", executionMode: "deterministic_first", sourceScope: "my_data" });
    await eventsOf(requestId, user.id);
    const record = await journal.read(requestId, owner);
    assert.equal(record?.version, 1);
    assert.equal("events" in (record ?? {}), false);
  });
});
