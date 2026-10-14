import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

// DB-dependent modules load after the data directory is set, because db.ts binds it at module evaluation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-conversation-agent-"));
process.env.LIMURIA_DATA_DIR = dataDir;
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[key];
const { initDb, closeDb, getDb } = await import("./db");
const { users, domains } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
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

  await t.test("without the flag a run is an ordinary version-1 record", async () => {
    const requestId = crypto.randomUUID();
    await startProjectChatRun(conversationUser, chat.id, { requestId, message: "technical analysis AAPL", executionMode: "deterministic_first", sourceScope: "my_data" });
    await eventsOf(requestId, user.id);
    const record = await journal.read(requestId, owner);
    assert.equal(record?.version, 1);
    assert.equal("events" in (record ?? {}), false);
  });
});
