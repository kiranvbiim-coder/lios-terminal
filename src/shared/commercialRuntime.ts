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
/** Account created, owner has not yet chosen "Start 7-day trial" or entered a licence key; no trial clock runs. */
export const TRIAL_PENDING_BILLING_STATE = "trial_pending" as const;
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

/**
 * Installation-level access (offline, no server): full while a verified licence key or the 7-day local trial is
 * in force; otherwise READ-ONLY. Read-only never hides or deletes data: opening, viewing and exporting stay
 * available; only new AI calls, analysis/tool execution, automation runs and new provider connections are refused.
 */
export const READ_ONLY_ERROR_CODE = "license_read_only" as const;

export type InstallationAccessReason =
  | "license_valid"
  | "trial_active"
  | "trial_not_started"
  | "trial_expired"
  | "license_expired"
  | "license_unusable"
  | "unmanaged";

export interface InstallationAccessInput {
  now: Date;
  /**
   * An explicit signal (the packaged customer desktop) that this installation is under the trial/key rule. Never
   * derived from missing rows: a managed install with no record yet is "trial not started", not "unmanaged".
   */
  managed: boolean;
  /** The imported licence key, if any. `valid` means signature, trust anchor, device scope and expiry all pass. */
  license: { present: boolean; valid: boolean; expiresAt: Date | null; expired: boolean };
  /** The installation's trial, or null when this install has never had a client trial record. */
  trial: { state: TrialLifecycleState; endsAt: Date | null } | null;
}

export interface InstallationAccessMode {
  mode: "full" | "read_only";
  reason: InstallationAccessReason;
  /** ISO time the access that is currently granting (or last granted) execution ends. */
  trialEndsAt: string | null;
  licenseExpiresAt: string | null;
  /** Whole days remaining on the access in force; null while read-only or unmanaged. */
  daysLeft: number | null;
  /** The owner has not yet chosen between the trial and entering a key. */
  canStartTrial: boolean;
}

const ACCESS_DAY_MS = 24 * 60 * 60 * 1000;

function wholeDaysLeft(until: Date, now: Date): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / ACCESS_DAY_MS));
}

export function resolveInstallationAccessMode(input: InstallationAccessInput): InstallationAccessMode {
  const { now, license, trial } = input;
  const trialEndsAt = trial?.endsAt ? trial.endsAt.toISOString() : null;
  const licenseExpiresAt = license.expiresAt ? license.expiresAt.toISOString() : null;
  const base = { trialEndsAt, licenseExpiresAt };

  if (license.valid && license.expiresAt) {
    return { ...base, mode: "full", reason: "license_valid", daysLeft: wholeDaysLeft(license.expiresAt, now), canStartTrial: false };
  }
  if (trial?.state === "active" && trial.endsAt) {
    return { ...base, mode: "full", reason: "trial_active", daysLeft: wholeDaysLeft(trial.endsAt, now), canStartTrial: false };
  }
  if (license.present) {
    return { ...base, mode: "read_only", reason: license.expired ? "license_expired" : "license_unusable", daysLeft: null, canStartTrial: trial?.state === "not_started" };
  }
  if (trial) {
    const reason = trial.state === "not_started" ? "trial_not_started" : "trial_expired";
    return { ...base, mode: "read_only", reason, daysLeft: null, canStartTrial: trial.state === "not_started" };
  }
  // Managed with no record yet: the owner has not chosen between the trial and a key.
  if (input.managed) return { ...base, mode: "read_only", reason: "trial_not_started", daysLeft: null, canStartTrial: true };
  // Not managed (server Home, development, internal): not under a client trial.
  return { ...base, mode: "full", reason: "unmanaged", daysLeft: null, canStartTrial: false };
}
