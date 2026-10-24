import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { sql } from "drizzle-orm";
import { conversationRuntimeEventSchema, workingContextSnapshotSchema } from "@shared/conversationRuntime";
import { artifactContentSchema, artifactRefreshSpecSchema } from "@shared/artifactContracts";
import { savedMessageArtifactRefs } from "@shared/conversationArtifactRefs";
import { trustManifestSchema } from "@shared/trustContracts";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import type { ExecutionJournalRecord } from "./exec/execution-journal";

// Intentionally load DB-dependent modules after the test data directory: db.ts binds it at module evaluation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-conversation-journal-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectArtifacts, projectArtifactVersions, projectChatMessages } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectChat, listProjectChatMessages } = await import("./projectChatStore");
const { ConversationStartError, startProjectChatRun, startTemporaryRun } = await import("./conversationRunService");
const { conversationRuns, ConversationRunRegistry } = await import("./conversationRunRegistry");
const { cancelConversationExecution, getConversationTool, registerConversationTool } = await import("./conversationRuntime");
const { getConversationExecutionJournal, recoverConversationExecutions, ConversationExecutionTranscript } = await import("./exec/execution-scope");
const { createExecutionJournal } = await import("./exec/execution-journal");
const { registerProjectConversationRoutes } = await import("./projectConversationRoutes");
const { runCommand } = await import("./exec/run-command");
const { getArtifactVersion, keepConversationDraftVersion, listArtifactVersions } = await import("./artifactStore");

type User = typeof users.$inferSelect;
const offline = { sourceScope: "my_data", executionMode: "deterministic_first" } as const;

async function seedUser(): Promise<User> {
  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Journal tester", role: "internal_analyst", organizationId: null,
  }).returning();
  return user!;
}

