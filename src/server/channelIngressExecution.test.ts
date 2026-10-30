import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ConversationRunServiceOptions } from "./conversationRunService";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import type { TelegramAutoRunPolicy } from "@shared/telegramConnection";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-channel-execution-"));
const saved = { data: process.env.LIMURIA_DATA_DIR, secret: process.env.LIMURIA_VAULT_SECRET, store: process.env.LIMURIA_CREDENTIAL_STORE };
process.env.LIMURIA_DATA_DIR = root;
process.env.LIMURIA_VAULT_SECRET = "synthetic-ingress-execution-test-secret-at-least-32";
delete process.env.LIMURIA_CREDENTIAL_STORE;
// DB modules capture the data root at evaluation, so static imports would bind the real Home before this fixture.
const [dbModule, schema, projectStore, chatStore, tenant, vault, ingress, policyModule, runService, registry, journalModule, injected, router, masterAi, runtime, admission] = await Promise.all([
  import("./db"), import("@shared/schema"), import("./projectStore"), import("./projectChatStore"), import("./tenantContext"),
  import("./credentialVault"), import("./telegramConnectionService"), import("@shared/telegramConnection"), import("./conversationRunService"),
  import("./conversationRunRegistry"), import("./exec/execution-scope"), import("./fixtures/injectedAiAuthorization"), import("./byoaiRouter"),
  import("./masterAiGate"), import("./conversationRuntime"), import("./channelIngressExecution"),
]);
let confirmingEffects = 0;
runtime.registerConversationTool({
  id: "test.incoming.owner_review", label: "Confirm a test-owned effect", kind: "calculate", access: "write",
  permissionClass: "user_confirm", sideEffect: "internal_write", replaySafe: false, maxOutputBytes: 1024, cancel: null,
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ output: z.null(), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }).strict(),
  invoke: async () => { confirmingEffects++; return { output: null, summary: "Owner-reviewed effect", deterministic: true, sourceRefs: [] }; },
});
let externalEffects = 0;
runtime.registerConversationTool({
  id: "test.incoming.external", label: "Confirm a test-owned external effect", kind: "calculate", access: "write",
  permissionClass: "user_confirm", sideEffect: "external", replaySafe: false, maxOutputBytes: 1024, cancel: null,
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ output: z.null(), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }).strict(),
  invoke: async () => { externalEffects++; return { output: null, summary: "Owner-reviewed external effect", deterministic: true, sourceRefs: [] }; },
});

async function fixture(t: TestContext, overrides: Partial<TelegramAutoRunPolicy> = {}) {
  const db = dbModule.getDb();
  const id = crypto.randomUUID();
  const [user] = await db.insert(schema.users).values({ email: `${id}@example.test`, name: "Incoming owner", passwordHash: "test-only", role: "internal_admin" }).returning();
  const context = tenant.tenantContext(user);
  const project = await projectStore.createProject(context, { name: "Incoming execution project" });
  const chat = await chatStore.createProjectChat(context, { projectId: project.id, scope: "project" });
  await injected.authorizeInjectedAiForTest(user, t);
  const autoRun = policyModule.telegramAutoRunPolicySchema.parse({ enabled: true, allowedSenderRefs: ["user:777"], ...overrides });
  const policy = policyModule.telegramConnectionPolicySchema.parse({ version: "lios-telegram-connection/1", accountBindingId: id,
    enabled: true, projectId: project.id, chatId: chat.id, allowedConversationIds: ["123"], allowedUpdateTypes: ["message", "edited_message"],
    retentionDays: 7, allowAiTransmission: true, allowOutbound: false, autoRun });
  const name = policyModule.telegramCredentialName(user.id, id);
  vault.setVaultCredential(name, "123456:synthetic_incoming_execution");
  const [source] = await db.insert(schema.sourceConnections).values({ userId: user.id, connectorId: "telegram", name: "Incoming test source",
    sourceType: "private_api", config: policyModule.telegramSourceConfig(policy), credentialRef: `vault:${name}` }).returning();
  await db.insert(schema.userDataConsents).values({ userId: user.id, scope: policyModule.telegramConsentScope(id), consentVersion: policyModule.TELEGRAM_CONNECTION_CONSENT_VERSION });
  const [consent] = await db.insert(schema.userDataConsents).values({ userId: user.id, scope: policyModule.telegramExecutionConsentScope(id), consentVersion: policyModule.TELEGRAM_EXECUTION_CONSENT_VERSION }).returning();
  let updateId = 0;
  const adopt = async (text = "Summarize current Project continuity", senderId = 777, connectionId = source.id) => {
    const n = ++updateId;
    const bytes = Buffer.from(JSON.stringify({ ok: true, result: [{ update_id: n, message: { message_id: n,
      date: 1_700_000_000 + n, chat: { id: 123 }, from: { id: senderId }, text } }] }));
    const poll = await ingress.pollTelegramSourceConnection({ context, connectionId,
      offset: await ingress.nextTelegramPollOffset(context, connectionId), dependencies: {
        resolveAddress: async () => ({ address: "149.154.167.220", family: 4 as const }),
        requester: async () => ({ status: 200, headers: {}, body: bytes }),
      } });
    await ingress.adoptTelegramPoll({ context, connectionId, poll });
    const [row] = await db.select().from(schema.channelIngressUpdates).where(and(eq(schema.channelIngressUpdates.sourceConnectionId, connectionId), eq(schema.channelIngressUpdates.updateId, n))).limit(1);
    assert.ok(row?.chatMessageId);
    return row;
  };
  const messages = () => chatStore.listProjectChatMessages(context, chat.id);
  return { db, user, context, project, chat, source, consent, policy, adopt, messages };
}

