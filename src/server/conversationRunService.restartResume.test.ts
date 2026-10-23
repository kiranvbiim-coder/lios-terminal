import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { createAttribution } from "./byoaiRouter";

// DB-dependent modules load after the data directory is set, because db.ts binds it at module evaluation.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-restart-resume-"));
process.env.LIMURIA_DATA_DIR = dataDir;
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete process.env[key];
const { initDb, closeDb, getDb } = await import("./db");
const { users, domains } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createProject } = await import("./projectStore");
const { createProjectChat, addProjectChatMessage, listProjectChatMessages } = await import("./projectChatStore");
const { startProjectChatRun, resumeInterruptedConversationRun, reviewGovernedToolRun, ConversationStartError } = await import("./conversationRunService");
const { conversationRuns } = await import("./conversationRunRegistry");
const { getConversationExecutionJournal } = await import("./exec/execution-scope");
const { registerConversationTool } = await import("./conversationRuntime");
const { assertAgentEventChain } = await import("./exec/agent-run-events");

const anyInput = z.object({}).passthrough();
const anyResult = z.object({ output: z.unknown(), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }).strict();
type Tool = Parameters<typeof registerConversationTool>[0];
const governed = (tool: Pick<Tool, "id" | "label" | "kind" | "permissionClass" | "invoke">, extra: Partial<Tool> = {}): Tool => ({
  access: "read", sideEffect: "none", replaySafe: true, inputSchema: anyInput, outputSchema: anyResult, cancel: null, ...tool, ...extra,
} as Tool);

const echoRuns: string[] = [];
const slowRuns: string[] = [];
const externalRuns: string[] = [];
let cancelOnUnknownExternal: (() => void) | null = null;
registerConversationTool(governed({
  id: "test.restart.external", label: "External write", kind: "calculate", permissionClass: "user_confirm",
  invoke: async (input) => { externalRuns.push(String(input.symbol)); return { output: null, summary: "external done", deterministic: true, sourceRefs: ["test:external"] }; },
}, { access: "write", sideEffect: "external", replaySafe: false }));
registerConversationTool(governed({
  id: "test.restart.external-unknown", label: "External effect with unknown outcome", kind: "calculate", permissionClass: "user_confirm",
  invoke: async () => {
    externalRuns.push("unknown");
    cancelOnUnknownExternal?.();
    throw new Error("provider accepted the write but the response was lost");
  },
}, { access: "write", sideEffect: "external", replaySafe: false }));
const gatedRuns: string[] = [];
let slowMode: "wait_for_stop" | "instant" = "wait_for_stop";
registerConversationTool(governed({
  id: "test.restart.echo", label: "Echo", kind: "retrieve", permissionClass: "safe_auto",
  invoke: async (input) => { echoRuns.push(String(input.symbol)); return { output: null, summary: `echo ${String(input.symbol)}`, deterministic: true, sourceRefs: ["test:echo"] }; },
}));
registerConversationTool(governed({
  id: "test.restart.slow", label: "Slow", kind: "retrieve", permissionClass: "safe_auto",
  invoke: async (_input, signal) => {
    slowRuns.push(slowMode);
    if (slowMode === "wait_for_stop") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 20_000);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
      });
    }
    return { output: null, summary: "slow done", deterministic: true, sourceRefs: ["test:slow"] };
  },
}));
registerConversationTool(governed({
  id: "test.restart.gated", label: "Gated", kind: "calculate", permissionClass: "user_confirm",
  invoke: async (input) => { gatedRuns.push(String(input.symbol)); return { output: null, summary: "gated done", deterministic: true, sourceRefs: ["test:gated"] }; },
}));

const planJson = (steps: unknown[]) => JSON.stringify({ steps });
const step = (id: string, toolId: string, dependsOn: string[] = []) => ({ id, toolId, label: `Run ${id}`, input: { symbol: "TEST" }, dependsOn });
const answer = (text: string) => JSON.stringify({ decision: "complete", answer: text });

