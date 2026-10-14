import { eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import {
  clientAlerts,
  dashboardWatchlistItems,
  domains,
  organizationDomains,
  organizations,
  platformPlans,
  publishedContent,
} from "@shared/schema";

export const PLATFORM_DOMAINS = [
  {
    slug: "finance",
    name: "Finance",
    icon: "TrendingUp",
    active: true,
    description: "Markets, portfolios, equities, macro -- the original Limuria Intelligence terminal.",
  },
  {
    slug: "economics_policy",
    name: "Economics & Public Policy",
    icon: "Landmark",
    active: true,
    description: "Macroeconomic indicators, central bank policy, and government data.",
  },
  {
    slug: "supply_chain",
    name: "Operations & Supply Chain Logistics",
    icon: "Truck",
    active: true,
    description: "Freight rates, port congestion, supplier risk, and a real route/network/resilience engine.",
  },
  {
    slug: "environment_sustainability",
    name: "Environment & Sustainability",
    icon: "Leaf",
    active: true,
    description: "Climate risk, emissions, ESG, and a real carbon transition risk/credit MRV engine.",
  },
  {
    slug: "marketing_pr",
    name: "Marketing, PR & Communications",
    icon: "Megaphone",
    active: false,
    description: "Brand sentiment, media monitoring, campaign performance. Coming soon.",
  },
  {
    slug: "tourism_hospitality",
    name: "Tourism & Hospitality",
    icon: "Palmtree",
    active: false,
    description: "Occupancy, booking trends, destination demand. Coming soon.",
  },
] as const;

export async function ensurePlatformDomains(): Promise<void> {
  const db = getDb();

  for (const domain of PLATFORM_DOMAINS) {
    const [existing] = await db.select().from(domains).where(eq(domains.slug, domain.slug)).limit(1);
    if (existing) continue;
    await db.insert(domains).values(domain);
  }

  const [financeDomain] = await db.select().from(domains).where(eq(domains.slug, "finance")).limit(1);
  if (!financeDomain) throw new Error("Finance domain missing after platform bootstrap.");

  await db.update(publishedContent).set({ domainId: financeDomain.id }).where(isNull(publishedContent.domainId));
  await db.update(dashboardWatchlistItems).set({ domainId: financeDomain.id }).where(isNull(dashboardWatchlistItems.domainId));
  await db.update(clientAlerts).set({ domainId: financeDomain.id }).where(isNull(clientAlerts.domainId));

  const allOrgs = await db.select().from(organizations);
  for (const org of allOrgs) {
    const existingGrants = await db.select().from(organizationDomains).where(eq(organizationDomains.organizationId, org.id));
    if (existingGrants.some((grant) => grant.domainId === financeDomain.id)) continue;
    await db.insert(organizationDomains).values({ organizationId: org.id, domainId: financeDomain.id }).onConflictDoNothing();
  }
}


export const PLATFORM_COMMERCIAL_PLANS = [
  {
    code: "starter-monthly",
    name: "LiOS Starter",
    tier: "starter" as const,
    seatLimit: 1,
    featureLimits: { softwareTier: "starter" },
  },
  {
    code: "pro-monthly",
    name: "LiOS Pro",
    tier: "pro" as const,
    seatLimit: 1,
    featureLimits: { softwareTier: "pro" },
  },
  {
    code: "enterprise-monthly",
    name: "LiOS Enterprise",
    tier: "enterprise" as const,
    seatLimit: null,
    featureLimits: { softwareTier: "enterprise" },
  },
] as const;

/** Creates the canonical software-plan catalog used for entitlements and licence plan codes. */
export async function ensureCommercialPlans(): Promise<void> {
  const db = getDb();
  for (const seed of PLATFORM_COMMERCIAL_PLANS) {
    const [existing] = await db.select().from(platformPlans).where(eq(platformPlans.code, seed.code)).limit(1);
    if (!existing) {
      await db.insert(platformPlans).values({
        code: seed.code,
        name: seed.name,
        tier: seed.tier,
        seatLimit: seed.seatLimit,
        offlineGraceDays: 7,
        featureLimits: seed.featureLimits,
        active: true,
      });
      continue;
    }

    const updates: Partial<typeof platformPlans.$inferInsert> = {};
    if (existing.name !== seed.name) updates.name = seed.name;
    if (existing.tier !== seed.tier) updates.tier = seed.tier;
    if (existing.seatLimit !== seed.seatLimit) updates.seatLimit = seed.seatLimit;
    if (!existing.active) updates.active = true;
    if (Object.keys(updates).length) {
      await db.update(platformPlans).set({ ...updates, updatedAt: new Date() }).where(eq(platformPlans.id, existing.id));
    }
  }
}
