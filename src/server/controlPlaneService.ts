import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { recordSecurityAuditEvent, auditActor } from "./auditEvents";
import {
  evaluateDeviceAuthorization,
  evaluateLicenseLifecycle,
  hasFeatureEntitlement,
  type LicenseLifecycleDecision,
  type LicenseLifecycleStatus,
} from "./controlPlanePolicy";
import { canTransitionLicense, isExecutableLicenseStatus } from "@shared/commercialRuntime";
import {
  type SignedOfflineLicenseLease,
} from "./licenseLease";
import {
  authorizedDevices,
  licenseEntitlements,
  organizationLicenses,
  organizations,
  platformPlans,
  sessionControls,
  sessions,
  users,
  type AuthorizedDevice,
  type InsertLicenseEntitlement,
  type InsertPlatformPlan,
  type OrganizationLicense,
  type SessionControl,
  type User,
} from "@shared/schema";

export interface SessionControlRequest {
  controlType: "force_logout" | "force_reauth";
  scope: "organization" | "user" | "session" | "global";
  organizationId?: number | null;
  targetUserId?: number | null;
  sid?: string | null;
  reason: string;
  expiresAt?: Date | null;
}

export interface SessionMatchContext {
  sid: string;
  sessionData: unknown;
}

export interface SessionControlMatchInput {
  controlType: "force_logout" | "force_reauth";
  scope: "organization" | "user" | "session" | "global";
  organizationId?: number | null;
  targetUserId?: number | null;
  sid?: string | null;
}

export interface DeviceAccessDecision {
  allowed: boolean;
  reason: "no_devices_configured" | "device_fingerprint_missing" | "device_unknown" | "device_authorized" | "device_pending" | "device_revoked" | "device_lease_expired" | "device_not_configured";
}

export interface EntitlementDecision {
  allowed: boolean;
  reason: "license_not_configured" | "entitlements_not_configured" | "entitlement_granted" | "entitlement_missing";
}

