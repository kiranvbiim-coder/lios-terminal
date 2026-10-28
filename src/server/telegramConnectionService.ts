import { and, eq } from "drizzle-orm";
import { organizations, sourceConnections, userDataConsents, users } from "@shared/schema";
import {
  TELEGRAM_CONNECTION_CONSENT_VERSION, parseTelegramSourceConfig,
  telegramConsentScope, telegramCredentialName,
} from "@shared/telegramConnection";
import { getDb } from "./db";
import { getProject } from "./projectStore";
import { getProjectChat } from "./projectChatStore";
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
async function currentBinding(ctx: TenantContext, connectionId: number) {
  if (!Number.isSafeInteger(ctx.userId) || ctx.userId < 1 || !Number.isSafeInteger(connectionId) || connectionId < 1) throw new TelegramConnectionRefusal();
  const [user] = await getDb().select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!user?.active || user.mustChangePassword || (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) ||
      user.role !== ctx.role || (user.organizationId ?? null) !== ctx.organizationId) throw new TelegramConnectionRefusal();
  const currentTenant = tenantContext(user);
  if (currentTenant.organizationId !== null) {
    const [organization] = await getDb().select({ status: organizations.status }).from(organizations).where(eq(organizations.id, currentTenant.organizationId)).limit(1);
    if (organization?.status !== "active") throw new TelegramConnectionRefusal();
  }
  const [source] = await getDb().select().from(sourceConnections).where(and(
    eq(sourceConnections.id, connectionId), eq(sourceConnections.userId, user.id),
  )).limit(1);
  if (!source || (source.organizationId ?? null) !== currentTenant.organizationId || source.connectorId !== "telegram" || source.sourceType !== "private_api") throw new TelegramConnectionRefusal();
  const policy = parseTelegramSourceConfig(source.config);
  if (!policy.enabled) throw new TelegramConnectionRefusal();
  const name = telegramCredentialName(user.id, policy.accountBindingId);
  // A saved source may name only its own generated vault entry, not another account, env var or file.
  if (source.credentialRef !== `vault:${name}`) throw new TelegramConnectionRefusal();
  const project = await getProject(currentTenant, policy.projectId);
  const chat = await getProjectChat(currentTenant, policy.chatId);
  if (project.status !== "active" || chat.status !== "active" || chat.scope !== "project" || chat.projectId !== project.id) throw new TelegramConnectionRefusal();
  const [consent] = await getDb().select().from(userDataConsents).where(and(
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
    return { binding: admitted.binding, policy: admitted.policy, ...response };
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
