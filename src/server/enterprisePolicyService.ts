import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb } from "./db";
import { withOrganizationId } from "./tenantDb";
import { recordSecurityAuditEvent, auditActor } from "./auditEvents";
import {
  organizations,
  users,
  organizationLicenses,
  authorizedDevices,
  organizationEnterprisePolicies,
  type User,
} from "@shared/schema";
import {
  DEFAULT_ENTERPRISE_POLICY,
  assessEnterprisePolicy,
  normalizeEnterprisePolicy,
  enterprisePolicySchema,
  type EnterprisePolicy,
} from "@shared/enterpriseContracts";

export interface EnterprisePolicyRecord {
  organizationId: number;
  policy: EnterprisePolicy;
  revision: number;
  updatedByUserId: number | null;
  updatedAt: Date | null;
}

export interface EnterpriseOrganizationOverview {
  organization: typeof organizations.$inferSelect;
  policy: EnterprisePolicyRecord;
  users: Array<Pick<typeof users.$inferSelect, "id" | "email" | "name" | "role" | "active" | "lastLoginAt">>;
  seatUsage: { active: number; total: number; configuredLimit: number | null; remaining: number | null };
  license: { status: string; planId: number | null; seatsPurchased: number } | null;
  devices: { total: number; authorized: number; pending: number; revoked: number };
  readiness: ReturnType<typeof assessEnterprisePolicy>;
}

function defaultRecord(organizationId: number): EnterprisePolicyRecord {
  return { organizationId, policy: normalizeEnterprisePolicy(DEFAULT_ENTERPRISE_POLICY), revision: 1, updatedByUserId: null, updatedAt: null };
}

export async function getStoredEnterprisePolicy(organizationId: number): Promise<EnterprisePolicyRecord | null> {
  return withOrganizationId(organizationId, async (tx) => {
    const [row] = await tx.select().from(organizationEnterprisePolicies)
      .where(eq(organizationEnterprisePolicies.organizationId, organizationId)).limit(1);
    if (!row) return null;
    return {
      organizationId: row.organizationId,
      policy: normalizeEnterprisePolicy(row.policy),
      revision: row.revision,
      updatedByUserId: row.updatedByUserId,
      updatedAt: row.updatedAt,
    };
  });
}

export async function getEnterprisePolicy(organizationId: number): Promise<EnterprisePolicyRecord | null> {
  return withOrganizationId(organizationId, async (tx) => {
    const [row] = await tx.select().from(organizationEnterprisePolicies)
      .where(eq(organizationEnterprisePolicies.organizationId, organizationId)).limit(1);
    if (!row) return defaultRecord(organizationId);
    return {
      organizationId: row.organizationId,
      policy: normalizeEnterprisePolicy(row.policy),
      revision: row.revision,
      updatedByUserId: row.updatedByUserId,
      updatedAt: row.updatedAt,
    };
  });
}

export async function saveEnterprisePolicy(
  organizationId: number,
  input: unknown,
  actor: Pick<User, "id" | "email">,
): Promise<EnterprisePolicyRecord> {
  // Writes must be valid; normalization is only the explicit legacy migration.
  const policy = normalizeEnterprisePolicy(enterprisePolicySchema.parse(input));
  const record = await withOrganizationId(organizationId, async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).for("update").limit(1);
    if (!organization) throw new Error("Organization not found.");
    const [existing] = await tx.select().from(organizationEnterprisePolicies)
      .where(eq(organizationEnterprisePolicies.organizationId, organizationId)).limit(1);
    const now = new Date();
    if (existing) {
      const [updated] = await tx.update(organizationEnterprisePolicies).set({
        policy,
        revision: existing.revision + 1,
        updatedByUserId: actor.id,
        updatedAt: now,
      }).where(eq(organizationEnterprisePolicies.organizationId, organizationId)).returning();
      return { organizationId, policy, revision: updated.revision, updatedByUserId: actor.id, updatedAt: updated.updatedAt, previousPolicyDigest: createHash("sha256").update(JSON.stringify(existing.policy)).digest("hex") };
    }
    const [created] = await tx.insert(organizationEnterprisePolicies).values({
      organizationId,
      policy,
      revision: 1,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return { organizationId, policy, revision: created.revision, updatedByUserId: actor.id, updatedAt: created.updatedAt, previousPolicyDigest: null };
  });
  const { previousPolicyDigest, ...saved } = record;
  await recordSecurityAuditEvent(actor.id, "enterprise_policy_updated", {
    organizationId, revision: saved.revision, previousPolicyDigest,
    policyDigest: createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
    decisionGrants: policy.roles.grants, ...auditActor(actor),
  });
  return saved;
}

export async function getEnterpriseOrganizationOverview(organizationId: number): Promise<EnterpriseOrganizationOverview | null> {
  return withOrganizationId(organizationId, async (tx) => {
    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!organization) return null;
    const [storedPolicy] = await tx.select().from(organizationEnterprisePolicies)
      .where(eq(organizationEnterprisePolicies.organizationId, organizationId)).limit(1);
    const policy: EnterprisePolicyRecord = storedPolicy
      ? { organizationId, policy: normalizeEnterprisePolicy(storedPolicy.policy), revision: storedPolicy.revision, updatedByUserId: storedPolicy.updatedByUserId, updatedAt: storedPolicy.updatedAt }
      : defaultRecord(organizationId);
    const organizationUsers = await tx.select({
      id: users.id, email: users.email, name: users.name, role: users.role, active: users.active, lastLoginAt: users.lastLoginAt,
    }).from(users).where(eq(users.organizationId, organizationId));
    const [license] = await tx.select({ status: organizationLicenses.status, planId: organizationLicenses.planId, seatsPurchased: organizationLicenses.seatsPurchased })
      .from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
    const deviceRows = await tx.select({ status: authorizedDevices.status }).from(authorizedDevices).where(eq(authorizedDevices.organizationId, organizationId));
    const active = organizationUsers.filter((user) => user.active && (user.role === "client_admin" || user.role === "client_user")).length;
    const configuredLimit = policy.policy.seats.maxSeats ?? license?.seatsPurchased ?? null;
    return {
      organization,
      policy,
      users: organizationUsers,
      seatUsage: { active, total: organizationUsers.length, configuredLimit, remaining: configuredLimit === null ? null : Math.max(0, configuredLimit - active) },
      license: license ?? null,
      devices: {
        total: deviceRows.length,
        authorized: deviceRows.filter((device) => device.status === "authorized").length,
        pending: deviceRows.filter((device) => device.status === "pending").length,
        revoked: deviceRows.filter((device) => device.status === "revoked").length,
      },
      readiness: assessEnterprisePolicy(policy.policy),
    };
  });
}

export async function listEnterpriseOrganizations() {
  const db = getDb();
  return db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status, lifecycleStage: organizations.lifecycleStage })
    .from(organizations).where(sql`${organizations.status} <> 'deleted'`);
}
