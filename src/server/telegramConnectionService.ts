import { appendLedgerEventInTransaction } from "./ledgerStore";
import { normalizeTelegramPollBody } from "./telegramPollNormalizer";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import {
  channelIngressCursors, channelIngressUpdates, organizations, projectChatMessages, projectChats, projects,
  sourceConnections, userDataConsents, users,
} from "@shared/schema";
import {
  TELEGRAM_CONNECTION_CONSENT_VERSION, parseTelegramSourceConfig,
  telegramConsentScope, telegramCredentialName,
} from "@shared/telegramConnection";
import { getDb } from "./db";
import type { TenantContext } from "./tenantContext";
import { tenantContext } from "./tenantContext";
import { getVaultCredential, getVaultProtection } from "./credentialVault";
import { assertOrganizationCredentialSnapshotCurrent, loadOrganizationCredentialSnapshot, organizationCredentialStoreEnabled } from "./organizationCredentialVault";
import { providerCredentialRevision } from "./providerCredentialRevision";
import { safeEqualSecret } from "./safeEqualSecret";
import { hashLedgerValue } from "./ledgerStore";
import { requestTelegramGetUpdates, TelegramPollRefusal } from "./telegramNetworkBroker";

type NetworkDependencies = NonNullable<Parameters<typeof requestTelegramGetUpdates>[0]["dependencies"]>;

export class TelegramConnectionRefusal extends Error {
  constructor() {
    super("The current Telegram connection, owner, consent, Chat or protected credential is unavailable.");
    this.name = "TelegramConnectionRefusal";
  }
}

/** Read established source/identity/consent/work stores, never a worker-selected owner or second account ledger. */
async function currentBinding(ctx: TenantContext, connectionId: number, db: any = getDb()) {
  if (!Number.isSafeInteger(ctx.userId) || ctx.userId < 1 || !Number.isSafeInteger(connectionId) || connectionId < 1) throw new TelegramConnectionRefusal();
  const [user] = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!user?.active || user.mustChangePassword || (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) ||
      user.role !== ctx.role || (user.organizationId ?? null) !== ctx.organizationId) throw new TelegramConnectionRefusal();
  const currentTenant = tenantContext(user);
  if (currentTenant.organizationId !== null) {
    const [organization] = await db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, currentTenant.organizationId)).limit(1);
    if (organization?.status !== "active") throw new TelegramConnectionRefusal();
  }
  const [source] = await db.select().from(sourceConnections).where(and(
    eq(sourceConnections.id, connectionId), eq(sourceConnections.userId, user.id),
  )).limit(1);
  if (!source || (source.organizationId ?? null) !== currentTenant.organizationId || source.connectorId !== "telegram" || source.sourceType !== "private_api") throw new TelegramConnectionRefusal();
  const policy = parseTelegramSourceConfig(source.config);
  if (!policy.enabled) throw new TelegramConnectionRefusal();
  const name = telegramCredentialName(user.id, policy.accountBindingId);
  // A saved source may name only its own generated vault entry, not another account, env var or file.
  if (source.credentialRef !== `vault:${name}`) throw new TelegramConnectionRefusal();
  const organizationClause = (column: any) => currentTenant.organizationId === null ? isNull(column) : eq(column, currentTenant.organizationId);
  const [project] = await db.select().from(projects).where(and(
    eq(projects.id, policy.projectId), eq(projects.ownerUserId, user.id), organizationClause(projects.organizationId), isNull(projects.trashedAt),
  )).limit(1);
  const [chat] = await db.select().from(projectChats).where(and(
    eq(projectChats.id, policy.chatId), eq(projectChats.ownerUserId, user.id), organizationClause(projectChats.organizationId), isNull(projectChats.trashedAt),
  )).limit(1);
  if (!project || !chat || project.status !== "active" || chat.status !== "active" || chat.scope !== "project" || chat.projectId !== project.id) throw new TelegramConnectionRefusal();
  const [consent] = await db.select().from(userDataConsents).where(and(
    eq(userDataConsents.userId, user.id), eq(userDataConsents.scope, telegramConsentScope(policy.accountBindingId)),
  )).limit(1);
  if (!consent || consent.revokedAt || consent.consentVersion !== TELEGRAM_CONNECTION_CONSENT_VERSION) throw new TelegramConnectionRefusal();
  const binding = {
    sourceConnectionId: source.id, accountBindingId: policy.accountBindingId,
    ownerUserId: user.id, organizationId: currentTenant.organizationId,
    projectId: project.id, chatId: chat.id,
  };
  return {
    binding, policy, name,
    digest: hashLedgerValue({ binding, policy, credentialRef: source.credentialRef, sourceUpdatedAt: source.updatedAt,
      consentId: consent.id, acceptedAt: consent.acceptedAt, role: user.role,
    }),
  };
}

