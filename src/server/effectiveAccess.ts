import { eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  authorizedDevices,
  licenseEntitlements,
  organizationLicenses,
  organizations,
  type User,
} from "@shared/schema";
import {
  effectiveAccessSnapshotSchema,
  principalFromUser,
  type EffectiveAccessSnapshot,
  type IdentityPrincipal,
  type OrganizationIdentity,
} from "@shared/identityContracts";
import { evaluateDeviceAuthorization, evaluateLicenseLifecycle } from "./controlPlanePolicy";
import type { SignedOfflineLicenseLease } from "./licenseLease";
import { evaluateCachedOfflineAccess } from "./offlineLeaseCache";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export interface LocalEffectiveAccessInput {
  user: Pick<User, "id" | "email" | "name" | "role" | "organizationId">;
  deviceFingerprintHash?: string | null;
  now?: Date;
}

export async function resolveLocalEffectiveAccess(input: LocalEffectiveAccessInput): Promise<EffectiveAccessSnapshot> {
  const now = input.now ?? new Date();
  const principal = principalFromUser(input.user);
  const db = getDb();

  if (principal.organizationId === null) {
    return effectiveAccessSnapshotSchema.parse({
      version: 1,
      mode: "online",
      principal,
      organization: null,
      device: null,
      deviceAccess: { allowed: true, reason: "internal_principal" },
      license: {
        status: null,
        reason: "internal_principal",
        canAuthenticate: true,
        canUseEntitledFeatures: true,
        offlineAllowed: false,
        expiresAt: null,
      },
      entitlementMode: "unrestricted",
      entitlements: [{
        featureKey: "*",
        active: true,
        limitValue: null,
        expiresAt: null,
        source: "compatibility",
      }],
      evaluatedAt: now.toISOString(),
      degradedReason: null,
    });
  }

  const organizationId = principal.organizationId;
  const [[organization], [license], entitlementRows, deviceRows] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1),
    db.select().from(licenseEntitlements).where(eq(licenseEntitlements.organizationId, organizationId)),
    db.select().from(authorizedDevices).where(eq(authorizedDevices.organizationId, organizationId)),
  ]);

  const licenseDecision = evaluateLicenseLifecycle(license ? {
    status: license.status,
    graceEndsAt: license.graceEndsAt,
    offlineLeaseExpiresAt: license.offlineLeaseExpiresAt,
  } : null, now);

  // A vendor-signed licence widens what a client organization may use, but never overrides a lock the
  // Home's own administrator set (suspended, security-locked, terminated, grace expired).
  const importedLicense = evaluateCachedOfflineAccess(undefined, now);
  if (importedLicense.allowed && importedLicense.lease && licenseDecision.canUseEntitledFeatures) {
    return effectiveAccessFromLicenseFile({
      principal,
      organization: organization ? {
        id: organization.id,
        name: organization.name,
        lifecycleStage: organization.lifecycleStage,
        status: organization.status,
      } : null,
      lease: importedLicense.lease,
      now,
    });
  }

  const matchedDevice = input.deviceFingerprintHash
    ? deviceRows.find((row) => row.deviceFingerprintHash === input.deviceFingerprintHash) ?? null
    : null;
  const deviceDecision = deviceRows.length === 0
    ? { allowed: true, reason: "no_devices_configured" as const }
    : !input.deviceFingerprintHash
      ? { allowed: false, reason: "device_fingerprint_missing" as const }
      : !matchedDevice
        ? { allowed: false, reason: "device_unknown" as const }
        : evaluateDeviceAuthorization({
            status: matchedDevice.status,
            leaseExpiresAt: matchedDevice.leaseExpiresAt,
          }, now);

  const entitlementMode = entitlementRows.length === 0 ? "unrestricted" as const : "allowlist" as const;
  const entitlements = entitlementRows.length === 0
    ? [{
        featureKey: "*",
        active: true,
        limitValue: null,
        expiresAt: null,
        source: "compatibility" as const,
      }]
    : entitlementRows.map((row) => ({
        featureKey: row.featureKey,
        active: row.active,
        limitValue: row.limitValue ?? null,
        expiresAt: iso(row.expiresAt),
        source: "license" as const,
      }));

  return effectiveAccessSnapshotSchema.parse({
    version: 1,
    mode: "online",
    principal,
    organization: organization ? {
      id: organization.id,
      name: organization.name,
      lifecycleStage: organization.lifecycleStage,
      status: organization.status,
    } : null,
    device: matchedDevice ? {
      fingerprintHash: matchedDevice.deviceFingerprintHash,
      status: matchedDevice.status,
      leaseExpiresAt: iso(matchedDevice.leaseExpiresAt),
    } : null,
    deviceAccess: deviceDecision,
    license: {
      status: license?.status ?? null,
      reason: licenseDecision.reason,
      canAuthenticate: licenseDecision.canAuthenticate,
      canUseEntitledFeatures: licenseDecision.canUseEntitledFeatures,
      offlineAllowed: licenseDecision.offlineAllowed,
      expiresAt: iso(license?.offlineLeaseExpiresAt),
    },
    entitlementMode,
    entitlements,
    evaluatedAt: now.toISOString(),
    degradedReason: !organization
      ? "organization_record_missing"
      : !license
        ? "commercial_configuration_not_yet_projected"
        : entitlementRows.length === 0
          ? "entitlements_not_configured_unrestricted_compatibility"
          : null,
  });
}

/**
 * Access granted by an imported, already-verified licence file (signature, pinned key, expiry and device claim are
 * checked by `evaluateCachedOfflineAccess` before a lease reaches this function).
 */
export function effectiveAccessFromLicenseFile(input: {
  principal: IdentityPrincipal;
  organization: OrganizationIdentity | null;
  lease: SignedOfflineLicenseLease;
  now?: Date;
}): EffectiveAccessSnapshot {
  const now = input.now ?? new Date();
  const payload = input.lease.payload;
  const unrestricted = (payload.entitlementMode ?? "allowlist") === "unrestricted";
  return effectiveAccessSnapshotSchema.parse({
    version: 1,
    mode: "online",
    principal: input.principal,
    organization: input.organization,
    device: null,
    deviceAccess: { allowed: true, reason: "license_file_device_verified" },
    license: {
      status: payload.status,
      reason: "license_file",
      canAuthenticate: true,
      canUseEntitledFeatures: true,
      offlineAllowed: false,
      expiresAt: payload.expiresAt,
    },
    // "Everything" is expressed as a wildcard grant, not mode "unrestricted": featureIsEntitled honours grant
    // expiry but treats unrestricted mode as unbounded, and a licence always ends.
    entitlementMode: "allowlist",
    entitlements: unrestricted
      ? [{ featureKey: "*", active: true, limitValue: null, expiresAt: payload.expiresAt, source: "license" }]
      : (payload.featureKeys ?? []).map((featureKey) => ({
          featureKey,
          active: true,
          limitValue: null,
          expiresAt: payload.expiresAt,
          source: "license",
        })),
    evaluatedAt: now.toISOString(),
    degradedReason: null,
  });
}
