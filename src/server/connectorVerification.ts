/**
 * Passive + on-demand truth source for whether a connector's adapter has
 * actually been exercised against its real vendor API, separate from
 * whether a credential merely exists. connectorService.ts reads this to
 * compute ConnectorRuntimeState; it never guesses "live_verified" from
 * credential presence alone.
 *
 * Fed by two paths:
 *  - passive: each connector's own dedicated fetch module records every
 *    real call it makes during normal terminal operation (see
 *    keyedQuoteAdapters.ts's getJson, fredData.ts, worldBankData.ts,
 *    blsData.ts, lseData.ts, fmpData.ts, secEdgarFinancials.ts,
 *    finnhubFinancials.ts, simfinFinancials.ts, marketData.ts's Yahoo/
 *    CoinGecko helpers, and byoaiTransport.ts's invokeAIProvider).
 *  - active: a user-triggered "Test connection" click runs a small live
 *    probe on demand for connectors that have one registered below.
 *
 * State is process-local and resets on restart. A "verified" claim
 * surviving a restart without a new real call would itself be a
 * fabrication -- we no longer know whether it's still true.
 */

export interface ConnectorVerification {
  ok: boolean;
  detail: string;
  at: string;
}

export interface AIChatVerificationIdentity {
  userId: number;
  organizationId: number | null;
  provider: string;
  credentialName?: string;
}

export interface AIChatVerificationAttempt extends AIChatVerificationIdentity {
  readonly attemptId: number;
}

interface AIChatProof {
  attempt: AIChatVerificationAttempt;
  model: string;
  credentialFingerprint: string;
  localModelIdentity?: string;
}

// Explicit account authorization is independent of shared passive connector health.
const chatAttempts = new Map<string, AIChatVerificationAttempt>();
const chatProofs = new Map<string, AIChatProof>();
let nextChatAttempt = 0;
function chatKey(identity: AIChatVerificationIdentity): string {
  return JSON.stringify([identity.organizationId, identity.userId, identity.provider]);
}

export function beginAIChatVerification(identity: AIChatVerificationIdentity): AIChatVerificationAttempt {
  const attempt = { ...identity, attemptId: ++nextChatAttempt };
  const key = chatKey(identity);
  chatAttempts.set(key, attempt);
  chatProofs.delete(key);
  return attempt;
}

export function publishAIChatVerification(attempt: AIChatVerificationAttempt, model: string, credentialFingerprint: string, localModelIdentity?: string): boolean {
  const key = chatKey(attempt);
  if (chatAttempts.get(key) !== attempt) return false;
  chatProofs.set(key, { attempt, model, credentialFingerprint, localModelIdentity });
  return true;
}

export function hasAIChatVerification(identity: AIChatVerificationIdentity, model: string, credentialFingerprint: string, localModelIdentity?: string): boolean {
  const proof = chatProofs.get(chatKey(identity));
  return Boolean(proof && chatAttempts.get(chatKey(identity)) === proof.attempt
    && proof.model === model && proof.credentialFingerprint === credentialFingerprint
    && (localModelIdentity === undefined || proof.localModelIdentity === localModelIdentity));
}

export function aiChatVerificationAttemptId(identity: AIChatVerificationIdentity): number | null {
  const proof = chatProofs.get(chatKey(identity));
  return proof && chatAttempts.get(chatKey(identity)) === proof.attempt ? proof.attempt.attemptId : null;
}

export function invalidateAIChatCredential(credentialName: string, organizationId: number | null | undefined): void {
  for (const [key, attempt] of chatAttempts) {
    if (attempt.credentialName === credentialName && (organizationId === undefined || attempt.organizationId === organizationId)) {
      chatAttempts.delete(key);
      chatProofs.delete(key);
    }
  }
}

export function invalidateAIChatVerification(provider: string, organizationId: number | null | undefined, userId?: number): void {
  for (const [key, attempt] of chatAttempts) {
    if (attempt.provider === provider && (organizationId === undefined || attempt.organizationId === organizationId)
      && (userId === undefined || attempt.userId === userId)) {
      chatAttempts.delete(key);
      chatProofs.delete(key);
    }
  }
}

const verifications = new Map<string, ConnectorVerification>();

export function recordConnectorVerification(connectorId: string, ok: boolean, detail: string): void {
  verifications.set(connectorId, { ok, detail, at: new Date().toISOString() });
}

export function getConnectorVerification(connectorId: string): ConnectorVerification | null {
  return verifications.get(connectorId) ?? null;
}

/** Test-only state reset; not used by runtime code. */
export function resetConnectorVerificationsForTests(): void {
  verifications.clear();
  chatAttempts.clear();
  chatProofs.clear();
}

export type ConnectorProbe = () => Promise<{ ok: boolean; detail: string }>;

const probes = new Map<string, ConnectorProbe>();

/** Registers a cheap, user-initiated live check for a connector. Only wire probes that don't meaningfully cost the user quota or money per click. */
export function registerConnectorProbe(connectorId: string, probe: ConnectorProbe): void {
  probes.set(connectorId, probe);
}

export function hasConnectorProbe(connectorId: string): boolean {
  return probes.has(connectorId);
}

/**
 * Runs a connector's registered live probe and records the outcome. Used
 * by the "Test connection" action so a click actually exercises the
 * vendor's API instead of re-reading a cached credential-presence guess.
 * Throws if no probe is registered -- callers should check
 * hasConnectorProbe() first and fall back to reporting the connector's
 * last-known passive state instead of silently no-op'ing.
 */
export async function probeConnector(connectorId: string): Promise<ConnectorVerification> {
  const probe = probes.get(connectorId);
  if (!probe) throw new Error(`No live probe is registered for connector "${connectorId}".`);
  try {
    const result = await probe();
    recordConnectorVerification(connectorId, result.ok, result.detail);
  } catch (error) {
    recordConnectorVerification(connectorId, false, error instanceof Error ? error.message : String(error));
  }
  return getConnectorVerification(connectorId)!;
}

/** Test-only probe registry reset. */
export function resetConnectorProbesForTests(): void {
  probes.clear();
}
