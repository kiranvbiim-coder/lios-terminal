import { resolveFinancialMetric, type FinancialMetricObservation } from "./financialMetricRegistry";

export type FinancialScreenOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "not-missing" | "missing";

export interface FinancialScreenCondition {
  metricId: string;
  operator: FinancialScreenOperator;
  value?: number;
  upperValue?: number;
  period?: string;
  scenarioId?: string;
}

export interface FinancialScreenEntity {
  symbol: string;
  observations: FinancialMetricObservation[];
}

export interface FinancialScreenMatch {
  symbol: string;
  pass: boolean;
  conditions: Array<{
    condition: FinancialScreenCondition;
    value: number | null;
    pass: boolean;
    status?: string;
  }>;
}

function compare(value: number | null, condition: FinancialScreenCondition): boolean {
  if (condition.operator === "missing") return value === null;
  if (condition.operator === "not-missing") return value !== null;
  if (value === null || !Number.isFinite(value)) return false;
  const target = condition.value;
  if (target === undefined || !Number.isFinite(target)) return false;
  if (condition.operator === "gt") return value > target;
  if (condition.operator === "gte") return value >= target;
  if (condition.operator === "lt") return value < target;
  if (condition.operator === "lte") return value <= target;
  if (condition.operator === "eq") return value === target;
  if (condition.operator === "neq") return value !== target;
  if (condition.operator === "between") return condition.upperValue !== undefined && value >= target && value <= condition.upperValue;
  return false;
}

export function evaluateFinancialScreen(entity: FinancialScreenEntity, conditions: readonly FinancialScreenCondition[], mode: "all" | "any" = "all"): FinancialScreenMatch {
  const rows = conditions.map(condition => {
    const resolved = resolveFinancialMetric(condition.metricId, entity.observations, { period: condition.period, scenarioId: condition.scenarioId });
    const value = resolved?.value ?? null;
    return { condition, value, pass: compare(value, condition), status: resolved?.status };
  });
  return { symbol: entity.symbol.toUpperCase(), pass: mode === "all" ? rows.every(row => row.pass) : rows.some(row => row.pass), conditions: rows };
}

export function runFinancialScreen(entities: readonly FinancialScreenEntity[], conditions: readonly FinancialScreenCondition[], mode: "all" | "any" = "all"): FinancialScreenMatch[] {
  return entities.map(entity => evaluateFinancialScreen(entity, conditions, mode)).filter(result => result.pass);
}

export const INSTITUTIONAL_SCREEN_PRESETS: readonly { id: string; label: string; conditions: FinancialScreenCondition[]; description: string }[] = [
  { id: "quality-value", label: "Quality at a Reasonable Price", description: "High returns, positive FCF yield and moderate leverage.", conditions: [{ metricId: "roic", operator: "gte", value: 0.15 }, { metricId: "fcfYield", operator: "gte", value: 0.04 }, { metricId: "netDebtEbitda", operator: "lte", value: 2.5 }] },
  { id: "deep-value", label: "Deep Value", description: "Low enterprise multiple with positive cash generation.", conditions: [{ metricId: "evEbitda", operator: "lte", value: 8 }, { metricId: "fcfYield", operator: "gte", value: 0.06 }] },
  { id: "compounder", label: "Compounder", description: "Strong returns, growth and cash conversion.", conditions: [{ metricId: "roic", operator: "gte", value: 0.18 }, { metricId: "revenueGrowth", operator: "gte", value: 0.08 }, { metricId: "fcfConversion", operator: "gte", value: 0.8 }] },
  { id: "balance-sheet", label: "Balance-Sheet Strength", description: "Low leverage and ample interest coverage.", conditions: [{ metricId: "netDebtEbitda", operator: "lte", value: 1.5 }, { metricId: "interestCoverage", operator: "gte", value: 5 }] },
  { id: "revision-momentum", label: "Estimate Revision Momentum", description: "Positive near-term analyst revisions.", conditions: [{ metricId: "estimateRevision30d", operator: "gt", value: 0 }, { metricId: "estimateRevision90d", operator: "gt", value: 0 }] },
];
