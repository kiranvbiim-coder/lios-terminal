import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  organizations,
  engagements,
  workstreams,
  portfolios,
  consultingRequests,
} from "@shared/schema";

export class TenantIntegrityError extends Error {
  statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "TenantIntegrityError";
  }
}

/** Resolve a client resource only when it belongs to the expected organization. */
export async function requireOrganization(organizationId: number): Promise<void> {
  const db = getDb();
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new TenantIntegrityError("Organization not found.");
}

export async function requireEngagementInOrganization(engagementId: number, organizationId: number): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ id: engagements.id }).from(engagements)
    .where(and(eq(engagements.id, engagementId), eq(engagements.organizationId, organizationId))).limit(1);
  if (!row) throw new TenantIntegrityError("Engagement does not belong to the organization.");
}

export async function requireWorkstreamInEngagement(workstreamId: number, engagementId: number, organizationId: number): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ id: workstreams.id }).from(workstreams)
    .innerJoin(engagements, eq(workstreams.engagementId, engagements.id))
    .where(and(
      eq(workstreams.id, workstreamId),
      eq(workstreams.engagementId, engagementId),
      eq(engagements.organizationId, organizationId),
    )).limit(1);
  if (!row) throw new TenantIntegrityError("Workstream does not belong to the engagement and organization.");
}

export async function requirePortfolioInOrganization(portfolioId: number, organizationId: number): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ id: portfolios.id }).from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.organizationId, organizationId))).limit(1);
  if (!row) throw new TenantIntegrityError("Portfolio does not belong to the organization.");
}

export async function requireRequestInOrganization(requestId: number, organizationId: number): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ id: consultingRequests.id }).from(consultingRequests)
    .where(and(eq(consultingRequests.id, requestId), eq(consultingRequests.organizationId, organizationId))).limit(1);
  if (!row) throw new TenantIntegrityError("Consulting request does not belong to the organization.");
}

/**
 * Validate the complete optional engagement/workstream chain on a request.
 * This prevents organization A from attaching B's engagement or workstream.
 */
export async function requireRequestHierarchy(input: {
  requestId?: number;
  organizationId: number;
  engagementId?: number | null;
  workstreamId?: number | null;
}): Promise<void> {
  if (input.requestId !== undefined) await requireRequestInOrganization(input.requestId, input.organizationId);
  if (input.engagementId != null) await requireEngagementInOrganization(input.engagementId, input.organizationId);
  if (input.workstreamId != null) {
    if (input.engagementId == null) throw new TenantIntegrityError("A workstream requires an engagement.");
    await requireWorkstreamInEngagement(input.workstreamId, input.engagementId, input.organizationId);
  }
}
