import { z } from "zod";
import { fromBase64Url, toBase64Url } from "./devicePairing";

export const deviceNetworkSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Advertise this Home on the LAN with mDNS while device networking is enabled. */
  discoverable: z.boolean().default(false),
  name: z.string().trim().min(1).max(80),
}).strict();
export type DeviceNetworkSettings = z.infer<typeof deviceNetworkSettingsSchema>;

const deviceEndpointSchema = z.string().max(512).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "wss:" && url.pathname === "/gateway/device" && Boolean(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}, "Pairing requires a TLS device Gateway endpoint without embedded credentials.");

/** The QR is an out-of-band trust channel: its certificate pin must be enforced before any token/proof is sent. */
export const devicePairingInvitationSchema = z.object({
  version: z.literal(1),
  homeId: z.string().uuid(),
  name: deviceNetworkSettingsSchema.shape.name,
  urls: z.array(deviceEndpointSchema).min(1).max(32),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  pairingToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type DevicePairingInvitation = z.infer<typeof devicePairingInvitationSchema>;

export interface DeviceNetworkStatus {
  enabled: boolean;
  discoverable: boolean;
  /** True when an mDNS advertisement is live for this listener. */
  discovering: boolean;
  name: string;
  port: number | null;
  urls: string[];
  fingerprint: string | null;
  homeId: string | null;
  error?: string | null;
}

const INVITATION_PREFIX = "lios-pair:v1:";
export function encodeDevicePairingInvitation(input: DevicePairingInvitation): string {
  const validated = devicePairingInvitationSchema.parse(input);
  return INVITATION_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(validated)));
}

export function decodeDevicePairingInvitation(value: string, now = Date.now()): DevicePairingInvitation {
  if (!value.startsWith(INVITATION_PREFIX) || value.length > 16_384) throw new Error("Invalid LiOS pairing invitation.");
  const invitation = devicePairingInvitationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(value.slice(INVITATION_PREFIX.length)))));
  if (Date.parse(invitation.expiresAt) <= now) throw new Error("This pairing invitation has expired. Ask the Home owner for a new code.");
  return invitation;
}
