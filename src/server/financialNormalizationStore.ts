import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { financialNormalizationAdjustments, financialNormalizationPolicies } from "@shared/schema";
import type { FinancialNormalizationAdjustment, FinancialNormalizationPolicy, NormalizationAdjustmentKind } from "@shared/financialNormalization";
import { withUserTransaction } from "./tenantDb";
import type { TenantContext } from "./tenantContext";

export interface NormalizationAdjustmentInput {
  /** Present when updating an adjustment row returned by a prior list/upsert; omitted to insert a new one. */
  id?: string;
  label: string;
  metricId: string;
  kind: NormalizationAdjustmentKind;
  amount: number;
  period: string;
  rationale?: string;
  source?: string;
}

export interface NormalizationPolicyInput {
  symbol: string;
  label: string;
  adjustments: NormalizationAdjustmentInput[];
}

function scopePredicate(ctx: TenantContext) {
  return ctx.organizationId === null
    ? eq(financialNormalizationPolicies.ownerUserId, ctx.userId)
    : or(eq(financialNormalizationPolicies.ownerUserId, ctx.userId), eq(financialNormalizationPolicies.organizationId, ctx.organizationId));
}

function toAdjustment(row: typeof financialNormalizationAdjustments.$inferSelect): FinancialNormalizationAdjustment {
  return {
    id: row.id,
    label: row.label,
    metricId: row.metricId,
    kind: row.kind as NormalizationAdjustmentKind,
    amount: row.amount,
    period: row.period,
    rationale: row.rationale ?? undefined,
    source: row.source ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPolicy(row: typeof financialNormalizationPolicies.$inferSelect, adjustmentRows: Array<typeof financialNormalizationAdjustments.$inferSelect>): FinancialNormalizationPolicy {
  return { id: row.id, label: row.label, adjustments: adjustmentRows.map(toAdjustment) };
}

export async function listNormalizationPolicies(ctx: TenantContext, symbol: string): Promise<FinancialNormalizationPolicy[]> {
  return withUserTransaction(ctx, async (tx) => {
    const policyRows = await tx.select().from(financialNormalizationPolicies).where(and(scopePredicate(ctx), eq(financialNormalizationPolicies.symbol, symbol.toUpperCase()))).orderBy(desc(financialNormalizationPolicies.updatedAt));
    if (policyRows.length === 0) return [];
    const policyIds = policyRows.map(row => row.id);
    const adjustmentRows = await tx.select().from(financialNormalizationAdjustments)
      .where(inArray(financialNormalizationAdjustments.policyId, policyIds))
      .orderBy(asc(financialNormalizationAdjustments.createdAt));
    return policyRows.map(policy => toPolicy(policy, adjustmentRows.filter(row => row.policyId === policy.id)));
  });
}

export async function upsertNormalizationPolicy(ctx: TenantContext, input: NormalizationPolicyInput): Promise<FinancialNormalizationPolicy> {
  const symbol = input.symbol.trim().toUpperCase();
  const label = input.label.trim() || `${symbol} Normalization Policy`;
  return withUserTransaction(ctx, async (tx) => {
    const existing = await tx.select().from(financialNormalizationPolicies).where(and(
      eq(financialNormalizationPolicies.ownerUserId, ctx.userId),
      eq(financialNormalizationPolicies.symbol, symbol),
    )).limit(1);
    const now = new Date();
    const policyValues = { organizationId: ctx.organizationId, ownerUserId: ctx.userId, symbol, label, updatedAt: now };
    const [policy] = existing[0]
      ? await tx.update(financialNormalizationPolicies).set(policyValues).where(eq(financialNormalizationPolicies.id, existing[0].id)).returning()
      : await tx.insert(financialNormalizationPolicies).values({ id: `fnp_${crypto.randomUUID().replace(/-/g, "")}`, ...policyValues, createdAt: now }).returning();

    for (const adjustment of input.adjustments) {
      const adjustmentLabel = adjustment.label.trim();
      const rationale = adjustment.rationale?.trim() || null;
      const source = adjustment.source?.trim() || null;
      const period = adjustment.period.trim();
      if (adjustment.id) {
        await tx.update(financialNormalizationAdjustments).set({
          label: adjustmentLabel, metricId: adjustment.metricId, kind: adjustment.kind, amount: adjustment.amount, period, rationale, source,
        }).where(and(eq(financialNormalizationAdjustments.id, adjustment.id), eq(financialNormalizationAdjustments.policyId, policy.id)));
      } else {
        await tx.insert(financialNormalizationAdjustments).values({
          id: `fna_${crypto.randomUUID().replace(/-/g, "")}`,
          policyId: policy.id, label: adjustmentLabel, metricId: adjustment.metricId, kind: adjustment.kind, amount: adjustment.amount, period, rationale, source, createdAt: now,
        });
      }
    }

    const adjustmentRows = await tx.select().from(financialNormalizationAdjustments).where(eq(financialNormalizationAdjustments.policyId, policy.id)).orderBy(asc(financialNormalizationAdjustments.createdAt));
    return toPolicy(policy, adjustmentRows);
  });
}

export async function deleteNormalizationAdjustment(ctx: TenantContext, id: string): Promise<boolean> {
  return withUserTransaction(ctx, async (tx) => {
    const [adjustment] = await tx.select({ policyId: financialNormalizationAdjustments.policyId }).from(financialNormalizationAdjustments).where(eq(financialNormalizationAdjustments.id, id)).limit(1);
    if (!adjustment) return false;
    const [policy] = await tx.select().from(financialNormalizationPolicies).where(and(scopePredicate(ctx), eq(financialNormalizationPolicies.id, adjustment.policyId))).limit(1);
    if (!policy) return false;
    const deleted = await tx.delete(financialNormalizationAdjustments).where(eq(financialNormalizationAdjustments.id, id)).returning();
    return deleted.length > 0;
  });
}
