import { LIOS_FIRST_USE_CONTRACT } from "./firstUseJourney";
export interface ConnectionCenterSummary {
  canEnterTerminal: boolean;
  statusLabel: string;
  ctaLabel: string;
  statusDetail: string;
  state: "loading" | "unavailable" | "unconfigured" | "configured" | "verified" | "attention";
  savedCount: number;
  verifiedCount: number;
  attentionCount: number;
}

export function summarizeConnectionCenter(connections: readonly { status: string }[] | undefined, failed = false): ConnectionCenterSummary {
  const savedCount = connections?.length ?? 0;
  const verifiedCount = connections?.filter(connection => ["healthy", "live_verified"].includes(connection.status.trim().toLowerCase())).length ?? 0;
  const attentionCount = connections?.filter(connection => !["healthy", "live_verified", "configured", "credential_configured"].includes(connection.status.trim().toLowerCase())).length ?? 0;
  const state = failed ? "unavailable" : connections === undefined ? "loading" : !savedCount ? "unconfigured"
    : attentionCount ? "attention" : verifiedCount === savedCount ? "verified" : "configured";
  const presentation = {
    loading: ["Checking saved connections", "You can continue while LiOS loads your saved connection status."],
    unavailable: ["Connection status unavailable", "Saved connection status could not be loaded. Retry status or continue without assuming a source is available."],
    unconfigured: [LIOS_FIRST_USE_CONTRACT.noConnectionStatus, LIOS_FIRST_USE_CONTRACT.noConnectionDetail],
    configured: ["Connections saved", "Saved configuration is not live verification. Verify a source when your work needs it."],
    verified: ["Connections verified", "The saved connections have recorded successful checks. Coverage, freshness and permissions are checked for each request."],
    attention: ["Connections need attention", "Some saved connections are unavailable, disabled or need verification. Review their status below; you can still continue."],
  }[state];
  return {
    canEnterTerminal: !LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter,
    ctaLabel: LIOS_FIRST_USE_CONTRACT.continueAction,
    state, savedCount, verifiedCount, attentionCount,
    statusLabel: presentation[0], statusDetail: presentation[1],
  };
}


export interface ConnectionRecoveryPresentation {
  needsAttention: boolean;
  testLabel: "Test" | "Verify" | "Retry";
  editLabel: "Edit" | "Fix";
}

export function connectionRecoveryPresentation(status: string): ConnectionRecoveryPresentation {
  const normalized = status.trim().toLowerCase();
  if (normalized === "healthy" || normalized === "live_verified") {
    return { needsAttention: false, testLabel: "Test", editLabel: "Edit" };
  }
  if (normalized === "configured" || normalized === "credential_configured") {
    return { needsAttention: false, testLabel: "Verify", editLabel: "Edit" };
  }
  return { needsAttention: true, testLabel: "Retry", editLabel: "Fix" };
}

export function isConnectorConnectable(connector: { adapterImplemented?: boolean }): boolean {
  return connector.adapterImplemented !== false;
}

/**
 * Registry headers must distinguish configured credentials from a successful
 * live provider invocation. Count only current, known connector identities;
 * duplicate/stale health rows must never inflate the verified figure.
 */
export function countLiveVerifiedConnectors(
  connectors: readonly { id: string }[],
  health: readonly { connectorId: string; state: string }[],
): number {
  const knownConnectorIds = new Set(connectors.map((connector) => connector.id));
  return new Set(health
    .filter((report) => report.state === "live_verified" && knownConnectorIds.has(report.connectorId))
    .map((report) => report.connectorId)).size;
}
