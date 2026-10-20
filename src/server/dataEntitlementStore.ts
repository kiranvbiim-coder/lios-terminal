import crypto from "crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import { dataEntitlementPolicies, type DataEntitlementPolicy } from "@shared/schema";
import { entitlementPolicyInputSchema, type EntitlementPolicyInput } from "@shared/pointInTimeUniverse";
import { getDb, type DrizzleDb } from "./db";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

export async function createEntitlementPolicy(input: EntitlementPolicyInput, reviewedByUserId: number | null = null) {
  const parsed = entitlementPolicyInputSchema.parse(input);
  const contentHash = stableSnapshotHash(parsed);
  const db = getDb();
  const [existing] = await db.select().from(dataEntitlementPolicies).where(eq(dataEntitlementPolicies.contentHash, contentHash)).limit(1);
  if (existing) return { policy: existing, created: false };
  const [policy] = await db.insert(dataEntitlementPolicies).values({
    id: crypto.randomUUID(), ...parsed, effectiveFrom: new Date(parsed.effectiveFrom),
    effectiveTo: parsed.effectiveTo ? new Date(parsed.effectiveTo) : null,
    reviewedAt: parsed.reviewedAt ? new Date(parsed.reviewedAt) : null, reviewedByUserId, contentHash,
  }).returning();
  return { policy, created: true };
}

export async function getEntitlementPolicyById(id: string, db: Pick<DrizzleDb, "select"> = getDb(), lock = false): Promise<DataEntitlementPolicy | null> {
  const query = db.select().from(dataEntitlementPolicies).where(eq(dataEntitlementPolicies.id, id));
  const [policy] = await (lock ? query.for("share") : query).limit(1);
  return policy ?? null;
}

export async function getApplicableEntitlementPolicy(provider: string, dataClass: string, asOf = new Date()) {
  const rows = await getDb().select().from(dataEntitlementPolicies).where(and(
    eq(dataEntitlementPolicies.provider, provider), eq(dataEntitlementPolicies.dataClass, dataClass), lte(dataEntitlementPolicies.effectiveFrom, asOf),
  )).orderBy(desc(dataEntitlementPolicies.effectiveFrom));
  return rows.find((row) => !row.effectiveTo || row.effectiveTo >= asOf) ?? null;
}

export async function ensureEntitlementPolicy(provider: string, dataClass: string, createdByUserId: number) {
  const existing = await getApplicableEntitlementPolicy(provider, dataClass);
  if (existing) return existing;
  const userSupplied = provider === "user_supplied";
  const { policy } = await createEntitlementPolicy({
    provider, dataClass, licenseType: userSupplied ? "user_supplied" : "unknown", accessScope: "internal_only",
    redistribution: "restricted", permittedUses: ["display", "internal_research", "model_input", "derived_output", "export"],
    attribution: userSupplied ? "User-supplied dataset; source attribution retained in snapshot lineage." : null,
    termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null,
    notes: userSupplied ? "Uploader remains responsible for source rights." : "Pending formal source-rights review; internal use only.",
  }, createdByUserId);
  return policy;
}

export async function listEntitlementPolicies() {
  return getDb().select().from(dataEntitlementPolicies).orderBy(dataEntitlementPolicies.provider, dataEntitlementPolicies.dataClass, desc(dataEntitlementPolicies.effectiveFrom));
}
