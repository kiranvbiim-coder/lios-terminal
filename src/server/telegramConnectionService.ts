import { appendLedgerEventInTransaction } from "./ledgerStore";
import { normalizeTelegramPollBody } from "./telegramPollNormalizer";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  channelIngressCursors, channelIngressUpdates, organizations, projectChatMessages, projectChats, projects,
  sourceConnections, userDataConsents, users,
} from "@shared/schema";
import {
  TELEGRAM_CONNECTION_CONSENT_VERSION, TELEGRAM_OUTBOUND_CONSENT_VERSION, parseTelegramSourceConfig,
  telegramConsentScope, telegramOutboundConsentScope, telegramCredentialName,
  TELEGRAM_EXECUTION_CONSENT_VERSION, telegramExecutionConsentScope,
  channelMessageExcludedFromAi,
} from "@shared/telegramConnection";
import { getDb, type DrizzleDb } from "./db";
import type { TenantContext } from "./tenantContext";
import { tenantContext } from "./tenantContext";
import { getVaultCredential, getVaultProtection } from "./credentialVault";
import { assertOrganizationCredentialSnapshotCurrent, loadOrganizationCredentialSnapshot, organizationCredentialStoreEnabled, organizationCredentialRevision } from "./organizationCredentialVault";
import { providerCredentialRevision } from "./providerCredentialRevision";
import { safeEqualSecret } from "./safeEqualSecret";
import { hashLedgerValue } from "./ledgerStore";
import { notifyDataChanged } from "./gatewayRuntime";
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

export class TelegramNamespaceRefusal extends TelegramConnectionRefusal {
  readonly code = "namespace_reconnect_required";
  constructor() {
    super();
    this.name = "TelegramNamespaceRefusal";
    this.message = "Telegram progress cannot be safely attributed to this bot. Disconnect and create a new named connection; existing Chat history and replay receipts are preserved.";
  }
}

interface IngressCredential {
  providerBotId: string;
  tokenFingerprint: string;
  credentialRevision: number;
  organizationStore: boolean;
  assertCurrent(): Promise<() => void>;
  resolveToken(): string;
  close(): void;
}

/**
 * Selected OpenClaw c074824a mechanisms: token-fingerprint.ts / update-offset-store.ts bot namespace and
 * rotation detection. Read only the exact Home-owned protected entry; no getMe, ambient token or worker identity.
 * The prefix is the credential's declared bot ID, not a claim that the provider authenticated it.
 */
async function currentIngressCredential(ctx: TenantContext, name: string): Promise<IngressCredential> {
  const organizationStore = organizationCredentialStoreEnabled();
  if (organizationStore && ctx.organizationId === null) throw new TelegramConnectionRefusal();
  const revision = () => organizationStore ? organizationCredentialRevision(ctx.organizationId!) : providerCredentialRevision();
  const credentialRevision = revision();
  let snapshot = organizationStore ? await loadOrganizationCredentialSnapshot(ctx.organizationId!, name) : null;
  let token = organizationStore ? snapshot?.[name] : getVaultProtection() === "configured_secret" ? getVaultCredential(name) : null;
  const match = token?.match(/^([1-9][0-9]{0,19}):[A-Za-z0-9_-]{1,256}$/);
  if (!match || revision() !== credentialRevision) throw new TelegramConnectionRefusal();
  const providerBotId = match[1];
  const tokenFingerprint = hashLedgerValue(token);
  let closed = false;
  const assertCurrent = async () => {
    if (closed || organizationCredentialStoreEnabled() !== organizationStore || revision() !== credentialRevision) throw new TelegramConnectionRefusal();
    let fence: (() => void) | undefined;
    if (organizationStore) {
      if (!snapshot) throw new TelegramConnectionRefusal();
      fence = await assertOrganizationCredentialSnapshotCurrent(ctx.organizationId!, snapshot, name);
    } else if (getVaultProtection() !== "configured_secret" || !safeEqualSecret(getVaultCredential(name) ?? "", token ?? "")) throw new TelegramConnectionRefusal();
    return () => {
      if (closed || organizationCredentialStoreEnabled() !== organizationStore || revision() !== credentialRevision) throw new TelegramConnectionRefusal();
      fence?.();
    };
  };
  return {
    providerBotId, tokenFingerprint, credentialRevision, organizationStore, assertCurrent,
    resolveToken: () => { if (closed || !token) throw new TelegramConnectionRefusal(); return token; },
    close: () => { closed = true; token = null; snapshot = null; },
  };
}

