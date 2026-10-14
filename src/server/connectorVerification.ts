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
