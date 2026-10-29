import crypto from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { telegramConnectInputSchema } from "@shared/telegramConnection";
import { telegramPollingStatus } from "./telegramPollingRuntime";
import {
  channelIngressCursors, projectChats, projects, sourceConnections, userDataConsents,
  type SourceConnection, type User,
} from "@shared/schema";
import {
  TELEGRAM_CONNECTION_CONSENT_VERSION, TELEGRAM_OUTBOUND_CONSENT_VERSION, parseTelegramSourceConfig, telegramConnectionPolicySchema,
  telegramConsentScope, telegramOutboundConsentScope, telegramCredentialName, telegramSourceConfig,
  type TelegramConnectionPolicy,
} from "@shared/telegramConnection";
import { getDb } from "./db";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { tenantContext } from "./tenantContext";
import { deleteVaultCredential, getVaultProtection, hasVaultCredential, setVaultCredential } from "./credentialVault";
import {
  deleteOrganizationCredential, getOrganizationCredential, organizationCredentialStoreConfigured,
  organizationCredentialStoreEnabled, setOrganizationCredential,
} from "./organizationCredentialVault";

export type SetupUser = Pick<User, "id" | "email" | "organizationId" | "role">;

export class TelegramSetupError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 422, message: string) {
    super(message);
    this.name = "TelegramSetupError";
  }
}

export interface TelegramConnectionSummary {
  connectionId: number;
  name: string;
  enabled: boolean;
  projectId: number;
  chatId: number;
  allowedConversationIds: string[];
  allowedUpdateTypes: string[];
  retentionDays: number;
  allowAiTransmission: boolean;
  allowOutbound: boolean;
  consentActive: boolean;
  credentialPresent: boolean;
  nextOffset: number;
  /** Redacted Home loop state; null when Home is not running a loop (disabled, just saved, or runtime stopped). */
  polling: { state: string; consecutiveFailures: number; lastFailure: string | null; lastAdoptedAt: string | null } | null;
  updatedAt: string;
}

const organizationClause = (column: any, organizationId: number | null) => organizationId === null ? isNull(column) : eq(column, organizationId);
const usesOrganizationStore = (user: Pick<User, "organizationId">) => organizationCredentialStoreEnabled() && user.organizationId != null;

async function storeToken(user: Pick<User, "id" | "organizationId">, name: string, token: string): Promise<void> {
  if (usesOrganizationStore(user)) {
    if (!organizationCredentialStoreConfigured()) throw new TelegramSetupError(422, "The organization credential store is not configured.");
    await setOrganizationCredential(user.organizationId!, name, token, "Telegram bot", user.id);
    return;
  }
  if (organizationCredentialStoreEnabled()) throw new TelegramSetupError(422, "Organization credential mode requires an organization account.");
  // The adjacent generated-key fallback is not accepted for channel secrets: require the OS-protected/configured vault secret.
  if (getVaultProtection() !== "configured_secret") throw new TelegramSetupError(422, "An OS-protected credential vault is required before saving a Telegram bot token.");
  setVaultCredential(name, token, "Telegram bot");
}

async function removeToken(user: Pick<User, "organizationId">, name: string): Promise<void> {
  if (usesOrganizationStore(user)) await deleteOrganizationCredential(user.organizationId!, name);
  else deleteVaultCredential(name);
}

async function credentialPresent(user: Pick<User, "organizationId">, name: string): Promise<boolean> {
  return usesOrganizationStore(user)
    ? (await getOrganizationCredential(user.organizationId!, name)) !== null
    : getVaultProtection() === "configured_secret" && hasVaultCredential(name);
}

