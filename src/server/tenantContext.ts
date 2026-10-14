import type { User } from "@shared/schema";
import { ownershipMatches, ownershipScopeSchema, type OwnershipScope } from "@shared/identityContracts";

/**
 * Canonical tenant context for service-layer authorization.
 * Client users must have an organization. Internal users intentionally do not
 * receive an implicit organization here; internal cross-client access must be
 * an explicit, audited service operation rather than an accidental RLS bypass.
 */
export interface TenantContext {
  userId: number;
  organizationId: number | null;
  role: User["role"];
}

export function tenantContext(user: Pick<User, "id" | "organizationId" | "role">): TenantContext {
  const isClient = user.role === "client_admin" || user.role === "client_user";
  if (isClient && !user.organizationId) {
    throw new Error("Authenticated client user has no organization.");
  }
  return { userId: user.id, organizationId: user.organizationId ?? null, role: user.role };
}

export function assertSameOrganization(ctx: TenantContext, organizationId: number): void {
  if (ctx.organizationId === null || ctx.organizationId !== organizationId) {
    throw new Error("Organization boundary violation.");
  }
}


/** Canonical work-ownership scope. Commercial entitlement state is deliberately
 * absent: billing can gate execution, but it never changes who owns local work. */
export function ownershipScope(ctx: TenantContext): OwnershipScope {
  return ownershipScopeSchema.parse({
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
  });
}

export function assertOwnedByTenant(
  ctx: TenantContext,
  resource: { ownerUserId: number; organizationId: number | null },
): void {
  if (!ownershipMatches(ownershipScope(ctx), resource)) {
    throw new Error("Authenticated work ownership boundary violation.");
  }
}

/** Legacy filesystem work predates organization scoping. It may be claimed only
 * by the exact authenticated user that created it; organization membership alone
 * never grants claim rights. */
export function assertLegacyWorkClaim(ctx: TenantContext, legacyOwnerUserId: number): void {
  if (legacyOwnerUserId !== ctx.userId) {
    throw new Error("Legacy work can only be claimed by its authenticated creator.");
  }
}
