import crypto from "crypto";
import { LICENSE_TRUST_ANCHORS } from "@shared/licenseTrust";

export const ASYMMETRIC_LICENSE_LEASE_ALGORITHM = "Ed25519" as const;

export interface OfflineLicenseLeasePayload {
  organizationId: number;
  licenseId: number;
  status: "active" | "grace";
  seatsPurchased: number;
  issuedAt: string;
  expiresAt: string;
  keyId: string;
  /** Optional V4 customer-desktop scope. Older admin-issued leases omit these
   * fields and continue to verify against the legacy canonical payload. */
  deviceFingerprintHash?: string;
  planCode?: string | null;
  entitlementMode?: "unrestricted" | "allowlist";
  featureKeys?: string[];
}

export interface SignedOfflineLicenseLease {
  algorithm: typeof ASYMMETRIC_LICENSE_LEASE_ALGORITHM;
  payload: OfflineLicenseLeasePayload;
  signature: string;
}

export interface LeaseVerificationResult {
  valid: boolean;
  reason:
    | "lease_valid"
    | "lease_wrong_algorithm"
    | "lease_untrusted_key"
    | "lease_signature_mismatch"
    | "lease_expired"
    | "lease_status_not_offline_allowed"
    | "lease_secret_missing";
}

function canonicalPayload(payload: OfflineLicenseLeasePayload): string {
  const canonical: Record<string, unknown> = {
    organizationId: payload.organizationId,
    licenseId: payload.licenseId,
    status: payload.status,
    seatsPurchased: payload.seatsPurchased,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    keyId: payload.keyId,
  };
  // Add scoped fields only when present so leases issued before the desktop
  // control-plane convergence keep their original signature contract.
  if (payload.deviceFingerprintHash !== undefined) canonical.deviceFingerprintHash = payload.deviceFingerprintHash;
  if (payload.planCode !== undefined) canonical.planCode = payload.planCode;
  if (payload.entitlementMode !== undefined) canonical.entitlementMode = payload.entitlementMode;
  if (payload.featureKeys !== undefined) canonical.featureKeys = [...payload.featureKeys].sort();
  return JSON.stringify(canonical);
}

function signPayloadAsymmetrically(payload: OfflineLicenseLeasePayload, privateKey: string): string {
  return crypto.sign(null, Buffer.from(canonicalPayload(payload), "utf8"), privateKey).toString("base64url");
}

function validPayloadStatus(payload: OfflineLicenseLeasePayload): boolean {
  return payload.status === "active" || payload.status === "grace";
}

function validExpiry(payload: OfflineLicenseLeasePayload, now: Date): boolean {
  const expiresAt = new Date(payload.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt >= now.getTime();
}
export function createSignedAsymmetricOfflineLicenseLease(payload: OfflineLicenseLeasePayload, privateKey: string): SignedOfflineLicenseLease {
  return {
    algorithm: ASYMMETRIC_LICENSE_LEASE_ALGORITHM,
    payload,
    signature: signPayloadAsymmetrically(payload, privateKey),
  };
}

export function verifyAsymmetricOfflineLicenseLease(lease: SignedOfflineLicenseLease, publicKey: string | null, now = new Date()): LeaseVerificationResult {
  if (!publicKey) return { valid: false, reason: "lease_secret_missing" };
  if (lease.algorithm !== ASYMMETRIC_LICENSE_LEASE_ALGORITHM) return { valid: false, reason: "lease_wrong_algorithm" };
  if (!validPayloadStatus(lease.payload)) return { valid: false, reason: "lease_status_not_offline_allowed" };
  try {
    const publicKeyObject = crypto.createPublicKey(publicKey);
    if (publicKeyObject.asymmetricKeyType !== "ed25519") {
      return { valid: false, reason: "lease_signature_mismatch" };
    }
    const valid = crypto.verify(null, Buffer.from(canonicalPayload(lease.payload), "utf8"), publicKeyObject, Buffer.from(lease.signature, "base64url"));
    if (!valid) return { valid: false, reason: "lease_signature_mismatch" };
  } catch {
    return { valid: false, reason: "lease_signature_mismatch" };
  }
  if (!validExpiry(lease.payload, now)) return { valid: false, reason: "lease_expired" };
  return { valid: true, reason: "lease_valid" };
}

/** Verifies against the pinned anchors (or an explicit set in tests). The lease selects its key by id; it never supplies it. */
export function verifyLeaseAgainstTrustAnchors(
  lease: SignedOfflineLicenseLease,
  anchors: Readonly<Record<string, string>> = LICENSE_TRUST_ANCHORS,
  now = new Date(),
): LeaseVerificationResult {
  const publicKey = anchors[lease.payload.keyId];
  if (!publicKey) return { valid: false, reason: "lease_untrusted_key" };
  return verifyAsymmetricOfflineLicenseLease(lease, publicKey, now);
}

export function licenseKeyId(publicKeyPem: string): string {
  return crypto.createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}
