import { deviceIdFromPublicKey, fromBase64Url, toBase64Url } from "@shared/devicePairing";

/** Ed25519 device identity; publicKey and signatures are base64url as in shared/devicePairing. */
export interface DeviceIdentity {
  id: string;
  publicKey: string;
  sign(payload: string): Promise<string>;
}

export interface DeviceIdentityKeys {
  publicKey: string;
  privateKeyPkcs8: string;
}

export interface CreatedDeviceIdentity {
  identity: DeviceIdentity;
  /** Exports the key material so the platform can persist it. */
  exportKeys(): Promise<DeviceIdentityKeys>;
}

const ED25519 = { name: "Ed25519" } as const;

async function buildIdentity(publicKey: string, privateKey: CryptoKey): Promise<DeviceIdentity> {
  return {
    id: await deviceIdFromPublicKey(publicKey),
    publicKey,
    sign: async (payload) => toBase64Url(new Uint8Array(await crypto.subtle.sign(ED25519, privateKey, new TextEncoder().encode(payload)))),
  };
}

export async function createDeviceIdentity(): Promise<CreatedDeviceIdentity> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return {
    identity: await buildIdentity(publicKey, pair.privateKey),
    exportKeys: async () => ({
      publicKey,
      privateKeyPkcs8: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))),
    }),
  };
}

export async function restoreDeviceIdentity(keys: DeviceIdentityKeys): Promise<DeviceIdentity> {
  const privateKey = await crypto.subtle.importKey("pkcs8", fromBase64Url(keys.privateKeyPkcs8) as BufferSource, ED25519, false, ["sign"]);
  return buildIdentity(keys.publicKey, privateKey);
}
