import { z } from "zod";

/**
 * Device identity and pairing contract (GM-09a).
 *
 * A paired device is an Ed25519 keypair. The Home stores only the public key; every Gateway connection proves
 * possession by signing a nonce the Home just issued, so there is no reusable bearer secret on the device or in the
 * Home. Pairing is a one-time, short-lived token created from an owner session and then approved by that owner on
 * the Home. A paired device acts as the user who approved it, with scopes capped below `admin`: it can read and run
 * conversations but never manage the Home (backups, licence, data folder, other devices).
 *
 * The proof payload shape follows OpenClaw `packages/gateway-client/src/device-auth.ts` (MIT, commit
 * c074824a27c96d3983043f9eeb33823cd1772d8c): a delimiter-joined, versioned string binding the device, client,
 * scopes, signing time and the server nonce. LiOS signs with Ed25519 over WebCrypto so the same code runs in
 * Node, browsers and webviews.
 */

export const DEVICE_PAIRING_TOKEN_TTL_MS = 5 * 60_000;
/** Largest accepted difference between the device's signing time and the Home's clock. */
export const DEVICE_PROOF_MAX_SKEW_MS = 2 * 60_000;
/** The only scopes a paired device can ever hold. */
export const DEVICE_SCOPES = ["read", "write"] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];

export const DEVICE_CAPABILITY_LIMIT = 64;
const deviceSurfaceNameSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);
export const deviceCapabilityAdvertisementSchema = z.object({
  capabilities: z.array(deviceSurfaceNameSchema).max(DEVICE_CAPABILITY_LIMIT).default([]),
  commands: z.array(deviceSurfaceNameSchema).max(DEVICE_CAPABILITY_LIMIT).default([]),
}).strict();
export type DeviceCapabilityAdvertisement = z.infer<typeof deviceCapabilityAdvertisementSchema>;

export function normalizeDeviceCapabilityAdvertisement(input?: {
  capabilities?: readonly string[];
  commands?: readonly string[];
} | null): DeviceCapabilityAdvertisement {
  const parsed = deviceCapabilityAdvertisementSchema.parse({
    capabilities: input?.capabilities ?? [],
    commands: input?.commands ?? [],
  });
  return {
    capabilities: [...new Set(parsed.capabilities)].sort(),
    commands: [...new Set(parsed.commands)].sort(),
  };
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** Raw 32-byte Ed25519 public key, base64url without padding. */
export const devicePublicKeySchema = z.string().length(43).regex(BASE64URL);
/** 64-byte Ed25519 signature, base64url without padding. */
export const deviceSignatureSchema = z.string().length(86).regex(BASE64URL);
export const deviceIdSchema = z.string().length(32).regex(/^[0-9a-f]+$/);

export const deviceProofSchema = z.object({
  id: deviceIdSchema,
  publicKey: devicePublicKeySchema,
  signature: deviceSignatureSchema,
  signedAt: z.number().int().min(0),
  capabilities: z.array(deviceSurfaceNameSchema).max(DEVICE_CAPABILITY_LIMIT).optional(),
  commands: z.array(deviceSurfaceNameSchema).max(DEVICE_CAPABILITY_LIMIT).optional(),
}).strict();
export type DeviceProof = z.infer<typeof deviceProofSchema>;

export const pairingRequestSchema = z.object({
  token: z.string().min(32).max(128).regex(BASE64URL),
  deviceName: z.string().trim().min(1).max(80),
}).strict();
export type PairingRequest = z.infer<typeof pairingRequestSchema>;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A device id is the first 128 bits of SHA-256 over the raw public key, so it cannot be chosen independently of the key. */
export async function deviceIdFromPublicKey(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fromBase64Url(publicKey) as BufferSource));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface DeviceProofPayloadInput {
  deviceId: string;
  clientId: string;
  clientMode: string;
  scopes: readonly string[];
  signedAt: number;
  nonce: string;
  /** The pairing token when this connect is a pairing request, so the proof is bound to it; empty otherwise. */
  pairingToken: string;
  capabilities?: readonly string[];
  commands?: readonly string[];
}

export function buildDeviceProofPayload(input: DeviceProofPayloadInput): string {
  const surface = normalizeDeviceCapabilityAdvertisement({
    capabilities: input.capabilities,
    commands: input.commands,
  });
  if (surface.capabilities.length === 0 && surface.commands.length === 0) {
    return [
      "lios-device-v1",
      input.deviceId,
      input.clientId,
      input.clientMode,
      [...input.scopes].sort().join(","),
      String(input.signedAt),
      input.nonce,
      input.pairingToken,
    ].join("|");
  }
  return [
    "lios-device-v2",
    input.deviceId,
    input.clientId,
    input.clientMode,
    [...input.scopes].sort().join(","),
    String(input.signedAt),
    input.nonce,
    input.pairingToken,
    JSON.stringify(surface.capabilities),
    JSON.stringify(surface.commands),
  ].join("|");
}

export const deviceRecordSchema = z.object({
  id: deviceIdSchema,
  name: z.string(),
  platform: z.string(),
  scopes: z.array(z.enum(DEVICE_SCOPES)),
  capabilities: z.array(deviceSurfaceNameSchema).max(DEVICE_CAPABILITY_LIMIT).default([]),
  commands: z.array(deviceSurfaceNameSchema).max(DEVICE_CAPABILITY_LIMIT).default([]),
  advertisedAt: z.string().datetime({ offset: true }).nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
  lastSeenAt: z.string().datetime({ offset: true }).nullable(),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type DeviceRecord = z.infer<typeof deviceRecordSchema>;

export const pendingPairingSchema = z.object({
  pairingId: z.string().uuid(),
  deviceName: z.string(),
  platform: z.string(),
  deviceId: deviceIdSchema,
  capabilities: z.array(deviceSurfaceNameSchema).max(DEVICE_CAPABILITY_LIMIT).default([]),
  commands: z.array(deviceSurfaceNameSchema).max(DEVICE_CAPABILITY_LIMIT).default([]),
  requestedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type PendingPairing = z.infer<typeof pendingPairingSchema>;
