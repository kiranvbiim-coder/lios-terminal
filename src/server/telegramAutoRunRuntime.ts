import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { channelIngressUpdates, projectChatMessages, sourceConnections, userDataConsents } from "@shared/schema";
import {
  parseTelegramSourceConfig, TELEGRAM_EXECUTION_CONSENT_VERSION, TELEGRAM_CONNECTION_CONSENT_VERSION,
  telegramExecutionConsentScope, telegramConsentScope,
} from "@shared/telegramConnection";
import type { TelegramConnectionPolicy } from "@shared/telegramConnection";
import { getDb } from "./db";
import type { startAdoptedChannelIngressRun } from "./conversationRunService";
import { hashLedgerValue } from "./ledgerStore";

/** Discovery is only a hint. The canonical run entry reloads every owner/source/consent/AI/cap guard. */
export async function discoverTelegramAutoRunCandidates(connectionId: number): Promise<number[]> {
  const db = getDb();
  const [source] = await db.select().from(sourceConnections).where(and(
    eq(sourceConnections.id, connectionId), eq(sourceConnections.connectorId, "telegram"), eq(sourceConnections.sourceType, "private_api"),
  )).limit(1);
  if (!source) return [];
  let policy: TelegramConnectionPolicy;
  try { policy = parseTelegramSourceConfig(source.config); } catch { return []; }
  if (!policy.enabled || !policy.allowAiTransmission || !policy.autoRun?.enabled) return [];
  let executionConsentBinding: string | null = null;
  for (const [scope, version] of [
    [telegramConsentScope(policy.accountBindingId), TELEGRAM_CONNECTION_CONSENT_VERSION],
    [telegramExecutionConsentScope(policy.accountBindingId), TELEGRAM_EXECUTION_CONSENT_VERSION],
  ]) {
    const [consent] = await db.select({
      id: userDataConsents.id, version: userDataConsents.consentVersion, acceptedAt: userDataConsents.acceptedAt,
    }).from(userDataConsents).where(and(
      eq(userDataConsents.userId, source.userId), eq(userDataConsents.scope, scope),
      eq(userDataConsents.consentVersion, version), isNull(userDataConsents.revokedAt),
    )).limit(1);
    if (!consent) return [];
    if (scope === telegramExecutionConsentScope(policy.accountBindingId)) executionConsentBinding = hashLedgerValue(consent);
  }
  if (executionConsentBinding === null) return [];
  const executionPolicySha256 = hashLedgerValue(policy.autoRun);
  const retentionCutoff = new Date(Date.now() - policy.retentionDays * 86_400_000);
  const candidates = await db.select({ id: channelIngressUpdates.id }).from(channelIngressUpdates)
    .innerJoin(projectChatMessages, eq(projectChatMessages.id, channelIngressUpdates.chatMessageId))
    .where(and(
      eq(channelIngressUpdates.sourceConnectionId, connectionId), eq(channelIngressUpdates.messageAnchor, true),
      eq(channelIngressUpdates.disposition, "adopted"), isNull(channelIngressUpdates.executionRequestId),
      isNull(channelIngressUpdates.executionClaimedAt),
      eq(projectChatMessages.chatId, policy.chatId),
      eq(projectChatMessages.role, "user"), gt(projectChatMessages.createdAt, retentionCutoff),
      sql`${projectChatMessages.metadata}->'channelIngress'->'aiTransmissionAllowed' = 'true'::jsonb`,
      sql`${projectChatMessages.metadata}->'channelIngress'->>'executionConsentBinding' = ${executionConsentBinding}`,
      sql`${projectChatMessages.metadata}->'channelIngress'->>'executionPolicySha256' = ${executionPolicySha256}`,
      inArray(sql<string>`${projectChatMessages.metadata}->'channelIngress'->>'senderRef'`, policy.autoRun.allowedSenderRefs),
      sql`${projectChatMessages.metadata}->'channelIngress'->'autoRunEligible' = 'true'::jsonb`,
      // An edit never creates a delayed first execution either; only untouched original input is discoverable.
      sql`${projectChatMessages.metadata}->'channelIngress'->'latestUpdateId' = ${projectChatMessages.metadata}->'channelIngress'->'updateId'`,
    )).orderBy(asc(channelIngressUpdates.id)).limit(3);
  return candidates.map(candidate => candidate.id);
}

type StartIncomingRun = typeof startAdoptedChannelIngressRun;

/** Called only AFTER durable adoption returns (no source/Chat locks); awaits admission, never model completion. */
export async function startTelegramAutoRunsAfterAdoption(
  connectionId: number,
  signal?: AbortSignal,
  startRun?: StartIncomingRun,
): Promise<void> {
  if (signal?.aborted) return;
  const ids = await discoverTelegramAutoRunCandidates(connectionId);
  if (signal?.aborted || ids.length === 0) return;
  // Lazy boundary avoids setup → polling → runner initialization cycles and keeps disabled sources inert.
  const start = startRun ?? (await import("./conversationRunService")).startAdoptedChannelIngressRun;
  for (const id of ids) {
    if (signal?.aborted) return;
    try { await start(id); } catch { /* A claimed/unknown attempt is never automatically replayed. */ }
  }
}