async function terminal(requestId: string, userId: number, ignoreWaiting = false) {
  const events: ConversationRuntimeEvent[] = [];
  const done = Promise.withResolvers<void>();
  const subscription = registry.conversationRuns.subscribe(requestId, userId, -1, ({ event }) => {
    events.push(event);
    if (event.type === "done" && (!ignoreWaiting || event.status !== "waiting_approval")) done.resolve();
  });
  assert.ok(subscription);
  try { await done.promise; return events; } finally { subscription.detach(); }
}

function model(before?: (callNumber: number) => Promise<void>, toolId = "lios.project.continuity") {
  const prompts: string[] = [];
  let calls = 0;
  const aiCompletion: NonNullable<ConversationRunServiceOptions["aiCompletion"]> = async request => {
    calls++;
    prompts.push(JSON.stringify(request));
    assert.equal(request.fallback, "none");
    assert.equal(request.dataClassification, "organization");
    assert.equal(request.maxAttempts, 1);
    await before?.(calls);
    const text = calls === 1
      ? JSON.stringify({ steps: [{ id: "continuity", toolId, label: "Run bounded step", input: {}, dependsOn: [] }] })
      : JSON.stringify({ decision: "complete", answer: "Current Project continuity was read under bounded incoming authority." });
    return { provider: "openai", model: "gpt-4o-mini", text,
      attribution: router.createAttribution({ provider: "openai", model: "gpt-4o-mini", prompt: "synthetic injected model", output: text }) };
  };
  return { aiCompletion, prompts, calls: () => calls };
}

