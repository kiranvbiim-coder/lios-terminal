// The canonical vocabulary for license/device status lives in the Postgres
// enum declarations in schema.ts (license_lifecycle_status,
// device_authorization_status), which is what migrations actually alter.
// Deriving from there instead of re-declaring the values here means a
// future migration that adds/renames a status is a single-source change:
// schema.ts drifting from the database is already caught by
// server/dbMigration.test.ts's enum-drift regression test, and everything
// downstream of these types now shares that same guarantee.
import { deviceAuthorizationStatusEnum, licenseLifecycleStatusEnum } from "./schema";

export const SOFTWARE_PLAN_TIERS = ["trial", "starter", "pro", "enterprise"] as const;
export type SoftwarePlanTier = (typeof SOFTWARE_PLAN_TIERS)[number];

export const LEGACY_SOFTWARE_PLAN_MAP = {
  personal: "starter",
  team: "pro",
} as const satisfies Record<string, SoftwarePlanTier>;

export type LegacySoftwarePlanTier = keyof typeof LEGACY_SOFTWARE_PLAN_MAP;

const CANONICAL_PLAN_TIER_SET = new Set<string>(SOFTWARE_PLAN_TIERS);

/**
 * Normalize only software-plan semantics. Generic uses of "team" elsewhere in
 * LiOS (collaboration, organizations, consulting delivery) are intentionally
 * outside this contract and must never be rewritten through this function.
 */
export function normalizeSoftwarePlanTier(value: unknown): SoftwarePlanTier | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (CANONICAL_PLAN_TIER_SET.has(normalized)) return normalized as SoftwarePlanTier;
  return LEGACY_SOFTWARE_PLAN_MAP[normalized as LegacySoftwarePlanTier] ?? null;
}

export function requireSoftwarePlanTier(value: unknown): SoftwarePlanTier {
  const tier = normalizeSoftwarePlanTier(value);
  if (!tier) throw new Error(`Unsupported LiOS software plan tier: ${String(value)}`);
  return tier;
}

export const DEFAULT_TRIAL_DAYS = 7 as const;
export const BILLING_FAILURE_GRACE_DAYS = 7 as const;
export const TRIAL_ENTITLEMENT_TIER: Exclude<SoftwarePlanTier, "trial"> = "pro";

export const AI_RUNTIME_POLICY = Object.freeze({
  ownership: "user_provider",
  defaultProvider: null,
  requiresUserProviderForAiActions: true,
  deterministicRuntimeRequiresAi: false,
  byoaiConsumesLiosCredits: false,
  trialByoaiConsumesLiosCredits: false,
} as const);

export type LicenseLifecycleStatus = (typeof licenseLifecycleStatusEnum.enumValues)[number];

export const LICENSE_LIFECYCLE_STATUSES = licenseLifecycleStatusEnum.enumValues;

const LICENSE_TRANSITIONS: Readonly<Record<LicenseLifecycleStatus, ReadonlySet<LicenseLifecycleStatus>>> = {
  active: new Set(["grace", "billing_hold", "suspended", "security_locked", "terminated"]),
  grace: new Set(["active", "billing_hold", "suspended", "security_locked", "terminated"]),
  billing_hold: new Set(["active", "grace", "suspended", "security_locked", "terminated"]),
  suspended: new Set(["active", "grace", "security_locked", "terminated"]),
  security_locked: new Set(["active", "grace", "suspended", "terminated"]),
  terminated: new Set(),
};

export function canTransitionLicense(
  from: LicenseLifecycleStatus,
  to: LicenseLifecycleStatus,
): boolean {
  return from === to || LICENSE_TRANSITIONS[from].has(to);
}

export const DEVICE_AUTHORIZATION_STATUSES = deviceAuthorizationStatusEnum.enumValues;
export type DeviceAuthorizationStatus = (typeof DEVICE_AUTHORIZATION_STATUSES)[number];

export function canDeviceExecutePaidCapabilities(status: DeviceAuthorizationStatus): boolean {
  return status === "authorized";
}

export type TrialLifecycleState =
  | "not_started"
  | "active"
  | "converted"
  | "expired"
  | "revoked";

export interface ServerTrialSnapshot {
  /** Time supplied by the trusted LiOS control plane, never the desktop clock. */
  serverNow: Date;
  startedAt: Date | null;
  endsAt: Date | null;
  convertedAt?: Date | null;
  revokedAt?: Date | null;
}

