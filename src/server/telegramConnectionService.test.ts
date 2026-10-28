import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-telegram-scope-"));
const saved = { data: process.env.LIMURIA_DATA_DIR, secret: process.env.LIMURIA_VAULT_SECRET, store: process.env.LIMURIA_CREDENTIAL_STORE, hosted: process.env.LIMURIA_HOSTED_VAULT_SECRET };
process.env.LIMURIA_DATA_DIR = root;
process.env.LIMURIA_VAULT_SECRET = "synthetic-telegram-test-secret-at-least-32-chars";
delete process.env.LIMURIA_CREDENTIAL_STORE;
const [dbModule, schema, projects, chats, tenant, vault, connection, policyModule, network] = await Promise.all([
  import("./db"), import("@shared/schema"), import("./projectStore"), import("./projectChatStore"), import("./tenantContext"),
  import("./credentialVault"), import("./telegramConnectionService"), import("@shared/telegramConnection"), import("./telegramNetworkBroker"),
]);

test("Telegram polling uses current canonical ownership, consent and protected credentials", async t => {
  await dbModule.initDb();
  t.after(async () => {
    await dbModule.closeDb();
    vault.invalidateVaultCache();
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries({ LIMURIA_DATA_DIR: saved.data, LIMURIA_VAULT_SECRET: saved.secret, LIMURIA_CREDENTIAL_STORE: saved.store, LIMURIA_HOSTED_VAULT_SECRET: saved.hosted })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const db = dbModule.getDb();
  const fixture = async (organizationId: number | null = null) => {
    const id = crypto.randomUUID();
    const [user] = await db.insert(schema.users).values({ email: `${id}@example.test`, name: "Synthetic channel owner", passwordHash: "test-hash", role: organizationId === null ? "internal_admin" : "client_admin", organizationId }).returning();
    const context = tenant.tenantContext(user);
    const project = await projects.createProject(context, { name: "Scoped channel project" });
    const chat = await chats.createProjectChat(context, { projectId: project.id, scope: "project" });
    const policy: import("@shared/telegramConnection").TelegramConnectionPolicy = {
      version: "lios-telegram-connection/1", accountBindingId: id, enabled: true, projectId: project.id, chatId: chat.id,
      allowedConversationIds: ["123"], allowedUpdateTypes: ["message"], retentionDays: 7, allowAiTransmission: false, allowOutbound: false,
    };
    const name = policyModule.telegramCredentialName(user.id, id);
    vault.setVaultCredential(name, "123456:synthetic_channel_test", "Synthetic channel fixture");
    const [source] = await db.insert(schema.sourceConnections).values({ userId: user.id, organizationId, connectorId: "telegram", name: "Synthetic Telegram", sourceType: "private_api", config: policyModule.telegramSourceConfig(policy), credentialRef: `vault:${name}` }).returning();
    const [consent] = await db.insert(schema.userDataConsents).values({ userId: user.id, scope: policyModule.telegramConsentScope(id), consentVersion: policyModule.TELEGRAM_CONNECTION_CONSENT_VERSION }).returning();
    return { user, context, project, chat, policy, source, consent, name };
  };
  const dependencies = (onRequest?: () => Promise<void>) => {
    let calls = 0;
    return {
      resolveAddress: async () => ({ address: "149.154.167.220", family: 4 as const }),
      requester: async () => { calls++; await onRequest?.(); return { status: 200, headers: {}, body: Buffer.from("PRIVATE-UNADOPTED-UPDATE") }; },
      count: () => calls,
    };
  };

  await t.test("foreign source, missing/revoked consent, cross-Project Chat and credential substitution never reach HTTP", async () => {
    for (const boundary of ["foreign", "consent", "mapping", "credential", "inactive", "secret-in-config"] as const) {
      const f = await fixture(), deps = dependencies();
      if (boundary === "foreign") {
        const other = await fixture();
        f.context = other.context;
      }
      if (boundary === "consent") await db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, f.consent.id));
      if (boundary === "mapping") {
        const other = await projects.createProject(f.context, { name: "Different owned Project" });
        const chat = await chats.createProjectChat(f.context, { scope: "project", projectId: other.id });
        await db.update(schema.sourceConnections).set({ config: policyModule.telegramSourceConfig({ ...f.policy, chatId: chat.id }) }).where(eq(schema.sourceConnections.id, f.source.id));
      }
      if (boundary === "credential") await db.update(schema.sourceConnections).set({ credentialRef: "vault:operator-api-key" }).where(eq(schema.sourceConnections.id, f.source.id));
      if (boundary === "inactive") await db.update(schema.users).set({ active: false }).where(eq(schema.users.id, f.user.id));
      if (boundary === "secret-in-config") await db.update(schema.sourceConnections).set({ config: { ...f.source.config, token: "MUST-NOT-BE-STORED-HERE" } }).where(eq(schema.sourceConnections.id, f.source.id));
      await assert.rejects(connection.pollTelegramSourceConnection({ context: f.context, connectionId: f.source.id, offset: 0, dependencies: deps }), connection.TelegramConnectionRefusal);
      assert.equal(deps.count(), 0, boundary);
    }
  });

  await t.test("current consent or token revocation during HTTP withholds the response", async () => {
    for (const boundary of ["consent", "credential"] as const) {
      const f = await fixture();
      const deps = dependencies(async () => {
        if (boundary === "consent") await db.update(schema.userDataConsents).set({ revokedAt: new Date() }).where(eq(schema.userDataConsents.id, f.consent.id));
        else vault.deleteVaultCredential(f.name);
      });
      await assert.rejects(connection.pollTelegramSourceConnection({ context: f.context, connectionId: f.source.id, offset: 0, dependencies: deps }), error => error instanceof network.TelegramPollRefusal && error.code === "unauthorized");
      assert.equal(deps.count(), 1);
    }
  });

  await t.test("organization mode cannot borrow a machine-local token with the same account name", async () => {
    const [organization] = await db.insert(schema.organizations).values({ name: "Synthetic tenant", slug: crypto.randomUUID() }).returning();
    const f = await fixture(organization.id), deps = dependencies();
    process.env.LIMURIA_CREDENTIAL_STORE = "organization";
    process.env.LIMURIA_HOSTED_VAULT_SECRET = "synthetic-hosted-telegram-secret-at-least-32-chars";
    try {
      await assert.rejects(connection.pollTelegramSourceConnection({ context: f.context, connectionId: f.source.id, offset: 0, dependencies: deps }));
      assert.equal(deps.count(), 0);
    } finally { delete process.env.LIMURIA_CREDENTIAL_STORE; delete process.env.LIMURIA_HOSTED_VAULT_SECRET; }
  });

  await t.test("organization mode refuses null-organization owners instead of using their machine token", async () => {
    const f = await fixture(), deps = dependencies();
    process.env.LIMURIA_CREDENTIAL_STORE = "organization";
    process.env.LIMURIA_HOSTED_VAULT_SECRET = "synthetic-hosted-telegram-secret-at-least-32-chars";
    try {
      await assert.rejects(connection.pollTelegramSourceConnection({ context: f.context, connectionId: f.source.id, offset: 0, dependencies: deps }));
      assert.equal(deps.count(), 0);
    } finally { delete process.env.LIMURIA_CREDENTIAL_STORE; delete process.env.LIMURIA_HOSTED_VAULT_SECRET; }
  });

  await t.test("same-value organization credential re-save invalidates the admitted poll snapshot", async () => {
    const [organization] = await db.insert(schema.organizations).values({ name: "Versioned synthetic tenant", slug: crypto.randomUUID() }).returning();
    const f = await fixture(organization.id);
    const organizationVault = await import("./organizationCredentialVault");
    process.env.LIMURIA_CREDENTIAL_STORE = "organization";
    process.env.LIMURIA_HOSTED_VAULT_SECRET = "synthetic-hosted-telegram-secret-at-least-32-chars";
    try {
      await organizationVault.setOrganizationCredential(organization.id, f.name, "123456:synthetic_channel_test");
      const deps = dependencies(async () => {
        await organizationVault.setOrganizationCredential(organization.id, f.name, "123456:synthetic_channel_test");
      });
      await assert.rejects(connection.pollTelegramSourceConnection({ context: f.context, connectionId: f.source.id, offset: 0, dependencies: deps }), error => error instanceof network.TelegramPollRefusal && error.code === "unauthorized");
      assert.equal(deps.count(), 1);
    } finally { delete process.env.LIMURIA_CREDENTIAL_STORE; delete process.env.LIMURIA_HOSTED_VAULT_SECRET; }
  });

  await t.test("cancellation settles while initial canonical DB admission is queued", { timeout: 5000 }, async () => {
    const f = await fixture(), deps = dependencies(), controller = new AbortController();
    const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const transaction = db.transaction(async tx => {
      await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
      held.resolve();
      await release.promise;
    });
    await held.promise;
    try {
      const polling = connection.pollTelegramSourceConnection({ context: f.context, connectionId: f.source.id, offset: 0, signal: controller.signal, dependencies: deps });
      const refused = assert.rejects(polling, error => error instanceof network.TelegramPollRefusal && error.code === "cancelled");
      controller.abort();
      await refused;
      assert.equal(deps.count(), 0);
    } finally { release.resolve(); await transaction; }
  });

  await t.test("an inactive organization cannot use otherwise-owned channel state", async () => {
    const [organization] = await db.insert(schema.organizations).values({ name: "Inactive synthetic tenant", slug: crypto.randomUUID(), status: "inactive" }).returning();
    const f = await fixture(organization.id), deps = dependencies();
    await assert.rejects(connection.pollTelegramSourceConnection({ context: f.context, connectionId: f.source.id, offset: 0, dependencies: deps }), connection.TelegramConnectionRefusal);
    assert.equal(deps.count(), 0);
  });
});
