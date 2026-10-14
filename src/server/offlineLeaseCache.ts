import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LICENSE_TRUST_ANCHORS } from "@shared/licenseTrust";
import { dataPath, dataRootId } from "./dataRoot";
import {
  ASYMMETRIC_LICENSE_LEASE_ALGORITHM,
  verifyLeaseAgainstTrustAnchors,
  type SignedOfflineLicenseLease,
} from "./licenseLease";

/** Only the lease is stored. Its signing key is looked up in the pinned trust anchors, never read from this file. */
export interface CachedOfflineLeaseBundle {
  version: 2;
  lease: SignedOfflineLicenseLease;
  cachedAt: string;
}

export interface CachedOfflineAccessDecision {
  allowed: boolean;
  reason:
    | "offline_lease_valid"
    | "offline_lease_missing"
    | "offline_lease_invalid"
    | "offline_lease_untrusted_key"
    | "offline_lease_expired"
    | "offline_lease_unscoped"
    | "offline_lease_wrong_device"
    | "offline_feature_not_entitled";
  lease?: SignedOfflineLicenseLease;
}

/** `<data root>/license` unless a test or operator points LIOS_LICENSE_CACHE_DIR elsewhere. */
function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LIOS_LICENSE_CACHE_DIR?.trim();
  return configured ? path.resolve(configured) : dataPath("license");
}

/**
 * The install a device-bound licence names: the desktop workspace id, or for a headless Home the id in its data-root
 * marker. A backup restored into a new root is a new install and needs its licence re-issued.
 */
export function desktopDeviceFingerprintHash(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env.LIOS_DESKTOP_DEVICE_ID?.trim();
  if (id) {
    if (id.length < 8 || id.length > 256) return null;
    return crypto.createHash("sha256").update(`desktop:${id}`).digest("hex");
  }
  if (env !== process.env) return null;
  const rootId = dataRootId();
  return rootId ? crypto.createHash("sha256").update(`home:${rootId}`).digest("hex") : null;
}

export function offlineLeasePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheRoot(env), "offline-entitlement.json");
}

export function cacheOfflineLeaseBundle(bundle: Pick<CachedOfflineLeaseBundle, "lease">, env: NodeJS.ProcessEnv = process.env): void {
  const target = offlineLeasePath(env);
  const root = path.dirname(target);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const value: CachedOfflineLeaseBundle = {
    version: 2,
    lease: bundle.lease,
    cachedAt: new Date().toISOString(),
  };
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // Windows ACLs are managed by the OS/user profile.
  }
}

export function readCachedOfflineLeaseBundle(env: NodeJS.ProcessEnv = process.env): CachedOfflineLeaseBundle | null {
  const target = offlineLeasePath(env);
  if (!fs.existsSync(target)) return null;
  try {
    // Version 1 files also carried a self-asserted public key; it is ignored, so an old file is only as good as its pinned-key signature.
    const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as { version?: number; lease?: SignedOfflineLicenseLease; cachedAt?: string };
    if ((parsed?.version !== 1 && parsed?.version !== 2) || !parsed.lease?.payload) return null;
    return { version: 2, lease: parsed.lease, cachedAt: parsed.cachedAt ?? "" };
  } catch {
    return null;
  }
}

export function evaluateCachedOfflineAccess(
  featureKey?: string,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  anchors: Readonly<Record<string, string>> = LICENSE_TRUST_ANCHORS,
): CachedOfflineAccessDecision {
  const bundle = readCachedOfflineLeaseBundle(env);
  if (!bundle) return { allowed: false, reason: "offline_lease_missing" };
  if (bundle.lease.algorithm !== ASYMMETRIC_LICENSE_LEASE_ALGORITHM) {
    return { allowed: false, reason: "offline_lease_invalid" };
  }

  const verification = verifyLeaseAgainstTrustAnchors(bundle.lease, anchors, now);
  if (!verification.valid) {
    const reason = verification.reason === "lease_untrusted_key" ? "offline_lease_untrusted_key"
      : verification.reason === "lease_expired" ? "offline_lease_expired"
      : "offline_lease_invalid";
    return { allowed: false, reason };
  }

  // A licence is bound to one install only when its signed payload says so (it carries a device fingerprint).
  const payload = bundle.lease.payload;
  if (!payload.entitlementMode) return { allowed: false, reason: "offline_lease_unscoped" };
  if (payload.deviceFingerprintHash && payload.deviceFingerprintHash !== desktopDeviceFingerprintHash(env)) {
    return { allowed: false, reason: "offline_lease_wrong_device" };
  }

  if (featureKey && payload.entitlementMode === "allowlist" && !(payload.featureKeys ?? []).includes(featureKey)) {
    return { allowed: false, reason: "offline_feature_not_entitled" };
  }

  return { allowed: true, reason: "offline_lease_valid", lease: bundle.lease };
}