export function sessionUserId(sessionData: unknown): number | null {
  if (!sessionData || typeof sessionData !== "object") return null;
  if (!("passport" in sessionData)) return null;
  const passport = sessionData.passport;
  if (!passport || typeof passport !== "object") return null;
  if (!("user" in passport)) return null;
  const raw = passport.user;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

export function sessionMatchesControl(
  session: SessionMatchContext,
  control: SessionControlMatchInput,
  userOrganizationById: Map<number, number | null>,
): boolean {
  if (control.scope === "global") return true;
  if (control.scope === "session") return !!control.sid && session.sid === control.sid;

  const userId = sessionUserId(session.sessionData);
  if (userId === null) return false;
  if (control.scope === "user") return userId === control.targetUserId;
  if (control.scope === "organization") return userOrganizationById.get(userId) === control.organizationId;
  return false;
}

function validateSessionControlRequest(input: SessionControlRequest): void {
  if (!["force_logout", "force_reauth"].includes(input.controlType)) throw new Error("Unsupported session control type.");
  if (!["organization", "user", "session", "global"].includes(input.scope)) throw new Error("Unsupported session control scope.");
  if (typeof input.reason !== "string" || input.reason.trim().length < 3) throw new Error("Session control reason must be at least 3 characters.");
  if (input.scope === "organization" && (!Number.isInteger(input.organizationId) || input.organizationId! <= 0)) {
    throw new Error("organization session controls require organizationId");
  }
  if (input.scope === "user" && (!Number.isInteger(input.targetUserId) || input.targetUserId! <= 0)) {
    throw new Error("user session controls require targetUserId");
  }
  if (input.scope === "session" && !input.sid?.trim()) throw new Error("session-scoped controls require sid");
}

export async function listPlatformPlans() {
  const db = getDb();
  return db.select().from(platformPlans);
}

export async function createPlatformPlan(input: InsertPlatformPlan, actor: Pick<User, "id" | "email">) {
  const db = getDb();
  const [plan] = await db.insert(platformPlans).values(input).returning();
  await recordSecurityAuditEvent(actor.id, "platform_plan_created", { planId: plan.id, code: plan.code, tier: plan.tier, ...auditActor(actor) });
  return plan;
}

export async function getOrganizationControlPlaneSnapshot(organizationId: number) {
  const db = getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return null;

  const [license] = await db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
  const [plan] = license?.planId
    ? await db.select().from(platformPlans).where(eq(platformPlans.id, license.planId)).limit(1)
    : [null];
  const entitlements = await db.select().from(licenseEntitlements).where(eq(licenseEntitlements.organizationId, organizationId));
  const devices = await db.select().from(authorizedDevices).where(eq(authorizedDevices.organizationId, organizationId));
  const controls = await db.select().from(sessionControls).where(eq(sessionControls.organizationId, organizationId));

  return { organization, license: license ?? null, plan: plan ?? null, entitlements, devices, sessionControls: controls };
}

export async function getOrganizationLicenseDecision(organizationId: number, now = new Date()) {
  const db = getDb();
  const [license] = await db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
  return evaluateLicenseLifecycle(license ? {
    status: license.status,
    graceEndsAt: license.graceEndsAt,
    offlineLeaseExpiresAt: license.offlineLeaseExpiresAt,
  } : null, now);
}

// LV4-02-08: a lean read for session-boot time (fetched on every page load
// via /api/client/auth/me), unlike getOrganizationControlPlaneSnapshot
// which also joins entitlements/devices/sessionControls for the admin
// console's heavier per-request use. Returns both the raw status/graceEndsAt
// (so the client can render "grace ends in N days") and the derived
// decision reason (so the client doesn't have to re-implement
// evaluateLicenseLifecycle's branching).
export interface OrganizationLicenseSummary {
  status: LicenseLifecycleStatus;
  reason: LicenseLifecycleDecision["reason"];
  canUseEntitledFeatures: boolean;
  graceEndsAt: Date | null;
}

export async function getOrganizationLicenseSummary(
  organizationId: number,
  now = new Date(),
): Promise<OrganizationLicenseSummary | null> {
  const db = getDb();
  const [license] = await db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
  if (!license) return null;

  const decision = evaluateLicenseLifecycle({
    status: license.status,
    graceEndsAt: license.graceEndsAt,
    offlineLeaseExpiresAt: license.offlineLeaseExpiresAt,
  }, now);

  return {
    status: license.status,
    reason: decision.reason,
    canUseEntitledFeatures: decision.canUseEntitledFeatures,
    graceEndsAt: license.graceEndsAt,
  };
}

export async function getDeviceAccessDecision(organizationId: number, fingerprintHash: string | null | undefined, now = new Date()): Promise<DeviceAccessDecision> {
  const db = getDb();
  const devices = await db.select().from(authorizedDevices).where(eq(authorizedDevices.organizationId, organizationId));
  if (!devices.length) return { allowed: true, reason: "no_devices_configured" };
  if (!fingerprintHash) return { allowed: false, reason: "device_fingerprint_missing" };
  const device = devices.find((row) => row.deviceFingerprintHash === fingerprintHash);
  if (!device) return { allowed: false, reason: "device_unknown" };

  const decision = evaluateDeviceAuthorization({ status: device.status, leaseExpiresAt: device.leaseExpiresAt }, now);
  if (decision.allowed) {
    await db.update(authorizedDevices).set({ lastSeenAt: now }).where(eq(authorizedDevices.id, device.id));
  }
  return decision;
}

export async function getEntitlementDecision(organizationId: number, featureKey: string, now = new Date()): Promise<EntitlementDecision> {
  const db = getDb();
  const [license] = await db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
  if (!license) return { allowed: true, reason: "license_not_configured" };

  const entitlements = await db.select({
    featureKey: licenseEntitlements.featureKey,
    active: licenseEntitlements.active,
    expiresAt: licenseEntitlements.expiresAt,
  }).from(licenseEntitlements).where(eq(licenseEntitlements.organizationId, organizationId));
  if (!entitlements.length) return { allowed: true, reason: "entitlements_not_configured" };

  const allowed = hasFeatureEntitlement(entitlements, featureKey, now);
  return allowed ? { allowed: true, reason: "entitlement_granted" } : { allowed: false, reason: "entitlement_missing" };
}

function licenseUpsertSourceGuard(status: LicenseLifecycleStatus) {
  switch (status) {
    case "active":
      return sql`${organizationLicenses.status} IN ('active', 'grace', 'billing_hold', 'suspended', 'security_locked')`;
    case "grace":
      return sql`${organizationLicenses.status} IN ('active', 'grace', 'billing_hold', 'suspended', 'security_locked')`;
    case "billing_hold":
      return sql`${organizationLicenses.status} IN ('active', 'grace', 'billing_hold')`;
    case "suspended":
      return sql`${organizationLicenses.status} IN ('active', 'grace', 'billing_hold', 'suspended', 'security_locked')`;
    case "security_locked":
      return sql`${organizationLicenses.status} IN ('active', 'grace', 'billing_hold', 'suspended', 'security_locked')`;
    case "terminated":
      return sql`${organizationLicenses.status} IN ('active', 'grace', 'billing_hold', 'suspended', 'security_locked', 'terminated')`;
  }
}

export async function upsertOrganizationLicense(
  organizationId: number,
  input: Omit<typeof organizationLicenses.$inferInsert, "organizationId" | "updatedByUserId">,
  // LV4-03-05: null represents an automated/system-initiated update (e.g.
  // billingSubscriptionProjection.ts applying a webhook-driven status
  // change) with no human actor to attribute it to -- matches
  // recordSecurityAuditEvent's own userId: number | null convention.
  // updated_by_user_id has a real FK to users.id, so null here (not a
  // fabricated sentinel user id) is the only correct way to represent
  // "no human did this."
  actor: Pick<User, "id" | "email"> | null,
): Promise<OrganizationLicense> {
  const db = getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) throw new Error("Organization not found.");

  const [existing] = await db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
  if (existing && input.status && !canTransitionLicense(existing.status, input.status)) {
    throw new Error(`Cannot transition license from "${existing.status}" to "${input.status}": ${existing.status} is a terminal state.`);
  }

  const setWhere = input.status
    ? actor === null
      ? sql`${licenseUpsertSourceGuard(input.status)} AND ${organizationLicenses.status} <> 'security_locked'`
      : licenseUpsertSourceGuard(input.status)
    : undefined;
  const now = new Date();
  const [license] = await db.insert(organizationLicenses).values({
    ...input,
    organizationId,
    updatedByUserId: actor?.id ?? null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: organizationLicenses.organizationId,
    set: {
      ...input,
      ...(input.status === "grace" && input.graceEndsAt
        ? {
            // Concurrent grace transitions can arrive for the same org.
            // Once the row is already in grace, preserve the earliest
            // deadline atomically instead of allowing last-write-wins to
            // extend the customer's recovery window.
            graceEndsAt: sql`CASE
              WHEN ${organizationLicenses.status} = 'grace'
                AND ${organizationLicenses.graceEndsAt} IS NOT NULL
              THEN LEAST(${organizationLicenses.graceEndsAt}, ${input.graceEndsAt})
              ELSE ${input.graceEndsAt}
            END`,
          }
        : {}),
      updatedByUserId: actor?.id ?? null,
      updatedAt: now,
    },
    setWhere,
  }).returning();
  if (!license) {
    const [current] = await db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
    if (!current) throw new Error("Organization license not found.");
    throw new Error(`Cannot transition license from "${current.status}" to "${input.status ?? current.status}": lifecycle transition is not allowed.`);
  }

  await recordSecurityAuditEvent(actor?.id ?? null, "organization_license_upserted", {
    organizationId,
    licenseId: license.id,
    status: license.status,
    planId: license.planId,
    seatsPurchased: license.seatsPurchased,
    ...(actor ? auditActor(actor) : { userId: null, actorEmail: null }),
  });
  return license;
}