/**
 * Home-only scoped polling. Returns unadopted provider bytes to Home, not to a worker or model.
 * Canonical durable adoption/dedupe/cursor, retention and separate outbound/AI rights are not supplied by this read.
 */
async function pollAdmittedTelegramConnection(input: {
  context: TenantContext;
  connectionId: number;
  offset: number;
  limit?: number;
  timeoutSeconds?: number;
  signal?: AbortSignal;
  /** Trusted local test seam, never source config, worker input or public route options. */
  dependencies?: NetworkDependencies;
}) {
  const ctx = { ...input.context };
  let admitted: Awaited<ReturnType<typeof currentBinding>>;
  try { admitted = await currentBinding(ctx, input.connectionId); } catch { throw new TelegramConnectionRefusal(); }
  input.signal?.throwIfAborted();
  // Capture the canonical provider/credential namespace, never ambient request identity or operator fallbacks.
  const organizationStore = organizationCredentialStoreEnabled();
  if (organizationStore && ctx.organizationId === null) throw new TelegramConnectionRefusal();
  let organizationSnapshot: Readonly<Record<string, string>> | null = null;
  const readToken = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (organizationCredentialStoreEnabled() !== organizationStore) throw new TelegramConnectionRefusal();
    let value: string | null | undefined;
    if (organizationStore) {
      if (ctx.organizationId === null) throw new TelegramConnectionRefusal();
      const snapshot = await loadOrganizationCredentialSnapshot(ctx.organizationId, admitted.name);
      signal.throwIfAborted();
      organizationSnapshot = snapshot;
      value = snapshot?.[admitted.name];
    } else value = getVaultProtection() === "configured_secret" ? getVaultCredential(admitted.name) : null;
    if (!value) throw new TelegramConnectionRefusal();
    return value;
  };
  let tokenSnapshot: string | undefined;
  let localCredentialRevision: number | undefined;
  try {
    const response = await requestTelegramGetUpdates({
      poll: { offset: input.offset, limit: input.limit, timeoutSeconds: input.timeoutSeconds, allowedUpdates: admitted.policy.allowedUpdateTypes },
      signal: input.signal, dependencies: input.dependencies,
      assertAuthorized: async (_poll, signal) => {
        const current = await currentBinding(ctx, input.connectionId);
        signal.throwIfAborted();
        if (current.digest !== admitted.digest) throw new TelegramConnectionRefusal();
        if (organizationCredentialStoreEnabled() !== organizationStore) throw new TelegramConnectionRefusal();
        if (tokenSnapshot !== undefined) {
          if (organizationStore && ctx.organizationId !== null) {
            if (!organizationSnapshot) throw new TelegramConnectionRefusal();
            const fence = await assertOrganizationCredentialSnapshotCurrent(ctx.organizationId, organizationSnapshot, admitted.name);
            signal.throwIfAborted();
            return () => {
              if (organizationCredentialStoreEnabled() !== organizationStore) throw new TelegramConnectionRefusal();
              fence();
            };
          }
          const revision = localCredentialRevision;
          if (providerCredentialRevision() !== revision || !safeEqualSecret(await readToken(signal), tokenSnapshot)) throw new TelegramConnectionRefusal();
          return () => {
            if (organizationCredentialStoreEnabled() !== organizationStore || providerCredentialRevision() !== revision) throw new TelegramConnectionRefusal();
          };
        }
      },
      resolveBotToken: async signal => {
        const value = await readToken(signal);
        signal.throwIfAborted();
        tokenSnapshot = value;
        localCredentialRevision = providerCredentialRevision();
        return tokenSnapshot;
      },
    });
    return { binding: admitted.binding, policy: admitted.policy, authorityDigest: admitted.digest, ...response };
  } catch (error) {
    if (error instanceof TelegramPollRefusal) throw error;
    throw new TelegramConnectionRefusal();
  } finally {
    tokenSnapshot = undefined;
    organizationSnapshot = null;
  }
}

/** Own one deadline/cancellation scope including the initial canonical DB admission. */
export async function pollTelegramSourceConnection(input: Parameters<typeof pollAdmittedTelegramConnection>[0]) {
  const sourceSignal = input.signal;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
  sourceSignal?.addEventListener("abort", onAbort, { once: true });
  if (sourceSignal?.aborted) onAbort();
  let removeCancellation: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    const abort = () => reject(new TelegramPollRefusal(timedOut ? "timeout" : "cancelled"));
    controller.signal.addEventListener("abort", abort, { once: true });
    removeCancellation = () => controller.signal.removeEventListener("abort", abort);
    if (controller.signal.aborted) abort();
  });
  try {
    if (controller.signal.aborted) throw new TelegramPollRefusal("cancelled");
    return await Promise.race([cancelled, pollAdmittedTelegramConnection({
      ...input, context: { ...input.context }, signal: controller.signal,
      dependencies: input.dependencies ? { ...input.dependencies } : undefined,
    })]);
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", onAbort);
    removeCancellation?.();
    controller.abort();
  }
}

