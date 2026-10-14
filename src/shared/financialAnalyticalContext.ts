import { buildFinancialDataCube } from "./financialDataCube";
import { auditFinancialDataQuality, type FinancialQualityReport } from "./financialDataQuality";
import { resolveInstitutionalFinancialMetric } from "./institutionalFinancialResolver";
import type { FinancialMetricObservation, ResolvedFinancialMetric } from "./financialMetricRegistry";
import { FINANCIAL_METRICS } from "./financialMetricRegistry";
import { buildFinancialTrustReport, type FinancialTrustReport } from "./financialTrust";
import { rankValuationMethods, type ValuationMethodReadiness } from "./valuationModelReadiness";

export interface FinancialAnalyticalContext {
  symbol: string;
  observations: FinancialMetricObservation[];
  metrics: Record<string, ResolvedFinancialMetric | null>;
  periods: string[];
  scenarios: string[];
  trust: FinancialTrustReport;
  quality: FinancialQualityReport;
  valuationReadiness: ValuationMethodReadiness[];
}

export function buildFinancialAnalyticalContext(input: {
  symbol: string;
  observations: readonly FinancialMetricObservation[];
  metricIds?: readonly string[];
  sector?: string;
  periods?: readonly string[];
  scenarios?: readonly string[];
}): FinancialAnalyticalContext {
  const symbol = input.symbol.trim().toUpperCase();
  const observations = [...input.observations];
  const metricIds = input.metricIds?.length ? [...new Set(input.metricIds)] : FINANCIAL_METRICS.map(metric => metric.id);
  const cube = buildFinancialDataCube({ symbol, observations, metricIds, periods: input.periods, scenarioIds: input.scenarios });
  const metrics = Object.fromEntries(metricIds.map(metricId => [metricId, resolveInstitutionalFinancialMetric(metricId, observations)]));
  return {
    symbol,
    observations,
    metrics,
    periods: cube.periods,
    scenarios: cube.scenarios,
    trust: buildFinancialTrustReport(observations, FINANCIAL_METRICS, input.sector),
    quality: auditFinancialDataQuality(observations),
    valuationReadiness: rankValuationMethods(observations, input.sector ?? ""),
  };
}

export function contextMetric(context: FinancialAnalyticalContext, metricId: string): ResolvedFinancialMetric | null {
  return context.metrics[metricId] ?? resolveInstitutionalFinancialMetric(metricId, context.observations);
}
