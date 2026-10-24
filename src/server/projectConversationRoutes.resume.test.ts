import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import express from "express";
import test from "node:test";
import { z } from "zod";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { createAttribution } from "./byoaiRouter";

// DB-dependent modules load after the data directory is set, because db.ts binds it at module evaluation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-resume-routes-"));
process.env.LIMURIA_DATA_DIR = dataDir;
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[key];

const { closeDb, getDb, initDb } = await import("./db");
const { users, domains } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { startProjectChatRun } = await import("./conversationRunService");
const { conversationRuns } = await import("./conversationRunRegistry");
const { getConversationExecutionJournal } = await import("./exec/execution-scope");
const { registerProjectConversationRoutes } = await import("./projectConversationRoutes");
const { registerConversationTool } = await import("./conversationRuntime");

type Tool = Parameters<typeof registerConversationTool>[0];
let slowCalls = 0;
registerConversationTool({
  id: "test.routes.slow", label: "Slow", kind: "retrieve", permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true,
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.object({ output: z.unknown(), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }).strict(),
  cancel: null,
  invoke: async (_input, signal) => {
    // The first call waits for Stop; the call made by the resumed run returns at once.
    if (slowCalls++ === 0) {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    return { output: null, summary: "slow done", deterministic: true, sourceRefs: [] };
  },
} as Tool);

function finished(requestId: string, userId: number): Promise<ConversationRuntimeEvent[]> {
  const events: ConversationRuntimeEvent[] = [];
  const done = Promise.withResolvers<ConversationRuntimeEvent[]>();
  const subscription = conversationRuns.subscribe(requestId, userId, -1, ({ event }) => {
    events.push(event);
    if (event.type === "done") done.resolve(events);
  });
  assert.ok(subscription);
  return done.promise.finally(() => subscription.detach());
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string): Promise<T> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("execution history hides the continuation and marks only a resumable interrupted run; the resume route accepts a requestId and nothing else", { timeout: 120_000 }, async (t) => {
  await initDb();
  let server: Server | null = null;
  t.after(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const [finance] = await getDb().select().from(domains).where(eq(domains.slug, "finance")).limit(1);
  if (!finance) await getDb().insert(domains).values({ slug: "finance", name: "Finance", active: true });
  const seed = async (label: string) => (await getDb().insert(users).values({
    email: `${label}-${crypto.randomUUID()}@example.test`, passwordHash: "test-hash", role: "internal_analyst", organizationId: null, name: label,
  }).returning())[0]!;
  const owner = await seed("owner");
  const other = await seed("other");
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Resume routes" });
  const chat = await createProjectChat(tenant, { scope: "project", projectId: project.id });
  const runOwner = { userId: owner.id, projectId: project.id, chatId: chat.id };
  const journal = await getConversationExecutionJournal();
  const personaUser = { id: owner.id, email: owner.email, role: owner.role as "internal_analyst", organizationId: null };
  await (await import("./fixtures/injectedAiAuthorization")).authorizeInjectedAiForTest(personaUser, t);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = Number(req.header("x-test-user-id"));
    const user = userId === owner.id ? owner : userId === other.id ? other : null;
    const authenticated = req as typeof req & { isAuthenticated: () => boolean; user?: Express.User };
    authenticated.isAuthenticated = () => user !== null;
    if (user) authenticated.user = user;
    next();
  });
  registerProjectConversationRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const as = (user: { id: number }) => ({ "x-test-user-id": String(user.id), "content-type": "application/json" });

  const requestId = crypto.randomUUID();
  const plan = JSON.stringify({ steps: [{ id: "a", toolId: "test.routes.slow", label: "Wait", input: { symbol: "TEST" }, dependsOn: [] }] });
  const aiCompletion = async () => ({ provider: "openai", model: "gpt-4o", text: plan, attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "p", output: plan }) });
  await startProjectChatRun(
    { id: owner.id, email: owner.email, role: owner.role, organizationId: null },
    chat.id,
    { requestId, message: "Wait for the slow tool", executionMode: "ai_assisted", agent: true, sourceScope: "my_data" },
    { aiCompletion },
  );
  await until(() => journal.read(requestId, runOwner), (record) => record?.events?.some((event) => event.kind === "tool_call_started") === true, "the step to start");
  assert.equal(conversationRuns.cancel(requestId, owner.id), true);
  await finished(requestId, owner.id);
  await until(() => journal.read(requestId, runOwner), (record) => record?.status === "interrupted", "interrupted");

  await t.test("list and read project the record: binding facts and a resumable flag, never the continuation", async () => {
    const list = await (await fetch(`${base}/api/project-chats/${chat.id}/executions`, { headers: as(owner) })).json() as Array<{ id: string; status: string; resumable: boolean; checkpoint?: Record<string, unknown> }>;
    const row = list.find((item) => item.id === requestId);
    assert.equal(row?.status, "interrupted");
    assert.equal(row?.resumable, true);
    assert.ok(row?.checkpoint && "bindingSha256" in row.checkpoint, "binding facts stay observable for the Stop/restart fingerprint");
    assert.equal("continuation" in (row?.checkpoint ?? {}), false);
    const read = await (await fetch(`${base}/api/project-chats/${chat.id}/executions/${requestId}`, { headers: as(owner) })).json() as { resumable: boolean; checkpoint?: Record<string, unknown> };
    assert.equal(read.resumable, true);
    assert.equal(JSON.stringify(read).includes("TEST"), false, "the plan's raw tool input never leaves the server");
    const foreign = await fetch(`${base}/api/project-chats/${chat.id}/executions/${requestId}`, { headers: as(other) });
    assert.equal(foreign.status, 404);
  });

  await t.test("the resume route rejects anonymous callers, strangers, malformed ids and any body field", async () => {
    const url = `${base}/api/conversation-executions/${requestId}/resume`;
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: as(other), body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/api/conversation-executions/not-a-uuid/resume`, { method: "POST", headers: as(owner), body: "{}" })).status, 400);
    for (const body of [{ requestId }, { adapterId: "lios.native-agent-loop" }, { objective: "other" }, { checkpointRef: "x" }, { authorization: { grant: true } }, { chatId: chat.id }]) {
      const rejected = await fetch(url, { method: "POST", headers: as(owner), body: JSON.stringify(body) });
      assert.equal(rejected.status, 400, JSON.stringify(body));
    }
    assert.equal((await journal.read(requestId, runOwner))?.status, "interrupted", "every refusal left the record interrupted");
  });

  await t.test("an empty-body owner request resumes the SAME run id; a second request is refused once it is no longer interrupted", async () => {
    const response = await fetch(`${base}/api/conversation-executions/${requestId}/resume`, { method: "POST", headers: as(owner), body: "{}" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, requestId });
    // No model is configured for the real BYOAI path, so the resumed run ends visibly failed after continuing from its checkpoint.
    await finished(requestId, owner.id);
    const after = await until(() => journal.read(requestId, runOwner), (record) => record !== null && record.status !== "running" && record.status !== "interrupted", "the resumed run to end");
    assert.notEqual(after?.status, "interrupted");
    const again = await fetch(`${base}/api/conversation-executions/${requestId}/resume`, { method: "POST", headers: as(owner), body: "{}" });
    assert.equal(again.status, 409);
    assert.equal(((await again.json()) as { code: string }).code, "run_not_interrupted");
    const list = await (await fetch(`${base}/api/project-chats/${chat.id}/executions`, { headers: as(owner) })).json() as Array<{ id: string; resumable: boolean }>;
    assert.equal(list.find((item) => item.id === requestId)?.resumable, false, "a run that is no longer interrupted is not resumable");
  });
});