export class TelegramAdoptionConflict extends Error {
  constructor() {
    super("A Telegram update identity was replayed with different content; no update in the batch was adopted.");
    this.name = "TelegramAdoptionConflict";
  }
}

export type TelegramAdoptionResult =
  | { kind: "adopted"; adopted: number; ignored: number; duplicates: number; nextOffset: number }
  | { kind: "provider_error"; code: "unauthorized" | "conflict" | "rate_limited" | "unavailable"; retryAfterMs: number | null };

/** Cursor for the next getUpdates offset; unknown/new sources start at zero. */
export async function nextTelegramPollOffset(context: TenantContext, connectionId: number): Promise<number> {
  await currentBinding({ ...context }, connectionId);
  const [cursor] = await getDb().select().from(channelIngressCursors).where(eq(channelIngressCursors.sourceConnectionId, connectionId)).limit(1);
  return cursor?.nextOffset ?? 0;
}

/**
 * Durably adopt one already-authorized poll under CURRENT authority. Chat content, replay custody, a minimal Ledger
 * disposition and the cursor commit together or not at all. Provider acceptance of the offset is never inferred from this.
 * Edited/non-message families are explicitly dispositioned `ignored`; they are not applied as new Chat turns.
 */
export async function adoptTelegramPoll(input: {
  context: TenantContext;
  connectionId: number;
  poll: { authorityDigest: string; status: number; body: Uint8Array };
}): Promise<TelegramAdoptionResult> {
  const ctx = { ...input.context };
  const normalized = normalizeTelegramPollBody(input.poll.body, input.poll.status);
  if (normalized.kind === "provider_error") return normalized;
  const db: any = getDb();
  try {
    return await db.transaction(async (tx: any): Promise<TelegramAdoptionResult> => {
      // Source row first, then Chat; Project lifecycle writes Chats before Project, so no Project lock is nested here.
      const locked = await tx.select({ id: sourceConnections.id }).from(sourceConnections).where(eq(sourceConnections.id, input.connectionId)).for("update").limit(1);
      if (!locked.length) throw new TelegramConnectionRefusal();
      const current = await currentBinding(ctx, input.connectionId, tx);
      if (!safeEqualSecret(current.digest, input.poll.authorityDigest)) throw new TelegramConnectionRefusal();
      await tx.select({ id: projectChats.id }).from(projectChats).where(eq(projectChats.id, current.binding.chatId)).for("update").limit(1);
      await tx.insert(channelIngressCursors).values({ sourceConnectionId: input.connectionId, provider: "telegram", nextOffset: 0 }).onConflictDoNothing();
      const [cursor] = await tx.select().from(channelIngressCursors).where(eq(channelIngressCursors.sourceConnectionId, input.connectionId)).for("update").limit(1);
      const known = new Map<number, { fingerprint: string }>();
      for (const row of await tx.select().from(channelIngressUpdates).where(eq(channelIngressUpdates.sourceConnectionId, input.connectionId))) {
        known.set(Number(row.updateId), { fingerprint: row.fingerprint });
      }
      let adopted = 0, ignored = 0, duplicates = 0;
      for (const update of normalized.updates) {
        const fingerprint = hashLedgerValue(update.payload);
        const prior = known.get(update.updateId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new TelegramAdoptionConflict();
          duplicates++;
          continue;
        }
        const policy = current.policy;
        let reason: string | null = null;
        if (update.updateId < cursor.nextOffset) reason = "below_cursor_without_custody";
        else if (update.eventType.startsWith("edited_")) reason = "edit_not_applied";
        else if (update.eventType !== "message") reason = "unsupported_event";
        else if (!update.conversationId || !update.messageId) reason = "namespace_unresolved";
        else if (!policy.allowedConversationIds.includes(update.conversationId)) reason = "conversation_not_allowed";
        else if (update.text === null || !update.text.trim()) reason = "no_text";
        let messageId: number | null = null;
        if (reason === null) {
          const [message] = await tx.insert(projectChatMessages).values({
            chatId: current.binding.chatId, role: "user", content: update.text!,
            metadata: { channelIngress: {
              provider: "telegram", sourceConnectionId: input.connectionId, updateId: update.updateId,
              conversationId: update.conversationId, messageId: update.messageId, occurredAt: update.occurredAt,
              aiTransmissionAllowed: policy.allowAiTransmission,
            } },
          }).returning({ id: projectChatMessages.id });
          messageId = message.id;
          adopted++;
        } else ignored++;
        await tx.insert(channelIngressUpdates).values({
          sourceConnectionId: input.connectionId, updateId: update.updateId, eventType: update.eventType,
          fingerprint, disposition: reason === null ? "adopted" : "ignored", reason, chatMessageId: messageId,
        });
        await appendLedgerEventInTransaction(tx, ctx, {
          projectId: current.binding.projectId, chatId: current.binding.chatId,
          eventType: "channel.update.dispositioned", actorType: "provider",
          correlationId: `telegram:${input.connectionId}:${update.updateId}`,
          payload: { provider: "telegram", sourceConnectionId: input.connectionId, updateId: update.updateId, eventType: update.eventType, disposition: reason === null ? "adopted" : "ignored", reason, chatMessageId: messageId, fingerprint },
        });
      }
      let nextOffset = Number(cursor.nextOffset);
      if (normalized.updates.length) {
        nextOffset = Math.max(nextOffset, normalized.updates[normalized.updates.length - 1].updateId + 1);
        await tx.update(channelIngressCursors).set({ nextOffset, updatedAt: new Date() }).where(eq(channelIngressCursors.sourceConnectionId, input.connectionId));
      }
      if (adopted) await tx.update(projectChats).set({ lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(projectChats.id, current.binding.chatId));
      return { kind: "adopted", adopted, ignored, duplicates, nextOffset };
    });
  } catch (error) {
    if (error instanceof TelegramAdoptionConflict || error instanceof TelegramConnectionRefusal) throw error;
    throw new TelegramConnectionRefusal();
  }
}

/** One poll+durable-adoption cycle driven by the canonical cursor; no worker input selects owner, offset or scope. */
export async function runTelegramPollCycle(target: { context: TenantContext; connectionId: number }, signal?: AbortSignal): Promise<TelegramAdoptionResult> {
  const polled = await pollTelegramSourceConnection({
    context: target.context, connectionId: target.connectionId, signal,
    offset: await nextTelegramPollOffset(target.context, target.connectionId),
  });
  return adoptTelegramPoll({ context: target.context, connectionId: target.connectionId, poll: polled });
}

/** Typed terminal causes: revoked/changed authority, invalid provider credential or conflicting replay are never retried automatically. */
export function isTerminalTelegramFailure(error: unknown): boolean {
  return error instanceof TelegramConnectionRefusal || error instanceof TelegramAdoptionConflict ||
    (error instanceof TelegramPollRefusal && error.code === "unauthorized");
}

/** Explicitly enabled sources only. Ownership is rebuilt from current user rows, never from saved config. */
export async function listEnabledTelegramPollingTargets(): Promise<Array<{ context: TenantContext; connectionId: number }>> {
  const rows = await getDb().select({ source: sourceConnections, user: users }).from(sourceConnections)
    .innerJoin(users, eq(users.id, sourceConnections.userId))
    .where(and(eq(sourceConnections.connectorId, "telegram"), eq(sourceConnections.sourceType, "private_api")));
  const targets: Array<{ context: TenantContext; connectionId: number }> = [];
  for (const { source, user } of rows) {
    try {
      if (!parseTelegramSourceConfig(source.config).enabled) continue;
      targets.push({ context: tenantContext(user), connectionId: source.id });
    } catch { /* malformed or inconsistent metadata is not pollable and is never repaired here */ }
  }
  return targets;
}

/**
 * Enforce each source's stored retention policy on imported Chat text, including disconnected sources. Only messages
 * carrying that source's `channelIngress` marker are removed; ordinary Chat turns, replay custody and the minimal Ledger
 * disposition (which never contains message text) are untouched. Returns the number of messages deleted.
 */
export async function purgeExpiredTelegramMessages(now: Date = new Date()): Promise<number> {
  const db: any = getDb();
  const rows = await db.select().from(sourceConnections).where(and(eq(sourceConnections.connectorId, "telegram"), eq(sourceConnections.sourceType, "private_api")));
  let deleted = 0;
  for (const source of rows) {
    let retentionDays: number;
    try { retentionDays = parseTelegramSourceConfig(source.config).retentionDays; } catch { continue; }
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const removed = await db.delete(projectChatMessages).where(and(
      sql`${projectChatMessages.metadata}->'channelIngress'->>'sourceConnectionId' = ${String(source.id)}`,
      lt(projectChatMessages.createdAt, cutoff),
    )).returning({ id: projectChatMessages.id });
    deleted += removed.length;
  }
  return deleted;
}
