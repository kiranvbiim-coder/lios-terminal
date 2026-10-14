import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { conversationRuntimeEventSchema, workingContextSnapshotSchema } from "@shared/conversationRuntime";
import type { ConversationRuntimeEvent, WorkingContextSnapshot } from "@shared/conversationRuntime";

// db.ts binds its data directory at module-evaluation time, so it must be imported only after this env var is set.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-working-context-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { addProjectChatMessage, createProjectChat, listProjectChatMessages } = await import("./projectChatStore");
const { ConversationStartError, startProjectChatRun, startTemporaryRun } = await import("./conversationRunService");
const { conversationRuns } = await import("./conversationRunRegistry");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createArtifact, getArtifact } = await import("./artifactStore");

type User = typeof users.$inferSelect;

async function seedUser(): Promise<User> {
  const [row] = await getDb().insert(users).values({
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    passwordHash: "test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Context Tester",
  }).returning();
  return row!;
}

/** Waits for the run's terminal `done` (the test's own timeout bounds a hung run) and returns every event it produced. */
async function eventsOf(requestId: string, userId: number): Promise<ConversationRuntimeEvent[]> {
  const events: ConversationRuntimeEvent[] = [];
  const done = Promise.withResolvers<void>();
  const subscription = conversationRuns.subscribe(requestId, userId, -1, (entry) => {
    events.push(entry.event);
    if (entry.event.type === "done") done.resolve();
  });
  assert.ok(subscription, "the run is registered for this user");
  await done.promise;
  subscription.detach();
  return events;
}

// my_data keeps the run offline (no market-data providers) while still exercising planning, persistence and the done event.
const offline = { sourceScope: "my_data", executionMode: "deterministic_first" } as const;

function plannedSymbol(events: ConversationRuntimeEvent[]): unknown {
  const plan = events.find((event) => event.type === "plan");
  return plan?.type === "plan" ? plan.plan.intent.parameters.symbol ?? plan.plan.intent.entityRefs[0] ?? null : undefined;
}

function doneContext(events: ConversationRuntimeEvent[]): WorkingContextSnapshot | null | undefined {
  const done = events.find((event) => event.type === "done");
  return done?.type === "done" ? done.workingContext : undefined;
}

