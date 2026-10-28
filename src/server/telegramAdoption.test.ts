import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { count, eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-telegram-adoption-"));
const saved = { data: process.env.LIMURIA_DATA_DIR, secret: process.env.LIMURIA_VAULT_SECRET, store: process.env.LIMURIA_CREDENTIAL_STORE };
process.env.LIMURIA_DATA_DIR = root;
process.env.LIMURIA_VAULT_SECRET = "synthetic-telegram-test-secret-at-least-32-chars";
delete process.env.LIMURIA_CREDENTIAL_STORE;
const [dbModule, schema, projects, chats, tenant, vault, service, policyModule, ledger] = await Promise.all([
  import("./db"), import("@shared/schema"), import("./projectStore"), import("./projectChatStore"), import("./tenantContext"),
  import("./credentialVault"), import("./telegramConnectionService"), import("@shared/telegramConnection"), import("./ledgerStore"),
]);

const message = (id: number, text: string, chat = 123) => ({ message_id: id, date: 1_700_000_000 + id, chat: { id: chat }, text });
const body = (updates: unknown[]) => Buffer.from(JSON.stringify({ ok: true, result: updates }));

test("Telegram adoption commits Chat, replay custody, minimal Ledger and cursor atomically under current authority", async t => {
  await dbModule.initDb();
  t.after(async () => {
    await dbModule.closeDb();
    vault.invalidateVaultCache();
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries({ LIMURIA_DATA_DIR: saved.data, LIMURIA_VAULT_SECRET: saved.secret, LIMURIA_CREDENTIAL_STORE: saved.store })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const db = dbModule.getDb();
  const fixture = async () => {
    const id = crypto.randomUUID();
    const [user] = await db.insert(schema.users).values({ email: `${id}@example.test`, name: "Synthetic adoption owner", passwordHash: "test-hash", role: "internal_admin" }).returning();
    const context = tenant.tenantContext(user);
    const project = await projects.createProject(context, { name: "Adoption project" });
    const chat = await chats.createProjectChat(context, { projectId: project.id, scope: "project" });
    const policy: import("@shared/telegramConnection").TelegramConnectionPolicy = {
      version: "lios-telegram-connection/1", accountBindingId: id, enabled: true, projectId: project.id, chatId: chat.id,
      allowedConversationIds: ["123"], allowedUpdateTypes: ["message", "edited_message"], retentionDays: 7, allowAiTransmission: false, allowOutbound: false,
    };
    const name = policyModule.telegramCredentialName(user.id, id);
    vault.setVaultCredential(name, "123456:synthetic_channel_test");
    const [source] = await db.insert(schema.sourceConnections).values({ userId: user.id, organizationId: null, connectorId: "telegram", name: "Synthetic Telegram", sourceType: "private_api", config: policyModule.telegramSourceConfig(policy), credentialRef: `vault:${name}` }).returning();
    const [consent] = await db.insert(schema.userDataConsents).values({ userId: user.id, scope: policyModule.telegramConsentScope(id), consentVersion: policyModule.TELEGRAM_CONNECTION_CONSENT_VERSION }).returning();
    const poll = async (bodyBytes: Buffer) => {
      const result = await service.pollTelegramSourceConnection({
        context, connectionId: source.id, offset: await service.nextTelegramPollOffset(context, source.id),
        dependencies: { resolveAddress: async () => ({ address: "149.154.167.220", family: 4 as const }), requester: async () => ({ status: 200, headers: {}, body: bodyBytes }) },
      });
      return { authorityDigest: result.authorityDigest, status: result.status, body: result.body };
    };
    const messages = async () => db.select().from(schema.projectChatMessages).where(eq(schema.projectChatMessages.chatId, chat.id));
    const receipts = async () => db.select().from(schema.channelIngressUpdates).where(eq(schema.channelIngressUpdates.sourceConnectionId, source.id));
    return { user, context, project, chat, source, consent, poll, messages, receipts, adopt: (poll: Awaited<ReturnType<typeof poll>>) => service.adoptTelegramPoll({ context, connectionId: source.id, poll }) };
  };

  await t.test("allowed text becomes Chat content while other families get explicit dispositions", async () => {
    const f = await fixture();
    const result = await f.adopt(await f.poll(body([
      { update_id: 10, message: message(1, "  exact  provider text ") },
      { update_id: 11, edited_message: { ...message(1, "edited"), edit_date: 1_700_000_100 } },
      { update_id: 12, message: message(2, "other conversation", 999) },
      { update_id: 13, callback_query: { id: "cb" } },
    ])));
    assert.deepEqual(result, { kind: "adopted", adopted: 1, ignored: 3, duplicates: 0, nextOffset: 14 });
    const rows = await f.messages();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].content, "  exact  provider text ");
    assert.equal(policyModule.channelMessageExcludedFromAi(rows[0].metadata), true);
    assert.deepEqual((await f.receipts()).map(r => [Number(r.updateId), r.disposition, r.reason]).sort(), [[10, "adopted", null], [11, "ignored", "edit_not_applied"], [12, "ignored", "conversation_not_allowed"], [13, "ignored", "unsupported_event"]]);
    assert.equal(await service.nextTelegramPollOffset(f.context, f.source.id), 14);
    const events = await ledger.listProjectLedgerEvents(f.context, f.project.id, { eventType: "channel.update.dispositioned" });
    assert.equal(events.length, 4);
    assert.equal(JSON.stringify(events).includes("exact  provider text"), false, "Ledger audit stays minimal and never copies message text");
    assert.equal((await ledger.verifyLedgerIntegrity(f.context, `project:${f.project.id}`)).valid, true);
  });

  await t.test("identical replay is custody-deduplicated, including after Chat clearing", async () => {
    const f = await fixture();
    const bytes = body([{ update_id: 20, message: message(7, "once") }]);
    await f.adopt(await f.poll(bytes));
    await db.delete(schema.projectChatMessages).where(eq(schema.projectChatMessages.chatId, f.chat.id));
    const replay = await f.adopt(await f.poll(bytes));
    assert.deepEqual(replay, { kind: "adopted", adopted: 0, ignored: 0, duplicates: 1, nextOffset: 21 });
    assert.equal((await f.messages()).length, 0, "A cleared Chat is not resurrected by replay");
    assert.equal((await f.receipts()).length, 1);
    assert.equal(((await f.receipts())[0]).chatMessageId, null);
  });

  await t.test("a same-ID content conflict rolls back every earlier update and the cursor", async () => {
    const f = await fixture();
    await f.adopt(await f.poll(body([{ update_id: 30, message: message(1, "original") }])));
    const before = { messages: (await f.messages()).length, receipts: (await f.receipts()).length, cursor: await service.nextTelegramPollOffset(f.context, f.source.id) };
    await assert.rejects(f.adopt(await f.poll(body([{ update_id: 29, message: message(2, "earlier new update") }, { update_id: 30, message: message(1, "tampered") }]))), service.TelegramAdoptionConflict);
    assert.deepEqual({ messages: (await f.messages()).length, receipts: (await f.receipts()).length, cursor: await service.nextTelegramPollOffset(f.context, f.source.id) }, before);
  });

  await t.test("consent revoked or policy changed after the poll refuses adoption without persistence", async () => {
    for (const boundary of ["consent", "policy", "owner"] as const) {
      const f = await fixture();
      const polled = await f.poll(body([{ update_id: 40, message: message(1, "private") }]));
      if (boundary === "consent") await db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, f.consent.id));
      if (boundary === "policy") await db.update(schema.sourceConnections).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(schema.sourceConnections.id, f.source.id));
      if (boundary === "owner") await db.update(schema.users).set({ active: false }).where(eq(schema.users.id, f.user.id));
      await assert.rejects(f.adopt(polled), service.TelegramConnectionRefusal);
      assert.equal((await f.messages()).length, 0, boundary);
      assert.equal((await f.receipts()).length, 0, boundary);
      const [{ value }] = await db.select({ value: count() }).from(schema.channelIngressCursors).where(eq(schema.channelIngressCursors.sourceConnectionId, f.source.id));
      assert.equal(value, 0, boundary);
    }
  });

  await t.test("provider errors and malformed success bodies never advance durable progress", async () => {
    const f = await fixture();
    for (const raw of [Buffer.from(JSON.stringify({ ok: false, error_code: 401, description: "bot123:SECRET" })), Buffer.from("not json"), body([{ update_id: 2, message: message(1, "x") }, { update_id: 1, message: message(2, "y") }])]) {
      const result = await f.adopt({ authorityDigest: "0".repeat(64), status: 200, body: raw });
      assert.equal(result.kind, "provider_error");
    }
    assert.equal((await f.receipts()).length, 0);
    assert.equal((await f.messages()).length, 0);
  });
});
