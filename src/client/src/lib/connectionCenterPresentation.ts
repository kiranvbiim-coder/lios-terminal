import { LIOS_FIRST_USE_CONTRACT, firstUseConnectionState } from "./firstUseJourney";
export interface ConnectionCenterSummary {
  canEnterTerminal: boolean;
  statusLabel: string;
  ctaLabel: string;
  statusDetail: string;
}

export function summarizeConnectionCenter(connectedCount: number, _availableCount: number): ConnectionCenterSummary {
  const state = firstUseConnectionState(connectedCount);

  return {
    canEnterTerminal: !LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter,
    statusLabel: state === "connected"
      ? LIOS_FIRST_USE_CONTRACT.connectedStatus
      : LIOS_FIRST_USE_CONTRACT.noConnectionStatus,
    ctaLabel: LIOS_FIRST_USE_CONTRACT.continueAction,
    statusDetail: state === "connected"
      ? LIOS_FIRST_USE_CONTRACT.connectedDetail
      : LIOS_FIRST_USE_CONTRACT.noConnectionDetail,
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