async function ensureOrganizationLicense(organizationId: number, actor: Pick<User, "id" | "email">): Promise<OrganizationLicense> {
  const db = getDb();
  const [existing] = await db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
  if (existing) return existing;
  return upsertOrganizationLicense(organizationId, { status: "active", seatsPurchased: 1, billingState: "current" }, actor);
}

export async function grantOrUpdateEntitlement(
  organizationId: number,
  input: InsertLicenseEntitlement,
  actor: Pick<User, "id" | "email">,
) {
  const db = getDb();
  const license = await ensureOrganizationLicense(organizationId, actor);
  const now = new Date();
  const [entitlement] = await db.insert(licenseEntitlements).values({
    ...input,
    organizationId,
    organizationLicenseId: license.id,
    grantedByUserId: actor.id,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [licenseEntitlements.organizationId, licenseEntitlements.featureKey],
    set: {
      organizationLicenseId: license.id,
      entitlementType: input.entitlementType,
      active: input.active,
      limitValue: input.limitValue ?? null,
      metadata: input.metadata,
      expiresAt: input.expiresAt ?? null,
      grantedByUserId: actor.id,
      updatedAt: now,
    },
  }).returning();

  await recordSecurityAuditEvent(actor.id, "license_entitlement_granted", { organizationId, entitlementId: entitlement.id, featureKey: entitlement.featureKey, ...auditActor(actor) });
  return entitlement;
}

export async function updateEntitlement(
  entitlementId: number,
  patch: Partial<InsertLicenseEntitlement>,
  actor: Pick<User, "id" | "email">,
) {
  const db = getDb();
  const [entitlement] = await db.update(licenseEntitlements).set({ ...patch, updatedAt: new Date() }).where(eq(licenseEntitlements.id, entitlementId)).returning();
  if (!entitlement) throw new Error("Entitlement not found.");
  await recordSecurityAuditEvent(actor.id, "license_entitlement_updated", { organizationId: entitlement.organizationId, entitlementId, changes: patch, ...auditActor(actor) });
  return entitlement;
}

