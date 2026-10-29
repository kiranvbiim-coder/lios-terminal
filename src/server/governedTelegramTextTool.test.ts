import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import type { GovernedToolCall } from "./governedTools";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-reviewed-channel-text-"));
process.env.LIMURIA_DATA_DIR = root;
process.env.LIMURIA_VAULT_SECRET = "synthetic-reviewed-channel-test-secret-32-chars";
delete process.env.LIMURIA_CREDENTIAL_STORE;
const dbModule = await import("./db");
const schema = await import("@shared/schema");
const setup = await import("./telegramConnectionSetup");
const connection = await import("./telegramConnectionService");
const policyModule = await import("@shared/telegramConnection");
const vault = await import("./credentialVault");
const { createProject } = await import("./projectStore");
const { createProjectChat } = await import("./projectChatStore");
const { GovernedToolRegistry } = await import("./governedTools");
const grants = await import("./conversationGrantStore");
const { createTelegramTextTool, telegramTargetsTool, preflightTelegramText } = await import("./governedTelegramTextTool");
const { telegramTextInputSchema } = await import("@shared/telegramConnection");
const { requestPinned } = await import("./p13PluginNetworkBroker");

test("reviewed Telegram text uses current consent, one exact grant, pinned Home HTTP and durable provider facts", { timeout: 90_000 }, async t => {
  await dbModule.initDb();
  const observed: Record<string, unknown>[] = [];
  let responseMode: "accept" | "reject" | "lost" | "wrong_topic" = "accept";
  const http = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const value = JSON.parse(body); observed.push(value);
      if (responseMode === "lost") { req.socket.destroy(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      if (responseMode === "reject") { res.end(JSON.stringify({ ok: false, error_code: 429, description: "private provider diagnostic" })); return; }
      res.end(JSON.stringify({ ok: true, result: { message_id: 91, chat: { id: Number(value.chat_id), type: "supergroup" },
        ...(value.message_thread_id ? { message_thread_id: responseMode === "wrong_topic" ? 999 : value.message_thread_id } : {}),
        ...(value.direct_messages_topic_id ? { direct_messages_topic: { topic_id: value.direct_messages_topic_id } } : {}),
        ...(value.reply_parameters ? { reply_to_message: { message_id: value.reply_parameters.message_id } } : {}) } }));
    });
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  t.after(async () => { http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); grants.clearOnceApprovals(); await dbModule.closeDb(); vault.invalidateVaultCache(); fs.rmSync(root, { recursive: true, force: true }); });
  const fixture = async (allowOutbound = true) => {
    const [user] = await dbModule.getDb().insert(schema.users).values({ name: "Synthetic channel owner", email: `${crypto.randomUUID()}@example.invalid`, passwordHash: "test", role: "internal_admin" }).returning();
    const tenant = { userId: user.id, organizationId: null, role: user.role };
    const project = await createProject(tenant, { name: "Reviewed channel Project" });
    const chat = await createProjectChat(tenant, { scope: "project", projectId: project.id });
    const connectionSummary = await setup.connectTelegram(user, { name: "Reviewed bot", botToken: "123456:synthetic_reviewed_text", projectId: project.id, chatId: chat.id,
      allowedConversationIds: ["-123"], consent: true, allowOutbound, ...(allowOutbound ? { outboundConsent: true } : {}) });
    const call: GovernedToolCall = { source: "agent", tenant, userId: user.id, projectId: project.id, chatId: chat.id, role: user.role,
      requestId: crypto.randomUUID(), sourceScope: "my_data", resourceTransmissionAllowed: true };
    const access = allowOutbound ? await connection.prepareTelegramOutboundConnection(tenant, connectionSummary.connectionId, project.id, chat.id) : null;
    const input: import("zod").z.output<typeof telegramTextInputSchema> = { connectionId: connectionSummary.connectionId, reviewBinding: access?.reviewBinding ?? "0".repeat(64), recipientId: "-123", text: "Reviewed exact financial text: revenue $1,250.00.", topic: { kind: "forum", id: 7 }, replyToMessageId: 17, silent: false };
    access?.close();
    return { user, tenant, project, chat, call, input, summary: connectionSummary };
  };
  const dependencies = (options: { beforeDns?: () => Promise<void>; afterResponse?: () => Promise<void> } = {}) => ({
    resolveAddress: async () => { await options.beforeDns?.(); return { address: "127.0.0.1", family: 4 as const }; },
    requester: async (request: Parameters<typeof requestPinned>[0]) => {
      assert.equal(request.url.hostname, "api.telegram.org"); assert.equal(request.url.pathname.endsWith("/sendMessage"), true);
      const response = await requestPinned({ ...request, url: new URL(`http://127.0.0.1:${port}/sendMessage`) });
      await options.afterResponse?.(); return response;
    },
  });
  const prepare = async (f: Awaited<ReturnType<typeof fixture>>, deps = dependencies()) => {
    const registry = new GovernedToolRegistry<"resolve" | "retrieve" | "calculate", import("./conversationRuntime").ConversationToolResult>();
    registry.register(createTelegramTextTool(deps));
    const descriptor = registry.get("lios.channel.telegram.send_text")!;
    const controller = new AbortController();
    const policy = { permissionClass: "user_confirm" as const, policyRevision: "a".repeat(64) };
    const planHash = "b".repeat(64);
    const proposal = await grants.proposeGovernedToolOperation({ user: f.user, projectId: f.project.id, chatId: f.chat.id,
      requestId: f.call.requestId!, stepId: "send", toolCallId: "send-call", toolId: descriptor.id, input: f.input, descriptor, planHash,
      policy, currentPolicy: () => policy, runSignal: controller.signal });
    let noEffect = 0;
    const call = { ...f.call, stepId: "send", toolCallId: "send-call", planHash, runSignal: controller.signal,
      idempotencyKey: crypto.randomUUID(), beforeExternalDispatch: async () => preflightTelegramText(f.input, f.call, controller.signal),
      markExternalDispatchNoEffect: async () => { noEffect++; }, afterExternalDispatchCommitted: async () => {} };
    const approve = async (scope: "once" | "project" = "once") => {
      await grants.reviewGovernedToolOperation({ user: f.user, requestId: f.call.requestId!, ...proposal, allow: true, scope });
      const authorization = await grants.resolveGovernedToolOperation({ user: f.user, requestId: f.call.requestId!, ...proposal });
      return { ...call, authorization };
    };
    return { registry, descriptor, controller, call, approve, noEffect: () => noEffect };
  };
  const accepted = (idempotencyKey: string) => dbModule.getDb().select().from(schema.projectLedgerEvents).where(and(eq(schema.projectLedgerEvents.correlationId, idempotencyKey), eq(schema.projectLedgerEvents.eventType, "execution.receipt")));

  await t.test("import alone cannot enable sends or disclose model targets", async () => {
    const f = await fixture(false);
    assert.deepEqual((await telegramTargetsTool.invoke({}, new AbortController().signal, f.call)).output, { targets: [], automaticReplies: false });
    await assert.rejects(preflightTelegramText(f.input, f.call, new AbortController().signal));
    await assert.rejects(setup.connectTelegram(f.user, { name: "Unconsented send", botToken: "123456:synthetic_reviewed_text", projectId: f.project.id, chatId: f.chat.id,
      allowedConversationIds: ["-123"], consent: true, allowOutbound: true }), setup.TelegramSetupError);
    assert.equal(observed.length, 0);
  });
  await t.test("denial, Project grants, forged grants and edited exact text never contact the recipient", async () => {
    const f = await fixture(); const p = await prepare(f); const before = observed.length;
    await assert.rejects(p.registry.invoke(p.descriptor.id, f.input, p.controller.signal, p.call));
    await assert.rejects(p.approve("project"));
    const call = await p.approve();
    await assert.rejects(p.registry.invoke(p.descriptor.id, { ...f.input, text: "Unreviewed replacement" }, p.controller.signal, call));
    await assert.rejects(p.registry.invoke(p.descriptor.id, f.input, p.controller.signal, { ...call, authorization: { approved: true } }));
    assert.equal(observed.length, before);
  });
  await t.test("one approved exact reply retains actual acceptance but not delivery, and its grant cannot replay", async () => {
    const f = await fixture(); const p = await prepare(f); const call = await p.approve(); const before = observed.length;
    const result = await p.registry.invoke(p.descriptor.id, f.input, p.controller.signal, call);
    assert.equal(observed.length, before + 1);
    assert.deepEqual(observed.at(-1), { chat_id: "-123", text: f.input.text, link_preview_options: { is_disabled: true }, disable_notification: false,
      message_thread_id: 7, reply_parameters: { message_id: 17, allow_sending_without_reply: false } });
    assert.equal((result.output as any).acceptance, "accepted"); assert.equal((result.output as any).destinationVerified, true);
    assert.deepEqual([(result.output as any).delivery, (result.output as any).read], ["unknown", "unknown"]);
    const events = await accepted(call.idempotencyKey!);
    assert.equal(events.length, 1); assert.equal(events[0].payload.providerMessageId, 91);
    assert.equal(JSON.stringify(events).includes(f.input.text), false); assert.equal(JSON.stringify(events).includes("synthetic_reviewed_text"), false);
    await assert.rejects(p.registry.invoke(p.descriptor.id, f.input, p.controller.signal, call));
    assert.equal(observed.length, before + 1);
  });
  await t.test("current target, Chat, selected-source, credential and consent drift refuse before HTTP", async () => {
    const f = await fixture(); const before = observed.length;
    for (const call of [{ ...f.call, chatId: f.chat.id + 999 }, { ...f.call, sourceScope: "web" as const }, { ...f.call, resourceTransmissionAllowed: false },
      { ...f.call, researchSourcePolicy: { mode: "only_refs" as const, allowedSourceRefs: [], providerAllow: [], providerDeny: [] } }]) {
      await assert.rejects(preflightTelegramText(f.input, call as GovernedToolCall, new AbortController().signal));
    }
    await assert.rejects(preflightTelegramText({ ...f.input, recipientId: "123456" }, f.call, new AbortController().signal));
    let capture: import("./governedTelegramTextTool").TelegramTargetsCapture | undefined;
    await telegramTargetsTool.invoke({}, new AbortController().signal, { ...f.call, recordTelegramTargets: value => { capture = value; } });
    assert.ok(capture); await capture.assertCurrent();
    const [source] = await dbModule.getDb().select().from(schema.sourceConnections).where(eq(schema.sourceConnections.id, f.summary.connectionId));
    const policy = policyModule.parseTelegramSourceConfig(source.config);
    vault.setVaultCredential(policyModule.telegramCredentialName(f.user.id, policy.accountBindingId), "123456:synthetic_rotated_text");
    await assert.rejects(capture.assertCurrent());
    await assert.rejects(preflightTelegramText(f.input, f.call, new AbortController().signal));
    assert.equal(observed.length, before);
  });
  await t.test("provider rejection is known no-effect; lost response stays unknown with no retry", async () => {
    for (const mode of ["reject", "lost"] as const) {
      responseMode = mode; const f = await fixture(); const p = await prepare(f); const call = await p.approve(); const before = observed.length;
      await assert.rejects(p.registry.invoke(p.descriptor.id, f.input, p.controller.signal, call), mode === "reject" ? /rate limit/ : /unknown/);
      assert.equal(observed.length, before + 1); assert.equal(p.noEffect(), mode === "reject" ? 1 : 0); assert.equal((await accepted(call.idempotencyKey!)).length, 0);
    }
    responseMode = "accept";
  });
  await t.test("known acceptance survives consent revocation after HTTP; wrong returned topic is never silently retried", async () => {
    const f = await fixture();
    const p = await prepare(f, dependencies({ afterResponse: async () => { await dbModule.getDb().update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.userId, f.user.id)); } }));
    const call = await p.approve(); const before = observed.length;
    await assert.rejects(p.registry.invoke(p.descriptor.id, f.input, p.controller.signal, call), /unknown/);
    assert.equal(observed.length, before + 1); assert.equal((await accepted(call.idempotencyKey!)).length, 1); assert.equal(p.noEffect(), 0);
    responseMode = "wrong_topic"; const g = await fixture(); const q = await prepare(g); const next = await q.approve();
    const result = await q.registry.invoke(q.descriptor.id, g.input, q.controller.signal, next);
    assert.equal((result.output as any).destinationVerified, false); assert.match(result.summary, /do not resend/); assert.equal(observed.length, before + 2);
    responseMode = "accept";
  });
  await t.test("General forum, private bot and channel direct-message topics keep distinct exact API destinations", async () => {
    for (const topic of [{ kind: "forum", id: 1 }, { kind: "private", id: 1 }, { kind: "direct_messages", id: 44 }] as const) {
      const f = await fixture(); f.input.topic = topic;
      const p = await prepare(f); const call = await p.approve(); const before = observed.length;
      const result = await p.registry.invoke(p.descriptor.id, f.input, p.controller.signal, call);
      assert.equal(observed.length, before + 1);
      assert.equal((result.output as any).destinationVerified, true);
      assert.equal(observed.at(-1)!.message_thread_id, topic.kind === "private" ? 1 : undefined);
      assert.equal(observed.at(-1)!.direct_messages_topic_id, topic.kind === "direct_messages" ? 44 : undefined);
    }
  });
  await t.test("revocation or Stop while DNS is pending never enters physical dispatch", async () => {
    const f = await fixture();
    const p = await prepare(f, dependencies({ beforeDns: async () => { await setup.disconnectTelegram(f.user, f.summary.connectionId); } }));
    const call = await p.approve(); const before = observed.length;
    await assert.rejects(p.registry.invoke(p.descriptor.id, f.input, p.controller.signal, call), /before network/);
    assert.equal(p.noEffect(), 1); assert.equal(observed.length, before);
    const g = await fixture();
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const q = await prepare(g, dependencies({ beforeDns: async () => { entered.resolve(); await release.promise; } }));
    const next = await q.approve();
    const pending = q.registry.invoke(q.descriptor.id, g.input, q.controller.signal, next);
    await entered.promise;
    q.controller.abort();
    await assert.rejects(pending);
    release.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(q.noEffect(), 1); assert.equal(observed.length, before);
  });
  await t.test("organization credential mode never falls back to this machine's channel token", async () => {
    const f = await fixture(); const before = observed.length;
    process.env.LIMURIA_CREDENTIAL_STORE = "organization";
    try { await assert.rejects(connection.prepareTelegramOutboundConnection(f.tenant, f.summary.connectionId, f.project.id, f.chat.id)); }
    finally { delete process.env.LIMURIA_CREDENTIAL_STORE; }
    assert.equal(observed.length, before);
  });
  await t.test("disconnect revokes outbound consent as well as credential; over-limit/control/target injection refuse", async () => {
    const f = await fixture(); const before = observed.length;
    for (const change of [{ text: "x".repeat(4_097) }, { text: "x\u0000y" }, { recipientId: "https://attacker.invalid" }, { topic: { kind: "forum", id: -1 } }, { endpoint: "https://attacker.invalid" }]) assert.equal(telegramTextInputSchema.safeParse({ ...f.input, ...change }).success, false);
    assert.equal((await setup.disconnectTelegram(f.user, f.summary.connectionId)).allowOutbound, false);
    await assert.rejects(preflightTelegramText(f.input, f.call, new AbortController().signal));
    const consent = await dbModule.getDb().select().from(schema.userDataConsents).where(eq(schema.userDataConsents.userId, f.user.id));
    assert.equal(consent.filter(row => row.scope.endsWith(":outbound") && row.revokedAt !== null).length, 1);
    assert.equal(observed.length, before);
  });
});
