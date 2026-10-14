import {
  getFinancialMetricDefinition,
  resolveFinancialMetric,
  type FinancialMetricDefinition,
  type FinancialMetricObservation,
  type ResolvedFinancialMetric,
} from "./financialMetricRegistry";

export type MissingFinanceActionKind =
  | "enter-direct"
  | "enter-input"
  | "import-statement"
  | "connect-provider"
  | "define-formula"
  | "mark-not-applicable";

export interface MissingFinanceAction {
  kind: MissingFinanceActionKind;
  label: string;
  metricId?: string;
  description: string;
  priority: number;
}

export interface FinancialMetricResolutionPlan {
  metric: FinancialMetricDefinition;
  resolved: ResolvedFinancialMetric;
  missing: Array<{ metricId: string; label: string; definition: FinancialMetricDefinition | null }>;
  actions: MissingFinanceAction[];
  canDeriveAfterInputs: boolean;
}

export function buildFinancialMetricResolutionPlan(
  idOrAlias: string,
  observations: readonly FinancialMetricObservation[],
  options: { period?: string; scenarioId?: string } = {},
): FinancialMetricResolutionPlan | null {
  const metric = getFinancialMetricDefinition(idOrAlias);
  const resolved = resolveFinancialMetric(idOrAlias, observations, options);
  if (!metric || !resolved) return null;

  const missingIds = resolved.missingDependencies.length
    ? resolved.missingDependencies
    : resolved.status === "missing" ? [metric.id] : [];
  const missing = [...new Set(missingIds)].map(metricId => {
    const definition = getFinancialMetricDefinition(metricId);
    return { metricId, label: definition?.label ?? metricId, definition };
  });

  const actions: MissingFinanceAction[] = [];
  if (resolved.status === "missing") {
    actions.push({ kind: "enter-direct", metricId: metric.id, label: `ENTER ${metric.shortLabel ?? metric.label} DIRECTLY`, description: "Store an explicit analyst-supplied value with source, date, period and note.", priority: 100 });
    for (const item of missing) {
      if (item.metricId !== metric.id) actions.push({ kind: "enter-input", metricId: item.metricId, label: `ENTER ${item.label.toUpperCase()}`, description: `Provide the missing input required to derive ${metric.label}.`, priority: 90 });
    }
    if (metric.category === "statement" || missing.some(item => item.definition?.category === "statement")) {
      actions.push({ kind: "import-statement", label: "IMPORT FINANCIAL STATEMENT", description: "Map CSV/XLSX/PDF-derived statement values into the canonical financial schema.", priority: 80 });
    }
    actions.push({ kind: "connect-provider", label: "FETCH / CONNECT DATA SOURCE", description: "Try an enabled provider before accepting a manual value.", priority: 70 });
    actions.push({ kind: "define-formula", metricId: metric.id, label: "DEFINE CUSTOM FORMULA", description: "Create an analyst-defined metric using the deterministic V6 formula engine.", priority: 50 });
    actions.push({ kind: "mark-not-applicable", metricId: metric.id, label: "MARK N/A", description: "Explicitly record that this metric is not applicable instead of leaving an unexplained blank.", priority: 20 });
  }

  return {
    metric,
    resolved,
    missing,
    actions: actions.sort((a, b) => b.priority - a.priority),
    canDeriveAfterInputs: Boolean(metric.calculate || metric.formula) && missing.some(item => item.metricId !== metric.id),
  };
}