function stubModel(script: Array<string | "wait_for_stop">) {
  const queue = [...script];
  const prompts: string[] = [];
  return {
    prompts,
    aiCompletion: async (completion: { signal?: AbortSignal; messages: Array<{ content: string }> }) => {
      prompts.push(completion.messages.map((message) => message.content).join("\n"));
      const next = queue.shift();
      if (next === undefined) throw new Error("model called more often than scripted");
      if (next === "wait_for_stop") {
        await new Promise<void>((_resolve, reject) => {
          completion.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      return { provider: "openai", model: "gpt-4o", text: next, attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "p", output: next }) };
    },
  };
}

async function seedUser() {
  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Restart tester", role: "internal_analyst", organizationId: null,
  }).returning();
  return user!;
}

function waitForEvent(requestId: string, userId: number, match: (event: ConversationRuntimeEvent) => boolean): Promise<ConversationRuntimeEvent[]> {
  const events: ConversationRuntimeEvent[] = [];
  const done = Promise.withResolvers<ConversationRuntimeEvent[]>();
  const subscription = conversationRuns.subscribe(requestId, userId, -1, ({ event }) => {
    events.push(event);
    if (match(event)) done.resolve(events);
  });
  assert.ok(subscription, "the run is registered");
  return done.promise.finally(() => subscription.detach());
}

const finished = (requestId: string, userId: number) =>
  waitForEvent(requestId, userId, (event) => event.type === "done" && event.status !== "waiting_approval");


