export const LIOS_FIRST_USE_CONTRACT = Object.freeze({
  identityIsOnlyEntryGate: true,
  connectionsRequiredToEnter: false,
  primaryAction: "ask" as const,
  optionalConnectionAction: "Connect sources",
  continueAction: "Continue to LiOS",
  noConnectionStatus: "Ready without setup",
  connectedStatus: "Sources ready",
  noConnectionDetail: "Start now. Connect data or AI only when a task needs it.",
  connectedDetail: "Your connected sources are ready. You can adjust source order or add more at any time.",
  shellHint: "Start now. Connections are optional—you can add data or AI when the work needs it.",
  recoveryPreservesTask: true,
});

export type FirstUseConnectionState = "unconfigured" | "connected";

export function firstUseConnectionState(connectedCount: number): FirstUseConnectionState {
  return Number.isFinite(connectedCount) && connectedCount > 0 ? "connected" : "unconfigured";
}
