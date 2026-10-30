import crypto from "node:crypto";
import { and, count, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  channelIngressCursors, channelIngressUpdates, environmentSetups, organizations, projectChatMessages,
  projectChats, projects, sourceConnections, userDataConsents, userPersonaPreferences, users,
} from "@shared/schema";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import {
  parseTelegramSourceConfig, TELEGRAM_CONNECTION_CONSENT_VERSION, TELEGRAM_EXECUTION_CONSENT_VERSION,
  telegramConsentScope, telegramCredentialName, telegramExecutionConsentScope,
} from "@shared/telegramConnection";
import { parseDataStackPins } from "@shared/dataStackPins";
import { getDb, type DrizzleDb } from "./db";
import { tenantContext } from "./tenantContext";
import { appendLedgerEventInTransaction, hashLedgerValue } from "./ledgerStore";
import { filterTelegramHistoryForAi, telegramIngressNamespaceReadiness } from "./telegramConnectionService";
import { masterAiAuthorizationRevision, requireMasterAiOn } from "./masterAiGate";
import { loadOrganizationCredentials } from "./organizationCredentialVault";
import { hasActiveCommunityConsent } from "./communityDataConsent";
import { runWithRequestIdentity } from "./requestContext";
import type { PersonaPreferenceUser } from "./personaPreferenceService";
import { notifyDataChanged } from "./gatewayRuntime";

export class ChannelIngressExecutionRefusal extends Error {
  constructor(readonly reason: string) { super(`Incoming execution refused: ${reason}.`); this.name = "ChannelIngressExecutionRefusal"; }
}
function refuse(reason: string): never { throw new ChannelIngressExecutionRefusal(reason); }

/** Read only canonical custody and current authority. A legacy/mutated marker can never mint an execution grant. */
async function readState(ingressId: number, db: Pick<DrizzleDb, "select"> = getDb()) {
  const [ingress] = await db.select().from(channelIngressUpdates).where(eq(channelIngressUpdates.id, ingressId)).limit(1);
  if (!ingress || ingress.disposition !== "adopted" || !ingress.messageAnchor || !ingress.chatMessageId ||
      !["message", "channel_post"].includes(ingress.eventType)) refuse("input_unavailable");
  const [source] = await db.select().from(sourceConnections).where(eq(sourceConnections.id, ingress.sourceConnectionId)).limit(1);
  if (!source || source.connectorId !== "telegram" || source.sourceType !== "private_api") refuse("source_unavailable");
  const policy = parseTelegramSourceConfig(source.config);
  if (!policy.enabled || !policy.allowAiTransmission || !policy.autoRun?.enabled) refuse("execution_disabled");
  const [user] = await db.select().from(users).where(eq(users.id, source.userId)).limit(1);
  if (!user?.active || user.mustChangePassword || (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) ||
      (source.organizationId ?? null) !== (user.organizationId ?? null)) refuse("owner_unavailable");
  const context = tenantContext(user);
  if (context.organizationId !== null) {
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, context.organizationId)).limit(1);
    if (organization?.status !== "active") refuse("organization_unavailable");
  }
  if (source.credentialRef !== `vault:${telegramCredentialName(user.id, policy.accountBindingId)}`) refuse("source_unavailable");
  const [chat] = await db.select().from(projectChats).where(eq(projectChats.id, policy.chatId)).limit(1);
  const [project] = await db.select().from(projects).where(eq(projects.id, policy.projectId)).limit(1);
  if (!chat || !project || chat.ownerUserId !== user.id || project.ownerUserId !== user.id ||
      (chat.organizationId ?? null) !== context.organizationId || (project.organizationId ?? null) !== context.organizationId ||
      chat.scope !== "project" || chat.projectId !== project.id || chat.status !== "active" || project.status !== "active" ||
      chat.trashedAt || project.trashedAt) refuse("chat_unavailable");
  const consents = await db.select().from(userDataConsents).where(and(eq(userDataConsents.userId, user.id), or(
    eq(userDataConsents.scope, telegramConsentScope(policy.accountBindingId)),
    eq(userDataConsents.scope, telegramExecutionConsentScope(policy.accountBindingId)),
  )));
  const ingressConsent = consents.find(row => row.scope === telegramConsentScope(policy.accountBindingId));
  const executionConsent = consents.find(row => row.scope === telegramExecutionConsentScope(policy.accountBindingId));
  if (!ingressConsent || ingressConsent.revokedAt || ingressConsent.consentVersion !== TELEGRAM_CONNECTION_CONSENT_VERSION ||
      !executionConsent || executionConsent.revokedAt || executionConsent.consentVersion !== TELEGRAM_EXECUTION_CONSENT_VERSION) refuse("consent_unavailable");
  const [cursor] = await db.select().from(channelIngressCursors).where(eq(channelIngressCursors.sourceConnectionId, source.id)).limit(1);
  const [message] = await db.select().from(projectChatMessages).where(eq(projectChatMessages.id, ingress.chatMessageId)).limit(1);
  const raw = message?.metadata.channelIngress;
  const marker = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!message || message.chatId !== chat.id || message.role !== "user" || !marker ||
      marker.provider !== "telegram" || marker.sourceConnectionId !== source.id || marker.providerBotId !== ingress.providerBotId ||
      !cursor?.providerBotId || cursor.providerBotId !== ingress.providerBotId || !cursor.tokenFingerprint ||
      marker.updateId !== ingress.updateId || marker.latestUpdateId !== ingress.updateId || marker.editedAt !== null ||
      marker.conversationId !== ingress.conversationId || marker.messageId !== ingress.providerMessageId ||
      marker.messageFamily !== ingress.messageFamily || marker.occurredAt !== ingress.providerOccurredAt?.toISOString() ||
      marker.contentState !== "text" || marker.aiTransmissionAllowed !== true || marker.autoRunEligible !== true) refuse("input_not_eligible");
  if (typeof marker.senderRef !== "string" || !policy.autoRun.allowedSenderRefs.includes(marker.senderRef)) refuse("actor_not_allowed");
  if (!policy.allowedConversationIds.includes(String(marker.conversationId)) || !policy.allowedUpdateTypes.includes(ingress.eventType)) refuse("source_policy_changed");
  if (message.createdAt.getTime() <= Date.now() - policy.retentionDays * 86_400_000) refuse("input_expired");
  if (marker.autoRunInputSha256 !== hashLedgerValue({ content: message.content, senderRef: marker.senderRef }) ||
      marker.executionPolicySha256 !== hashLedgerValue(policy.autoRun) ||
      marker.executionConsentBinding !== hashLedgerValue({ id: executionConsent.id, version: executionConsent.consentVersion, acceptedAt: executionConsent.acceptedAt })) refuse("adoption_binding_changed");
  const [setup] = await db.select().from(environmentSetups).where(eq(environmentSetups.userId, user.id)).limit(1);
  const [preferences] = await db.select({ preferences: userPersonaPreferences.preferences }).from(userPersonaPreferences)
    .where(eq(userPersonaPreferences.userId, user.id)).limit(1);
  const inputSha256 = hashLedgerValue({ content: message.content, marker, messageId: message.id, createdAt: message.createdAt });
  const authoritySha256 = hashLedgerValue({ source, userId: user.id, organizationId: context.organizationId, role: user.role,
    chatId: chat.id, projectId: project.id, projectInstructions: project.instructions, ingressConsent, executionConsent, setup,
    masterAi: preferences?.preferences.waveCMasterAi ?? null });
  return { ingress, source, policy, user: user as PersonaPreferenceUser, context, chat, message, setup, inputSha256, authoritySha256 };
}