async function eventsOf(requestId: string, userId: number, observe?: (event: ConversationRuntimeEvent) => void): Promise<ConversationRuntimeEvent[]> {
  const events: ConversationRuntimeEvent[] = [];
  const done = Promise.withResolvers<void>();
  const subscription = conversationRuns.subscribe(requestId, userId, -1, ({ event }) => {
    events.push(event);
    try {
      observe?.(event);
    } catch (error) {
      done.reject(error);
    }
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

test("saved Conversation Runtime turns retain encrypted terminal history across DB/HTTP reopen", { timeout: 60_000 }, async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const user = await seedUser();
  const foreign = await seedUser();
  const tenant = { userId: user.id, role: user.role, organizationId: null };
  const project = await createProject(tenant, { name: "Journal project" });
  const chat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });
  const quick = await createProjectChat(tenant, { scope: "quick" });
  const otherChat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });
  const owner = { userId: user.id, projectId: project.id, chatId: chat.id };
  const journal = await getConversationExecutionJournal();
  const retainedVersions: Array<{ id: string; version: number; sources: string[]; receipts: string[]; dependencies: string[]; refreshSpec: Record<string, unknown> | null }> = [];
  const successfulIds: string[] = [];
  const financeRequest = { ...offline, message: "Calculate my personal finances", context: { personalFinance: {
    schemaVersion: "1", asOf: "2026-09-22",
    accounts: [{ id: "bank", kind: "bank", balance: 200000, currency: "INR" }],
    transactions: [], debts: [], goals: [], retirement: null,
  } } };

  await t.test("two real deterministic Project turns persist once and finish before done", async () => {
    for (const message of ["what changed in this project?", "search this project for Journal project"]) {
      const requestId = crypto.randomUUID();
      successfulIds.push(requestId);
      await startProjectChatRun(user, chat.id, { requestId, message, ...offline });
      let atDone: Promise<ExecutionJournalRecord | null> | undefined;
      const events = await eventsOf(requestId, user.id, (event) => {
        if (event.type === "done") atDone = journal.read(requestId, owner);
      });
      const terminal = events.find((event) => event.type === "done");
      assert.equal(terminal?.type === "done" ? terminal.status : null, "completed");
      const record = await atDone;
      assert.equal(record?.status, "completed");
      assert.ok(record?.endedAt);
      const text = events.filter((event) => event.type === "text").at(-1);
      assert.equal(record?.stdout, text?.type === "text" ? text.text : null);
    }
    const messages = await listProjectChatMessages(tenant, chat.id);
    assert.equal(messages.filter((message) => message.role === "assistant").length, 2);
    assert.equal(messages.filter((message) => message.role === "user").length, 2);
    assert.equal((await journal.list(owner)).length, 2);
    const bytes = fs.readFileSync(path.join(dataDir, "execution-journal", successfulIds[0]!));
    assert.equal(bytes.includes(Buffer.from((await journal.read(successfulIds[0]!, owner))!.stdout)), false);
  });
  await t.test("meaningful Project and Quick output persist before completed with exact message refs", async () => {
    for (const target of [chat, quick]) {
      const requestId = crypto.randomUUID();
      await startProjectChatRun(user, target.id, { requestId, ...financeRequest });
      const events = await eventsOf(requestId, user.id);
      const artifact = events.find((event) => event.type === "artifact");
      for (const event of events) conversationRuntimeEventSchema.parse(event);
      assert.ok(artifact?.type === "artifact");
      const terminal = events.at(-1);
      assert.equal(terminal?.type === "done" ? terminal.status : null, "completed");
        assert.equal(artifact.artifact.persistence, target.scope === "quick" ? "chat_candidate" : "project_candidate");
        assert.ok(artifact.persistedArtifact, "Persistent Chat output persists before completed");
        const version = await getArtifactVersion(tenant, artifact.persistedArtifact.id, artifact.persistedArtifact.version);
        assert.deepEqual(version.sourceRefs, artifact.artifact.sourceRefs);
        assert.deepEqual(version.executionReceiptIds, artifact.artifact.executionReceiptIds);
        const plan = events.find((event) => event.type === "plan");
        assert.ok(plan?.type === "plan");
        const capabilityIds = plan.plan.capabilities.map((capability) => capability.id);
        assert.deepEqual(version.dependencyRefs, [...new Set([
          ...artifact.artifact.sourceRefs,
          ...capabilityIds.map((id) => `capability:${id}`),
          ...(version.trustManifest ? trustManifestSchema.parse(version.trustManifest).evidence.map((item) => item.sourceRef) : []),
        ])]);
        assert.deepEqual(version.refreshSpec, {
          kind: "conversation", ...offline, capabilityIds,
          message: financeRequest.message, selection: null, engineRef: null,
        });
        workingContextSnapshotSchema.parse(terminal?.type === "done" ? terminal.workingContext : null);
        retainedVersions.push({ ...artifact.persistedArtifact, sources: version.sourceRefs, receipts: version.executionReceiptIds, dependencies: version.dependencyRefs, refreshSpec: version.refreshSpec });
        assert.equal(terminal?.type === "done" ? terminal.workingContext?.activeArtifact : null, artifact.persistedArtifact.id);
        const assistant = (await listProjectChatMessages(tenant, target.id)).filter(message => message.role === "assistant").at(-1)!;
        assert.ok(Array.isArray(assistant.metadata.persistedArtifacts));
        assert.ok(assistant.metadata.persistedArtifacts.some(ref => typeof ref === "object" && ref !== null && "id" in ref && "version" in ref && ref.id === artifact.persistedArtifact?.id && ref.version === artifact.persistedArtifact?.version));
        const reopenedRefs = savedMessageArtifactRefs(assistant.metadata);
        const savedRef = reopenedRefs.find(ref => ref.id === artifact.persistedArtifact!.id);
        assert.ok(savedRef, "saved message metadata resolves the exact P4 Artifact identity");
        assert.equal(savedRef.version, artifact.persistedArtifact.version, "the saved message never advances to a later Artifact head");
        assert.equal(savedRef.title, artifact.artifact.title);
        assert.equal(savedRef.kind, artifact.artifact.data.kind);
    }
  });


  await t.test("Artifact store refusal is visible and cannot produce a completed or saved output", async () => {
    await getDb().execute(sql.raw(`CREATE FUNCTION reject_auto_artifact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Artifact storage unavailable'; END $$`));
    await getDb().execute(sql.raw(`CREATE TRIGGER reject_auto_artifact BEFORE INSERT ON project_artifacts FOR EACH ROW EXECUTE FUNCTION reject_auto_artifact()`));
    try {
      const requestId = crypto.randomUUID();
      await startProjectChatRun(user, chat.id, { requestId, ...financeRequest });
      const events = await eventsOf(requestId, user.id);
      const terminal = events.at(-1);
      assert.equal(terminal?.type === "done" ? terminal.status : null, "failed");
      assert.ok(events.some((event) => event.type === "error"));
      assert.equal(events.some((event) => event.type === "artifact" && event.persistedArtifact !== undefined), false);
      const failedMessages = await listProjectChatMessages(tenant, chat.id);
      assert.equal(failedMessages.filter(message =>
        message.role === "assistant" && message.metadata.runtimeRequestId === requestId).length, 0,
        "failed Artifact writes must never claim a durable result in Chat history");
    } finally {
      await getDb().execute(sql.raw(`DROP TRIGGER reject_auto_artifact ON project_artifacts`));
      await getDb().execute(sql.raw(`DROP FUNCTION reject_auto_artifact()`));
    }
  });

  await t.test("Quick failure retains useful transcript and pre-run Working Context", async () => {
    const requestId = crypto.randomUUID();
    await startProjectChatRun(user, quick.id, { requestId, message: "Analyse $MSFT technicals", ...offline });
    const events = await eventsOf(requestId, user.id);
    const terminal = events.find((event) => event.type === "done");
    assert.equal(terminal?.type === "done" ? terminal.status : null, "failed");
    assert.equal(terminal?.type === "done" ? terminal.workingContext?.entities[0]?.symbol : null, "MSFT");
    const record = await journal.read(requestId, { userId: user.id, projectId: null, chatId: quick.id });
    assert.equal(record?.status, "failed");
    assert.ok(record?.stderr.trim());
  });

  await t.test("canonical cancellation persists cancelled before the terminal event", async () => {
    const requestId = crypto.randomUUID();
    await startProjectChatRun(user, chat.id, { requestId, message: "what changed in this project?", ...offline });
    const events = await eventsOf(requestId, user.id, (event) => {
      if (event.type === "plan") assert.equal(cancelConversationExecution(requestId, user.id), true);
    });
    const terminal = events.find((event) => event.type === "done");
    assert.equal(terminal?.type === "done" ? terminal.status : null, "cancelled");
    assert.ok(terminal?.type === "done" && terminal.workingContext);
    assert.equal((await journal.read(requestId, owner))?.status, "cancelled");
  });

  await t.test("canonical runtime cancellation joins a real tool subprocess even without an explicit command signal", async () => {
    const search = getConversationTool("lios.project.search");
    assert.ok(search);
    const requestId = crypto.randomUUID();
    const readyPath = path.join(dataDir, "child-ready");
    const ready = Promise.withResolvers<void>();
    const watcher = fs.watch(dataDir, () => {
      if (fs.existsSync(readyPath)) ready.resolve();
    });
    // Use the runtime's real tool producer boundary, retaining its normal implementation after command completion.
    registerConversationTool({
      ...search,
      invoke: async (input, signal) => {
        await runCommand({
          argv: [process.execPath, "-e", "require('node:net').createServer().listen(0, '127.0.0.1', () => { const fs = require('node:fs'); fs.writeFileSync(process.argv[1] + '.tmp', String(process.pid)); fs.renameSync(process.argv[1] + '.tmp', process.argv[1]); });", readyPath],
          timeoutMs: 30_000,
          scopeKey: "producer-cannot-escape-conversation",
        });
        return search.invoke(input, signal);
      },
    });
    try {
      await startProjectChatRun(user, chat.id, { requestId, message: "search this project for Journal project", ...offline });
      const events = eventsOf(requestId, user.id);
      await ready.promise;
      const pid = Number(fs.readFileSync(readyPath, "utf8"));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      assert.equal(cancelConversationExecution(requestId, foreign.id), false);
      assert.equal(cancelConversationExecution(requestId, user.id), true);
      assert.ok((await events).some((event) => event.type === "done" && event.status === "cancelled"));
      assert.equal((await journal.read(requestId, owner))?.status, "cancelled");
      assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
    } finally {
      cancelConversationExecution(requestId, user.id);
      watcher.close();
      registerConversationTool(search);
      fs.rmSync(readyPath, { force: true });
    }
  });

  await t.test("Temporary turns never create journal records, Artifacts, versions or messages", async () => {
    const before = fs.readdirSync(path.join(dataDir, "execution-journal")).sort();
    const artifactsBefore = await getDb().select({ id: projectArtifacts.id }).from(projectArtifacts);
    const versionsBefore = await getDb().select({ id: projectArtifactVersions.id }).from(projectArtifactVersions);
    const messagesBefore = await getDb().select({ id: projectChatMessages.id }).from(projectChatMessages);
    const requestId = crypto.randomUUID();
    await startTemporaryRun(user, { requestId, history: [], ...financeRequest });
    const events = await eventsOf(requestId, user.id);
    const artifact = events.find((event) => event.type === "artifact");
    assert.ok(artifact?.type === "artifact");
    assert.equal(artifact.persistedArtifact, undefined);
    assert.equal(artifact.artifact.persistence, "ephemeral");
    assert.deepEqual(fs.readdirSync(path.join(dataDir, "execution-journal")).sort(), before);
    assert.equal(await journal.read(requestId, { userId: user.id, projectId: null, chatId: null }), null);
    assert.deepEqual(await getDb().select({ id: projectArtifacts.id }).from(projectArtifacts), artifactsBefore);
    assert.deepEqual(await getDb().select({ id: projectArtifactVersions.id }).from(projectArtifactVersions), versionsBefore);
    assert.deepEqual(await getDb().select({ id: projectChatMessages.id }).from(projectChatMessages), messagesBefore);
  });

  await t.test("recovery interrupts stale running records without admitting or resuming a run", async () => {
    const requestId = crypto.randomUUID();
    await journal.begin({ id: requestId, owner, label: "Conversation execution" });
    await journal.append(requestId, "stdout", "Retained partial answer");
    const active = conversationRuns.active(user.id);
    await closeDb();
    await initDb();
    for (const retained of retainedVersions) {
      const version = await getArtifactVersion(tenant, retained.id, retained.version);
      assert.deepEqual(version.sourceRefs, retained.sources);
      assert.deepEqual(version.executionReceiptIds, retained.receipts);
      assert.deepEqual(version.dependencyRefs, retained.dependencies);
      assert.deepEqual(version.refreshSpec, retained.refreshSpec);
    }
    await recoverConversationExecutions();
    const reopened = await createExecutionJournal();
    const record = await reopened.read(requestId, owner);
    assert.equal(record?.status, "interrupted");
    assert.equal(record?.stdout, "Retained partial answer");
    assert.equal(record?.exitCode, null);
    assert.deepEqual(conversationRuns.active(user.id), active);
    assert.equal(new ConversationRunRegistry().get(requestId, user.id), null);
    assert.equal((await reopened.read(successfulIds[0]!, owner))?.status, "completed");
  });

  await t.test("reopened auto-retained work supports governed report refresh and explicit same-Artifact version save", async () => {
    const source = retainedVersions[0]!;
    const requestId = crypto.randomUUID();
    const selection = { kind: "artifact", id: source.id, label: "Saved finance snapshot", view: "document", symbol: null };
    await startProjectChatRun(user, chat.id, {
      requestId, message: "Create a risk report", ...offline,
      context: { activeObjectRefs: [source.id], selection },
    });
    const events = await eventsOf(requestId, user.id);
    const terminal = events.at(-1);
    assert.equal(terminal?.type === "done" ? terminal.status : null, "completed");
    const output = events.find((event) => event.type === "artifact");
    assert.ok(output?.type === "artifact" && output.persistedArtifact);
    const original = await getArtifactVersion(tenant, output.persistedArtifact.id, 1);
    const report = artifactContentSchema.parse(original.content);
    assert.equal(report.kind, "report");
    if (report.kind !== "report") throw new Error("Expected canonical report output.");
    assert.equal(report.blocks.some(block => block.type === "code"), false, "professional report sections must not fall back to Artifact JSON code");
    assert.ok(report.blocks.some(block => block.type === "table" && block.attrs.table), "recorded structured values become readable canonical report tables");
    const spec = artifactRefreshSpecSchema.parse(original.refreshSpec);
    assert.equal(spec.message, "Create a risk report");
    assert.deepEqual(spec.selection, selection);
    assert.ok(original.dependencyRefs.includes(`${source.id}@v1`));
    assert.ok(original.dependencyRefs.includes("capability:research.report"));
    await closeDb();
    await initDb();
    assert.deepEqual(await getArtifactVersion(tenant, output.persistedArtifact.id, 1), original);

    // Match the existing UI: stage the saved message/posture, focus the saved Artifact,
    // then explicitly send it through the governed Conversation Runtime.
    const refreshRequestId = crypto.randomUUID();
    await startProjectChatRun(user, chat.id, {
      requestId: refreshRequestId, message: spec.message!,
      sourceScope: spec.sourceScope, executionMode: spec.executionMode,
      context: { activeObjectRefs: [output.persistedArtifact.id] },
    });
    const refreshed = await eventsOf(refreshRequestId, user.id);
    assert.ok(refreshed.some((event) => event.type === "done" && event.status === "completed"));
    assert.ok(refreshed.some((event) => event.type === "receipt" && event.receipt.operation === "p5-professional-report"));
    const next = refreshed.find((event) => event.type === "artifact");
    assert.ok(next?.type === "artifact" && next.persistedArtifact);
    const retained = await getArtifactVersion(tenant, next.persistedArtifact.id, 1);
    assert.ok(retained.sourceRefs.includes(`${output.persistedArtifact.id}@v1`));
    assert.notDeepEqual(retained.executionReceiptIds, original.executionReceiptIds);
    assert.equal((await listArtifactVersions(tenant, output.persistedArtifact.id)).length, 1);
    const saved = await keepConversationDraftVersion(tenant, {
      artifactId: output.persistedArtifact.id, draft: next.artifact, requestId: refreshRequestId,
      trustManifest: retained.trustManifest ? trustManifestSchema.parse(retained.trustManifest) : null,
      dependencyRefs: retained.dependencyRefs, refreshSpec: artifactRefreshSpecSchema.parse(retained.refreshSpec),
    });
    assert.equal(saved.artifact.id, output.persistedArtifact.id);
    assert.equal(saved.version.version, 2);
    assert.deepEqual(saved.version.executionReceiptIds, retained.executionReceiptIds);
    assert.deepEqual((await getArtifactVersion(tenant, output.persistedArtifact.id, 1)), original);

    // Replay metadata deliberately does not invent personal-finance input capture.
    const financeSpec = artifactRefreshSpecSchema.parse(source.refreshSpec);
    const unsupportedId = crypto.randomUUID();
    await startProjectChatRun(user, chat.id, {
      requestId: unsupportedId, message: financeSpec.message!,
      sourceScope: financeSpec.sourceScope, executionMode: financeSpec.executionMode,
    });
    const unsupported = await eventsOf(unsupportedId, user.id);
    assert.ok(unsupported.some((event) => event.type === "done" && event.status === "failed"));
    assert.ok(unsupported.some((event) => event.type === "data_gap" && event.gap.field === "personal_finance_inputs"));
    assert.equal(unsupported.some((event) => event.type === "artifact"), false);
  });

  await t.test("authenticated HTTP history survives reopen and denies foreign user/chat/anonymous reads", async () => {
    const app = express();
    app.use((req, _res, next) => {
      const identity = req.get("x-test-user");
      const authenticated = identity === String(user.id) ? user : identity === String(foreign.id) ? foreign : null;
      req.isAuthenticated = (() => authenticated !== null) as typeof req.isAuthenticated;
      if (authenticated) req.user = authenticated;
      next();
    });
    registerProjectConversationRoutes(app);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api/project-chats`;
      const headers = { "x-test-user": String(user.id) };
      const list = await fetch(`${base}/${chat.id}/executions`, { headers });
      assert.equal(list.status, 200);
      const records: ExecutionJournalRecord[] = await list.json();
      assert.ok(records.some((record) => record.status === "interrupted"));
      assert.ok(records.some((record) => record.id === successfulIds[0] && record.stdout.length > 0));
      const read = await fetch(`${base}/${chat.id}/executions/${successfulIds[0]}`, { headers });
      assert.equal(read.status, 200);
      assert.equal((await read.json() as ExecutionJournalRecord).status, "completed");
      assert.equal((await fetch(`${base}/${otherChat.id}/executions/${successfulIds[0]}`, { headers })).status, 404);
      assert.equal((await fetch(`${base}/${chat.id}/executions`, { headers: { "x-test-user": String(foreign.id) } })).status, 404);
      assert.equal((await fetch(`${base}/${chat.id}/executions/${successfulIds[0]}`, { headers: { "x-test-user": String(foreign.id) } })).status, 404);
      assert.equal((await fetch(`${base}/${chat.id}/executions`)).status, 401);
      assert.equal((await fetch(`${base}/${chat.id}/executions/${successfulIds[0]}`)).status, 401);
      const filename = path.join(dataDir, "execution-journal", successfulIds[0]!);
      const encrypted = fs.readFileSync(filename);
      const corrupted = Buffer.from(encrypted);
      corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
      fs.writeFileSync(filename, corrupted);
      try {
        assert.equal((await fetch(`${base}/${chat.id}/executions/${successfulIds[0]}`, { headers })).status, 503);
        assert.equal((await fetch(`${base}/${chat.id}/executions`, { headers })).status, 503);
      } finally {
        fs.writeFileSync(filename, encrypted);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  await t.test("cumulative runtime text appends only deltas, including the final returned text", async () => {
    const id = crypto.randomUUID();
    await journal.begin({ id, owner, label: "Conversation execution" });
    const transcript = new ConversationExecutionTranscript(journal, id);
    for (const text of ["Hello", "Hello ", "Hello world", "Hello world"]) {
      await transcript.recordEvent({ type: "text", requestId: id, at: new Date().toISOString(), text, label: "deterministic" });
    }
    await transcript.recordText("Hello world!");
    await transcript.finish("completed");
    assert.equal((await journal.read(id, owner))?.stdout, "Hello world!");
  });

  await t.test("unavailable persistence stops execution and visibly fails instead of falling back", async () => {
    const directory = path.join(dataDir, "execution-journal");
    const backup = path.join(dataDir, "journal-backup");
    fs.renameSync(directory, backup);
    fs.writeFileSync(directory, "not a directory");
    try {
      const requestId = crypto.randomUUID();
      const before = await listProjectChatMessages(tenant, chat.id);
      await assert.rejects(
        startProjectChatRun(user, chat.id, { requestId, message: "what changed in this project?", ...offline }),
        (error: unknown) => error instanceof ConversationStartError && error.status === 503 && error.body.code === "execution_journal_failed",
      );
      assert.equal(conversationRuns.get(requestId, user.id), null, "persistence failure refuses admission instead of registering a fallback run");
      assert.deepEqual(await listProjectChatMessages(tenant, chat.id), before, "failed admission persists no initiating message");
      assert.equal(fs.existsSync(path.join(backup, requestId)), false);
    } finally {
      fs.unlinkSync(directory);
      fs.renameSync(backup, directory);
    }
  });

  await t.test("a write failure during a real run cannot expose a successful terminal result", async () => {
    const directory = path.join(dataDir, "execution-journal");
    const backup = path.join(dataDir, "journal-write-backup");
    const requestId = crypto.randomUUID();
    let replaced = false;
    try {
      await startProjectChatRun(user, chat.id, { requestId, message: "what changed in this project?", ...offline });
      const events = await eventsOf(requestId, user.id, (event) => {
        if (event.type === "plan") {
          fs.renameSync(directory, backup);
          fs.writeFileSync(directory, "not a directory");
          replaced = true;
        }
      });
      assert.equal(replaced, true);
      assert.ok(events.some((event) => event.type === "error" && event.code === "execution_journal_failed"));
      assert.ok(events.some((event) => event.type === "done" && event.status === "failed" && event.workingContext));
      assert.equal(events.some((event) => event.type === "done" && event.status === "completed"), false);
    } finally {
      if (replaced) {
        fs.unlinkSync(directory);
        fs.renameSync(backup, directory);
      }
    }
    await recoverConversationExecutions();
    assert.equal((await journal.read(requestId, owner))?.status, "interrupted");
  });
});