/** Connect an owned Project/Chat to one Telegram bot. Rights are explicit; nothing is polled until Home reconciles it. */
export async function connectTelegram(user: SetupUser, rawInput: unknown): Promise<TelegramConnectionSummary> {
  const parsed = telegramConnectInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new TelegramSetupError(400, "Telegram connection input is invalid or consent was not given.");
  const input = parsed.data;
  const ctx = tenantContext(user);
  const db = getDb();
  const [project] = await db.select().from(projects).where(and(
    eq(projects.id, input.projectId), eq(projects.ownerUserId, user.id), organizationClause(projects.organizationId, ctx.organizationId), isNull(projects.trashedAt),
  )).limit(1);
  const [chat] = await db.select().from(projectChats).where(and(
    eq(projectChats.id, input.chatId), eq(projectChats.ownerUserId, user.id), organizationClause(projectChats.organizationId, ctx.organizationId), isNull(projectChats.trashedAt),
  )).limit(1);
  if (!project || project.status !== "active" || !chat || chat.status !== "active" || chat.scope !== "project" || chat.projectId !== project.id) {
    throw new TelegramSetupError(404, "The selected Project and Project Chat are not available to this account.");
  }
  const [existing] = await db.select({ id: sourceConnections.id }).from(sourceConnections).where(and(
    eq(sourceConnections.userId, user.id), eq(sourceConnections.connectorId, "telegram"), eq(sourceConnections.name, input.name),
  )).limit(1);
  if (existing) throw new TelegramSetupError(409, "A Telegram connection with this name already exists. Disconnect it or choose another name.");

  const accountBindingId = crypto.randomUUID();
  const credentialName = telegramCredentialName(user.id, accountBindingId);
  const policy: TelegramConnectionPolicy = telegramConnectionPolicySchema.parse({
    version: "lios-telegram-connection/1", accountBindingId, enabled: true, projectId: project.id, chatId: chat.id,
    allowedConversationIds: input.allowedConversationIds, allowedUpdateTypes: input.allowedUpdateTypes,
    retentionDays: input.retentionDays, allowAiTransmission: input.allowAiTransmission, allowOutbound: input.allowOutbound,
  });
  await storeToken(user, credentialName, input.botToken);
  try {
    const source = await (db as any).transaction(async (tx: any) => {
      const [row] = await tx.insert(sourceConnections).values({
        userId: user.id, organizationId: ctx.organizationId, connectorId: "telegram", name: input.name, sourceType: "private_api",
        config: telegramSourceConfig(policy), credentialRef: `vault:${credentialName}`, status: "configured",
      }).returning();
      await tx.insert(userDataConsents).values({
        userId: user.id, scope: telegramConsentScope(accountBindingId), consentVersion: TELEGRAM_CONNECTION_CONSENT_VERSION,
      });
      if (policy.allowOutbound) await tx.insert(userDataConsents).values({
        userId: user.id, scope: telegramOutboundConsentScope(accountBindingId), consentVersion: TELEGRAM_OUTBOUND_CONSENT_VERSION,
      });
      return row as SourceConnection;
    });
    await recordAuditEvent(user.id, "telegram_connection_saved", {
      connectionId: source.id, projectId: project.id, chatId: chat.id, allowAiTransmission: policy.allowAiTransmission,
      conversationCount: policy.allowedConversationIds.length, ...auditActor(user),
    });
    return summarize(user, source, true);
  } catch (error) {
    await removeToken(user, credentialName).catch(() => undefined);
    if (error instanceof TelegramSetupError) throw error;
    throw new TelegramSetupError(409, "The Telegram connection could not be saved.");
  }
}