/** Background work resolves the canonical owner's organization credentials; ambient caller identity is never inherited. */
async function withIncomingIdentity<T>(state: Awaited<ReturnType<typeof readState>>, callback: () => Promise<T>): Promise<T> {
  const [credentials, communityYahooConsent, publicFillerConsent] = await Promise.all([
    state.context.organizationId !== null ? loadOrganizationCredentials(state.context.organizationId) : Promise.resolve(undefined),
    hasActiveCommunityConsent(state.user.id, "yahoo_community"), hasActiveCommunityConsent(state.user.id, "public_filler"),
  ]);
  return runWithRequestIdentity({ userId: state.user.id, organizationId: state.context.organizationId, credentials,
    selectedConnectorIds: state.setup?.selectedConnectorIds ?? [], providerStackOrder: state.setup?.providerStackOrder ?? [],
    dataStackPins: parseDataStackPins(state.setup?.dataStackPins ?? []), communityYahooConsent, publicFillerConsent }, callback);
}

export type AdoptedChannelIngressLaunch = Awaited<ReturnType<typeof prepareAdoptedChannelIngressLaunch>>;

/** No model/tool call here. SQL admission precedes the filesystem journal: permanent at-most-once, not exactly-once. */
export async function prepareAdoptedChannelIngressLaunch(ingressId: number) {
  if (!Number.isSafeInteger(ingressId) || ingressId < 1) refuse("invalid_ingress_id");
  const initial = await readState(ingressId);
  if (initial.ingress.executionRequestId) refuse("already_claimed");
  const gate = await withIncomingIdentity(initial, () => requireMasterAiOn(initial.user));
  if (!gate.ok) refuse("master_ai_off");
  const masterAiRevision = masterAiAuthorizationRevision(initial.user.id);
  const requestId = crypto.randomUUID();
  const budget = { maxSteps: initial.policy.autoRun!.maxSteps, maxAiCalls: initial.policy.autoRun!.maxAiCalls,
    maxDurationMs: initial.policy.autoRun!.maxDurationMs, maxRevisions: 0 };
  const request = conversationRequestSchema.parse({ requestId, message: initial.message.content,
    executionMode: "ai_assisted", sourceScope: "auto", approvals: [], aiDirectApproved: false,
    transmissionPolicy: { allowResourceReferences: false, maxProviderAttempts: 1 },
  });
  let claimed = false;
  let deadlineAtMs: number | null = null;
  const compare = (current: Awaited<ReturnType<typeof readState>>) => {
    if (deadlineAtMs !== null && Date.now() >= deadlineAtMs) refuse("duration_limit");
    if (masterAiAuthorizationRevision(initial.user.id) !== masterAiRevision) refuse("master_ai_changed");
    if (current.inputSha256 !== initial.inputSha256 || current.authoritySha256 !== initial.authoritySha256) refuse("input_or_authority_changed");
    if (claimed && (current.ingress.executionRequestId !== requestId || current.ingress.executionInputSha256 !== initial.inputSha256 ||
        current.ingress.executionChatId !== initial.chat.id || current.ingress.executionSettledAt)) refuse("claim_unavailable");
  };
  const assertCurrent = async () => {
    const current = await readState(ingressId);
    compare(current);
    const currentGate = await withIncomingIdentity(current, () => requireMasterAiOn(current.user));
    if (!currentGate.ok || currentGate.provider !== gate.provider || currentGate.model !== gate.model ||
        currentGate.verificationAttemptId !== gate.verificationAttemptId) refuse("master_ai_changed");
    await telegramIngressNamespaceReadiness(current.context, current.source.id);
    if ((await filterTelegramHistoryForAi(current.context, [current.message])).length !== 1) refuse("source_permission_changed");
    compare(await readState(ingressId));
  };
  await assertCurrent();
  return {
    ingressId, requestId, user: initial.user, chatId: initial.chat.id, message: initial.message,
    inputSha256: initial.inputSha256, request, budget, assertCurrent,
    remainingDurationMs: () => deadlineAtMs === null ? budget.maxDurationMs : Math.max(0, deadlineAtMs - Date.now()),
    withIdentity<T>(callback: () => Promise<T>): Promise<T> {
      return withIncomingIdentity(initial, callback);
    },
    async claim(metadata: Record<string, unknown>) {
      await assertCurrent();
      await getDb().transaction(async tx => {
        await tx.select({ id: sourceConnections.id }).from(sourceConnections).where(eq(sourceConnections.id, initial.source.id)).for("update").limit(1);
        await tx.select({ id: projectChats.id }).from(projectChats).where(eq(projectChats.id, initial.chat.id)).for("update").limit(1);
        // Retention deletes message then its SET NULL custody FK; keep that order under Source/Chat.
        await tx.select({ id: projectChatMessages.id }).from(projectChatMessages).where(eq(projectChatMessages.id, initial.message.id)).for("update").limit(1);
        await tx.select({ id: channelIngressUpdates.id }).from(channelIngressUpdates).where(eq(channelIngressUpdates.id, ingressId)).for("update").limit(1);
        await tx.select({ id: userDataConsents.id }).from(userDataConsents).where(and(eq(userDataConsents.userId, initial.user.id),
          or(eq(userDataConsents.scope, telegramConsentScope(initial.policy.accountBindingId)),
            eq(userDataConsents.scope, telegramExecutionConsentScope(initial.policy.accountBindingId))))).for("share");
        await tx.select({ id: userPersonaPreferences.userId }).from(userPersonaPreferences)
          .where(eq(userPersonaPreferences.userId, initial.user.id)).for("share");
        const current = await readState(ingressId, tx);
        if (current.ingress.executionRequestId) refuse("already_claimed");
        compare(current);
        const [inflight] = await tx.select({ id: channelIngressUpdates.id }).from(channelIngressUpdates).where(and(
          isNotNull(channelIngressUpdates.executionRequestId), isNull(channelIngressUpdates.executionSettledAt),
          or(eq(channelIngressUpdates.sourceConnectionId, initial.source.id), eq(channelIngressUpdates.executionChatId, initial.chat.id)),
        )).limit(1);
        if (inflight) refuse("execution_inflight");
        const now = new Date();
        const [usage] = await tx.select({
          hour: sql<number>`count(*) filter (where ${channelIngressUpdates.executionClaimedAt} >= ${new Date(now.getTime() - 3_600_000)})::int`,
          day: count(),
        }).from(channelIngressUpdates).where(and(eq(channelIngressUpdates.sourceConnectionId, initial.source.id),
          gte(channelIngressUpdates.executionClaimedAt, new Date(now.getTime() - 86_400_000))));
        if ((usage?.hour ?? 0) >= initial.policy.autoRun!.maxRunsPerHour) refuse("hourly_limit");
        if ((usage?.day ?? 0) >= initial.policy.autoRun!.maxRunsPerDay) refuse("daily_limit");
        compare(current);
        deadlineAtMs = now.getTime() + budget.maxDurationMs;
        await tx.update(channelIngressUpdates).set({ executionRequestId: requestId, executionInputSha256: initial.inputSha256,
          executionClaimedAt: now, executionChatId: initial.chat.id }).where(eq(channelIngressUpdates.id, ingressId));
        await tx.update(projectChatMessages).set({ metadata: { ...current.message.metadata, ...metadata,
          channelIngressExecutionId: ingressId } }).where(eq(projectChatMessages.id, initial.message.id));
        await appendLedgerEventInTransaction(tx, initial.context, { projectId: initial.chat.projectId, chatId: initial.chat.id,
          eventType: "execution.planned", actorType: "system", requestId, payload: { purpose: "channel_ingress_claim",
            ingressId, sourceConnectionId: initial.source.id, messageId: initial.message.id, inputSha256: initial.inputSha256,
            authoritySha256: initial.authoritySha256, budget, automaticReplay: false } });
      });
      claimed = true;
      notifyDataChanged("conversations", { userId: initial.user.id });
    },
    async persistAssistant(content: string, metadata: Record<string, unknown>) {
      await assertCurrent();
      await getDb().transaction(async tx => {
        // Same lock order as adoption/claim; Chat clear either precedes this check or deletes the committed output.
        await tx.select({ id: sourceConnections.id }).from(sourceConnections).where(eq(sourceConnections.id, initial.source.id)).for("update").limit(1);
        await tx.select({ id: projectChats.id }).from(projectChats).where(eq(projectChats.id, initial.chat.id)).for("update").limit(1);
        await tx.select({ id: projectChatMessages.id }).from(projectChatMessages).where(eq(projectChatMessages.id, initial.message.id)).for("update").limit(1);
        await tx.select({ id: channelIngressUpdates.id }).from(channelIngressUpdates).where(eq(channelIngressUpdates.id, ingressId)).for("update").limit(1);
        await tx.select({ id: userDataConsents.id }).from(userDataConsents).where(and(eq(userDataConsents.userId, initial.user.id),
          or(eq(userDataConsents.scope, telegramConsentScope(initial.policy.accountBindingId)),
            eq(userDataConsents.scope, telegramExecutionConsentScope(initial.policy.accountBindingId))))).for("share");
        await tx.select({ id: userPersonaPreferences.userId }).from(userPersonaPreferences)
          .where(eq(userPersonaPreferences.userId, initial.user.id)).for("share");
        compare(await readState(ingressId, tx));
        const [existing] = await tx.select({ id: projectChatMessages.id }).from(projectChatMessages).where(and(
          eq(projectChatMessages.chatId, initial.chat.id), eq(projectChatMessages.role, "assistant"),
          sql`${projectChatMessages.metadata}->>'channelIngressExecutionId' = ${String(ingressId)}`,
        )).limit(1);
        if (masterAiAuthorizationRevision(initial.user.id) !== masterAiRevision) refuse("master_ai_changed");
        if (!existing) await tx.insert(projectChatMessages).values({ chatId: initial.chat.id, role: "assistant", content,
          metadata: { ...metadata, channelIngressExecutionId: ingressId } });
        const now = new Date();
        await tx.update(projectChats).set({ lastActivityAt: now, updatedAt: now }).where(eq(projectChats.id, initial.chat.id));
        await tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, initial.chat.projectId!));
      });
      notifyDataChanged("conversations", { userId: initial.user.id });
    },
    async settle() {
      if (!claimed) return;
      // Never clear/reassign a claim, even if its message was purged. Unknown/crash outcomes do not call this.
      const settled = await getDb().update(channelIngressUpdates).set({ executionSettledAt: new Date() }).where(and(
        eq(channelIngressUpdates.id, ingressId), eq(channelIngressUpdates.executionRequestId, requestId), isNull(channelIngressUpdates.executionSettledAt),
      )).returning();
      if (settled.length) notifyDataChanged("conversations", { userId: initial.user.id });
    },
  };
}

export async function isAdoptedChannelExecutionRequest(requestId: string): Promise<boolean> {
  const [row] = await getDb().select({ id: channelIngressUpdates.id }).from(channelIngressUpdates)
    .where(eq(channelIngressUpdates.executionRequestId, requestId)).limit(1);
  return Boolean(row);
}
