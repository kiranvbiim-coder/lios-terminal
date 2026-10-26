import type { DeviceRecord, PendingPairing } from "@shared/devicePairing";
import type { DeviceNetworkStatus } from "@shared/deviceNetwork";
import type { GatewayState } from "./gateway/gatewayClient";
import type { DeviceHomeRecord } from "@shared/deviceHomes";

export type DeviceContinuityState = "online" | "reconnecting" | "offline" | "unknown";

/** Browser Gateway availability is an observation, not a grant: this does
 * not query individual devices or assert the Home has internet access. */
export function describeDeviceContinuity(gateway: GatewayState, browserOnline: boolean | null): {
  state: DeviceContinuityState; label: string; consequence: string;
} {
  if (browserOnline === false) return {
    state: "offline", label: "Browser reports offline",
    consequence: "Home and paired-node availability are unverified. Do not resubmit approvals, remote operations or workflow runs automatically.",
  };
  if (gateway === "ready") return {
    state: "online", label: "Home Gateway connected",
    consequence: "The authenticated Gateway is connected. Individual paired devices and their permitted capabilities still require fresh server verification.",
  };
  if (gateway === "connecting" || gateway === "reconnecting") return {
    state: "reconnecting", label: "Home Gateway reconnecting",
    consequence: "The client may refresh read-only state on reconnect; in-flight actions have unknown outcomes until canonical receipts are inspected. Never auto-retry.",
  };
  return {
    state: "unknown", label: "Home Gateway not connected",
    consequence: "Pairing, device reachability, revocation and previous request outcomes are not confirmed by this connection indicator.",
  };
}

export function advertisedDeviceCapabilities(
  record: Pick<DeviceRecord | PendingPairing, "capabilities" | "commands">,
): { label: string; caveat: string } {
  const cap = record.capabilities.length ? record.capabilities.join(", ") : "none declared";
  const cmds = record.commands.length ? record.commands.join(", ") : "none declared";
  return {
    label: `Advertised capabilities: ${cap} · declared commands: ${cmds}`,
    caveat: "Self-advertised device metadata is not a permission grant, live runtime health, an authorized command, or verified execution.",
  };
}

export function deviceNetworkChangeReview(network: DeviceNetworkStatus, desiredEnabled: boolean): string {
  return desiredEnabled
    ? `Enable the Home's device-only TLS listener for paired devices? Current local network exposure is ${network.enabled ? "enabled" : "disabled"}. This changes local device reachability, not the web/REST API. Pairing and capability approvals remain server-owned. Review your trusted LAN before proceeding.`
    : "Disable the Home device-only TLS listener? Existing remote connections may drop; already-started remote work cannot be assumed cancelled. This does not revoke paired device records.";
}

export function rememberedHomeChangeReview(home: Pick<DeviceHomeRecord, "name" | "homeId">): string {
  return `Make "${home.name}" your locally selected Home? This changes a saved preference only. It does not establish a TLS connection, transfer source rights, authenticate a new Home or retry a pending action. Verify the pinned certificate and reconnect before working.`;
}

export function pairedDeviceRevocationReview(device: Pick<DeviceRecord, "id" | "name">): string {
  return `Revoke "${device.name}" (${device.id.slice(0, 8)})? The Home will revoke its paired-device credential and disconnect currently connected sessions. An offline device may not receive a push notice; future access is refused on server verification. Already completed remote actions cannot be undone.`;
}