import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-telegram-setup-"));
const saved = { data: process.env.LIMURIA_DATA_DIR, secret: process.env.LIMURIA_VAULT_SECRET, store: process.env.LIMURIA_CREDENTIAL_STORE };
process.env.LIMURIA_DATA_DIR = root;
process.env.LIMURIA_VAULT_SECRET = "synthetic-telegram-test-secret-at-least-32-chars";
delete process.env.LIMURIA_CREDENTIAL_STORE;
const [dbModule, schema, projects, chats, tenant, vault, setup, service, sources, discovery, incoming, policyModule] = await Promise.all([
  import("./db"), import("@shared/schema"), import("./projectStore"), import("./projectChatStore"), import("./tenantContext"),
  import("./credentialVault"), import("./telegramConnectionSetup"), import("./telegramConnectionService"),
  import("./sourceConnectionService"), import("./sourceDiscoveryService"), import("./telegramAutoRunRuntime"), import("@shared/telegramConnection"),
]);
const token = "123456:synthetic_setup_token";

test("Telegram setup stores consent and token under canonical owners and never leaks the token", async t => {
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
  const owner = async () => {
    const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.test`, name: "Synthetic setup owner", passwordHash: "x", role: "internal_admin" }).returning();
    const ctx = tenant.tenantContext(user);
    const project = await projects.createProject(ctx, { name: "Setup project" });
    const chat = await chats.createProjectChat(ctx, { projectId: project.id, scope: "project" });
    return { user, ctx, project, chat };
  };
  const input = (o: Awaited<ReturnType<typeof owner>>, extra: Record<string, unknown> = {}) => ({
    name: "Synthetic bot", botToken: token, projectId: o.project.id, chatId: o.chat.id, allowedConversationIds: ["123"], consent: true, ...extra,
  });

  await t.test("explicit consent is mandatory and a connected source is pollable under current authority", async () => {
    const o = await owner();
    await assert.rejects(setup.connectTelegram(o.user, input(o, { consent: false })), setup.TelegramSetupError);
    await assert.rejects(setup.connectTelegram(o.user, input(o, { botToken: "not a token" })), setup.TelegramSetupError);
    const connection = await setup.connectTelegram(o.user, input(o));
    assert.deepEqual([connection.enabled, connection.consentActive, connection.credentialPresent, connection.allowAiTransmission, connection.allowOutbound], [true, true, true, false, false]);
    assert.equal(JSON.stringify(connection).includes(token), false);
    const rows = await db.select().from(schema.sourceConnections).where(eq(schema.sourceConnections.id, connection.connectionId));
    assert.equal(JSON.stringify(rows).includes(token), false, "source metadata never contains the token");
    // The same Home reader used by polling accepts this exact binding (no network is reached: the requester is a local stub).
    let requests = 0;
    const polled = await service.pollTelegramSourceConnection({ context: o.ctx, connectionId: connection.connectionId, offset: 0, dependencies: {
      resolveAddress: async () => ({ address: "149.154.167.220", family: 4 as const }),
      requester: async () => { requests++; return { status: 200, headers: {}, body: Buffer.from('{"ok":true,"result":[]}') }; },
    } });
    assert.equal(polled.binding.projectId, o.project.id);
    assert.equal(requests, 1);
    assert.deepEqual((await service.listEnabledTelegramPollingTargets()).filter(target => target.connectionId === connection.connectionId).length, 1);
  });

  await t.test("foreign Project/Chat, duplicate names and an unprotected vault are refused before any secret is stored", async () => {
    const a = await owner(), b = await owner();
    const before = vault.listVaultCredentials().length;
    await assert.rejects(setup.connectTelegram(a.user, input(b)), (error: unknown) => error instanceof setup.TelegramSetupError && error.status === 404);
    assert.equal(vault.listVaultCredentials().length, before);
    await setup.connectTelegram(a.user, input(a));
    await assert.rejects(setup.connectTelegram(a.user, input(a)), (error: unknown) => error instanceof setup.TelegramSetupError && error.status === 409);
    assert.equal(vault.listVaultCredentials().length, before + 1, "a refused duplicate leaves no orphaned credential");
  });

  await t.test("disconnect disables polling, revokes consent, deletes the token and retains replay custody", async () => {
    const o = await owner();
    const connection = await setup.connectTelegram(o.user, input(o, {
      name: "Disconnect bot", allowAiTransmission: true, allowOutbound: true, outboundConsent: true,
      autoRun: { enabled: true, allowedSenderRefs: ["user:77"] }, autoRunConsent: true,
    }));
    const result = await setup.disconnectTelegram(o.user, connection.connectionId);
    assert.deepEqual([result.enabled, result.consentActive, result.credentialPresent], [false, false, false]);
    const revoked = await db.select().from(schema.userDataConsents).where(eq(schema.userDataConsents.userId, o.user.id));
    assert.equal(revoked.length, 3, "ingress, outbound and execution have distinct consent records");
    assert.equal(revoked.every(row => row.revokedAt !== null), true);
    assert.equal(result.autoRunConsentActive, false);
    await assert.rejects(service.pollTelegramSourceConnection({ context: o.ctx, connectionId: connection.connectionId, offset: 0, dependencies: { resolveAddress: async () => { throw new Error("must not reach network"); } } }), service.TelegramConnectionRefusal);
    assert.equal((await service.listEnabledTelegramPollingTargets()).some(target => target.connectionId === connection.connectionId), false);
    const other = await owner();
    await assert.rejects(setup.disconnectTelegram(other.user, connection.connectionId), (error: unknown) => error instanceof setup.TelegramSetupError && error.status === 404);
  });

  await t.test("incoming opt-in persists separate execution consent and Home discovers only unclaimed eligible originals", async () => {
    const o = await owner();
    const autoRun = { enabled: true, allowedSenderRefs: ["user:77"] };
    await assert.rejects(setup.connectTelegram(o.user, input(o, { autoRun, allowAiTransmission: true })), setup.TelegramSetupError);
    const connection = await setup.connectTelegram(o.user, input(o, { autoRun, autoRunConsent: true, allowAiTransmission: true, allowedUpdateTypes: ["message", "edited_message"] }));
    assert.equal(connection.autoRun?.enabled, true);
    assert.equal(connection.autoRunConsentActive, true);
    assert.equal(connection.allowOutbound, false);
    assert.deepEqual(connection.autoRunCounts, { claimedLastHour: 0, claimedLastDay: 0, unsettled: 0 });
    const [source] = await db.select().from(schema.sourceConnections).where(eq(schema.sourceConnections.id, connection.connectionId));
    const policy = policyModule.parseTelegramSourceConfig(source.config);
    const [executionConsent] = await db.select().from(schema.userDataConsents).where(and(
      eq(schema.userDataConsents.userId, o.user.id), eq(schema.userDataConsents.scope, policyModule.telegramExecutionConsentScope(policy.accountBindingId)),
    ));
    assert.equal(executionConsent.consentVersion, policyModule.TELEGRAM_EXECUTION_CONSENT_VERSION);
    const updates = Array.from({ length: 5 }, (_, index) => ({
      update_id: index + 1, message: { message_id: index + 1, date: 1_700_000_000 + index, chat: { id: 123 }, from: { id: 77 }, text: `incoming ${index}` },
    }));
    updates.push({ update_id: 6, message: { message_id: 6, date: 1_700_000_006, chat: { id: 123 }, from: { id: 88 }, text: "not an allowed actor" } });
    const poll = await service.pollTelegramSourceConnection({ context: o.ctx, connectionId: source.id, offset: 0, dependencies: {
      resolveAddress: async () => ({ address: "149.154.167.220", family: 4 as const }),
      requester: async () => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ ok: true, result: updates })) }),
    } });
    await service.adoptTelegramPoll({ context: o.ctx, connectionId: source.id, poll });
    const receipts = await db.select().from(schema.channelIngressUpdates).where(eq(schema.channelIngressUpdates.sourceConnectionId, source.id));
    const ids = receipts.filter(row => row.updateId <= 5).map(row => row.id).sort((a, b) => a - b);
    assert.deepEqual(await incoming.discoverTelegramAutoRunCandidates(source.id), ids.slice(0, 3));
    const seen: number[] = [];
    await incoming.startTelegramAutoRunsAfterAdoption(source.id, undefined, async id => {
      seen.push(id);
      const claimedAt = new Date();
      await db.update(schema.channelIngressUpdates).set({
        executionRequestId: crypto.randomUUID(), executionInputSha256: "a".repeat(64), executionClaimedAt: claimedAt,
        executionChatId: o.chat.id, executionSettledAt: seen.length === 3 ? null : claimedAt,
      }).where(eq(schema.channelIngressUpdates.id, id));
      return { kind: "not_started", reason: seen.length === 3 ? "synthetic_claim_before_journal_failure" : "synthetic_settled_attempt" };
    });
    assert.deepEqual(seen, ids.slice(0, 3), "only canonical custody IDs reach entry; bounded at three per cycle");
    assert.deepEqual(await incoming.discoverTelegramAutoRunCandidates(source.id), ids.slice(3), "claimed unknown outcomes never replay");
    const editedPoll = await service.pollTelegramSourceConnection({ context: o.ctx, connectionId: source.id, offset: 7, dependencies: {
      resolveAddress: async () => ({ address: "149.154.167.220", family: 4 as const }),
      requester: async () => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ ok: true, result: [{
        update_id: 7, edited_message: { message_id: 5, date: 1_700_000_004, edit_date: 1_700_000_100, chat: { id: 123 }, from: { id: 77 }, text: "edited before first execution" },
      }] })) }),
    } });
    await service.adoptTelegramPoll({ context: o.ctx, connectionId: source.id, poll: editedPoll });
    assert.deepEqual(await incoming.discoverTelegramAutoRunCandidates(source.id), [ids[3]], "an edited original cannot trigger a delayed first run");
    const stopped = new AbortController();
    stopped.abort();
    let stoppedCalls = 0;
    await incoming.startTelegramAutoRunsAfterAdoption(source.id, stopped.signal, async () => { stoppedCalls++; return { kind: "not_started", reason: "unexpected" }; });
    assert.equal(stoppedCalls, 0, "stopped Home must not call entry");
    const stopMidDiscovery = new AbortController();
    let partialCalls = 0;
    await incoming.startTelegramAutoRunsAfterAdoption(source.id, stopMidDiscovery.signal, async () => {
      partialCalls++;
      stopMidDiscovery.abort();
      return { kind: "not_started", reason: "stopped" };
    });
    assert.equal(partialCalls, 1, "Home stop between admissions prevents the next candidate");
    const [summary] = (await setup.listTelegramConnections(o.user)).filter(row => row.connectionId === source.id);
    assert.deepEqual(summary.autoRunCounts, { claimedLastHour: 3, claimedLastDay: 3, unsettled: 1 });
    await db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, executionConsent.id));
    assert.deepEqual(await incoming.discoverTelegramAutoRunCandidates(source.id), []);
    let revokedCalls = 0;
    await incoming.startTelegramAutoRunsAfterAdoption(source.id, undefined, async () => { revokedCalls++; return { kind: "not_started", reason: "unexpected" }; });
    assert.equal(revokedCalls, 0, "revoked execution consent cannot launch work");
    await setup.disconnectTelegram(o.user, source.id);
    const consents = await db.select().from(schema.userDataConsents).where(eq(schema.userDataConsents.userId, o.user.id));
    assert.equal(consents.every(row => row.revokedAt !== null), true);
    assert.deepEqual(await incoming.discoverTelegramAutoRunCandidates(source.id), []);
  });

  await t.test("three stale or ineligible earlier originals cannot starve fresh incoming work", async () => {
    for (const fence of ["consent", "policy", "expired", "ai_excluded", "role", "actor"] as const) {
      const o = await owner();
      const connection = await setup.connectTelegram(o.user, input(o, {
        autoRun: { enabled: true, allowedSenderRefs: ["user:77"] }, autoRunConsent: true, allowAiTransmission: true,
      }));
      const [source] = await db.select().from(schema.sourceConnections).where(eq(schema.sourceConnections.id, connection.connectionId));
      const policy = policyModule.parseTelegramSourceConfig(source.config);
      const adopt = async (ids: number[]) => {
        const poll = await service.pollTelegramSourceConnection({
          context: o.ctx, connectionId: source.id, offset: await service.nextTelegramPollOffset(o.ctx, source.id), dependencies: {
            resolveAddress: async () => ({ address: "149.154.167.220", family: 4 as const }),
            requester: async () => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ ok: true, result: ids.map(id => ({
              update_id: id, message: { message_id: id, date: 1_700_000_000 + id, chat: { id: 123 }, from: { id: 77 }, text: `${fence} incoming ${id}` },
            })) })) }),
          },
        });
        await service.adoptTelegramPoll({ context: o.ctx, connectionId: source.id, poll });
      };
      await adopt([1, 2, 3]);
      assert.equal((await incoming.discoverTelegramAutoRunCandidates(source.id)).length, 3);
      if (fence === "consent") {
        const [consent] = await db.select().from(schema.userDataConsents).where(and(
          eq(schema.userDataConsents.userId, o.user.id), eq(schema.userDataConsents.scope, policyModule.telegramExecutionConsentScope(policy.accountBindingId)),
        ));
        await db.update(schema.userDataConsents).set({ acceptedAt: new Date(consent.acceptedAt.getTime() + 1_000) }).where(eq(schema.userDataConsents.id, consent.id));
      } else if (fence === "policy") {
        await db.update(schema.sourceConnections).set({
          config: policyModule.telegramSourceConfig({ ...policy, autoRun: { ...policy.autoRun!, maxSteps: 3 } }), updatedAt: new Date(),
        }).where(eq(schema.sourceConnections.id, source.id));
      } else {
        const messages = await db.select().from(schema.projectChatMessages).where(eq(schema.projectChatMessages.chatId, o.chat.id));
        for (const message of messages) {
          if (fence === "expired") await db.update(schema.projectChatMessages).set({ createdAt: new Date(Date.now() - 366 * 86_400_000) }).where(eq(schema.projectChatMessages.id, message.id));
          else if (fence === "role") await db.update(schema.projectChatMessages).set({ role: "assistant" }).where(eq(schema.projectChatMessages.id, message.id));
          else {
            const marker = message.metadata.channelIngress as Record<string, unknown>;
            await db.update(schema.projectChatMessages).set({ metadata: {
              ...message.metadata, channelIngress: { ...marker, ...(fence === "ai_excluded" ? { aiTransmissionAllowed: false } : { senderRef: "user:88" }) },
            } }).where(eq(schema.projectChatMessages.id, message.id));
          }
        }
      }
      await adopt([4]);
      const [fresh] = await db.select().from(schema.channelIngressUpdates).where(and(
        eq(schema.channelIngressUpdates.sourceConnectionId, source.id), eq(schema.channelIngressUpdates.updateId, 4),
      ));
      assert.deepEqual(await incoming.discoverTelegramAutoRunCandidates(source.id), [fresh.id], fence);
    }
  });

  await t.test("clean and import-only connections never call incoming AI entry", async () => {
    assert.deepEqual(await incoming.discoverTelegramAutoRunCandidates(2_000_000_000), []);
    const o = await owner();
    const connection = await setup.connectTelegram(o.user, input(o));
    let calls = 0;
    await incoming.startTelegramAutoRunsAfterAdoption(connection.connectionId, undefined, async () => { calls++; return { kind: "not_started", reason: "unexpected" }; });
    assert.equal(calls, 0);
    assert.equal(connection.autoRun, null);
    assert.equal(connection.autoRunConsentActive, false);
  });

  await t.test("generic source-connection paths cannot list, test, fetch, discover, edit or delete a channel source", async () => {
    const o = await owner();
    const connection = await setup.connectTelegram(o.user, input(o, { name: "Fenced bot" }));
    assert.equal((await sources.listSourceConnections(o.user.id)).some(row => row.connectorId === "telegram"), false);
    assert.equal(await sources.testSourceConnection(o.user.id, connection.connectionId, o.user), null);
    assert.equal(await sources.deleteSourceConnection(o.user.id, connection.connectionId, o.user), false);
    await assert.rejects(sources.fetchApiSourceConnection(o.user.id, connection.connectionId, o.user));
    await assert.rejects(discovery.discoverApiConnection(o.user.id, connection.connectionId, o.user));
    await assert.rejects(sources.upsertSourceConnection(o.user.id, null, { id: connection.connectionId, connectorId: "custom_x", name: "x", sourceType: "private_api", config: { endpoint: "https://example.com" }, credentialRef: null } as never, o.user));
    const [still] = await db.select().from(schema.sourceConnections).where(eq(schema.sourceConnections.id, connection.connectionId));
    assert.equal(still.connectorId, "telegram");
  });
});
