import type { TenantContext } from "./tenantContext";
import { FINANCIAL_METRICS, searchFinancialMetrics } from "@shared/financialMetricRegistry";
import {
  semanticMetricDefinitionSchema,
  type SemanticMetricDefinition,
} from "@shared/universalDataFabric";
import {
  createSemanticMetricVersion,
  listSemanticMetricVersions,
} from "./universalDataFabricStore";

function builtInMetric(metric: (typeof FINANCIAL_METRICS)[number]): SemanticMetricDefinition {
  return semanticMetricDefinitionSchema.parse({
    schemaVersion: "1",
    metricId: metric.id,
    version: 1,
    name: metric.label,
    description: metric.description ?? metric.shortLabel ?? metric.label,
    category: metric.category,
    unit: metric.unit ?? null,
    aliases: metric.aliases ?? [],
    formula: metric.formula ?? null,
    sourcePolicy: {
      preferredCapabilities: ["statements"],
      preferredProviders: [],
      pointInTimeRequired: metric.category !== "estimates",
    },
    status: "active",
  });
}

export function listBuiltInSemanticMetrics(): SemanticMetricDefinition[] {
  return FINANCIAL_METRICS.map(builtInMetric);
}

export async function searchSemanticMetricCatalog(
  ctx: TenantContext,
  query: string,
  limit = 80,
): Promise<SemanticMetricDefinition[]> {
  const normalized = query.trim().toLowerCase();
  const customRows = await listSemanticMetricVersions(ctx);
  const latestCustom = new Map<string, SemanticMetricDefinition>();
  for (const row of customRows) {
    if (latestCustom.has(row.metricId)) continue;
    const metric = semanticMetricDefinitionSchema.parse({
      schemaVersion: "1",
      metricId: row.metricId,
      version: row.version,
      name: row.name,
      description: row.description,
      category: row.category,
      unit: row.unit,
      aliases: row.aliases,
      formula: row.formula,
      sourcePolicy: row.sourcePolicy,
      status: row.status,
    });
    latestCustom.set(metric.metricId, metric);
  }
  const builtIn = searchFinancialMetrics(query, limit).map(builtInMetric);
  const custom = [...latestCustom.values()].filter((metric) => !normalized || [metric.metricId, metric.name, metric.description, ...metric.aliases].join(" ").toLowerCase().includes(normalized));
  const merged = new Map<string, SemanticMetricDefinition>();
  for (const metric of [...custom, ...builtIn]) if (!merged.has(metric.metricId)) merged.set(metric.metricId, metric);
  return [...merged.values()].slice(0, Math.min(Math.max(limit, 1), 500));
}

export async function defineSemanticMetric(
  ctx: TenantContext,
  input: Omit<SemanticMetricDefinition, "version"> & { version?: number },
) {
  return createSemanticMetricVersion(ctx, input);
}
