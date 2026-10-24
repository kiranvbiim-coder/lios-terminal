export const LIOS_FIRST_USE_CONTRACT = Object.freeze({
  identityIsOnlyEntryGate: true,
  connectionsRequiredToEnter: false,
  primaryAction: "ask" as const,
  optionalConnectionAction: "Connect data or AI (optional)",
  continueAction: "Continue to LiOS",
  noConnectionStatus: "Ready without setup",
  noConnectionDetail: "Start now. Connect data or AI only when a task needs it.",
  shellHint: "Ask in your own words. Configure sources and AI when needed; unavailable evidence or capabilities stay explicit.",
  recoveryPreservesTask: true,
});

export type FirstUseConnectionState = "unconfigured" | "connected";

export function firstUseConnectionState(connectedCount: number): FirstUseConnectionState {
  return Number.isFinite(connectedCount) && connectedCount > 0 ? "connected" : "unconfigured";
}

/** Known setup recoveries open the existing Connections surface; all others stage text. */
export function firstUseRecoveryDestination(action: string): "connections" | "compose" {
  const normalized = action.trim().toLowerCase().replace(/\s+/g, " ");
  return /^(?:connect\b.*|configure ai\b.*|set up ai\b.*|open connection center|open connections|open connect)$/.test(normalized)
    ? "connections" : "compose";
}
