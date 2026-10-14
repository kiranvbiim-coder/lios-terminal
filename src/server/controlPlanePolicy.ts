// LICENSE_LIFECYCLE_STATUSES/DeviceAuthorizationStatus are re-exported here
// (rather than redeclared) so this module's existing consumers keep working
// unchanged, while the actual vocabulary has a single source of truth in
// shared/commercialRuntime.ts, which in turn derives it from schema.ts's
// Postgres enum declarations -- the same values the database enforces.
export {
  LICENSE_LIFECYCLE_STATUSES,
  DEVICE_AUTHORIZATION_STATUSES,
  type LicenseLifecycleStatus,
  type DeviceAuthorizationStatus,
} from "@shared/commercialRuntime";
import type { LicenseLifecycleStatus, DeviceAuthorizationStatus } from "@shared/commercialRuntime";

export type OrganizationLifecycleStage = "trial" | "client" | "churned";

export interface LicenseLifecycleInput {
  status: LicenseLifecycleStatus;
  graceEndsAt?: Date | string | null;
  offlineLeaseExpiresAt?: Date | string | null;
}

export interface LicenseLifecycleDecision {
  canAuthenticate: boolean;
  canUseEntitledFeatures: boolean;
  offlineAllowed: boolean;
  shouldRevokeSessions: boolean;
  reason:
    | "license_active"
    | "license_in_grace"
    | "license_grace_expired"
    | "license_billing_hold"
    | "license_suspended"
    | "license_security_locked"
    | "license_terminated"
    | "license_not_configured";
}

export interface DeviceAuthorizationInput {
  status: DeviceAuthorizationStatus;
  leaseExpiresAt?: Date | string | null;
}

export interface DeviceAuthorizationDecision {
  allowed: boolean;
  reason: "device_authorized" | "device_pending" | "device_revoked" | "device_lease_expired" | "device_not_configured";
}

export interface EntitlementInput {
  featureKey: string;
  active: boolean;
  expiresAt?: Date | string | null;
}

export interface OrganizationAccessInput {
  organizationStatus?: string | null;
  lifecycleStage?: OrganizationLifecycleStage | null;
}

export interface OrganizationAccessDecision {
  allowed: boolean;
  reason: "organization_active_client" | "organization_missing" | "organization_inactive" | "organization_not_client";
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isOnOrAfter(value: Date | string | null | undefined, now: Date): boolean {
  const time = toTime(value);
  return time !== null && time >= now.getTime();
}

export function evaluateLicenseLifecycle(input: LicenseLifecycleInput | null | undefined, now = new Date()): LicenseLifecycleDecision {
  if (!input) {
    // Backward-compatible while the repo still has only org/user booleans.
    // Once organization_licenses is mandatory, callers should fail closed before
    // reaching this compatibility branch.
    return {
      canAuthenticate: true,
      canUseEntitledFeatures: true,
      offlineAllowed: false,
      shouldRevokeSessions: false,
      reason: "license_not_configured",
    };
  }

  const offlineAllowed = isOnOrAfter(input.offlineLeaseExpiresAt, now);

  switch (input.status) {
    case "active":
      return {
        canAuthenticate: true,
        canUseEntitledFeatures: true,
        offlineAllowed,
        shouldRevokeSessions: false,
        reason: "license_active",
      };
    case "grace": {
      const inGrace = isOnOrAfter(input.graceEndsAt, now);
      return {
        canAuthenticate: inGrace,
        canUseEntitledFeatures: inGrace,
        offlineAllowed: inGrace && offlineAllowed,
        shouldRevokeSessions: !inGrace,
        reason: inGrace ? "license_in_grace" : "license_grace_expired",
      };
    }
    case "billing_hold":
      return {
        canAuthenticate: true,
        canUseEntitledFeatures: false,
        offlineAllowed: false,
        shouldRevokeSessions: false,
        reason: "license_billing_hold",
      };
    case "suspended":
      return {
        canAuthenticate: false,
        canUseEntitledFeatures: false,
        offlineAllowed: false,
        shouldRevokeSessions: true,
        reason: "license_suspended",
      };
    case "security_locked":
      return {
        canAuthenticate: false,
        canUseEntitledFeatures: false,
        offlineAllowed: false,
        shouldRevokeSessions: true,
        reason: "license_security_locked",
      };
    case "terminated":
      return {
        canAuthenticate: false,
        canUseEntitledFeatures: false,
        offlineAllowed: false,
        shouldRevokeSessions: true,
        reason: "license_terminated",
      };
  }
}

export function evaluateDeviceAuthorization(input: DeviceAuthorizationInput | null | undefined, now = new Date()): DeviceAuthorizationDecision {
  if (!input) return { allowed: true, reason: "device_not_configured" };
  if (input.status === "pending") return { allowed: false, reason: "device_pending" };
  if (input.status === "revoked") return { allowed: false, reason: "device_revoked" };
  if (input.leaseExpiresAt && !isOnOrAfter(input.leaseExpiresAt, now)) return { allowed: false, reason: "device_lease_expired" };
  return { allowed: true, reason: "device_authorized" };
}

export function hasFeatureEntitlement(entitlements: EntitlementInput[], featureKey: string, now = new Date()): boolean {
  return entitlements.some((entitlement) => {
    if (!entitlement.active) return false;
    if (entitlement.featureKey !== "*" && entitlement.featureKey !== featureKey) return false;
    if (entitlement.expiresAt && !isOnOrAfter(entitlement.expiresAt, now)) return false;
    return true;
  });
}

export function evaluateOrganizationAccess(input: OrganizationAccessInput | null | undefined): OrganizationAccessDecision {
  if (!input) return { allowed: false, reason: "organization_missing" };
  if (input.organizationStatus !== "active") return { allowed: false, reason: "organization_inactive" };
  if (input.lifecycleStage !== "client") return { allowed: false, reason: "organization_not_client" };
  return { allowed: true, reason: "organization_active_client" };
}