// Serial real-DB scenarios take over120s on hosted Intel macOS; individual execution budgets stay unchanged.
test("adopted ingress executes once through the canonical owner and permanently fences replay", { timeout: 240_000 }, async t => {
  await dbModule.initDb();
  const [finance] = await dbModule.getDb().select().from(schema.domains).where(eq(schema.domains.slug, "finance")).limit(1);
  if (!finance) await dbModule.getDb().insert(schema.domains).values({ slug: "finance", name: "Finance", active: true });
  t.after(async () => {
    await dbModule.closeDb(); vault.invalidateVaultCache(); fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries({ LIMURIA_DATA_DIR: saved.data, LIMURIA_VAULT_SECRET: saved.secret, LIMURIA_CREDENTIAL_STORE: saved.store })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  await t.test("disabled, legacy eligibility, foreign actor, changed input and Master AI off never invoke", async t => {
    for (const scenario of ["disabled", "legacy", "foreign", "changed", "master_off", "consent_changed", "policy_changed"] as const) {
      const f = await fixture(t, scenario === "disabled" ? { enabled: false } : {});
      const row = await f.adopt(undefined, scenario === "foreign" ? 888 : 777);
      const [message] = await f.messages();
      if (scenario === "legacy") await f.db.update(schema.projectChatMessages).set({ metadata: { ...message.metadata,
        channelIngress: { ...(message.metadata.channelIngress as Record<string, unknown>), autoRunEligible: undefined } } }).where(eq(schema.projectChatMessages.id, message.id));
      if (scenario === "changed") await f.db.update(schema.projectChatMessages).set({ content: "Locally replaced source objective" }).where(eq(schema.projectChatMessages.id, message.id));
      if (scenario === "master_off") await masterAi.turnMasterAiOff(f.user);
      if (scenario === "consent_changed") await f.db.update(schema.userDataConsents).set({ acceptedAt: new Date(f.consent.acceptedAt.getTime() + 1000) }).where(eq(schema.userDataConsents.id, f.consent.id));
      if (scenario === "policy_changed") await f.db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...f.policy,
        autoRun: { ...f.policy.autoRun!, maxSteps: 3 } }) }).where(eq(schema.sourceConnections.id, f.source.id));
      const m = model();
      assert.equal((await runService.startAdoptedChannelIngressRun(row.id, m)).kind, "not_started", scenario);
      assert.equal(m.calls(), 0, scenario);
      const [custody] = await f.db.select().from(schema.channelIngressUpdates).where(eq(schema.channelIngressUpdates.id, row.id));
      assert.equal(custody.executionRequestId, null, scenario);
    }
  });

  await t.test("parallel duplicate admissions produce one claim, one original user and at most one assistant", async t => {
    const f = await fixture(t);
    const row = await f.adopt("Original external objective");
    await f.adopt("LATER_MESSAGE_MUST_NOT_REACH_THIS_RUN");
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const m = model(async n => { if (n === 1) { entered.resolve(); await release.promise; } });
    const results = await Promise.all([runService.startAdoptedChannelIngressRun(row.id, m), runService.startAdoptedChannelIngressRun(row.id, m)]);
    const started = results.find(result => result.kind === "started");
    assert.ok(started?.kind === "started");
    assert.equal(results.filter(result => result.kind === "started").length, 1);
    await entered.promise;
    assert.equal((await f.messages()).filter(message => message.role === "user").length, 2, "no duplicate initiating user row");
    release.resolve();
    const events = await terminal(started.requestId, f.user.id);
    const completed = events.at(-1);
    assert.equal(completed?.type === "done" ? completed.status : null, "completed");
    const rows = await f.messages();
    assert.equal(rows.filter(message => message.role === "assistant").length, 1);
    assert.equal(rows.find(message => message.role === "assistant")?.metadata.runtimeRequestId, started.requestId);
    assert.equal(rows.find(message => message.id === row.chatMessageId)?.metadata.runtimeRequestId, started.requestId);
    assert.equal(m.prompts.some(prompt => prompt.includes("LATER_MESSAGE_MUST_NOT_REACH_THIS_RUN")), false);
    assert.equal(m.calls(), 2);
    const [custody] = await f.db.select().from(schema.channelIngressUpdates).where(eq(schema.channelIngressUpdates.id, row.id));
    assert.equal(custody.executionRequestId, started.requestId); assert.ok(custody.executionSettledAt);
    await assert.rejects(f.db.insert(schema.projectChatMessages).values({ chatId: f.chat.id, role: "assistant", content: "Duplicate result",
      metadata: { channelIngressExecutionId: row.id } }), (error: unknown) =>
      (error as { cause?: { code?: string } }).cause?.code === "23505");
    const journal = await journalModule.getConversationExecutionJournal();
    assert.equal((await journal.read(started.requestId, { userId: f.user.id, projectId: f.project.id, chatId: f.chat.id }))?.status, "completed");
    assert.equal((await runService.startAdoptedChannelIngressRun(row.id, m)).kind, "not_started");
    await chatStore.clearProjectChatMessages(f.context, f.chat.id);
    assert.equal((await runService.startAdoptedChannelIngressRun(row.id, m)).kind, "not_started");
    assert.equal((await f.messages()).length, 0);
    await assert.rejects(runService.resumeInterruptedConversationRun(f.user, started.requestId, m), error =>
      error instanceof runService.ConversationStartError && error.body.code === "channel_execution_not_replayable");
  });

  await t.test("one inflight source/Chat and rolling hourly/day limits are durable", async t => {
    for (const cap of ["hour", "day"] as const) {
      const f = await fixture(t, { maxRunsPerHour: cap === "hour" ? 1 : 12, maxRunsPerDay: 1 });
      const first = await f.adopt(), second = await f.adopt();
      const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const m = model(async n => { if (n === 1) { entered.resolve(); await release.promise; } });
      const started = await runService.startAdoptedChannelIngressRun(first.id, m); assert.equal(started.kind, "started");
      if (started.kind !== "started") throw new Error("expected admission");
      await entered.promise;
      assert.deepEqual(await runService.startAdoptedChannelIngressRun(second.id, m), { kind: "not_started", reason: "execution_inflight" });
      release.resolve(); await terminal(started.requestId, f.user.id);
      assert.deepEqual(await runService.startAdoptedChannelIngressRun(second.id, m), { kind: "not_started", reason: cap === "hour" ? "hourly_limit" : "daily_limit" });
    }
  });

  await t.test("different sources targeting one Chat cannot overlap execution", async t => {
    const f = await fixture(t); const first = await f.adopt();
    const binding = crypto.randomUUID(); const name = policyModule.telegramCredentialName(f.user.id, binding);
    vault.setVaultCredential(name, "123456:synthetic_other_connection");
    const [source] = await f.db.insert(schema.sourceConnections).values({ userId: f.user.id, connectorId: "telegram", name: "Other incoming source",
      sourceType: "private_api", config: policyModule.telegramSourceConfig({ ...f.policy, accountBindingId: binding }), credentialRef: `vault:${name}` }).returning();
    await f.db.insert(schema.userDataConsents).values([
      { userId: f.user.id, scope: policyModule.telegramConsentScope(binding), consentVersion: policyModule.TELEGRAM_CONNECTION_CONSENT_VERSION },
      { userId: f.user.id, scope: policyModule.telegramExecutionConsentScope(binding), consentVersion: policyModule.TELEGRAM_EXECUTION_CONSENT_VERSION },
    ]);
    const second = await f.adopt(undefined, 777, source.id);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const m = model(async n => { if (n === 1) { entered.resolve(); await release.promise; } });
    const started = await runService.startAdoptedChannelIngressRun(first.id, m);
    assert.equal(started.kind, "started"); if (started.kind !== "started") throw new Error("expected admission");
    await entered.promise;
    assert.deepEqual(await runService.startAdoptedChannelIngressRun(second.id, m), { kind: "not_started", reason: "execution_inflight" });
    release.resolve(); await terminal(started.requestId, f.user.id);
  });

  await t.test("consent revocation and Chat clear during a model call refuse output without resurrection", async t => {
    for (const action of ["revoke", "clear", "replace", "master_off"] as const) {
      const f = await fixture(t); const row = await f.adopt();
      const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      const m = model(async n => { if (n === 1) { entered.resolve(); await release.promise; } });
      const started = await runService.startAdoptedChannelIngressRun(row.id, m); assert.equal(started.kind, "started");
      if (started.kind !== "started") throw new Error("expected admission");
      await entered.promise;
      if (action === "revoke") await f.db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, f.consent.id));
      if (action === "clear") await chatStore.clearProjectChatMessages(f.context, f.chat.id);
      if (action === "replace") await f.db.update(schema.projectChatMessages).set({ content: "changed while model waits" }).where(eq(schema.projectChatMessages.id, row.chatMessageId!));
      if (action === "master_off") await masterAi.turnMasterAiOff(f.user);
      release.resolve(); await terminal(started.requestId, f.user.id);
      assert.equal(m.calls(), 1);
      assert.equal((await f.messages()).filter(message => message.role === "assistant").length, 0, action);
      if (action === "clear") assert.equal((await f.messages()).length, 0);
      assert.equal((await runService.startAdoptedChannelIngressRun(row.id, m)).kind, "not_started");
    }
  });

  await t.test("source AI-call cap stops before an additional injected provider dispatch", async t => {
    const f = await fixture(t, { maxAiCalls: 1 }); const row = await f.adopt(); const m = model();
    const started = await runService.startAdoptedChannelIngressRun(row.id, m); assert.equal(started.kind, "started");
    if (started.kind !== "started") throw new Error("expected admission");
    const events = await terminal(started.requestId, f.user.id);
    assert.equal(m.calls(), 1);
    const retained = (await f.messages()).find(message => message.role === "assistant");
    assert.ok(retained, "the existing bounded-loop stop observation remains visible in Chat");
    assert.equal(retained.metadata.aiDerived, false, "a budget stop is not a completed model answer");
    assert.equal(events.some(event => event.type === "receipt" && event.receipt.aiDerived === false), true);
  });

  await t.test("step and wall-clock budgets bound tool admission and an injected model wait", async t => {
    for (const limit of ["steps", "duration"] as const) {
      const f = await fixture(t, limit === "steps" ? { maxSteps: 1 } : { maxDurationMs: 2000 });
      const row = await f.adopt(); let calls = 0;
      const aiCompletion: NonNullable<ConversationRunServiceOptions["aiCompletion"]> = async request => {
        calls++;
        if (limit === "duration") {
          assert.ok(request.signal);
          const stopped = Promise.withResolvers<never>();
          if (request.signal.aborted) stopped.reject(request.signal.reason);
          else request.signal.addEventListener("abort", () => stopped.reject(request.signal!.reason), { once: true });
          await stopped.promise;
        }
        const text = JSON.stringify({ steps: ["first", "second"].map(id => ({
          id, toolId: "lios.project.continuity", label: id, input: {}, dependsOn: [],
        })) });
        return { provider: "openai", model: "gpt-4o-mini", text,
          attribution: router.createAttribution({ provider: "openai", model: "gpt-4o-mini", prompt: "bounded", output: text }) };
      };
      const started = await runService.startAdoptedChannelIngressRun(row.id, { aiCompletion });
      assert.equal(started.kind, "started"); if (started.kind !== "started") throw new Error("expected admission");
      const events = await terminal(started.requestId, f.user.id);
      assert.equal(events.some(event => event.type === "tool_start"), false, limit);
      assert.equal(calls, 1);
      assert.equal((await f.messages()).filter(message => message.role === "assistant").length, 0);
    }
  });

  await t.test("confirming steps pause for one exact owner review and never self-approve", async t => {
    const f = await fixture(t); const row = await f.adopt();
    const before = confirmingEffects;
    const aiCompletion: NonNullable<ConversationRunServiceOptions["aiCompletion"]> = async () => {
      const text = JSON.stringify({ steps: [{ id: "review", toolId: "test.incoming.owner_review", label: "Review", input: {}, dependsOn: [] }] });
      return { provider: "openai", model: "gpt-4o-mini", text,
        attribution: router.createAttribution({ provider: "openai", model: "gpt-4o-mini", prompt: "review", output: text }) };
    };
    const started = await runService.startAdoptedChannelIngressRun(row.id, { aiCompletion });
    assert.equal(started.kind, "started"); if (started.kind !== "started") throw new Error("expected admission");
    await terminal(started.requestId, f.user.id);
    assert.equal(confirmingEffects, before);
    // Waiting done precedes the actionable review synchronously; replay reads the registry's complete retained emission.
    const replay: ConversationRuntimeEvent[] = [];
    const subscription = registry.conversationRuns.subscribe(started.requestId, f.user.id, -1, ({ event }) => { replay.push(event); });
    subscription?.detach();
    const approval = replay.find(event => event.type === "governed_tool_approval_required");
    assert.ok(approval?.type === "governed_tool_approval_required");
    assert.deepEqual(approval.choices, ["allow_once", "deny"]);
    await assert.rejects(runService.reviewGovernedToolRun(f.user, started.requestId, approval.reviewId, "allow_project"));
    await runService.reviewGovernedToolRun(f.user, started.requestId, approval.reviewId, "deny");
    assert.equal(confirmingEffects, before);
    const [custody] = await f.db.select().from(schema.channelIngressUpdates).where(eq(schema.channelIngressUpdates.id, row.id));
    assert.ok(custody.executionSettledAt);
    const allowed = await fixture(t);
    const allowedRow = await allowed.adopt();
    const allowedModel = model(undefined, "test.incoming.owner_review");
    const allowedRun = await runService.startAdoptedChannelIngressRun(allowedRow.id, allowedModel);
    assert.equal(allowedRun.kind, "started");
    if (allowedRun.kind !== "started") throw new Error("expected admission");
    await terminal(allowedRun.requestId, allowed.user.id);
    const allowedReplay: ConversationRuntimeEvent[] = [];
    const observer = registry.conversationRuns.subscribe(allowedRun.requestId, allowed.user.id, -1, ({ event }) => { allowedReplay.push(event); });
    observer?.detach();
    const exact = allowedReplay.find(event => event.type === "governed_tool_approval_required");
    assert.ok(exact?.type === "governed_tool_approval_required");
    await runService.reviewGovernedToolRun(allowed.user, allowedRun.requestId, exact.reviewId, "allow_once");
    const completed = await terminal(allowedRun.requestId, allowed.user.id, true);
    assert.equal(completed.at(-1)?.type === "done" && (completed.at(-1) as { status: string }).status, "completed");
    assert.equal(confirmingEffects, before + 1, "one exact owner approval executes only its paused effect");
    await assert.rejects(runService.reviewGovernedToolRun(allowed.user, allowedRun.requestId, exact.reviewId, "allow_once"));
    assert.equal(confirmingEffects, before + 1, "replayed review cannot execute twice");
  });

  await t.test("revocation after awaited dispatch preparation refuses the actual exact-approved external effect", async t => {
    const f = await fixture(t); const row = await f.adopt(); const m = model(undefined, "test.incoming.external");
    const before = externalEffects;
    const started = await runService.startAdoptedChannelIngressRun(row.id, m);
    assert.equal(started.kind, "started"); if (started.kind !== "started") throw new Error("expected admission");
    await terminal(started.requestId, f.user.id);
    const replay: ConversationRuntimeEvent[] = [];
    const subscription = registry.conversationRuns.subscribe(started.requestId, f.user.id, -1, ({ event }) => { replay.push(event); });
    subscription?.detach();
    const approval = replay.find(event => event.type === "governed_tool_approval_required");
    assert.ok(approval?.type === "governed_tool_approval_required");
    const journal = await journalModule.getConversationExecutionJournal();
    const append = journal.appendAgentEvent;
    journal.appendAgentEvent = async (requestId, event) => {
      const result = await append.call(journal, requestId, event);
      if (requestId === started.requestId && event.kind === "tool_call_dispatch_intent") {
        await f.db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, f.consent.id));
      }
      return result;
    };
    try {
      await runService.reviewGovernedToolRun(f.user, started.requestId, approval.reviewId, "allow_once");
      await terminal(started.requestId, f.user.id, true);
    } finally { journal.appendAgentEvent = append; }
    assert.equal(externalEffects, before);
    assert.equal(m.calls(), 1);
    assert.equal((await f.messages()).filter(message => message.role === "assistant").length, 0);
    const record = await journal.read(started.requestId, { userId: f.user.id, projectId: f.project.id, chatId: f.chat.id });
    assert.ok(record?.version === 2 && record.events.some(event => event.kind === "tool_call_dispatch_no_effect"));
  });

  await t.test("a cleared input fences tool admission inside nested canonical scopes", async t => {
    const f = await fixture(t); const row = await f.adopt();
    const adopted = await admission.prepareAdoptedChannelIngressLaunch(row.id);
    const before = confirmingEffects;
    await assert.rejects(journalModule.withConversationExecutionScope(crypto.randomUUID(), () =>
      journalModule.withConversationExecutionScope(crypto.randomUUID(), async () => {
        await chatStore.clearProjectChatMessages(f.context, f.chat.id);
        await runtime.invokeConversationTool("test.incoming.owner_review", {}, new AbortController().signal);
      }), undefined, adopted.assertCurrent), error =>
      error instanceof admission.ChannelIngressExecutionRefusal && error.reason === "input_unavailable");
    assert.equal(confirmingEffects, before);
    assert.equal((await f.messages()).length, 0);
  });

  await t.test("journal failure leaves a permanent unsettled claim and Ledger evidence without model dispatch", async t => {
    const f = await fixture(t); const row = await f.adopt(); const m = model();
    const journal = await journalModule.getConversationExecutionJournal();
    const begin = journal.begin;
    journal.begin = async () => { throw new Error("synthetic journal write failure"); };
    try {
      assert.deepEqual(await runService.startAdoptedChannelIngressRun(row.id, m), { kind: "not_started", reason: "execution_journal_failed" });
    } finally { journal.begin = begin; }
    const [custody] = await f.db.select().from(schema.channelIngressUpdates).where(eq(schema.channelIngressUpdates.id, row.id));
    assert.ok(custody.executionRequestId); assert.ok(custody.executionClaimedAt); assert.equal(custody.executionSettledAt, null);
    assert.equal((await runService.startAdoptedChannelIngressRun(row.id, m)).kind, "not_started");
    assert.equal(m.calls(), 0);
    const events = await f.db.select().from(schema.projectLedgerEvents).where(eq(schema.projectLedgerEvents.requestId, custody.executionRequestId!));
    assert.equal(events.filter(event => event.payload.purpose === "channel_ingress_claim").length, 1);
    assert.equal(JSON.stringify(events).includes("Summarize current Project continuity"), false);
    await chatStore.clearProjectChatMessages(f.context, f.chat.id);
    const next = await f.adopt();
    assert.deepEqual(await runService.startAdoptedChannelIngressRun(next.id, m), { kind: "not_started", reason: "execution_inflight" },
      "clearing content cannot release an ambiguous durable source/Chat claim");
  });
});
