import type { FinancialMetricDefinition, FinancialMetricObservation, ResolvedFinancialMetric } from "./financialMetricRegistry";

export interface FinancialObjectRef {
  id: string;
  symbol: string;
  metricId: string;
  period: string;
  scenarioId?: string;
}

export interface FinancialObject extends FinancialObjectRef {
  kind: "financial-metric";
  label: string;
  value: number | null;
  status: ResolvedFinancialMetric["status"];
  unit: FinancialMetricDefinition["unit"];
  category: FinancialMetricDefinition["category"];
  currency?: string;
  asOf?: string;
  source?: string;
  formula?: string;
  dependencies: FinancialObjectRef[];
  missingDependencies: string[];
  note?: string;
  createdAt: string;
}

export function financialObjectId(input: { symbol: string; metricId: string; period?: string; scenarioId?: string }): string {
  return ["fin", input.symbol.trim().toUpperCase(), input.metricId, input.period ?? "CURRENT", input.scenarioId ?? "BASE"].join(":");
}

export function createFinancialObject(symbol: string, resolved: ResolvedFinancialMetric): FinancialObject {
  const period = resolved.period ?? "CURRENT";
  return {
    id: financialObjectId({ symbol, metricId: resolved.metricId, period, scenarioId: resolved.scenarioId }),
    kind: "financial-metric",
    symbol: symbol.trim().toUpperCase(),
    metricId: resolved.metricId,
    period,
    scenarioId: resolved.scenarioId,
    label: resolved.definition.label,
    value: resolved.value,
    status: resolved.status,
    unit: resolved.definition.unit,
    category: resolved.definition.category,
    currency: resolved.currency,
    asOf: resolved.asOf,
    source: resolved.source,
    formula: resolved.formula,
    dependencies: resolved.trace.map(input => ({
      id: financialObjectId({ symbol, metricId: input.metricId, period, scenarioId: resolved.scenarioId }),
      symbol: symbol.trim().toUpperCase(),
      metricId: input.metricId,
      period,
      scenarioId: resolved.scenarioId,
    })),
    missingDependencies: resolved.missingDependencies,
    note: resolved.note,
    createdAt: new Date().toISOString(),
  };
}

export interface FinancialObjectCollection {
  symbol: string;
  objects: FinancialObject[];
  observations: FinancialMetricObservation[];
  createdAt: string;
}

export function createFinancialObjectCollection(symbol: string, resolved: readonly ResolvedFinancialMetric[], observations: readonly FinancialMetricObservation[]): FinancialObjectCollection {
  return {
    symbol: symbol.trim().toUpperCase(),
    objects: resolved.map(item => createFinancialObject(symbol, item)),
    observations: observations.slice(),
    createdAt: new Date().toISOString(),
  };
}
