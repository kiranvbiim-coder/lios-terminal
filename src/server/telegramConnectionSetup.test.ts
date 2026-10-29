import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-telegram-setup-"));
const saved = { data: process.env.LIMURIA_DATA_DIR, secret: process.env.LIMURIA_VAULT_SECRET, store: process.env.LIMURIA_CREDENTIAL_STORE };
process.env.LIMURIA_DATA_DIR = root;
process.env.LIMURIA_VAULT_SECRET = "synthetic-telegram-test-secret-at-least-32-chars";
delete process.env.LIMURIA_CREDENTIAL_STORE;
const [dbModule, schema, projects, chats, tenant, vault, setup, service, sources, discovery] = await Promise.all([
  import("./db"), import("@shared/schema"), import("./projectStore"), import("./projectChatStore"), import("./tenantContext"),
  import("./credentialVault"), import("./telegramConnectionSetup"), import("./telegramConnectionService"),
  import("./sourceConnectionService"), import("./sourceDiscoveryService"),
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
    const connection = await setup.connectTelegram(o.user, input(o, { name: "Disconnect bot" }));
    const result = await setup.disconnectTelegram(o.user, connection.connectionId);
    assert.deepEqual([result.enabled, result.consentActive, result.credentialPresent], [false, false, false]);
    await assert.rejects(service.pollTelegramSourceConnection({ context: o.ctx, connectionId: connection.connectionId, offset: 0, dependencies: { resolveAddress: async () => { throw new Error("must not reach network"); } } }), service.TelegramConnectionRefusal);
    assert.equal((await service.listEnabledTelegramPollingTargets()).some(target => target.connectionId === connection.connectionId), false);
    const other = await owner();
    await assert.rejects(setup.disconnectTelegram(other.user, connection.connectionId), (error: unknown) => error instanceof setup.TelegramSetupError && error.status === 404);
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