async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string): Promise<T> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("Stop parks a checkpointed agent run as interrupted; an explicit requestId-only resume continues the SAME run without re-planning", { timeout: 120_000 }, async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const [finance] = await getDb().select().from(domains).where(eq(domains.slug, "finance")).limit(1);
  if (!finance) await getDb().insert(domains).values({ slug: "finance", name: "Finance", active: true });
  const user = await seedUser();
  const tenant = { userId: user.id, role: user.role, organizationId: null };
  const project = await createProject(tenant, { name: "Restart project" });
  const chat = await createProjectChat(tenant, { projectId: project.id, scope: "project" });
  const owner = { userId: user.id, projectId: project.id, chatId: chat.id };
  const journal = await getConversationExecutionJournal();
  const conversationUser = { id: user.id, email: user.email, role: user.role, organizationId: null };
  const personaUser = { id: user.id, email: user.email, role: user.role as "internal_analyst", organizationId: null };
  await (await import("./fixtures/injectedAiAuthorization")).authorizeInjectedAiForTest(personaUser, t);

  const startAgent = (requestId: string, script: Array<string | "wait_for_stop">, message = "Compare the quote for TEST") =>
    startProjectChatRun(conversationUser, chat.id, { requestId, message, executionMode: "ai_assisted", agent: true, sourceScope: "my_data" }, { aiCompletion: stubModel(script).aiCompletion });

  await t.test("Stop with a checkpoint: done:cancelled to the UI, durable interrupted record, open ledger, no answer saved", async () => {
    echoRuns.length = 0; slowRuns.length = 0; slowMode = "wait_for_stop";
    const requestId = crypto.randomUUID();
    await startAgent(requestId, [planJson([step("a", "test.restart.echo"), step("b", "test.restart.slow", ["a"])])]);
    await until(() => journal.read(requestId, owner), (record) => record?.events?.some((event) => event.kind === "tool_call_started" && event.toolCallId === "b-call") === true, "step b to be in flight");
    assert.equal(conversationRuns.cancel(requestId, user.id), true);
    const events = await finished(requestId, user.id);
    assert.equal((events.at(-1) as { status: string }).status, "cancelled", "the UI still sees done:cancelled");

    const record = await until(() => journal.read(requestId, owner), (value) => value?.status === "interrupted", "the durable interrupted state");
    assert.equal(record?.version, 2);
    assert.notEqual(record?.endedAt, null);
    assert.ok(record?.checkpoint?.continuation, "the owner-bound checkpoint with its continuation is preserved");
    assert.deepEqual(record?.checkpoint?.continuation?.settled.map((outcome) => outcome.id), ["a"]);
    assert.equal(record?.events?.some((event) => event.kind === "step_finished" && event.stepId === "b"), false, "the stopped step stays open");
    const messages = await listProjectChatMessages(tenant, chat.id);
    assert.equal(messages.filter((message) => message.role === "assistant" && message.metadata.runtimeRequestId === requestId).length, 0);
    const initiating = messages.find((message) => message.role === "user" && message.metadata.runtimeRequestId === requestId);
    assert.ok(initiating?.metadata.agentRestart, "bounded reconstruction facts were persisted with the initiating message");
    assert.equal(record?.checkpoint?.sourceMessageId, initiating.id, "the encrypted checkpoint pins the exact initiating transcript row");
    assert.equal(JSON.stringify(initiating?.metadata).includes("authoriz"), false);

    await assert.rejects(
      startAgent(requestId, [answer("must not run")], "Duplicate request id must be refused."),
      (error: unknown) => error instanceof ConversationStartError && error.status === 409 && error.body.code === "request_id_already_used",
    );
    assert.equal(
      (await listProjectChatMessages(tenant, chat.id)).filter((message) => message.role === "user" && message.metadata.runtimeRequestId === requestId).length,
      1,
      "a sequential requestId replay is refused before it can append another objective",
    );
    // Model the concurrent append race: resume must use the message ID bound into the encrypted checkpoint, not become
    // ambiguous because another user message later claims the same requestId.
    await addProjectChatMessage(tenant, chat.id, {
      role: "user",
      content: "Concurrent duplicate requestId row.",
      metadata: { runtimeRequestId: requestId },
    });
    // A fresh process (restart recovery) neither changes the record nor executes anything.
    await journal.recoverInterrupted();
    const after = await journal.read(requestId, owner);
    assert.deepEqual(after, record);
    assert.deepEqual(slowRuns, ["wait_for_stop"], "nothing re-executed");

    slowMode = "instant";
    const model = stubModel([answer("Resumed and compared.")]);
    const resumed = await resumeInterruptedConversationRun(conversationUser, requestId, { aiCompletion: model.aiCompletion });
    assert.equal(resumed.requestId, requestId, "the same requestId, never a new run");
    assert.equal(conversationRuns.getScoped(requestId, owner)?.requestId, requestId);
    const resumedEvents = await finished(requestId, user.id);
    assert.equal((resumedEvents.at(-1) as { status: string }).status, "completed");
    assert.ok(resumedEvents.some((event) => event.type === "plan"), "the validated plan is republished");
    assert.ok(resumedEvents.some((event) => event.type === "receipt"));

    const done = await journal.read(requestId, owner);
    assert.equal(done?.status, "completed");
    assert.deepEqual(echoRuns, ["TEST"], "the settled step was not re-run");
    assert.deepEqual(slowRuns, ["wait_for_stop", "instant"], "the stopped step ran once more");
    assert.equal(model.prompts.length, 1, "no re-plan: the only model call is the inspection");
    assert.match(model.prompts[0]!, /Results/);
    assert.doesNotThrow(() => assertAgentEventChain(done!.events!, requestId));
    assert.equal(done!.events!.filter((event) => event.kind === "step_started" && event.stepId === "b").length, 1);
    assert.ok(done!.events!.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call" && event.status === "cancelled"));
    assert.ok(done!.events!.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call-r1" && event.status === "succeeded"));
    assert.equal(done?.checkpoint?.sourceMessageId, initiating.id);
    assert.doesNotMatch(model.prompts.join("\\n"), /Concurrent duplicate requestId row/);
    const finalMessages = await listProjectChatMessages(tenant, chat.id);
    assert.equal(finalMessages.filter((message) => message.role === "user" && message.metadata.runtimeRequestId === requestId).length, 2, "the synthetic concurrent duplicate remains a separate transcript row");
    assert.equal(finalMessages.filter((message) => message.role === "assistant" && message.metadata.runtimeRequestId === requestId).length, 1);

    await assert.rejects(resumeInterruptedConversationRun(conversationUser, requestId), (error: unknown) => error instanceof ConversationStartError && error.status === 409 && error.body.code === "run_not_interrupted");
  });
  await t.test("concurrent duplicate requestId starts admit one run before transcript append", async () => {
    slowMode = "wait_for_stop";
    const requestId = crypto.randomUUID();
    const outcomes = await Promise.allSettled([
      startAgent(requestId, [planJson([step("a", "test.restart.slow")])], "First concurrent objective."),
      startAgent(requestId, [planJson([step("a", "test.restart.slow")])], "Second concurrent objective."),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    assert.ok(rejected?.reason instanceof ConversationStartError);
    assert.equal(rejected.reason.status, 409);
    assert.equal(rejected.reason.body.code, "request_id_already_used");
    assert.equal(
      (await listProjectChatMessages(tenant, chat.id)).filter((message) => message.role === "user" && message.metadata.runtimeRequestId === requestId).length,
      1,
      "the losing concurrent start appends no orphan objective",
    );
    await until(() => journal.read(requestId, owner), (record) => record?.events?.some((event) => event.kind === "tool_call_started") === true, "the admitted run to start");
    assert.equal(conversationRuns.cancel(requestId, user.id), true);
    await finished(requestId, user.id);
    await until(() => journal.read(requestId, owner), (record) => record?.status === "interrupted", "the admitted run to park");
  });


  await t.test("Stop before any checkpoint exists is a terminal cancelled run that can never resume", async () => {
    const requestId = crypto.randomUUID();
    await startAgent(requestId, ["wait_for_stop"]);
    await until(() => journal.read(requestId, owner), (record) => record?.version === 2, "the run to begin");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(conversationRuns.cancel(requestId, user.id), true);
    const events = await finished(requestId, user.id);
    assert.equal((events.at(-1) as { status: string }).status, "cancelled");
    const record = await until(() => journal.read(requestId, owner), (value) => value !== null && value.status !== "running", "terminal state");
    assert.equal(record?.status, "cancelled");
    assert.equal(record?.checkpoint, undefined);
    await assert.rejects(resumeInterruptedConversationRun(conversationUser, requestId), (error: unknown) => error instanceof ConversationStartError && error.status === 409 && error.body.code === "run_not_interrupted");
  });

  await t.test("a second concurrent resume of the same run is refused, and a re-Stop re-parks the run for another resume with a fresh call id", async () => {
    echoRuns.length = 0; slowRuns.length = 0; slowMode = "wait_for_stop";
    const requestId = crypto.randomUUID();
    await startAgent(requestId, [planJson([step("a", "test.restart.echo"), step("b", "test.restart.slow", ["a"])])]);
    await until(() => journal.read(requestId, owner), (record) => record?.events?.some((event) => event.kind === "tool_call_started" && event.toolCallId === "b-call") === true, "step b to be in flight");
    conversationRuns.cancel(requestId, user.id);
    await finished(requestId, user.id);
    await until(() => journal.read(requestId, owner), (value) => value?.status === "interrupted", "interrupted");

    const first = await resumeInterruptedConversationRun(conversationUser, requestId, { aiCompletion: stubModel([answer("never reached")]).aiCompletion });
    assert.equal(first.requestId, requestId);
    await assert.rejects(
      resumeInterruptedConversationRun(conversationUser, requestId, { aiCompletion: stubModel([answer("never reached")]).aiCompletion }),
      (error: unknown) => error instanceof ConversationStartError && error.status === 409,
    );
    await until(() => journal.read(requestId, owner), (record) => record?.status === "running" && record.events?.some((event) => event.kind === "tool_call_started" && event.toolCallId === "b-call-r1") === true, "the resumed call to be in flight");
    assert.equal(slowRuns.length, 2);

    conversationRuns.cancel(requestId, user.id);
    const second = await finished(requestId, user.id);
    assert.equal((second.at(-1) as { status: string }).status, "cancelled");
    const parked = await until(() => journal.read(requestId, owner), (value) => value?.status === "interrupted", "re-parked");
    assert.equal(parked?.events?.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "b-call-r1"), false, "the newest call stays open");

    slowMode = "instant";
    await resumeInterruptedConversationRun(conversationUser, requestId, { aiCompletion: stubModel([answer("Third time lucky.")]).aiCompletion });
    const events = await finished(requestId, user.id);
    assert.equal((events.at(-1) as { status: string }).status, "completed");
    const done = await journal.read(requestId, owner);
    assert.equal(done?.status, "completed");
    assert.doesNotThrow(() => assertAgentEventChain(done!.events!, requestId));
    assert.ok(done!.events!.some((event) => event.kind === "tool_call_started" && event.toolCallId === "b-call-r2"));
    assert.deepEqual(echoRuns, ["TEST"], "the settled step never re-ran across both resumes");
  });

  await t.test("a confirm-class step re-pauses for a FRESH approval after Stop and resume; it is never self-authorized and runs exactly once after approval", async () => {
    gatedRuns.length = 0;
    const requestId = crypto.randomUUID();
    await startAgent(requestId, [planJson([step("g", "test.restart.gated")])]);
    const first = await waitForEvent(requestId, user.id, (event) => event.type === "governed_tool_approval_required" || event.type === "done");
    assert.ok(first.some((event) => event.type === "governed_tool_approval_required"));
    assert.equal((await journal.read(requestId, owner))?.status, "waiting_approval");

    conversationRuns.cancel(requestId, user.id);
    await until(() => journal.read(requestId, owner), (value) => value?.status === "interrupted", "interrupted from the approval pause");
    assert.deepEqual(gatedRuns, [], "nothing ran");

    const model = stubModel([answer("Approved and done.")]);
    await resumeInterruptedConversationRun(conversationUser, requestId, { aiCompletion: model.aiCompletion });
    const resumedEvents = await waitForEvent(requestId, user.id, (event) => event.type === "governed_tool_approval_required" || (event.type === "done" && event.status !== "waiting_approval"));
    const approval = resumedEvents.find((event) => event.type === "governed_tool_approval_required");
    assert.ok(approval && approval.type === "governed_tool_approval_required", JSON.stringify(resumedEvents.filter((event) => event.type === "error" || event.type === "done")));
    assert.deepEqual(gatedRuns, [], "the resumed confirm-class step did not execute without a new approval");
    const waiting = await until(() => journal.read(requestId, owner), (value) => value?.status === "waiting_approval", "a fresh durable approval pause");
    assert.ok(waiting?.events?.some((event) => event.kind === "tool_call_finished" && event.toolCallId === "g-call" && event.status === "cancelled"));
    assert.ok(waiting?.events?.some((event) => event.kind === "tool_call_waiting_approval" && event.toolCallId === "g-call-r1"));

    const released = await reviewGovernedToolRun(conversationUser, requestId, approval.reviewId, "allow_once");
    assert.equal(released.status, "resuming");
    const events = await waitForEvent(requestId, user.id, (event) => event.type === "done" && event.status !== "waiting_approval");
    assert.equal((events.at(-1) as { status: string }).status, "completed");
    assert.deepEqual(gatedRuns, ["TEST"], "executed exactly once");
    const done = await journal.read(requestId, owner);
    assert.equal(done?.status, "completed");
    assert.doesNotThrow(() => assertAgentEventChain(done!.events!, requestId));
    assert.ok(done!.events!.some((event) => event.kind === "tool_call_resumed" && event.toolCallId === "g-call-r1"));
  });

  await t.test("an external effect interrupted before dispatch took effect resumes under the SAME idempotency key and commits exactly once", async () => {
    externalRuns.length = 0;
    const requestId = crypto.randomUUID();
    const original = journal.appendAgentEvent.bind(journal);
    let armed = true;
    // Deterministic induction: the user presses Stop in the instant the write-ahead dispatch intent becomes durable. The
    // production dispatch path then proves the tool was never entered and records `dispatch_no_effect`.
    journal.appendAgentEvent = async (id, event) => {
      const sealed = await original(id, event);
      if (armed && id === requestId && typeof event === "object" && event !== null && "kind" in event && event.kind === "tool_call_dispatch_intent") {
        armed = false;
        conversationRuns.cancel(requestId, user.id);
      }
      return sealed;
    };
    t.after(() => { journal.appendAgentEvent = original; });

    await startAgent(requestId, [planJson([step("w", "test.restart.external")])]);
    const approvalEvents = await waitForEvent(requestId, user.id, (event) => event.type === "governed_tool_approval_required");
    const firstApproval = approvalEvents.find((event) => event.type === "governed_tool_approval_required");
    assert.ok(firstApproval && firstApproval.type === "governed_tool_approval_required");
    await reviewGovernedToolRun(conversationUser, requestId, firstApproval.reviewId, "allow_once");
    const cancelled = await waitForEvent(requestId, user.id, (event) => event.type === "done" && event.status === "cancelled");
    assert.equal((cancelled.at(-1) as { status: string }).status, "cancelled");

    const parked = await until(() => journal.read(requestId, owner), (value) => value?.status === "interrupted", "interrupted after the induced Stop");
    const kinds = parked!.events!.map((event) => `${event.kind}${"attempt" in event ? `:${event.attempt}` : ""}`);
    assert.deepEqual(kinds.filter((kind) => kind.startsWith("tool_call_dispatch")), ["tool_call_dispatch_intent:1", "tool_call_dispatch_no_effect:1"]);
    assert.deepEqual(externalRuns, [], "the external tool was never entered");

    const model = stubModel([answer("Written once.")]);
    await resumeInterruptedConversationRun(conversationUser, requestId, { aiCompletion: model.aiCompletion });
    const resumedEvents = await waitForEvent(requestId, user.id, (event) => event.type === "governed_tool_approval_required");
    const secondApproval = resumedEvents.find((event) => event.type === "governed_tool_approval_required");
    assert.ok(secondApproval && secondApproval.type === "governed_tool_approval_required");
    assert.notEqual(secondApproval.reviewId, firstApproval.reviewId, "a fresh review, never the old authorization");
    assert.deepEqual(externalRuns, [], "resume alone dispatched nothing");
    await reviewGovernedToolRun(conversationUser, requestId, secondApproval.reviewId, "allow_once");
    await waitForEvent(requestId, user.id, (event) => event.type === "done" && event.status === "completed");

    const done = await journal.read(requestId, owner);
    assert.equal(done?.status, "completed");
    assert.doesNotThrow(() => assertAgentEventChain(done!.events!, requestId));
    const dispatches = done!.events!.filter((event) => event.kind === "tool_call_dispatch_intent" || event.kind === "tool_call_dispatch_no_effect" || event.kind === "tool_call_dispatch_committed");
    assert.deepEqual(dispatches.map((event) => `${event.kind}:${event.toolCallId}:${event.attempt}`), [
      "tool_call_dispatch_intent:w-call:1",
      "tool_call_dispatch_no_effect:w-call:1",
      "tool_call_dispatch_intent:w-call-r1:1",
      "tool_call_dispatch_committed:w-call-r1:1",
    ]);
    assert.equal(new Set(dispatches.map((event) => event.idempotencyKey)).size, 1, "one idempotency key across both attempts");
    assert.equal(dispatches.filter((event) => event.kind === "tool_call_dispatch_committed").length, 1, "exactly one durable commit");
    assert.deepEqual(externalRuns, ["TEST"], "the external effect happened exactly once");
    const link = done!.events!.find((event) => event.kind === "tool_call_started" && event.toolCallId === "w-call-r1");
    assert.equal(link?.kind === "tool_call_started" && link.resumesToolCallId, "w-call", "the retry call is explicitly linked to the call it continues");
    const first = done!.events!.find((event) => event.kind === "tool_call_started" && event.toolCallId === "w-call");
    assert.equal(first?.kind === "tool_call_started" && first.resumesToolCallId, undefined, "the original call carries no link");
  });

  await t.test("Stop racing an outcome-unknown external dispatch preserves reconciliation state", async () => {
    externalRuns.length = 0;
    const requestId = crypto.randomUUID();
    await startAgent(requestId, [planJson([step("unknown", "test.restart.external-unknown")])]);
    const approvalEvents = await waitForEvent(requestId, user.id, (event) => event.type === "governed_tool_approval_required");
    const approval = approvalEvents.find((event) => event.type === "governed_tool_approval_required");
    assert.ok(approval && approval.type === "governed_tool_approval_required");
    cancelOnUnknownExternal = () => { assert.equal(conversationRuns.cancel(requestId, user.id), true); };
    try {
      await reviewGovernedToolRun(conversationUser, requestId, approval.reviewId, "allow_once");
      const record = await until(
        () => journal.read(requestId, owner),
        (value) => value?.status === "interrupted" || value?.status === "completed" || value?.status === "failed",
        "terminal or reconciliation journal state",
      );
      const events = await finished(requestId, user.id);
      assert.notEqual((events.at(-1) as { status: string }).status, "cancelled", "unknown dispatch is not normalized to an ordinary Stop");
      assert.equal(record?.status, "interrupted", JSON.stringify({ done: events.at(-1), recordStatus: record?.status, stdout: record?.stdout, stderr: record?.stderr, ledger: record?.events?.map((event) => event.kind) }));
      assert.deepEqual(record?.events?.filter((event) =>
        event.kind === "tool_call_dispatch_intent" || event.kind === "tool_call_dispatch_no_effect" || event.kind === "tool_call_dispatch_committed",
      ).map((event) => event.kind), ["tool_call_dispatch_intent"]);
      assert.deepEqual(externalRuns, ["unknown"]);
      const { isRestartResumable } = await import("./executionRecordView");
      assert.equal(isRestartResumable(record!, await listProjectChatMessages(tenant, chat.id)), false, "an unresolved dispatch is not advertised as resumable");
      await assert.rejects(
        resumeInterruptedConversationRun(conversationUser, requestId),
        (error: unknown) => error instanceof ConversationStartError && error.status === 409 && error.body.code === "reconciliation_required",
      );
    } finally {
      cancelOnUnknownExternal = null;
    }
  });

  await t.test("resume is owner-scoped, requestId-validated and refuses an unknown run", async () => {
    const requestId = crypto.randomUUID();
    slowMode = "wait_for_stop";
    await startAgent(requestId, [planJson([step("a", "test.restart.slow")])]);
    await until(() => journal.read(requestId, owner), (record) => record?.events?.some((event) => event.kind === "tool_call_started") === true, "the step to start");
    conversationRuns.cancel(requestId, user.id);
    await finished(requestId, user.id);
    await until(() => journal.read(requestId, owner), (value) => value?.status === "interrupted", "interrupted");

    const stranger = await seedUser();
    const strangerUser = { id: stranger.id, email: stranger.email, role: stranger.role, organizationId: null };
    await assert.rejects(resumeInterruptedConversationRun(strangerUser, requestId), (error: unknown) => error instanceof ConversationStartError && error.status === 404);
    await assert.rejects(resumeInterruptedConversationRun(conversationUser, crypto.randomUUID()), (error: unknown) => error instanceof ConversationStartError && error.status === 404);
    for (const bad of [requestId.toUpperCase(), "not-a-uuid", 7, null, { requestId }]) {
      await assert.rejects(resumeInterruptedConversationRun(conversationUser, bad), (error: unknown) => error instanceof ConversationStartError && error.status === 400);
    }
    assert.equal((await journal.read(requestId, owner))?.status, "interrupted", "refusals leave the record interrupted");
    assert.equal(conversationRuns.getScoped(requestId, owner)?.finished, true, "and register nothing new");

    // Drift: a changed tool catalogue changes the checkpoint's tool-set binding. The resume is refused before anything runs.
    registerConversationTool(governed({
      id: "test.restart.late", label: "Registered after the interruption", kind: "retrieve", permissionClass: "safe_auto",
      invoke: async () => ({ output: null, summary: "late", deterministic: true, sourceRefs: [] }),
    }));
    const slowBefore = slowRuns.length;
    await assert.rejects(
      resumeInterruptedConversationRun(conversationUser, requestId, { aiCompletion: stubModel([answer("never")]).aiCompletion }),
      (error: unknown) => error instanceof ConversationStartError && error.status === 409 && error.body.code === "agent_resume_drift",
    );
    assert.equal((await journal.read(requestId, owner))?.status, "interrupted");
    assert.equal(slowRuns.length, slowBefore, "nothing executed");
  });
});