function ingressAuthorityDigest(bindingDigest: string, credential: IngressCredential) {
  return hashLedgerValue({ bindingDigest, providerBotId: credential.providerBotId, tokenFingerprint: credential.tokenFingerprint,
    credentialRevision: credential.credentialRevision, organizationStore: credential.organizationStore });
}

async function currentIngressCursor(db: Pick<DrizzleDb, "select">, connectionId: number, providerBotId: string, chatId: number) {
  const [cursor] = await db.select().from(channelIngressCursors).where(eq(channelIngressCursors.sourceConnectionId, connectionId)).limit(1);
  if (cursor && (!cursor.providerBotId || !cursor.tokenFingerprint || cursor.providerBotId !== providerBotId)) throw new TelegramNamespaceRefusal();
  // Never backfill old receipts from text/fingerprints, even if a retained row happens to look attributable.
  const [unattributable] = await db.select({ id: channelIngressUpdates.id }).from(channelIngressUpdates).where(and(
    eq(channelIngressUpdates.sourceConnectionId, connectionId),
    cursor ? sql`(${channelIngressUpdates.providerBotId} IS NULL OR ${channelIngressUpdates.providerBotId} <> ${providerBotId})` : sql`true`,
  )).limit(1);
  if (unattributable) throw new TelegramNamespaceRefusal();
  if (!cursor) {
    const [orphanedContent] = await db.select({ id: projectChatMessages.id }).from(projectChatMessages).where(and(
      eq(projectChatMessages.chatId, chatId),
      sql`${projectChatMessages.metadata}->'channelIngress'->>'sourceConnectionId' = ${String(connectionId)}`,
    )).limit(1);
    if (orphanedContent) throw new TelegramNamespaceRefusal();
  }
  return cursor;
}

/** Owner-facing readiness uses exactly polling's protected identity and durable custody checks, without network I/O. */
export async function telegramIngressNamespaceReadiness(context: TenantContext, connectionId: number): Promise<{
  namespaceReady: boolean; reason: "namespace_reconnect_required" | null;
}> {
  const ctx = { ...context };
  const binding = await currentBinding(ctx, connectionId);
  const credential = await currentIngressCredential(ctx, binding.name);
  try {
    await currentIngressCursor(getDb(), connectionId, credential.providerBotId, binding.binding.chatId);
    const fence = await credential.assertCurrent(); fence();
    return { namespaceReady: true, reason: null };
  } catch (error) {
    if (error instanceof TelegramNamespaceRefusal) return { namespaceReady: false, reason: error.code };
    throw error;
  } finally { credential.close(); }
}

