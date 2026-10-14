import { z } from "zod";
import { LICENSE_TRUST_ANCHORS } from "@shared/licenseTrust";
import { ASYMMETRIC_LICENSE_LEASE_ALGORITHM, verifyLeaseAgainstTrustAnchors, type SignedOfflineLicenseLease } from "./licenseLease";
import {
  cacheOfflineLeaseBundle,
  desktopDeviceFingerprintHash,
  evaluateCachedOfflineAccess,
  readCachedOfflineLeaseBundle,
  type CachedOfflineAccessDecision,
} from "./offlineLeaseCache";

/**
 * A licence is a vendor-signed file the customer imports. Nothing contacts LiOS at runtime (owner decision Q1):
 * the signature is checked against the pinned trust anchors in `shared/licenseTrust.ts`, the expiry is a signed
 * date, and the optional device fingerprint is a signed claim. Imports reuse the existing Ed25519 lease format.
 */
export const LICENSE_FILE_FORMAT = "lios-license/1";
const MAX_LICENSE_FILE_BYTES = 64 * 1024;

const leaseSchema = z.object({
  algorithm: z.literal(ASYMMETRIC_LICENSE_LEASE_ALGORITHM),
  signature: z.string().min(1).max(512),
  payload: z.object({
    organizationId: z.number().int(),
    licenseId: z.number().int(),
    status: z.enum(["active", "grace"]),
    seatsPurchased: z.number().int().nonnegative(),
    issuedAt: z.string(),
    expiresAt: z.string(),
    keyId: z.string().min(1).max(64),
    deviceFingerprintHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    planCode: z.string().max(128).nullable().optional(),
    entitlementMode: z.enum(["unrestricted", "allowlist"]).optional(),
    featureKeys: z.array(z.string().max(128)).max(512).optional(),
  }).strict(),
}).strict();

const fileSchema = z.object({ format: z.literal(LICENSE_FILE_FORMAT), lease: leaseSchema }).strict();

export class LicenseImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseImportError";
  }
}

export function serializeLicenseFile(lease: SignedOfflineLicenseLease): string {
  return `${JSON.stringify({ format: LICENSE_FILE_FORMAT, lease }, null, 2)}\n`;
}

export function parseLicenseFile(text: string): SignedOfflineLicenseLease {
  if (Buffer.byteLength(text) > MAX_LICENSE_FILE_BYTES) throw new LicenseImportError("The licence file is too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LicenseImportError("This is not a LiOS licence file.");
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) throw new LicenseImportError("This is not a valid LiOS licence file.");
  return parsed.data.lease;
}

export interface LicenseStatus {
  /** Hash a customer sends to the vendor to request a licence bound to this install. */
  deviceFingerprintHash: string | null;
  state: "none" | "valid" | CachedOfflineAccessDecision["reason"];
  bound: boolean;
  planCode: string | null;
  seats: number | null;
  entitlementMode: "unrestricted" | "allowlist" | null;
  featureCount: number | null;
  issuedAt: string | null;
  expiresAt: string | null;
  keyId: string | null;
}

export function licenseStatus(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
  anchors: Readonly<Record<string, string>> = LICENSE_TRUST_ANCHORS,
): LicenseStatus {
  const decision = evaluateCachedOfflineAccess(undefined, now, env, anchors);
  const bundle = readCachedOfflineLeaseBundle(env);
  const payload = bundle?.lease.payload;
  return {
    deviceFingerprintHash: desktopDeviceFingerprintHash(env),
    state: !bundle ? "none" : decision.allowed ? "valid" : decision.reason,
    bound: Boolean(payload?.deviceFingerprintHash),
    planCode: payload?.planCode ?? null,
    seats: payload?.seatsPurchased ?? null,
    entitlementMode: payload?.entitlementMode ?? null,
    featureCount: payload?.featureKeys?.length ?? null,
    issuedAt: payload?.issuedAt ?? null,
    expiresAt: payload?.expiresAt ?? null,
    keyId: payload?.keyId ?? null,
  };
}

/** Verifies completely before anything is stored; a rejected file leaves the current licence untouched. */
export function importLicenseFile(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
  anchors: Readonly<Record<string, string>> = LICENSE_TRUST_ANCHORS,
): LicenseStatus {
  const lease = parseLicenseFile(text);
  const verification = verifyLeaseAgainstTrustAnchors(lease, anchors, now);
  if (!verification.valid) {
    const message = verification.reason === "lease_untrusted_key" ? "This licence was not issued by a trusted LiOS licence key."
      : verification.reason === "lease_expired" ? "This licence has expired."
      : "The licence signature is not valid; the file may be damaged or altered.";
    throw new LicenseImportError(message);
  }
  if (!lease.payload.entitlementMode) throw new LicenseImportError("This licence does not state its entitlements.");
  if (lease.payload.deviceFingerprintHash && lease.payload.deviceFingerprintHash !== desktopDeviceFingerprintHash(env)) {
    throw new LicenseImportError("This licence was issued for a different installation.");
  }
  cacheOfflineLeaseBundle({ lease }, env);
  return licenseStatus(env, now, anchors);
}