export async function registerOrUpdateDevice(
  organizationId: number,
  input: Omit<typeof authorizedDevices.$inferInsert, "organizationId" | "revokedByUserId" | "revokedAt">,
  actor: Pick<User, "id" | "email">,
): Promise<AuthorizedDevice> {
  const db = getDb();
  const now = new Date();
  const revoked = input.status === "revoked";
  const [device] = await db.insert(authorizedDevices).values({
    ...input,
    organizationId,
    lastSeenAt: now,
    revokedAt: revoked ? now : null,
    revokedByUserId: revoked ? actor.id : null,
  }).onConflictDoUpdate({
    target: [authorizedDevices.organizationId, authorizedDevices.deviceFingerprintHash],
    set: {
      userId: input.userId ?? null,
      deviceLabel: input.deviceLabel,
      status: input.status ?? "authorized",
      leaseExpiresAt: input.leaseExpiresAt ?? null,
      lastSeenAt: now,
      revokedAt: revoked ? now : null,
      revokedByUserId: revoked ? actor.id : null,
      revokeReason: input.revokeReason ?? null,
      metadata: input.metadata ?? {},
    },
  }).returning();

  await recordSecurityAuditEvent(actor.id, "authorized_device_upserted", { organizationId, deviceId: device.id, status: device.status, ...auditActor(actor) });
  return device;
}

export async function updateDevice(
  deviceId: number,
  patch: Partial<Pick<AuthorizedDevice, "status" | "deviceLabel" | "leaseExpiresAt" | "revokeReason">>,
  actor: Pick<User, "id" | "email">,
): Promise<AuthorizedDevice> {
  const db = getDb();
  const revoked = patch.status === "revoked";
  const [device] = await db.update(authorizedDevices).set({
    ...patch,
    revokedAt: revoked ? new Date() : patch.status === "authorized" || patch.status === "pending" ? null : undefined,
    revokedByUserId: revoked ? actor.id : patch.status === "authorized" || patch.status === "pending" ? null : undefined,
  }).where(eq(authorizedDevices.id, deviceId)).returning();
  if (!device) throw new Error("Device not found.");
  await recordSecurityAuditEvent(actor.id, "authorized_device_updated", { organizationId: device.organizationId, deviceId, changes: patch, ...auditActor(actor) });
  return device;
}

export async function createSessionControl(
  input: SessionControlRequest,
  actor: Pick<User, "id" | "email">,
): Promise<{ control: SessionControl; revokedSessions: number }> {
  validateSessionControlRequest(input);
  const db = getDb();
  if (input.scope === "organization") {
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.organizationId!)).limit(1);
    if (!organization) throw new Error("Organization not found.");
  }
  if (input.scope === "user") {
    const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.targetUserId!)).limit(1);
    if (!targetUser) throw new Error("Target user not found.");
  }
  if (input.organizationId != null && input.targetUserId != null) {
    const [targetUser] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, input.targetUserId)).limit(1);
    if (!targetUser || targetUser.organizationId !== input.organizationId) throw new Error("Target user does not belong to the requested organization.");
  }
  const [control] = await db.insert(sessionControls).values({
    ...input,
    organizationId: input.organizationId ?? null,
    targetUserId: input.targetUserId ?? null,
    sid: input.sid ?? null,
    createdByUserId: actor.id,
  }).returning();

  // Both controls invalidate the matching persisted sessions. A force-re-auth
  // therefore has a real enforcement path: the next request must establish a
  // fresh authenticated session rather than merely recording a no-op control.
  const revokedSessions = await revokeMatchingSessions(input);

  await recordSecurityAuditEvent(actor.id, input.controlType === "force_logout" ? "session_force_logout" : "session_force_reauth", {
    controlId: control.id,
    scope: input.scope,
    organizationId: input.organizationId ?? null,
    targetUserId: input.targetUserId ?? null,
    sid: input.sid ?? null,
    revokedSessions,
    ...auditActor(actor),
  });

  return { control, revokedSessions };
}

async function revokeMatchingSessions(control: SessionControlRequest): Promise<number> {
  const db = getDb();
  if (control.scope === "session" && control.sid) {
    const [existing] = await db.select({ sid: sessions.sid }).from(sessions).where(eq(sessions.sid, control.sid)).limit(1);
    if (!existing) return 0;
    await db.delete(sessions).where(eq(sessions.sid, control.sid));
    return 1;
  }
  if (control.scope === "global") {
    const rows = await db.select({ sid: sessions.sid }).from(sessions);
    await db.delete(sessions);
    return rows.length;
  }

  const sessionRows = await db.select({ sid: sessions.sid, sessionData: sessions.sessionData }).from(sessions);
  const userRows = await db.select({ id: users.id, organizationId: users.organizationId }).from(users);
  const userOrgById = new Map(userRows.map((row) => [row.id, row.organizationId]));
  const matched = sessionRows.filter((row) => sessionMatchesControl(row, control, userOrgById));
  for (const row of matched) {
    await db.delete(sessions).where(and(eq(sessions.sid, row.sid)));
  }
  return matched.length;
}
