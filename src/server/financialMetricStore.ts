import crypto from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { financialCustomMetrics, financialMetricOverrides } from "@shared/schema";
import type { FinancialMetricObservation, FinancialMetricUnit } from "@shared/financialMetricRegistry";
import { extractFinanceFormulaDependencies } from "@shared/financeFormula";
import { withUserTransaction } from "./tenantDb";
import type { TenantContext } from "./tenantContext";

export interface FinancialMetricOverrideInput {
  symbol: string;
  metricId: string;
  value: number;
  period: string;
  scenarioId?: string;
  asOf: string;
  publishedAt?: string;
  source: string;
  sourceUrl?: string;
  currency?: string;
  note?: string;
  confidence?: number;
  status?: "manual" | "imported";
}

function scopePredicate(ctx: TenantContext) {
  return ctx.organizationId === null
    ? eq(financialMetricOverrides.ownerUserId, ctx.userId)
    : or(eq(financialMetricOverrides.ownerUserId, ctx.userId), eq(financialMetricOverrides.organizationId, ctx.organizationId));
}

function toObservation(row: typeof financialMetricOverrides.$inferSelect): FinancialMetricObservation {
  return {
    metricId: row.metricId,
    value: row.value,
    status: row.status === "imported" ? "imported" : "manual",
    period: row.period,
    scenarioId: row.scenarioId ?? undefined,
    asOf: row.asOf,
    publishedAt: row.publishedAt ?? undefined,
    source: row.source,
    sourceUrl: row.sourceUrl ?? undefined,
    currency: row.currency ?? undefined,
    note: row.note ?? undefined,
    confidence: row.confidence ?? undefined,
    manualOverride: true,
  };
}

export async function listFinancialMetricOverrides(ctx: TenantContext, symbol: string): Promise<FinancialMetricObservation[]> {
  return withUserTransaction(ctx, async (tx) => {
    const rows = await tx.select().from(financialMetricOverrides).where(and(scopePredicate(ctx), eq(financialMetricOverrides.symbol, symbol.toUpperCase()))).orderBy(desc(financialMetricOverrides.updatedAt));
    return rows.map(toObservation);
  });
}

export async function upsertFinancialMetricOverride(ctx: TenantContext, input: FinancialMetricOverrideInput): Promise<FinancialMetricObservation> {
  const symbol = input.symbol.trim().toUpperCase();
  const period = input.period.trim() || "CURRENT";
  const scenarioId = input.scenarioId?.trim() || null;
  return withUserTransaction(ctx, async (tx) => {
    const existing = await tx.select().from(financialMetricOverrides).where(and(
      eq(financialMetricOverrides.ownerUserId, ctx.userId),
      eq(financialMetricOverrides.symbol, symbol),
      eq(financialMetricOverrides.metricId, input.metricId),
      eq(financialMetricOverrides.period, period),
      scenarioId === null ? isNull(financialMetricOverrides.scenarioId) : eq(financialMetricOverrides.scenarioId, scenarioId),
    )).limit(1);
    const now = new Date();
    const values = {
      organizationId: ctx.organizationId,
      ownerUserId: ctx.userId,
      symbol,
      metricId: input.metricId,
      value: input.value,
      status: input.status ?? "manual",
      period,
      scenarioId,
      asOf: input.asOf,
      publishedAt: input.publishedAt ?? null,
      source: input.source.trim(),
      sourceUrl: input.sourceUrl?.trim() || null,
      currency: input.currency?.trim() || null,
      note: input.note?.trim() || null,
      confidence: input.confidence ?? null,
      updatedAt: now,
    };
    const rows = existing[0]
      ? await tx.update(financialMetricOverrides).set(values).where(eq(financialMetricOverrides.id, existing[0].id)).returning()
      : await tx.insert(financialMetricOverrides).values({ id: `fmo_${crypto.randomUUID().replace(/-/g, "")}`, ...values, createdAt: now }).returning();
    return toObservation(rows[0]);
  });
}

export async function deleteFinancialMetricOverride(ctx: TenantContext, id: string): Promise<boolean> {
  return withUserTransaction(ctx, async (tx) => {
    const deleted = await tx.delete(financialMetricOverrides).where(and(scopePredicate(ctx), eq(financialMetricOverrides.id, id))).returning();
    return deleted.length > 0;
  });
}

export interface FinancialCustomMetricInput {
  id?: string;
  label: string;
  unit: FinancialMetricUnit;
  formula: string;
  description?: string;
}

function toCustomMetric(row: typeof financialCustomMetrics.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    unit: row.unit as FinancialMetricUnit,
    formula: row.formula,
    dependencies: row.dependencies,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listFinancialCustomMetrics(ctx: TenantContext) {
  return withUserTransaction(ctx, async (tx) => {
    const rows = await tx.select().from(financialCustomMetrics).where(scopePredicate(ctx)).orderBy(desc(financialCustomMetrics.updatedAt));
    return rows.map(toCustomMetric);
  });
}

export async function upsertFinancialCustomMetric(ctx: TenantContext, input: FinancialCustomMetricInput) {
  const label = input.label.trim();
  const formula = input.formula.trim();
  const dependencies = extractFinanceFormulaDependencies(formula);
  if (!label || !formula || dependencies.length === 0) throw new Error("A custom metric requires a label and a formula with at least one canonical dependency.");
  return withUserTransaction(ctx, async (tx) => {
    const id = input.id?.trim() || `fcm_${crypto.randomUUID().replace(/-/g, "")}`;
    const now = new Date();
    const existing = await tx.select().from(financialCustomMetrics).where(and(eq(financialCustomMetrics.ownerUserId, ctx.userId), eq(financialCustomMetrics.id, id))).limit(1);
    const values = { organizationId: ctx.organizationId, ownerUserId: ctx.userId, label, unit: input.unit, formula, dependencies, description: input.description?.trim() || null, updatedAt: now };
    const rows = existing[0]
      ? await tx.update(financialCustomMetrics).set(values).where(eq(financialCustomMetrics.id, id)).returning()
      : await tx.insert(financialCustomMetrics).values({ id, ...values, createdAt: now }).returning();
    return toCustomMetric(rows[0]);
  });
}

export async function deleteFinancialCustomMetric(ctx: TenantContext, id: string): Promise<boolean> {
  return withUserTransaction(ctx, async (tx) => {
    const deleted = await tx.delete(financialCustomMetrics).where(and(scopePredicate(ctx), eq(financialCustomMetrics.id, id))).returning();
    return deleted.length > 0;
  });
}