async function summarize(user: Pick<User, "organizationId">, source: SourceConnection, consentActive: boolean): Promise<TelegramConnectionSummary> {
  const policy = parseTelegramSourceConfig(source.config);
  const [cursor] = await getDb().select().from(channelIngressCursors).where(eq(channelIngressCursors.sourceConnectionId, source.id)).limit(1);
  const live = policy.enabled ? telegramPollingStatus(source.id) : null;
  const [outboundConsent] = policy.allowOutbound ? await getDb().select({ id: userDataConsents.id }).from(userDataConsents).where(and(
    eq(userDataConsents.userId, source.userId), eq(userDataConsents.scope, telegramOutboundConsentScope(policy.accountBindingId)),
    eq(userDataConsents.consentVersion, TELEGRAM_OUTBOUND_CONSENT_VERSION), isNull(userDataConsents.revokedAt),
  )).limit(1) : [];
  return {
    connectionId: source.id, name: source.name, enabled: policy.enabled, projectId: policy.projectId, chatId: policy.chatId,
    allowedConversationIds: policy.allowedConversationIds, allowedUpdateTypes: policy.allowedUpdateTypes,
    retentionDays: policy.retentionDays, allowAiTransmission: policy.allowAiTransmission, allowOutbound: policy.enabled && consentActive && policy.allowOutbound && Boolean(outboundConsent),
    consentActive, credentialPresent: await credentialPresent(user, telegramCredentialName(source.userId, policy.accountBindingId)),
    nextOffset: cursor?.nextOffset ?? 0, updatedAt: source.updatedAt.toISOString(),
    polling: policy.enabled
      ? { state: live?.state ?? "waiting", consecutiveFailures: live?.consecutiveFailures ?? 0, lastFailure: live?.lastFailure ?? null, lastAdoptedAt: live?.lastAdoptedAt ?? null }
      : null,
  };
}

export async function listTelegramConnections(user: SetupUser): Promise<TelegramConnectionSummary[]> {
  const db = getDb();
  const rows = await db.select().from(sourceConnections).where(and(
    eq(sourceConnections.userId, user.id), eq(sourceConnections.connectorId, "telegram"),
  ));
  const summaries: TelegramConnectionSummary[] = [];
  for (const source of rows) {
    try {
      const policy = parseTelegramSourceConfig(source.config);
      const [consent] = await db.select().from(userDataConsents).where(and(
        eq(userDataConsents.userId, user.id), eq(userDataConsents.scope, telegramConsentScope(policy.accountBindingId)),
      )).limit(1);
      summaries.push(await summarize(user, source, Boolean(consent && !consent.revokedAt && consent.consentVersion === TELEGRAM_CONNECTION_CONSENT_VERSION)));
    } catch { /* inconsistent metadata is not presented as a usable connection */ }
  }
  return summaries;
}

/** Disable polling, revoke the data-use consent and delete the bot token. Replay custody and imported Chat content are retained. */
export async function disconnectTelegram(user: SetupUser, connectionId: number): Promise<TelegramConnectionSummary> {
  if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new TelegramSetupError(400, "Connection id is invalid.");
  const db: any = getDb();
  const now = new Date();
  const result = await db.transaction(async (tx: any) => {
    const [source] = await tx.select().from(sourceConnections).where(and(
      eq(sourceConnections.id, connectionId), eq(sourceConnections.userId, user.id), eq(sourceConnections.connectorId, "telegram"),
    )).for("update").limit(1);
    if (!source) throw new TelegramSetupError(404, "Telegram connection not found.");
    const policy = parseTelegramSourceConfig(source.config);
    const [updated] = await tx.update(sourceConnections).set({
      config: telegramSourceConfig({ ...policy, enabled: false }), status: "configured", updatedAt: now,
    }).where(eq(sourceConnections.id, source.id)).returning();
    await tx.update(userDataConsents).set({ revokedAt: now }).where(and(
      eq(userDataConsents.userId, user.id), inArray(userDataConsents.scope, [telegramConsentScope(policy.accountBindingId), telegramOutboundConsentScope(policy.accountBindingId)]), isNull(userDataConsents.revokedAt),
    ));
    return { source: updated as SourceConnection, policy };
  });
  await removeToken(user, telegramCredentialName(user.id, result.policy.accountBindingId));
  await recordAuditEvent(user.id, "telegram_connection_disconnected", { connectionId, ...auditActor(user) });
  return summarize(user, result.source, false);
}
