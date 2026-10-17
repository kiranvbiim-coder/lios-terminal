import { and, desc, eq, isNull, lte, or, gt } from "drizzle-orm";
import { datasetSnapshots } from "@shared/schema";
import { estimatesPayloadSchema } from "@shared/pointInTimeAlternativeData";
import type { P9AutomationEvent } from "@shared/p9AutomationContracts";
import type { TenantContext } from "./tenantContext";
import { getDb } from "./db";
import { getApplicableEntitlementPolicy } from "./dataEntitlementStore";
import { canAccessDatasetSnapshot } from "./columnarArtifactStore";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

/** Reads a real retained estimate/actual snapshot only after current metadata and rights admission. */
export async function readCurrentP9FinancialEvents(ctx: TenantContext, projectId: number, symbol: string, kind: "earnings" | "estimate_revision", now = new Date()): Promise<Array<{ key: string; event: P9AutomationEvent }>> {
  const db = getDb();
  const [identity] = await db.select({
    id: datasetSnapshots.id, provider: datasetSnapshots.provider, organizationId: datasetSnapshots.organizationId,
    createdByUserId: datasetSnapshots.createdByUserId, contentHash: datasetSnapshots.contentHash,
    availableAt: datasetSnapshots.availableAt, expiresAt: datasetSnapshots.expiresAt,
  }).from(datasetSnapshots).where(and(
    eq(datasetSnapshots.dataClass, "estimates"), eq(datasetSnapshots.entityKey, symbol),
    ctx.organizationId === null ? isNull(datasetSnapshots.organizationId) : or(isNull(datasetSnapshots.organizationId), eq(datasetSnapshots.organizationId, ctx.organizationId)),
    lte(datasetSnapshots.availableAt, now), or(isNull(datasetSnapshots.expiresAt), gt(datasetSnapshots.expiresAt, now)),
  )).orderBy(desc(datasetSnapshots.availableAt), desc(datasetSnapshots.createdAt)).limit(1);
  if (!identity || !canAccessDatasetSnapshot(identity, ctx)) throw new Error("No currently accessible estimate/earnings observation is available.");
  const policy = await getApplicableEntitlementPolicy(identity.provider, "estimates", now);
  if (!policy || !policy.permittedUses.includes("internal_research") || !policy.permittedUses.includes("display")
    || (policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_"))
    || (!policy.reviewedAt && policy.licenseType !== "user_supplied")) throw new Error("Current source rights do not permit recurring estimate/earnings observation.");
  const [snapshot] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, identity.id)).limit(1);
  if (!snapshot || !canAccessDatasetSnapshot(snapshot, ctx) || snapshot.contentHash !== identity.contentHash || snapshot.availableAt > now || (snapshot.expiresAt && snapshot.expiresAt <= now)) throw new Error("Financial event source changed during observation.");
  if (Buffer.byteLength(JSON.stringify(snapshot.payload), "utf8") > 2 * 1024 * 1024) throw new Error("Financial event source exceeds its bounded observation limit.");
  if (stableSnapshotHash({ payload: snapshot.payload, provider: snapshot.provider, lineage: snapshot.lineage }) !== snapshot.contentHash) throw new Error("Financial event source content does not match its retained revision.");
  const payload = estimatesPayloadSchema.parse(snapshot.payload);
  if (payload.symbol.toUpperCase() !== symbol) throw new Error("Financial event symbol does not match the observed source.");
  const rows = kind === "earnings"
    ? payload.actuals.filter(row => new Date(row.availableAt) <= now && new Date(row.reportedAt) <= now).map(row => ({ metric: row.metric, fiscalPeriod: row.fiscalPeriod, periodEnd: row.periodEnd, value: row.value, occurredAt: row.availableAt, publishedAt: row.reportedAt, contributor: "reported_actual", unit: "source_reported", currency: snapshot.currency }))
    : payload.observations.filter(row => new Date(row.availableAt) <= now && new Date(row.publishedAt) <= now).map(row => ({ metric: row.metric, fiscalPeriod: row.fiscalPeriod, periodEnd: row.periodEnd, value: row.value, occurredAt: row.availableAt, publishedAt: row.publishedAt, contributor: row.contributor, unit: row.unit, currency: row.currency }));
  return rows.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)).slice(-128).map(row => {
    const key = stableSnapshotHash(row);
    return { key, event: {
      eventType: kind, occurredAt: row.occurredAt, projectId, ownerUserId: ctx.userId, organizationId: ctx.organizationId,
      sourceRef: `snapshot:${snapshot.id}:observation:${key}`,
      payload: { symbol, metric: row.metric, fiscalPeriod: row.fiscalPeriod, periodEnd: row.periodEnd, value: row.value, contributor: row.contributor, unit: row.unit, currency: row.currency, provider: snapshot.provider, snapshotId: snapshot.id, contentHash: snapshot.contentHash, entitlementPolicyId: policy.id, publishedAt: row.publishedAt },
    } };
  });
}
