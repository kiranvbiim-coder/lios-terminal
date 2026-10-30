import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { count, eq } from "drizzle-orm";
import type { TelegramConnectionPolicy } from "@shared/telegramConnection";

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
  const fixture = async (overrides: Partial<TelegramConnectionPolicy> = {}) => {
    const id = crypto.randomUUID();
    const [user] = await db.insert(schema.users).values({ email: `${id}@example.test`, name: "Synthetic adoption owner", passwordHash: "test-hash", role: "internal_admin" }).returning();
    const context = tenant.tenantContext(user);
    const project = await projects.createProject(context, { name: "Adoption project" });
    const chat = await chats.createProjectChat(context, { projectId: project.id, scope: "project" });
    const policy: TelegramConnectionPolicy = {
      version: "lios-telegram-connection/1", accountBindingId: id, enabled: true, projectId: project.id, chatId: chat.id,
      allowedConversationIds: ["123"], allowedUpdateTypes: ["message", "edited_message"], retentionDays: 7, allowAiTransmission: false, allowOutbound: false,
      ...overrides,
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
    return { user, context, project, chat, source, consent, name, poll, messages, receipts, adopt: (poll: Awaited<ReturnType<typeof poll>>) => service.adoptTelegramPoll({ context, connectionId: source.id, poll }) };
  };

  await t.test("text and record-only edits commit one canonical Chat row and text-free dispositions", async () => {
    const f = await fixture();
    const result = await f.adopt(await f.poll(body([
      { update_id: 10, message: message(1, "  exact  provider text ") },
      { update_id: 11, edited_message: { ...message(1, "edited"), edit_date: 1_700_000_100 } },
      { update_id: 12, message: message(2, "other conversation", 999) },
      { update_id: 13, callback_query: { id: "cb" } },
    ])));
    assert.deepEqual(result, { kind: "adopted", adopted: 1, edited: 1, ignored: 2, duplicates: 0, nextOffset: 14 });
    const rows = await f.messages();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].content, "edited");
    assert.equal(policyModule.channelMessageExcludedFromAi(rows[0].metadata), true);
    const marker = rows[0].metadata.channelIngress as Record<string, unknown>;
    assert.equal(marker.updateId, 10, "originating update identity remains immutable");
    assert.equal(marker.latestUpdateId, 11);
    assert.equal(marker.providerBotId, "123456");
    assert.deepEqual((await f.receipts()).map(r => [Number(r.updateId), r.disposition, r.reason]).sort(), [[10, "adopted", null], [11, "edited", null], [12, "ignored", "conversation_not_allowed"], [13, "ignored", "unsupported_event"]]);
    assert.equal(await service.nextTelegramPollOffset(f.context, f.source.id), 14);
    const events = await ledger.listProjectLedgerEvents(f.context, f.project.id, { eventType: "channel.update.dispositioned" });
    assert.equal(events.length, 4);
    assert.equal(JSON.stringify(events).includes("exact  provider text"), false, "Ledger audit stays minimal and never copies message text");
    assert.equal((await ledger.verifyLedgerIntegrity(f.context, `project:${f.project.id}`)).valid, true);
  });

  await t.test("automatic eligibility is adoption-time actor and consent bound, never retroactive or rewritten by edits", async () => {
    const autoRun = {
      enabled: true, allowedSenderRefs: ["user:42"], maxRunsPerHour: 2, maxRunsPerDay: 10,
      maxAiCalls: 2, maxSteps: 4, maxDurationMs: 60_000,
    };
    const f = await fixture({ allowAiTransmission: true, autoRun });
    await f.adopt(await f.poll(body([{ update_id: 1, message: { ...message(1, "before consent"), from: { id: 42 } } }])));
    const [executionConsent] = await db.insert(schema.userDataConsents).values({
      userId: f.user.id, scope: policyModule.telegramExecutionConsentScope(policyModule.parseTelegramSourceConfig(f.source.config).accountBindingId),
      consentVersion: policyModule.TELEGRAM_EXECUTION_CONSENT_VERSION,
    }).returning();
    await f.adopt(await f.poll(body([
      { update_id: 2, message: { ...message(2, "wrong sender"), from: { id: 43 } } },
      { update_id: 3, message: { ...message(3, "eligible original"), from: { id: 42 } } },
      { update_id: 4, edited_message: { ...message(3, "edited current text"), from: { id: 42 }, edit_date: 1_700_000_100 } },
    ])));
    const byMessage = new Map((await f.messages()).map(row => {
      const marker = row.metadata.channelIngress as Record<string, unknown>;
      return [marker.messageId, { row, marker }] as const;
    }));
    assert.equal(byMessage.get("1")!.marker.autoRunEligible, false, "later consent never retroactively admits imported text");
    assert.equal(byMessage.get("2")!.marker.autoRunEligible, false, "imported text from a different actor cannot initiate execution");
    const current = byMessage.get("3")!;
    assert.equal(current.row.content, "edited current text");
    assert.equal(current.marker.autoRunEligible, true);
    assert.equal(current.marker.autoRunInputSha256, ledger.hashLedgerValue({ content: "eligible original", senderRef: "user:42" }),
      "edits preserve the original execution input fence instead of authorizing changed text");
    assert.equal(current.marker.executionPolicySha256, ledger.hashLedgerValue(autoRun));
    assert.equal(current.marker.executionConsentBinding, ledger.hashLedgerValue({
      id: executionConsent.id, version: executionConsent.consentVersion, acceptedAt: executionConsent.acceptedAt,
    }));
    await db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, executionConsent.id));
    await f.adopt(await f.poll(body([{ update_id: 5, message: { ...message(5, "after revocation"), from: { id: 42 } } }])));
    const after = (await f.messages()).find(row => row.content === "after revocation")!;
    assert.equal((after.metadata.channelIngress as Record<string, unknown>).autoRunEligible, false);
  });

  await t.test("identical replay is custody-deduplicated, including after Chat clearing", async () => {
    const f = await fixture();
    const bytes = body([{ update_id: 20, message: message(7, "once") }]);
    await f.adopt(await f.poll(bytes));
    await chats.clearProjectChatMessages(f.context, f.chat.id);
    const replay = await f.adopt(await f.poll(bytes));
    assert.deepEqual(replay, { kind: "adopted", adopted: 0, edited: 0, ignored: 0, duplicates: 1, nextOffset: 21 });
    assert.equal((await f.messages()).length, 0, "A cleared Chat is not resurrected by replay");
    assert.equal((await f.receipts()).length, 1);
    assert.equal(((await f.receipts())[0]).chatMessageId, null);
    const freshReplay = await f.adopt(await f.poll(body([
      { update_id: 21, message: message(7, "once") },
      { update_id: 22, edited_message: { ...message(7, "never restored"), edit_date: 1_700_000_100 } },
    ])));
    assert.deepEqual(freshReplay, { kind: "adopted", adopted: 0, edited: 0, ignored: 2, duplicates: 0, nextOffset: 23 });
    assert.equal((await f.messages()).length, 0);
    assert.deepEqual((await f.receipts()).filter(row => row.updateId > 20).map(row => row.reason).sort(), ["logical_message_replay", "message_target_unavailable"]);
  });

  await t.test("fresh update IDs never duplicate or overwrite an existing logical message", async () => {
    const f = await fixture();
    await f.adopt(await f.poll(body([{ update_id: 100, message: message(4, "first body") }])));
    const [original] = await f.messages();
    const result = await f.adopt(await f.poll(body([
      { update_id: 101, message: message(4, "first body") },
      { update_id: 102, message: message(4, "conflicting replay body") },
    ])));
    assert.deepEqual(result, { kind: "adopted", adopted: 0, edited: 0, ignored: 2, duplicates: 0, nextOffset: 103 });
    const [retained] = await f.messages();
    assert.equal(retained.id, original.id);
    assert.equal(retained.content, original.content);
    assert.equal(retained.createdAt.getTime(), original.createdAt.getTime());
    assert.equal((await f.receipts()).filter(row => row.messageAnchor).length, 1);
    assert.deepEqual((await f.receipts()).filter(row => row.updateId > 100).map(row => row.reason), ["logical_message_replay", "logical_message_replay"]);
  });

  await t.test("authorized edits preserve original ID/date and order by edit time then update ID", async () => {
    const f = await fixture({ allowAiTransmission: true });
    await f.adopt(await f.poll(body([{ update_id: 110, message: message(5, "before") }])));
    const [original] = await f.messages();
    await f.adopt(await f.poll(body([
      { update_id: 111, edited_message: { ...message(5, "current"), edit_date: 1_700_000_200 } },
      { update_id: 112, edited_message: { ...message(5, "stale embedded snapshot"), edit_date: 1_700_000_100 } },
      { update_id: 113, edited_message: { ...message(5, "equal-time newer update"), edit_date: 1_700_000_200 } },
      { update_id: 114, message: message(5, "replayed original") },
    ])));
    const [retained] = await f.messages();
    assert.equal(retained.id, original.id);
    assert.equal(retained.createdAt.getTime(), original.createdAt.getTime(), "edits never extend content retention");
    assert.equal(retained.content, "equal-time newer update");
    assert.deepEqual((await f.receipts()).map(row => [row.updateId, row.reason]), [[110, null], [111, null], [112, "stale_edit"], [113, null], [114, "logical_message_replay"]]);
    assert.equal((await f.receipts()).filter(row => row.disposition === "edited").every(row => row.chatMessageId === original.id), true);
    const marker = retained.metadata.channelIngress as Record<string, unknown>;
    assert.equal(marker.updateId, 110);
    assert.equal(marker.latestUpdateId, 113);
    assert.equal(marker.occurredAt, (original.metadata.channelIngress as Record<string, unknown>).occurredAt);
    assert.equal((await service.filterTelegramHistoryForAi(f.context, [original])).length, 0, "a previously prepared snapshot cannot release superseded text");
    assert.equal((await service.filterTelegramHistoryForAi(f.context, [retained])).length, 1);
  });

  await t.test("channel posts need no invented human sender; caption removal invalidates old AI text", async () => {
    for (const senderChat of [false, true]) {
      const f = await fixture({ allowedConversationIds: ["-100123"], allowedUpdateTypes: ["channel_post", "edited_channel_post"], allowAiTransmission: true });
      const channel = { id: -100123, type: "channel", title: "Private channel" };
      const originalPost = { message_id: 8, date: 1_700_000_008, chat: channel, ...(senderChat ? { sender_chat: channel } : {}), caption: "original caption", photo: [] };
      await f.adopt(await f.poll(body([{ update_id: 120, channel_post: originalPost }])));
      const [original] = await f.messages();
      const result = await f.adopt(await f.poll(body([
        { update_id: 121, edited_channel_post: { ...originalPost, caption: undefined, edit_date: 1_700_000_100 } },
      ])));
      assert.deepEqual(result, { kind: "adopted", adopted: 0, edited: 1, ignored: 0, duplicates: 0, nextOffset: 122 });
      const [removedCaption] = await f.messages();
      assert.equal(removedCaption.id, original.id);
      assert.equal(removedCaption.createdAt.getTime(), original.createdAt.getTime());
      assert.equal(removedCaption.content, "[Telegram message edited: no text or caption is available.]");
      assert.equal(JSON.stringify(removedCaption).includes("original caption"), false);
      assert.equal((removedCaption.metadata.channelIngress as Record<string, unknown>).contentState, "no_text");
      assert.equal(policyModule.channelMessageExcludedFromAi(removedCaption.metadata), true);
      assert.equal((await service.filterTelegramHistoryForAi(f.context, [original, removedCaption])).length, 0);
      await f.adopt(await f.poll(body([{ update_id: 122, edited_channel_post: { ...originalPost, caption: "restored provider caption", edit_date: 1_700_000_200 } }])));
      const [restoredCaption] = await f.messages();
      assert.equal(restoredCaption.content, "restored provider caption");
      assert.equal(policyModule.channelMessageExcludedFromAi(restoredCaption.metadata), true, "an edit cannot regrant restricted AI permission");
    }
  });

  await t.test("local update policy is enforced even when the provider sends unsubscribed message families", async () => {
    const f = await fixture({ allowedUpdateTypes: ["message"] });
    await f.adopt(await f.poll(body([
      { update_id: 130, message: message(1, "allowed original") },
      { update_id: 131, edited_message: { ...message(1, "not authorized locally"), edit_date: 1_700_000_100 } },
      { update_id: 132, channel_post: message(2, "not subscribed") },
    ])));
    assert.deepEqual((await f.messages()).map(row => row.content), ["allowed original"]);
    assert.deepEqual((await f.receipts()).filter(row => row.updateId > 130).map(row => row.reason), ["update_type_not_allowed", "update_type_not_allowed"]);
  });

  await t.test("unmatched, changed-family, changed-Chat and mismatched canonical targets never become new turns", async () => {
    const f = await fixture({ allowedUpdateTypes: ["message", "edited_message", "channel_post", "edited_channel_post"] });
    await f.adopt(await f.poll(body([
      { update_id: 140, message: message(1, "canonical original") },
      { update_id: 141, edited_message: { ...message(2, "unseen edit"), edit_date: 1_700_000_100 } },
      { update_id: 142, edited_channel_post: { ...message(1, "wrong family"), edit_date: 1_700_000_100 } },
      { update_id: 143, edited_message: { ...message(1, "wrong original timestamp"), date: 1_700_000_002, edit_date: 1_700_000_100 } },
    ])));
    const [original] = await f.messages();
    const otherChat = await chats.createProjectChat(f.context, { projectId: f.project.id, scope: "project" });
    const policy = policyModule.parseTelegramSourceConfig(f.source.config);
    await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...policy, chatId: otherChat.id }) }).where(eq(schema.sourceConnections.id, f.source.id));
    await f.adopt(await f.poll(body([{ update_id: 144, edited_message: { ...message(1, "wrong Chat"), edit_date: 1_700_000_200 } }])));
    assert.deepEqual((await f.messages()).map(row => [row.id, row.content]), [[original.id, "canonical original"]]);
    assert.deepEqual((await f.receipts()).filter(row => row.updateId > 140).sort((a, b) => a.updateId - b.updateId).map(row => row.reason), ["unmatched_edit", "message_family_mismatch", "message_target_mismatch", "message_target_mismatch"]);
    assert.equal((await db.select().from(schema.projectChatMessages).where(eq(schema.projectChatMessages.chatId, otherChat.id))).length, 0);
  });

  await t.test("current AI permission can only restrict, never expand, an adopted message on edit", async () => {
    for (const initiallyAllowed of [false, true]) {
      const f = await fixture({ allowAiTransmission: initiallyAllowed });
      await f.adopt(await f.poll(body([{ update_id: 150, message: message(1, "original rights") }])));
      const policy = policyModule.parseTelegramSourceConfig(f.source.config);
      await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...policy, allowAiTransmission: !initiallyAllowed }) }).where(eq(schema.sourceConnections.id, f.source.id));
      await f.adopt(await f.poll(body([{ update_id: 151, edited_message: { ...message(1, "edited rights"), edit_date: 1_700_000_100 } }])));
      const [retained] = await f.messages();
      assert.equal(retained.content, "edited rights");
      assert.equal(policyModule.channelMessageExcludedFromAi(retained.metadata), true);
    }
  });

  await t.test("expired targets and retention tombstones never revive under edits or fresh-ID originals", async () => {
    const f = await fixture();
    await f.adopt(await f.poll(body([{ update_id: 160, message: message(1, "retained until cutoff") }])));
    const [original] = await f.messages();
    const oldDate = new Date(Date.now() - 8 * 86_400_000);
    await db.update(schema.projectChatMessages).set({ createdAt: oldDate }).where(eq(schema.projectChatMessages.id, original.id));
    await f.adopt(await f.poll(body([{ update_id: 161, edited_message: { ...message(1, "must not refresh retention"), edit_date: 1_700_000_100 } }])));
    const [expired] = await f.messages();
    assert.equal(expired.content, original.content);
    assert.equal(expired.createdAt.getTime(), oldDate.getTime());
    assert.equal((await f.receipts()).find(row => row.updateId === 161)?.reason, "message_target_expired");
    await service.purgeExpiredTelegramMessages();
    await f.adopt(await f.poll(body([
      { update_id: 162, message: message(1, "retention replay") },
      { update_id: 163, edited_message: { ...message(1, "retention edit"), edit_date: 1_700_000_200 } },
    ])));
    assert.equal((await f.messages()).length, 0);
    assert.equal((await f.receipts()).find(row => row.messageAnchor)?.chatMessageId, null);
    assert.deepEqual((await f.receipts()).filter(row => row.updateId >= 162).map(row => row.reason), ["logical_message_replay", "message_target_unavailable"]);
  });

  await t.test("same-bot rotation preserves offset; stale snapshots and other bots cannot reuse it", async () => {
    const f = await fixture();
    await f.adopt(await f.poll(body([{ update_id: 170, message: message(1, "bound to declared bot") }])));
    const stalePoll = await f.poll(body([{ update_id: 171, message: message(2, "old credential snapshot") }]));
    vault.setVaultCredential(f.name, "123456:rotated_synthetic_token");
    assert.equal(await service.nextTelegramPollOffset(f.context, f.source.id), 171);
    assert.deepEqual(await service.telegramIngressNamespaceReadiness(f.context, f.source.id), { namespaceReady: true, reason: null });
    await assert.rejects(f.adopt(stalePoll), service.TelegramConnectionRefusal);
    await f.adopt(await f.poll(body([{ update_id: 171, message: message(1, "same-bot replay") }])));
    assert.equal((await f.messages()).length, 1);
    const [cursor] = await db.select().from(schema.channelIngressCursors).where(eq(schema.channelIngressCursors.sourceConnectionId, f.source.id));
    assert.equal(cursor.nextOffset, 172);
    assert.equal(cursor.providerBotId, "123456");
    assert.equal(cursor.tokenFingerprint, ledger.hashLedgerValue("123456:rotated_synthetic_token"));
    assert.equal(JSON.stringify(cursor).includes("rotated_synthetic_token"), false);
    vault.setVaultCredential(f.name, "654321:different_synthetic_bot");
    assert.deepEqual(await service.telegramIngressNamespaceReadiness(f.context, f.source.id), { namespaceReady: false, reason: "namespace_reconnect_required" });
    await assert.rejects(service.nextTelegramPollOffset(f.context, f.source.id), service.TelegramNamespaceRefusal);
    let requested = false;
    await assert.rejects(service.pollTelegramSourceConnection({
      context: f.context, connectionId: f.source.id, offset: 172,
      dependencies: { resolveAddress: async () => { requested = true; throw new Error("must refuse before network"); } },
    }), (error: unknown) => error instanceof service.TelegramNamespaceRefusal && /Disconnect and create a new named connection/.test(error.message));
    assert.equal(requested, false);
    assert.equal((await f.receipts()).length, 2);
    assert.equal((await f.messages()).length, 1);
  });

  await t.test("credential revoke-and-restore cannot resurrect an already captured poll digest", async () => {
    const f = await fixture();
    const captured = await f.poll(body([{ update_id: 180, message: message(1, "captured before revocation") }]));
    vault.deleteVaultCredential(f.name);
    vault.setVaultCredential(f.name, "123456:synthetic_channel_test");
    await assert.rejects(f.adopt(captured), service.TelegramConnectionRefusal);
    assert.equal((await f.receipts()).length, 0);
    await f.adopt(await f.poll(body([{ update_id: 180, message: message(1, "fresh authority") }])));
    assert.equal((await f.messages())[0].content, "fresh authority");
  });

  await t.test("logical identity is source/bot bound, not inferred from sender or content", async () => {
    const a = await fixture(), b = await fixture();
    vault.setVaultCredential(b.name, "654321:separate_bot");
    await a.adopt(await a.poll(body([{ update_id: 190, message: { ...message(1, "same provider coordinates"), from: { id: 654321, is_bot: true } } }])));
    await b.adopt(await b.poll(body([{ update_id: 190, message: { ...message(1, "same provider coordinates"), from: { id: 123456, is_bot: true } } }])));
    assert.equal(((await a.messages())[0].metadata.channelIngress as Record<string, unknown>).providerBotId, "123456");
    assert.equal(((await b.messages())[0].metadata.channelIngress as Record<string, unknown>).providerBotId, "654321");
    assert.notEqual((await a.messages())[0].id, (await b.messages())[0].id);
  });

  await t.test("legacy cleared custody and ambiguous retained metadata stay untouched and require a new connection", async () => {
    for (const retained of [false, true]) {
      const f = await fixture();
      if (retained) {
        for (const content of ["legacy duplicate A", "legacy duplicate B"]) await chats.addProjectChatMessage(f.context, f.chat.id, {
          role: "user", content, metadata: { channelIngress: {
            provider: "telegram", sourceConnectionId: f.source.id, updateId: 200, conversationId: "123", messageId: "1",
            occurredAt: "2023-11-14T22:13:21.000Z", aiTransmissionAllowed: false,
          } },
        });
      }
      await db.insert(schema.channelIngressUpdates).values({
        sourceConnectionId: f.source.id, updateId: 200, eventType: "message", disposition: "adopted",
        fingerprint: ledger.hashLedgerValue({ legacy: true }), chatMessageId: null,
      });
      await db.insert(schema.channelIngressCursors).values({ sourceConnectionId: f.source.id, provider: "telegram", nextOffset: 201 });
      const before = await f.messages();
      assert.deepEqual(await service.telegramIngressNamespaceReadiness(f.context, f.source.id), { namespaceReady: false, reason: "namespace_reconnect_required" });
      await assert.rejects(service.nextTelegramPollOffset(f.context, f.source.id), service.TelegramNamespaceRefusal);
      assert.deepEqual(await f.messages(), before, "no automatic merging, backfill, deletion or reset");
      const [receipt] = await f.receipts();
      assert.equal(receipt.providerBotId, null);
      assert.equal(receipt.conversationId, null);
      assert.equal(receipt.messageAnchor, false);
      const [cursor] = await db.select().from(schema.channelIngressCursors).where(eq(schema.channelIngressCursors.sourceConnectionId, f.source.id));
      assert.equal(cursor.nextOffset, 201);
      assert.equal(cursor.providerBotId, null);
    }
  });

  await t.test("foreign Chat metadata cannot assign or poison this source's protected namespace", async () => {
    const f = await fixture(), foreign = await fixture();
    await chats.addProjectChatMessage(foreign.context, foreign.chat.id, {
      role: "user", content: "foreign marker", metadata: { channelIngress: { provider: "telegram", sourceConnectionId: f.source.id, conversationId: "123", messageId: "1", aiTransmissionAllowed: false } },
    });
    assert.deepEqual(await service.telegramIngressNamespaceReadiness(f.context, f.source.id), { namespaceReady: true, reason: null });
    await f.adopt(await f.poll(body([{ update_id: 205, message: message(1, "owned canonical text") }])));
    assert.deepEqual((await f.messages()).map(row => row.content), ["owned canonical text"]);
    assert.deepEqual((await foreign.messages()).map(row => row.content), ["foreign marker"]);
  });

  await t.test("unattributable retained content without a cursor is not silently assigned to today's token", async () => {
    const f = await fixture();
    const original = await chats.addProjectChatMessage(f.context, f.chat.id, {
      role: "user", content: "legacy readable content", metadata: { channelIngress: { provider: "telegram", sourceConnectionId: f.source.id, conversationId: "123", messageId: "1", aiTransmissionAllowed: false } },
    });
    assert.deepEqual(await service.telegramIngressNamespaceReadiness(f.context, f.source.id), { namespaceReady: false, reason: "namespace_reconnect_required" });
    await assert.rejects(service.nextTelegramPollOffset(f.context, f.source.id), service.TelegramNamespaceRefusal);
    assert.deepEqual((await f.messages()).map(row => [row.id, row.content]), [[original.id, "legacy readable content"]]);
    assert.equal((await f.receipts()).length, 0);
  });

  await t.test("edit targets require exact canonical provider attribution and role", async () => {
    for (const boundary of ["sourceConnectionId", "providerBotId", "conversationId", "messageId", "messageFamily", "updateId", "latestUpdateId", "role"] as const) {
      const f = await fixture();
      await f.adopt(await f.poll(body([{ update_id: 210, message: message(1, "exact original") }])));
      const [original] = await f.messages();
      const marker = original.metadata.channelIngress as Record<string, unknown>;
      if (boundary === "role") await db.update(schema.projectChatMessages).set({ role: "assistant" }).where(eq(schema.projectChatMessages.id, original.id));
      else await db.update(schema.projectChatMessages).set({ metadata: { channelIngress: { ...marker, [boundary]: typeof marker[boundary] === "number" ? Number(marker[boundary]) + 1 : "different" } } }).where(eq(schema.projectChatMessages.id, original.id));
      await f.adopt(await f.poll(body([{ update_id: 211, edited_message: { ...message(1, "must not replace mismatched target"), edit_date: 1_700_000_100 } }])));
      assert.equal((await f.messages())[0].content, "exact original", boundary);
      assert.equal((await f.receipts()).find(row => row.updateId === 211)?.reason, "message_target_mismatch", boundary);
    }
  });

  await t.test("current authority revocation after polling withholds edits and preserves original custody", async () => {
    for (const boundary of ["consent", "owner", "source", "chat"] as const) {
      const f = await fixture();
      await f.adopt(await f.poll(body([{ update_id: 220, message: message(1, "original current authority") }])));
      const captured = await f.poll(body([{ update_id: 221, edited_message: { ...message(1, "revoked edit"), edit_date: 1_700_000_100 } }]));
      if (boundary === "consent") await db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, f.consent.id));
      if (boundary === "owner") await db.update(schema.users).set({ active: false }).where(eq(schema.users.id, f.user.id));
      if (boundary === "source") await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...policyModule.parseTelegramSourceConfig(f.source.config), enabled: false }) }).where(eq(schema.sourceConnections.id, f.source.id));
      if (boundary === "chat") await db.update(schema.projectChats).set({ status: "archived" }).where(eq(schema.projectChats.id, f.chat.id));
      await assert.rejects(f.adopt(captured), service.TelegramConnectionRefusal);
      assert.equal((await f.messages())[0].content, "original current authority", boundary);
      assert.equal((await f.receipts()).length, 1, boundary);
      const [cursor] = await db.select().from(schema.channelIngressCursors).where(eq(schema.channelIngressCursors.sourceConnectionId, f.source.id));
      assert.equal(cursor.nextOffset, 221);
    }
  });

  await t.test("clear and an already polled edit cannot recreate a canonical message", { timeout: 5000 }, async () => {
    const f = await fixture();
    await f.adopt(await f.poll(body([{ update_id: 230, message: message(1, "clear race") }])));
    const captured = await f.poll(body([{ update_id: 231, edited_message: { ...message(1, "edit racing clear"), edit_date: 1_700_000_100 } }]));
    await Promise.all([chats.clearProjectChatMessages(f.context, f.chat.id), f.adopt(captured)]);
    assert.equal((await f.messages()).length, 0);
    assert.equal((await f.receipts()).find(row => row.messageAnchor)?.chatMessageId, null);
    await f.adopt(await f.poll(body([{ update_id: 232, message: message(1, "post-clear fresh-ID replay") }])));
    assert.equal((await f.messages()).length, 0);
  });

  await t.test("queued adoption observes Chat lifecycle changes before any edit is committed", { timeout: 5000 }, async () => {
    const f = await fixture();
    await f.adopt(await f.poll(body([{ update_id: 240, message: message(1, "before archive") }])));
    const captured = await f.poll(body([{ update_id: 241, edited_message: { ...message(1, "while archived"), edit_date: 1_700_000_100 } }]));
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const transaction = db.transaction(async tx => {
      await tx.select().from(schema.projectChats).where(eq(schema.projectChats.id, f.chat.id)).for("update").limit(1);
      held.resolve();
      await release.promise;
      await tx.update(schema.projectChats).set({ status: "archived" }).where(eq(schema.projectChats.id, f.chat.id));
    });
    await held.promise;
    try {
      const refused = assert.rejects(f.adopt(captured), service.TelegramConnectionRefusal);
      release.resolve();
      await transaction;
      await refused;
    } finally { release.resolve(); await transaction; }
    assert.equal((await f.messages())[0].content, "before archive");
    assert.equal((await f.receipts()).length, 1);
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

  await t.test("retention removes only expired imported text for its own source and keeps custody", async () => {
    const a = await fixture(), b = await fixture();
    await a.adopt(await a.poll(body([{ update_id: 50, message: message(1, "old imported") }, { update_id: 51, message: message(2, "recent imported") }])));
    await b.adopt(await b.poll(body([{ update_id: 50, message: message(1, "other source imported") }])));
    const ordinary = await chats.addProjectChatMessage(a.context, a.chat.id, { role: "user", content: "ordinary turn", metadata: {} });
    const day = 86_400_000;
    const [oldest] = (await a.messages()).filter(m => m.content === "old imported");
    const [other] = (await b.messages());
    await db.update(schema.projectChatMessages).set({ createdAt: new Date(Date.now() - 40 * day) }).where(eq(schema.projectChatMessages.id, oldest.id));
    await db.update(schema.projectChatMessages).set({ createdAt: new Date(Date.now() - 40 * day) }).where(eq(schema.projectChatMessages.id, ordinary.id));
    await db.update(schema.projectChatMessages).set({ createdAt: new Date(Date.now() - 10 * day) }).where(eq(schema.projectChatMessages.id, other.id));
    await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...policyModule.parseTelegramSourceConfig(a.source.config), retentionDays: 30 }) }).where(eq(schema.sourceConnections.id, a.source.id));
    await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...policyModule.parseTelegramSourceConfig(b.source.config), retentionDays: 7 }) }).where(eq(schema.sourceConnections.id, b.source.id));
    const removed = await service.purgeExpiredTelegramMessages();
    assert.ok(removed >= 2, "the 40-day source-a text and 10-day source-b text (7-day policy) expire");
    assert.deepEqual((await a.messages()).map(m => m.content).sort(), ["ordinary turn", "recent imported"], "ordinary old Chat turns are never retention-purged");
    assert.equal((await b.messages()).length, 0);
    const custody = await a.receipts();
    assert.equal(custody.length, 2, "replay custody survives content retention");
    assert.equal(custody.find(r => Number(r.updateId) === 50)?.chatMessageId, null);
    assert.notEqual(custody.find(r => Number(r.updateId) === 51)?.chatMessageId, null);
  });

  await t.test("retained imported text needs current AI consent and exact source/chat/retention scope", async () => {
    for (const revoke of ["policy", "consent", "source", "chat", "retention", "deleted", "content", "marker"] as const) {
      const f = await fixture();
      const policy = { ...policyModule.parseTelegramSourceConfig(f.source.config), allowAiTransmission: true };
      await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig(policy) }).where(eq(schema.sourceConnections.id, f.source.id));
      await f.adopt(await f.poll(body([{ update_id: 75, message: message(1, "restricted-channel-context") }])));
      const rows = await f.messages();
      assert.equal((await service.filterTelegramHistoryForAi(f.context, rows)).length, 1);
      if (revoke === "policy") await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...policy, allowAiTransmission: false }) }).where(eq(schema.sourceConnections.id, f.source.id));
      if (revoke === "consent") await db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, f.consent.id));
      if (revoke === "source") await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...policy, enabled: false }) }).where(eq(schema.sourceConnections.id, f.source.id));
      if (revoke === "chat") rows[0].chatId = f.chat.id + 1000;
      if (revoke === "deleted") await db.delete(schema.projectChatMessages).where(eq(schema.projectChatMessages.id, rows[0].id));
      if (revoke === "content") await db.update(schema.projectChatMessages).set({ content: "current edited provider context" }).where(eq(schema.projectChatMessages.id, rows[0].id));
      if (revoke === "marker") await db.update(schema.projectChatMessages).set({ metadata: { channelIngress: { ...(rows[0].metadata.channelIngress as Record<string, unknown>), aiTransmissionAllowed: false } } }).where(eq(schema.projectChatMessages.id, rows[0].id));
      const now = revoke === "retention" ? rows[0].createdAt.getTime() + 8 * 86_400_000 : Date.now();
      const ordinary = { ...rows[0], id: -1, metadata: {}, content: "ordinary context" };
      assert.deepEqual((await service.filterTelegramHistoryForAi(f.context, [...rows, ordinary], now)).map(row => row.content), ["ordinary context"], revoke);
    }
  });
});