export function resolveTrialLifecycle(snapshot: ServerTrialSnapshot): TrialLifecycleState {
  if (snapshot.revokedAt) return "revoked";
  if (snapshot.convertedAt) return "converted";
  if (!snapshot.startedAt || !snapshot.endsAt) return "not_started";
  return snapshot.serverNow.getTime() < snapshot.endsAt.getTime() ? "active" : "expired";
}

export interface OfflineLeaseSnapshot {
  /** Trusted time from the last validated control-plane exchange. */
  trustedNow: Date;
  issuedAt: Date | null;
  expiresAt: Date | null;
  signedLeaseHash: string | null;
  publicKeyId: string | null;
  signatureVerified: boolean;
}

export interface OfflineLeaseDecision {
  valid: boolean;
  reason:
    | "valid"
    | "missing_lease"
    | "unsigned_lease"
    | "unverified_signature"
    | "invalid_interval"
    | "not_yet_valid"
    | "expired";
}

export function evaluateOfflineLease(lease: OfflineLeaseSnapshot): OfflineLeaseDecision {
  if (!lease.issuedAt || !lease.expiresAt) return { valid: false, reason: "missing_lease" };
  if (!lease.signedLeaseHash || !lease.publicKeyId) return { valid: false, reason: "unsigned_lease" };
  if (!lease.signatureVerified) return { valid: false, reason: "unverified_signature" };

  const issued = lease.issuedAt.getTime();
  const expires = lease.expiresAt.getTime();
  const now = lease.trustedNow.getTime();

  if (expires <= issued) return { valid: false, reason: "invalid_interval" };
  if (now < issued) return { valid: false, reason: "not_yet_valid" };
  if (now >= expires) return { valid: false, reason: "expired" };
  return { valid: true, reason: "valid" };
}

export interface RuntimeAccessInput {
  planTier: SoftwarePlanTier;
  licenseStatus: LicenseLifecycleStatus;
  deviceStatus: DeviceAuthorizationStatus;
  connectedToControlPlane: boolean;
  offlineLease?: OfflineLeaseSnapshot | null;
}

export interface RuntimeAccessDecision {
  canOpenLocalWorkspace: true;
  canExecutePaidCapabilities: boolean;
  effectiveEntitlementTier: Exclude<SoftwarePlanTier, "trial">;
  reason:
    | "online_authorized"
    | "offline_lease_authorized"
    | "device_not_authorized"
    | "license_not_executable"
    | "offline_lease_required";
}

export function isExecutableLicenseStatus(status: LicenseLifecycleStatus): status is "active" | "grace" {
  return status === "active" || status === "grace";
}

/**
 * Local work is never deleted or made unreadable by billing state. Paid
 * execution is controlled by server-backed license/device state and, offline,
 * by a verified signed lease.
 */
export function resolveRuntimeAccess(input: RuntimeAccessInput): RuntimeAccessDecision {
  const effectiveEntitlementTier = input.planTier === "trial" ? TRIAL_ENTITLEMENT_TIER : input.planTier;

  if (!canDeviceExecutePaidCapabilities(input.deviceStatus)) {
    return {
      canOpenLocalWorkspace: true,
      canExecutePaidCapabilities: false,
      effectiveEntitlementTier,
      reason: "device_not_authorized",
    };
  }

  if (!isExecutableLicenseStatus(input.licenseStatus)) {
    return {
      canOpenLocalWorkspace: true,
      canExecutePaidCapabilities: false,
      effectiveEntitlementTier,
      reason: "license_not_executable",
    };
  }

  if (input.connectedToControlPlane) {
    return {
      canOpenLocalWorkspace: true,
      canExecutePaidCapabilities: true,
      effectiveEntitlementTier,
      reason: "online_authorized",
    };
  }

  if (input.offlineLease && evaluateOfflineLease(input.offlineLease).valid) {
    return {
      canOpenLocalWorkspace: true,
      canExecutePaidCapabilities: true,
      effectiveEntitlementTier,
      reason: "offline_lease_authorized",
    };
  }

  return {
    canOpenLocalWorkspace: true,
    canExecutePaidCapabilities: false,
    effectiveEntitlementTier,
    reason: "offline_lease_required",
  };
}

export function aiInvocationConsumesLiosCredits(): false {
  return false;
}