test("TC-02: a saved chat remembers its context, resolves a follow-up from it, and fails closed on a foreign snapshot", { timeout: 60_000 }, async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const user = await seedUser();
  const ctx = { userId: user.id, organizationId: null, role: user.role };
  const chat = await createProjectChat(ctx, { scope: "quick", title: null });

  await t.test("turn 1 with an explicit ticker saves a validated snapshot, even though the offline turn ends without an answer", async () => {
    const requestId = crypto.randomUUID();
    await startProjectChatRun(user, chat.id, { requestId, message: "Analyse $MSFT technicals", ...offline });
    const events = await eventsOf(requestId, user.id);
    assert.equal(plannedSymbol(events), "MSFT");

    const messages = await listProjectChatMessages(ctx, chat.id);
    const userMessage = messages.filter((message) => message.role === "user").at(-1)!;
    const stored = workingContextSnapshotSchema.parse(userMessage.metadata.workingContext);
    assert.equal(stored.turn, 1);
    assert.equal(stored.chatId, chat.id);
    assert.equal(stored.scope, "quick");
    assert.deepEqual(stored.entities, [{ symbol: "MSFT", source: "message" }]);
    assert.equal(stored.sourcePosture, "my_data");

    assert.deepEqual(doneContext(events), stored, "the done event carries the same snapshot");
    conversationRuntimeEventSchema.parse(events.find((event) => event.type === "done"));
  });

  await t.test("turn 2, a follow-up with no ticker, resolves to the carried entity even with a different ambient symbol", async () => {
    const requestId = crypto.randomUUID();
    await startProjectChatRun(user, chat.id, { requestId, message: "Compare this", context: { symbol: "AAPL" }, ...offline });
    const events = await eventsOf(requestId, user.id);
    assert.equal(plannedSymbol(events), "MSFT", "the chat's context beats the ambient workbench symbol for a follow-up");

    const stored = workingContextSnapshotSchema.parse(doneContext(events));
    assert.equal(stored.turn, 2);
    assert.equal(stored.entities[0]?.symbol, "MSFT");
    assert.equal(stored.entities[0]?.source, "carried");
  });

  await t.test("an explicit ticker still beats both the carried context and the ambient symbol", async () => {
    const requestId = crypto.randomUUID();
    await startProjectChatRun(user, chat.id, { requestId, message: "Analyse $NVDA technicals", context: { symbol: "AAPL" }, ...offline });
    assert.equal(plannedSymbol(await eventsOf(requestId, user.id)), "NVDA");
  });

  await t.test("a question that does not refer back does not inherit the carried entity", async () => {
    const requestId = crypto.randomUUID();
    await startProjectChatRun(user, chat.id, { requestId, message: "What is a DCF?", ...offline });
    const symbol = plannedSymbol(await eventsOf(requestId, user.id));
    assert.ok(symbol === undefined || symbol === null || symbol === "", `no entity expected, got ${String(symbol)}`);
  });

  await t.test("a snapshot that belongs to another chat is ignored (no cross-chat bleed)", async () => {
    const other = await createProjectChat(ctx, { scope: "quick", title: null });
    const foreign = workingContextSnapshotSchema.parse({
      version: 1, scope: "quick", projectId: null, chatId: other.id + 1000, turn: 5, updatedAt: new Date().toISOString(),
      entities: [{ symbol: "TSLA", source: "message" }], activeArtifact: null, selectedElement: null, objective: null,
      sourcePosture: "my_data", assumptionRefs: [], asOf: null, capabilityIds: [], aiPosture: { executionMode: "deterministic_first", providerId: null },
      receiptRefs: [], workspaceSessionRef: null, confidence: 0.95,
    });
    await addProjectChatMessage(ctx, other.id, { role: "assistant", content: "earlier answer", metadata: { workingContext: foreign } });
    const requestId = crypto.randomUUID();
    await startProjectChatRun(user, other.id, { requestId, message: "Compare this", ...offline });
    assert.notEqual(plannedSymbol(await eventsOf(requestId, user.id)), "TSLA", "a snapshot that does not belong to this chat is not applied");
  });

  await t.test("a genuine current subject set asks before registering or executing a run; an explicit ticker resolves it", async () => {
    const multiple = await createProjectChat(ctx, { scope: "quick", title: null });
    const initialId = crypto.randomUUID();
    await startProjectChatRun(user, multiple.id, { requestId: initialId, message: "Analyse $MSFT and $NVDA technicals", ...offline });
    const initialContext = doneContext(await eventsOf(initialId, user.id));
    assert.deepEqual(initialContext?.entities.map((entity) => entity.symbol), ["MSFT", "NVDA"]);
    const before = await listProjectChatMessages(ctx, multiple.id);
    const ambiguousId = crypto.randomUUID();
    await assert.rejects(
      startProjectChatRun(user, multiple.id, { requestId: ambiguousId, message: "Why did this number change?", context: { symbol: "AAPL" }, ...offline }),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStartError);
        assert.equal(error.status, 409);
        assert.equal(error.body.code, "working_context_clarification_required");
        assert.deepEqual(error.body.symbols, ["MSFT", "NVDA"]);
        assert.match(error.message, /Which company/);
        return true;
      },
    );
    assert.equal(conversationRuns.get(ambiguousId, user.id), null, "no calculation or market run is registered for a guess");
    assert.deepEqual(await listProjectChatMessages(ctx, multiple.id), before, "asking does not overwrite the unresolved subject set");

    const explicitId = crypto.randomUUID();
    await startProjectChatRun(user, multiple.id, { requestId: explicitId, message: "Update this analysis for $NVDA", context: { symbol: "AAPL" }, ...offline });
    const resolved = await eventsOf(explicitId, user.id);
    assert.equal(plannedSymbol(resolved), "NVDA");
    assert.deepEqual(doneContext(resolved)?.entities, [{ symbol: "NVDA", source: "message" }]);
  });

  await t.test("unrelated prior-turn tickers do not turn a later follow-up into an ambiguity", async () => {
    const current = await createProjectChat(ctx, { scope: "quick", title: null });
    for (const symbol of ["MSFT", "NVDA"]) {
      const requestId = crypto.randomUUID();
      await startProjectChatRun(user, current.id, { requestId, message: `Analyse $${symbol} technicals`, ...offline });
      await eventsOf(requestId, user.id);
    }
    const followId = crypto.randomUUID();
    await startProjectChatRun(user, current.id, { requestId: followId, message: "Compare this", context: { symbol: "AAPL" }, ...offline });
    assert.equal(plannedSymbol(await eventsOf(followId, user.id)), "NVDA");
  });

  await t.test("conflicting deliberate selected referents ask rather than execute against the first", async () => {
    const requestId = crypto.randomUUID();
    await assert.rejects(startProjectChatRun(user, chat.id, {
      requestId, message: "Update this forecast",
      context: { selection: { kind: "security", symbol: "MSFT", text: "Forecast for $NVDA" } }, ...offline,
    }), (error: unknown) => error instanceof ConversationStartError && error.body.code === "working_context_clarification_required");
    assert.equal(conversationRuns.get(requestId, user.id), null);
  });

  await t.test("unsafe new metadata leaves a null tombstone, never the previous saved authority", async () => {
    const isolated = await createProjectChat(ctx, { scope: "quick", title: null });
    const firstId = crypto.randomUUID();
    await startProjectChatRun(user, isolated.id, { requestId: firstId, message: "Analyse $MSFT technicals", ...offline });
    await eventsOf(firstId, user.id);
    const unsafeId = crypto.randomUUID();
    await startProjectChatRun(user, isolated.id, { requestId: unsafeId, message: "Analyse $NVDA technicals", context: { sessionId: "api_key=abcdef1234567890abcdef" }, ...offline });
    const unsafeEvents = await eventsOf(unsafeId, user.id);
    assert.equal(doneContext(unsafeEvents), null);
    conversationRuntimeEventSchema.parse(unsafeEvents.find((event) => event.type === "done"));
    const messages = await listProjectChatMessages(ctx, isolated.id);
    assert.equal(messages.at(-1)?.metadata.workingContext, null);
    const followId = crypto.randomUUID();
    await startProjectChatRun(user, isolated.id, { requestId: followId, message: "Compare this", ...offline });
    assert.notEqual(plannedSymbol(await eventsOf(followId, user.id)), "MSFT");
  });

  await t.test("carried Artifact JSON must be authorized by the real owning Project store", async () => {
    const project = await createProject(ctx, { name: "Context owner" });
    const foreignProject = await createProject(ctx, { name: "Different context owner" });
    const { artifact } = await createArtifact(ctx, { projectId: foreignProject.id, title: "Unrelated table", content: { kind: "table", columns: [], rows: [] } });
    const projectChat = await createProjectChat(ctx, { scope: "project", projectId: project.id, title: null });
    const seededId = crypto.randomUUID();
    await startProjectChatRun(user, projectChat.id, { requestId: seededId, message: "Analyse $MSFT technicals", ...offline });
    const seeded = doneContext(await eventsOf(seededId, user.id));
    assert.ok(seeded);
    await addProjectChatMessage(ctx, projectChat.id, { role: "assistant", content: "Context hint", metadata: { workingContext: { ...seeded, activeArtifact: artifact.id } } });
    const blockedId = crypto.randomUUID();
    await assert.rejects(startProjectChatRun(user, projectChat.id, { requestId: blockedId, message: "Update this table", ...offline }),
      (error: unknown) => error instanceof ConversationStartError && error.status === 403 && error.body.code === "working_context_artifact_forbidden");
    assert.equal(conversationRuns.get(blockedId, user.id), null);
    assert.equal((await getArtifact(ctx, artifact.id)).headVersion, artifact.headVersion, "no foreign Artifact mutation occurs");

    const { artifact: own } = await createArtifact(ctx, { projectId: project.id, title: "Owned table", content: { kind: "table", columns: [], rows: [] } });
    await addProjectChatMessage(ctx, projectChat.id, { role: "assistant", content: "Owned context", metadata: { workingContext: { ...seeded, activeArtifact: own.id } } });
    const allowedId = crypto.randomUUID();
    await startProjectChatRun(user, projectChat.id, { requestId: allowedId, message: "Compare this", ...offline });
    assert.equal(doneContext(await eventsOf(allowedId, user.id))?.activeArtifact, own.id);

    const quickId = crypto.randomUUID();
    await assert.rejects(startProjectChatRun(user, chat.id, { requestId: quickId, message: "Update this table", context: { activeObjectRefs: [own.id] }, ...offline }),
      (error: unknown) => error instanceof ConversationStartError && error.body.code === "working_context_artifact_forbidden");
    assert.equal(conversationRuns.get(quickId, user.id), null);
  });
});

