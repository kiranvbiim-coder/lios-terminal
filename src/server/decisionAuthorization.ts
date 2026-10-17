import type { Express, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { organizations, organizationEnterprisePolicies, users } from "@shared/schema";
import { canUseEnterprisePermission, DECISION_ROLE_CEILINGS, DEFAULT_ENTERPRISE_POLICY, enterprisePolicySchema, normalizeEnterprisePolicy, type DecisionPermission } from "@shared/enterpriseContracts";
import { getDb, type DrizzleDb } from "./db";
import { decisionSnapshotHash } from "./decisionEngine";

export interface DecisionAuthorization {
  user: typeof users.$inferSelect;
  grants: Record<DecisionPermission, boolean>;
  digest: string;
}
export class DecisionAuthorizationError extends Error {
  readonly statusCode = 403;
}

/** Reload current account and organization policy, never a persona or a session's cached grants.
 * At exact review release pass its transaction and lock=true. The organization row
 * serializes even the initial policy insertion with saveEnterprisePolicy.
 */
export async function getDecisionAuthorization(user: Express.User, db: DrizzleDb = getDb(), lock = false): Promise<DecisionAuthorization> {
  const query = db.select().from(users).where(eq(users.id, user.id));
  const [current] = await (lock ? query.for("update") : query).limit(1);
  if (!current || !current.active || current.mustChangePassword || (current.lockedUntil && current.lockedUntil.getTime() > Date.now())) {
    throw new DecisionAuthorizationError("Current account state does not permit financial Decision access.");
  }
  // A session/device tenant or role change requires reauthentication, not silent authority expansion.
  if (current.role !== user.role || (current.organizationId ?? null) !== (user.organizationId ?? null)) {
    throw new DecisionAuthorizationError("Security role or organization changed; sign in again before accessing Decisions.");
  }
  let policy = normalizeEnterprisePolicy(DEFAULT_ENTERPRISE_POLICY);
  let revision = 0;
  if (current.organizationId !== null) {
    const organizationQuery = db.select().from(organizations).where(eq(organizations.id, current.organizationId));
    const [organization] = await (lock ? organizationQuery.for("update") : organizationQuery).limit(1);
    if (!organization || organization.status !== "active") throw new DecisionAuthorizationError("The current organization is not active.");
    const [stored] = await db.select().from(organizationEnterprisePolicies).where(eq(organizationEnterprisePolicies.organizationId, current.organizationId)).limit(1);
    if (stored) {
      if (!enterprisePolicySchema.safeParse(stored.policy).success) throw new DecisionAuthorizationError("Organization Decision policy is invalid; access is denied until corrected.");
      policy = normalizeEnterprisePolicy(stored.policy);
      revision = stored.revision;
    }
  }
  const grants = {
    read_decisions: canUseEnterprisePermission(policy, current.role, "read_decisions"),
    author_decisions: canUseEnterprisePermission(policy, current.role, "read_decisions") && canUseEnterprisePermission(policy, current.role, "author_decisions"),
    review_decisions: canUseEnterprisePermission(policy, current.role, "read_decisions") && canUseEnterprisePermission(policy, current.role, "review_decisions"),
  };
  return {
    user: current,
    grants,
    digest: decisionSnapshotHash({ authority: "enterprise-decision-v2", userId: current.id, role: current.role, organizationId: current.organizationId, active: current.active, mustChangePassword: current.mustChangePassword, lockedUntil: current.lockedUntil?.toISOString() ?? null, revision, policy }),
  };
}

export function assertDecisionPermission(authority: DecisionAuthorization, permission: DecisionPermission, organizationId?: number | null): void {
  if (organizationId != null && authority.user.organizationId !== organizationId) throw new DecisionAuthorizationError("Decision belongs to another organization.");
  if (!authority.grants[permission]) {
    const role = authority.user.role;
    const ceiling = DECISION_ROLE_CEILINGS[role].includes(permission);
    throw new DecisionAuthorizationError(ceiling
      ? `Organization policy denies ${permission} for security role ${role}; an authorized organization administrator must review the grant. Personas cannot authorize access.`
      : `Security role ${role} cannot ${permission}; organization grants and personas cannot widen this role's authority.`);
  }
}

export function requireDecisionPermission(permission: DecisionPermission): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!req.user) return void res.status(401).json({ error: "Authentication required." });
      const authority = await getDecisionAuthorization(req.user);
      assertDecisionPermission(authority, permission);
      req.user = authority.user;
      next();
    } catch (error) {
      if (error instanceof DecisionAuthorizationError) return void res.status(error.statusCode).json({ error: error.message });
      next(error);
    }
  };
}
