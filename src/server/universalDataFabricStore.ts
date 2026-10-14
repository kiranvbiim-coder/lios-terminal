import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  dataCoverageLedger,
  dataLineageReceipts,
  semanticMetricDefinitions,
} from "@shared/schema";
import {
  coverageLedgerSnapshotSchema,
  dataLineageReceiptSchema,
  semanticMetricDefinitionSchema,
  type CoverageLedgerSnapshot,
  type DataLineageReceipt,
  type SemanticMetricDefinition,
} from "@shared/universalDataFabric";
import type { TenantContext } from "./tenantContext";
import { getDb } from "./db";
import { hashLedgerValue } from "./ledgerStore";

function orgClause(column: any, ctx: TenantContext) {
  return ctx.organizationId === null ? isNull(column) : eq(column, ctx.organizationId);
}

export async function recordCoverageLedgerSnapshot(
  ctx: TenantContext,
  raw: CoverageLedgerSnapshot,
) {
  const snapshot = coverageLedgerSnapshotSchema.parse(raw);
  const contentHash = hashLedgerValue(snapshot);
  const id = crypto.randomUUID();
  const db = getDb();
  const [inserted] = await db.insert(dataCoverageLedger).values({
    id,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    generatedAt: new Date(snapshot.generatedAt),
    realUniverseSize: snapshot.realUniverseSize,
    indexedUniverseSize: snapshot.indexedUniverseSize,
    capacityProofSize: snapshot.capacityProofSize,
    warmSearchP95Ms: snapshot.warmSearchP95Ms,
    providerCount: snapshot.providers,
    implementedProviderCount: snapshot.implementedProviders,
    capabilityFamilyCount: snapshot.capabilityFamilies,
    fieldStages: snapshot.fieldStages,
    gaps: snapshot.gaps,
    contentHash,
  }).onConflictDoNothing().returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(dataCoverageLedger).where(and(
    eq(dataCoverageLedger.ownerUserId, ctx.userId),
    orgClause(dataCoverageLedger.organizationId, ctx),
    eq(dataCoverageLedger.contentHash, contentHash),
  )).limit(1);
  return existing;
}

export async function listCoverageLedgerSnapshots(ctx: TenantContext, limit = 50) {
  return getDb().select().from(dataCoverageLedger).where(and(
    eq(dataCoverageLedger.ownerUserId, ctx.userId),
    orgClause(dataCoverageLedger.organizationId, ctx),
  )).orderBy(desc(dataCoverageLedger.generatedAt)).limit(Math.min(Math.max(limit, 1), 500));
}

export async function createSemanticMetricVersion(
  ctx: TenantContext,
  raw: Omit<SemanticMetricDefinition, "version"> & { version?: number },
) {
  const db = getDb();
  const prior = await db.select().from(semanticMetricDefinitions).where(and(
    eq(semanticMetricDefinitions.ownerUserId, ctx.userId),
    orgClause(semanticMetricDefinitions.organizationId, ctx),
    eq(semanticMetricDefinitions.metricId, raw.metricId),
  )).orderBy(desc(semanticMetricDefinitions.version)).limit(1);
  const version = raw.version ?? ((prior[0]?.version ?? 0) + 1);
  const metric = semanticMetricDefinitionSchema.parse({ ...raw, version });
  await db.update(semanticMetricDefinitions).set({ status: "deprecated" }).where(and(
    eq(semanticMetricDefinitions.ownerUserId, ctx.userId),
    orgClause(semanticMetricDefinitions.organizationId, ctx),
    eq(semanticMetricDefinitions.metricId, metric.metricId),
    eq(semanticMetricDefinitions.status, "active"),
  ));
  const [created] = await db.insert(semanticMetricDefinitions).values({
    id: crypto.randomUUID(),
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    metricId: metric.metricId,
    version: metric.version,
    name: metric.name,
    description: metric.description,
    category: metric.category,
    unit: metric.unit,
    aliases: metric.aliases,
    formula: metric.formula,
    sourcePolicy: metric.sourcePolicy,
    status: metric.status,
  }).returning();
  return created;
}

export async function listSemanticMetricVersions(ctx: TenantContext, metricId?: string) {
  const conditions = [
    eq(semanticMetricDefinitions.ownerUserId, ctx.userId),
    orgClause(semanticMetricDefinitions.organizationId, ctx),
    metricId ? eq(semanticMetricDefinitions.metricId, metricId) : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);
  return getDb().select().from(semanticMetricDefinitions)
    .where(and(...conditions))
    .orderBy(semanticMetricDefinitions.metricId, desc(semanticMetricDefinitions.version));
}

export async function recordDataLineageReceipt(
  ctx: TenantContext,
  raw: DataLineageReceipt,
) {
  const receipt = dataLineageReceiptSchema.parse(raw);
  if (receipt.projectId !== null && receipt.projectId <= 0) throw new Error("Invalid Project scope.");
  const contentHash = hashLedgerValue(receipt);
  const db = getDb();
  const [created] = await db.insert(dataLineageReceipts).values({
    id: receipt.id,
    projectId: receipt.projectId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    requestId: receipt.requestId,
    capability: receipt.capability,
    entityRef: receipt.entityRef,
    pointInTime: receipt.pointInTime,
    stages: receipt.stages,
    contentHash,
    createdAt: new Date(receipt.createdAt),
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await db.select().from(dataLineageReceipts).where(and(
    eq(dataLineageReceipts.ownerUserId, ctx.userId),
    eq(dataLineageReceipts.contentHash, contentHash),
  )).limit(1);
  return existing;
}

export async function listDataLineageReceipts(ctx: TenantContext, projectId?: number, limit = 100) {
  const conditions = [
    eq(dataLineageReceipts.ownerUserId, ctx.userId),
    orgClause(dataLineageReceipts.organizationId, ctx),
    projectId ? eq(dataLineageReceipts.projectId, projectId) : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);
  return getDb().select().from(dataLineageReceipts)
    .where(and(...conditions))
    .orderBy(desc(dataLineageReceipts.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}