test("TC-02: a Temporary chat carries context only through the client and never stores it", { timeout: 60_000 }, async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const user = await seedUser();

  const firstId = crypto.randomUUID();
  await startTemporaryRun(user, { requestId: firstId, message: "Analyse $AMZN technicals", history: [], ...offline });
  const snapshot = doneContext(await eventsOf(firstId, user.id));
  assert.ok(snapshot, "the done event returns the snapshot for the client to hold in memory");
  assert.equal(snapshot.scope, "temporary");
  assert.equal(snapshot.chatId, null);
  assert.equal(snapshot.activeArtifact, null);

  const secondId = crypto.randomUUID();
  await startTemporaryRun(user, { requestId: secondId, message: "Compare this", history: [], workingContext: snapshot, ...offline });
  assert.equal(plannedSymbol(await eventsOf(secondId, user.id)), "AMZN");

  for (const unsafe of [
    { ...snapshot, scope: "project", chatId: 3 },
    { ...snapshot, objective: "api_key=abcdef1234567890abcdef" },
    { ...snapshot, activeArtifact: `artifact:${crypto.randomUUID()}` },
  ]) {
    const forgedId = crypto.randomUUID();
    await assert.rejects(startTemporaryRun(user, { requestId: forgedId, message: "Compare this", history: [], workingContext: unsafe, ...offline }),
      (error: unknown) => error instanceof ConversationStartError && error.status === 400 && error.body.code === "working_context_invalid");
    assert.equal(conversationRuns.get(forgedId, user.id), null, "unsafe client context never starts a run");
  }

  const multiId = crypto.randomUUID();
  await startTemporaryRun(user, { requestId: multiId, message: "Analyse $AMZN and $MSFT technicals", history: [], ...offline });
  const multiple = doneContext(await eventsOf(multiId, user.id));
  const askId = crypto.randomUUID();
  await assert.rejects(startTemporaryRun(user, { requestId: askId, message: "Compare this", history: [], workingContext: multiple, ...offline }),
    (error: unknown) => error instanceof ConversationStartError && error.body.code === "working_context_clarification_required");
  assert.equal(conversationRuns.get(askId, user.id), null);

  const unsafeId = crypto.randomUUID();
  await startTemporaryRun(user, { requestId: unsafeId, message: "Analyse $NVDA technicals", context: { sessionId: "api_key=abcdef1234567890abcdef" }, history: [], ...offline });
  const unsafeEvents = await eventsOf(unsafeId, user.id);
  assert.equal(doneContext(unsafeEvents), null, "a rejected derived snapshot explicitly clears client-held authority");
  conversationRuntimeEventSchema.parse(unsafeEvents.find((event) => event.type === "done"));
});