/** Home-only current outbound scope/credential snapshot. A review digest is data, not an execution grant. */
export async function prepareTelegramOutboundConnection(ctx: TenantContext, connectionId: number, projectId: number, chatId: number) {
  const admitted = await currentBinding(ctx, connectionId);
  if (!admitted.policy.allowOutbound || admitted.binding.projectId !== projectId || admitted.binding.chatId !== chatId) throw new TelegramConnectionRefusal();
  const readConsent = async () => {
    const [row] = await getDb().select().from(userDataConsents).where(and(eq(userDataConsents.userId, ctx.userId),
      eq(userDataConsents.scope, telegramOutboundConsentScope(admitted.binding.accountBindingId)))).limit(1);
    if (!row || row.revokedAt || row.consentVersion !== TELEGRAM_OUTBOUND_CONSENT_VERSION) throw new TelegramConnectionRefusal();
    return hashLedgerValue({ id: row.id, acceptedAt: row.acceptedAt, version: row.consentVersion });
  };
  const consentDigest = await readConsent();
  const organizationStore = organizationCredentialStoreEnabled();
  if (organizationStore && ctx.organizationId === null) throw new TelegramConnectionRefusal();
  const revision = () => organizationStore ? organizationCredentialRevision(ctx.organizationId!) : providerCredentialRevision();
  const credentialRevision = revision();
  let organizationSnapshot = organizationStore ? await loadOrganizationCredentialSnapshot(ctx.organizationId!, admitted.name) : null;
  let token = organizationStore ? organizationSnapshot?.[admitted.name] : getVaultProtection() === "configured_secret" ? getVaultCredential(admitted.name) : null;
  if (!token || !/^[0-9]{1,20}:[A-Za-z0-9_-]{1,256}$/.test(token) || revision() !== credentialRevision) throw new TelegramConnectionRefusal();
  const reviewBinding = hashLedgerValue({ authority: admitted.digest, consentDigest, credentialRevision, tokenHash: hashLedgerValue(token), organizationStore });
  let closed = false;
  const assertCurrent = async () => {
    if (closed || organizationCredentialStoreEnabled() !== organizationStore || revision() !== credentialRevision) throw new TelegramConnectionRefusal();
    const current = await currentBinding(ctx, connectionId);
    if (current.digest !== admitted.digest || await readConsent() !== consentDigest) throw new TelegramConnectionRefusal();
    let fence: (() => void) | undefined;
    if (organizationStore) {
      if (!organizationSnapshot) throw new TelegramConnectionRefusal();
      fence = await assertOrganizationCredentialSnapshotCurrent(ctx.organizationId!, organizationSnapshot, admitted.name);
    } else if (getVaultProtection() !== "configured_secret" || !safeEqualSecret(getVaultCredential(admitted.name) ?? "", token ?? "")) throw new TelegramConnectionRefusal();
    return () => {
      if (closed || organizationCredentialStoreEnabled() !== organizationStore || revision() !== credentialRevision) throw new TelegramConnectionRefusal();
      fence?.();
    };
  };
  return {
    binding: admitted.binding, policy: admitted.policy, reviewBinding, assertCurrent,
    resolveBotToken: async () => { const fence = await assertCurrent(); fence(); if (!token) throw new TelegramConnectionRefusal(); return token; },
    close: () => { closed = true; token = null; organizationSnapshot = null; },
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
  const credential = await currentIngressCredential(ctx, admitted.name);
  try {
    const cursor = await currentIngressCursor(getDb(), input.connectionId, credential.providerBotId, admitted.binding.chatId);
    if (input.offset !== (cursor?.nextOffset ?? 0)) throw new TelegramConnectionRefusal();
    const authorityDigest = ingressAuthorityDigest(admitted.digest, credential);
    const response = await requestTelegramGetUpdates({
      poll: { offset: input.offset, limit: input.limit, timeoutSeconds: input.timeoutSeconds, allowedUpdates: admitted.policy.allowedUpdateTypes },
      signal: input.signal, dependencies: input.dependencies,
      assertAuthorized: async (_poll, signal) => {
        const current = await currentBinding(ctx, input.connectionId);
        signal.throwIfAborted();
        if (current.digest !== admitted.digest) throw new TelegramConnectionRefusal();
        return credential.assertCurrent();
      },
      resolveBotToken: async signal => {
        const fence = await credential.assertCurrent();
        signal.throwIfAborted(); fence();
        return credential.resolveToken();
      },
    });
    return { binding: admitted.binding, policy: admitted.policy, authorityDigest, ...response };
  } catch (error) {
    if (error instanceof TelegramPollRefusal || error instanceof TelegramConnectionRefusal) throw error;
    throw new TelegramConnectionRefusal();
  } finally { credential.close(); }
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
  | { kind: "adopted"; adopted: number; edited: number; ignored: number; duplicates: number; nextOffset: number }
  | { kind: "provider_error"; code: "unauthorized" | "conflict" | "rate_limited" | "unavailable"; retryAfterMs: number | null };

/** The protected bot namespace is mandatory before any provider offset may be reused. Same-bot rotation keeps progress. */
export async function nextTelegramPollOffset(context: TenantContext, connectionId: number): Promise<number> {
  const ctx = { ...context };
  const binding = await currentBinding(ctx, connectionId);
  const credential = await currentIngressCredential(ctx, binding.name);
  try {
    const cursor = await currentIngressCursor(getDb(), connectionId, credential.providerBotId, binding.binding.chatId);
    const fence = await credential.assertCurrent(); fence();
    return cursor?.nextOffset ?? 0;
  } finally { credential.close(); }
}

/**
 * Durably adopt one already-authorized poll under CURRENT authority. Chat content, replay custody, a minimal Ledger
 * disposition and the cursor commit together or not at all. Provider acceptance of the offset is never inferred from this.
 * All four admitted message families share logical custody. Edits only change their exact canonical row, never dispatch AI/send.
 * Identity/record-only edit ordering adapts approved OpenClaw c074824a bot-handlers.inbound-pipeline.ts,
 * message-cache-codec.ts and message-dispatch-dedupe.ts. LiOS keeps durable anchors (no donor TTL/cache/SQLite).
 */
export async function adoptTelegramPoll(input: {
  context: TenantContext;
  connectionId: number;
  poll: { authorityDigest: string; status: number; body: Uint8Array };
}): Promise<TelegramAdoptionResult> {
  const ctx = { ...input.context };
  const normalized = normalizeTelegramPollBody(input.poll.body, input.poll.status);
  if (normalized.kind === "provider_error") return normalized;
  const db = getDb();
  const admitted = await currentBinding(ctx, input.connectionId);
  const credential = await currentIngressCredential(ctx, admitted.name);
  try {
    const result = await db.transaction(async (tx): Promise<TelegramAdoptionResult> => {
      // Source → Chat → message. Clear takes Chat → message only, never the inverse source lock.
      const locked = await tx.select({ id: sourceConnections.id }).from(sourceConnections).where(eq(sourceConnections.id, input.connectionId)).for("update").limit(1);
      if (!locked.length) throw new TelegramConnectionRefusal();
      const beforeChatLock = await currentBinding(ctx, input.connectionId, tx);
      await tx.select({ id: projectChats.id }).from(projectChats).where(eq(projectChats.id, beforeChatLock.binding.chatId)).for("update").limit(1);
      // A Chat may have been archived/trashed while this transaction waited for its row lock.
      const current = await currentBinding(ctx, input.connectionId, tx);
      if (current.digest !== admitted.digest || !safeEqualSecret(ingressAuthorityDigest(current.digest, credential), input.poll.authorityDigest)) throw new TelegramConnectionRefusal();
      let credentialFence = await credential.assertCurrent(); credentialFence();
      await currentIngressCursor(tx, input.connectionId, credential.providerBotId, current.binding.chatId);
      await tx.insert(channelIngressCursors).values({
        sourceConnectionId: input.connectionId, provider: "telegram", nextOffset: 0,
        providerBotId: credential.providerBotId, tokenFingerprint: credential.tokenFingerprint,
      }).onConflictDoNothing();
      const [cursor] = await tx.select().from(channelIngressCursors).where(eq(channelIngressCursors.sourceConnectionId, input.connectionId)).for("update").limit(1);
      if (!cursor || cursor.providerBotId !== credential.providerBotId) throw new TelegramNamespaceRefusal();
      const batchIds = normalized.updates.map(update => update.updateId);
      const existingUpdates = batchIds.length === 0 ? [] : await tx.select().from(channelIngressUpdates).where(and(
        eq(channelIngressUpdates.sourceConnectionId, input.connectionId), inArray(channelIngressUpdates.updateId, batchIds),
      ));
      const known = new Map(existingUpdates.map(row => [Number(row.updateId), row]));
      const [executionConsent] = current.policy.autoRun?.enabled ? await tx.select().from(userDataConsents).where(and(
        eq(userDataConsents.userId, ctx.userId),
        eq(userDataConsents.scope, telegramExecutionConsentScope(current.policy.accountBindingId)),
      )).limit(1) : [];
      const executionConsented = Boolean(executionConsent && !executionConsent.revokedAt &&
        executionConsent.consentVersion === TELEGRAM_EXECUTION_CONSENT_VERSION);
      let adopted = 0, edited = 0, ignored = 0, duplicates = 0;
      for (const update of normalized.updates) {
        const fingerprint = hashLedgerValue(update.payload);
        const prior = known.get(update.updateId);
        if (prior) {
          if (prior.providerBotId !== credential.providerBotId) throw new TelegramNamespaceRefusal();
          if (prior.fingerprint !== fingerprint) throw new TelegramAdoptionConflict();
          duplicates++;
          continue;
        }
        const policy = current.policy;
        const isEdit = update.eventType === "edited_message" || update.eventType === "edited_channel_post";
        const isMessage = isEdit || update.eventType === "message" || update.eventType === "channel_post";
        let reason: string | null = null;
        if (update.updateId < cursor.nextOffset) reason = "below_cursor_without_custody";
        else if (!isMessage) reason = "unsupported_event";
        else if (!policy.allowedUpdateTypes.includes(update.eventType)) reason = "update_type_not_allowed";
        else if (!update.conversationId || !update.messageId || !update.messageFamily) reason = "namespace_unresolved";
        else if (!policy.allowedConversationIds.includes(update.conversationId)) reason = "conversation_not_allowed";
        let messageId: number | null = null;
        let messageAnchor = false;
        let disposition: "adopted" | "edited" | "ignored" = "ignored";
        const hasText = update.text !== null && Boolean(update.text.trim());
        if (reason === null) {
          const [anchor] = await tx.select().from(channelIngressUpdates).where(and(
            eq(channelIngressUpdates.sourceConnectionId, input.connectionId),
            eq(channelIngressUpdates.providerBotId, credential.providerBotId),
            eq(channelIngressUpdates.conversationId, update.conversationId!),
            eq(channelIngressUpdates.providerMessageId, update.messageId!),
            eq(channelIngressUpdates.messageAnchor, true),
          )).limit(1);
          if (anchor && anchor.messageFamily !== update.messageFamily) reason = "message_family_mismatch";
          else if (!isEdit && anchor) reason = "logical_message_replay";
          else if (isEdit) {
            if (!anchor) reason = "unmatched_edit";
            else if (anchor.chatMessageId === null) reason = "message_target_unavailable";
            else {
              const [message] = await tx.select().from(projectChatMessages).where(and(
                eq(projectChatMessages.id, anchor.chatMessageId), eq(projectChatMessages.chatId, current.binding.chatId),
              )).for("update").limit(1);
              const [latestApplied] = await tx.select().from(channelIngressUpdates).where(and(
                eq(channelIngressUpdates.sourceConnectionId, input.connectionId),
                eq(channelIngressUpdates.providerBotId, credential.providerBotId),
                eq(channelIngressUpdates.conversationId, update.conversationId!),
                eq(channelIngressUpdates.providerMessageId, update.messageId!),
                inArray(channelIngressUpdates.disposition, ["adopted", "edited"]),
              )).orderBy(sql`coalesce(${channelIngressUpdates.providerEditedAt}, ${channelIngressUpdates.providerOccurredAt}) DESC`, sql`${channelIngressUpdates.updateId} DESC`).limit(1);
              const rawMarker = message?.metadata.channelIngress;
              const marker = rawMarker && typeof rawMarker === "object" && !Array.isArray(rawMarker) ? rawMarker as Record<string, unknown> : null;
              const latestUpdateId = latestApplied?.updateId;
              const latestAt = (latestApplied?.providerEditedAt ?? latestApplied?.providerOccurredAt)?.getTime();
              if (!message || message.role !== "user" || !marker || !latestApplied ||
                  marker.provider !== "telegram" || marker.sourceConnectionId !== input.connectionId ||
                  marker.providerBotId !== credential.providerBotId || marker.conversationId !== update.conversationId ||
                  marker.messageId !== update.messageId || marker.messageFamily !== update.messageFamily ||
                  marker.updateId !== anchor.updateId || marker.occurredAt !== anchor.providerOccurredAt?.toISOString() ||
                  update.occurredAt !== marker.occurredAt || marker.latestUpdateId !== latestUpdateId ||
                  marker.editedAt !== (latestApplied.providerEditedAt?.toISOString() ?? null) ||
                  latestApplied.chatMessageId !== message.id || latestApplied.messageFamily !== update.messageFamily ||
                  !Number.isSafeInteger(latestUpdateId) || !Number.isFinite(latestAt)) reason = "message_target_mismatch";
              else if (message.createdAt.getTime() <= Date.now() - policy.retentionDays * 86_400_000) reason = "message_target_expired";
              else if (Date.parse(update.editedAt!) < latestAt! ||
                  (Date.parse(update.editedAt!) === latestAt && update.updateId <= Number(latestUpdateId))) reason = "stale_edit";
              else {
                // Authoritative edit observation replaces text/caption; missing text invalidates old content, not message deletion.
                const changed = await tx.update(projectChatMessages).set({
                  content: hasText ? update.text! : "[Telegram message edited: no text or caption is available.]",
                  metadata: { ...message.metadata, channelIngress: { ...marker,
                    latestUpdateId: update.updateId, editedAt: update.editedAt, contentState: hasText ? "text" : "no_text",
                    aiTransmissionAllowed: marker.aiTransmissionAllowed === true && policy.allowAiTransmission && hasText,
                  } },
                }).where(and(eq(projectChatMessages.id, message.id), eq(projectChatMessages.chatId, current.binding.chatId))).returning();
                if (!changed.length) reason = "message_target_unavailable";
                else { messageId = changed[0].id; disposition = "edited"; edited++; }
              }
            }
          } else {
            // Even an admitted nontext original receives a tombstone, so later fresh-ID replays cannot invent a turn.
            messageAnchor = true;
            if (!hasText) reason = "no_text";
            else {
              const autoRunEligible = executionConsented && current.policy.autoRun?.enabled === true &&
                policy.allowAiTransmission && update.senderRef !== null &&
                current.policy.autoRun.allowedSenderRefs.includes(update.senderRef);
              const [message] = await tx.insert(projectChatMessages).values({
                chatId: current.binding.chatId, role: "user", content: update.text!,
                metadata: { channelIngress: {
                  provider: "telegram", sourceConnectionId: input.connectionId, providerBotId: credential.providerBotId,
                  updateId: update.updateId, latestUpdateId: update.updateId,
                  conversationId: update.conversationId, messageId: update.messageId, messageFamily: update.messageFamily,
                  occurredAt: update.occurredAt, editedAt: update.editedAt, contentState: "text",
                  aiTransmissionAllowed: policy.allowAiTransmission,
                  senderRef: update.senderRef,
                  autoRunEligible,
                  autoRunInputSha256: autoRunEligible ? hashLedgerValue({ content: update.text!, senderRef: update.senderRef }) : null,
                  executionConsentBinding: autoRunEligible ? hashLedgerValue({
                    id: executionConsent!.id, version: executionConsent!.consentVersion, acceptedAt: executionConsent!.acceptedAt,
                  }) : null,
                  executionPolicySha256: autoRunEligible ? hashLedgerValue(policy.autoRun) : null,
                } },
              }).returning();
              messageId = message.id; disposition = "adopted"; adopted++;
            }
          }
        }
        if (disposition === "ignored") ignored++;
        const hasCoordinates = isMessage && update.messageFamily !== null && update.conversationId !== null && update.messageId !== null;
        await tx.insert(channelIngressUpdates).values({
          sourceConnectionId: input.connectionId, providerBotId: credential.providerBotId,
          updateId: update.updateId, eventType: update.eventType, fingerprint, disposition, reason, chatMessageId: messageId,
          conversationId: hasCoordinates ? update.conversationId : null,
          providerMessageId: hasCoordinates ? update.messageId : null,
          messageFamily: hasCoordinates ? update.messageFamily : null,
          providerOccurredAt: hasCoordinates ? new Date(update.occurredAt!) : null,
          providerEditedAt: hasCoordinates && update.editedAt ? new Date(update.editedAt) : null, messageAnchor,
        });
        await appendLedgerEventInTransaction(tx, ctx, {
          projectId: current.binding.projectId, chatId: current.binding.chatId,
          eventType: "channel.update.dispositioned", actorType: "provider",
          correlationId: `telegram:${input.connectionId}:${update.updateId}`,
          payload: { provider: "telegram", sourceConnectionId: input.connectionId, providerBotId: credential.providerBotId,
            updateId: update.updateId, eventType: update.eventType, disposition, reason, chatMessageId: messageId, fingerprint },
        });
      }
      const nextOffset = normalized.updates.length
        ? Math.max(Number(cursor.nextOffset), normalized.updates[normalized.updates.length - 1].updateId + 1) : Number(cursor.nextOffset);
      await tx.update(channelIngressCursors).set({
        nextOffset, tokenFingerprint: credential.tokenFingerprint, updatedAt: new Date(),
      }).where(eq(channelIngressCursors.sourceConnectionId, input.connectionId));
      if (adopted || edited) await tx.update(projectChats).set({ lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(projectChats.id, current.binding.chatId));
      if ((await currentBinding(ctx, input.connectionId, tx)).digest !== current.digest) throw new TelegramConnectionRefusal();
      credentialFence = await credential.assertCurrent(); credentialFence();
      return { kind: "adopted", adopted, edited, ignored, duplicates, nextOffset };
    });
    if (result.kind === "adopted" && (result.adopted || result.edited)) notifyDataChanged("conversations", { userId: ctx.userId });
    return result;
  } catch (error) {
    if (error instanceof TelegramAdoptionConflict || error instanceof TelegramConnectionRefusal) throw error;
    throw new TelegramConnectionRefusal();
  } finally { credential.close(); }
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

/**
 * Admit retained channel history against current source/consent/work policy at each conversation attempt.
 * Adoption-time permission is necessary, never a lasting transmission grant. Non-channel history is unchanged.
 */
export async function filterTelegramHistoryForAi<T extends {
  id: number; chatId: number; role: string; content: string; createdAt: Date; metadata: Record<string, unknown>;
}>(context: TenantContext, history: readonly T[], now = Date.now()): Promise<T[]> {
  const result: T[] = [];
  const bindings = new Map<number, Awaited<ReturnType<typeof currentBinding>> | null>();
  const botNamespaces = new Map<number, string>();
  // Bound current-row reads to the same recent-history window; non-channel turns do not enter this query.
  const ids = history.filter(message => message.metadata.channelIngress !== undefined && Number.isSafeInteger(message.id) && message.id > 0)
    .slice(0, 20).map(message => message.id);
  const currentRows = ids.length ? await getDb().select({
    id: projectChatMessages.id, chatId: projectChatMessages.chatId, role: projectChatMessages.role, content: projectChatMessages.content,
    createdAt: projectChatMessages.createdAt, metadata: projectChatMessages.metadata,
  }).from(projectChatMessages).innerJoin(projectChats, eq(projectChats.id, projectChatMessages.chatId)).where(and(
    inArray(projectChatMessages.id, ids), eq(projectChats.ownerUserId, context.userId),
    context.organizationId === null ? isNull(projectChats.organizationId) : eq(projectChats.organizationId, context.organizationId),
  )) : [];
  const rowsById = new Map(currentRows.map(row => [row.id, row]));
  for (const message of history) {
    const raw = message.metadata.channelIngress;
    if (raw === undefined) { result.push(message); continue; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const marker = raw as Record<string, unknown>;
    if (marker.provider !== "telegram" || channelMessageExcludedFromAi(message.metadata) ||
        typeof marker.sourceConnectionId !== "number" || !Number.isSafeInteger(marker.sourceConnectionId) ||
        marker.sourceConnectionId < 1 || typeof marker.conversationId !== "string") continue;
    const sourceId = marker.sourceConnectionId;
    if (!bindings.has(sourceId)) {
      // The caller retains only a bounded recent history; also bound distinct lookups defensively.
      if (bindings.size >= 20) continue;
      try {
        const binding = await currentBinding(context, sourceId);
        const credential = await currentIngressCredential(context, binding.name);
        try {
          await currentIngressCursor(getDb(), sourceId, credential.providerBotId, binding.binding.chatId);
          const fence = await credential.assertCurrent(); fence();
          botNamespaces.set(sourceId, credential.providerBotId);
          bindings.set(sourceId, binding);
        } finally { credential.close(); }
      }
      catch { bindings.set(sourceId, null); }
    }
    const current = bindings.get(sourceId);
    const canonical = rowsById.get(message.id);
    if (!canonical || canonical.chatId !== message.chatId || canonical.role !== message.role || canonical.content !== message.content ||
        canonical.createdAt.getTime() !== message.createdAt.getTime() ||
        hashLedgerValue(canonical.metadata.channelIngress ?? null) !== hashLedgerValue(raw)) continue;
    if (!current || marker.providerBotId !== botNamespaces.get(sourceId) || marker.contentState === "no_text" ||
        !current.policy.allowAiTransmission || current.binding.chatId !== message.chatId ||
        !current.policy.allowedConversationIds.includes(marker.conversationId) ||
        !Number.isFinite(message.createdAt.getTime()) ||
        message.createdAt.getTime() <= now - current.policy.retentionDays * 86_400_000) continue;
    result.push(message);
  }
  return result;
}
