import { FINANCIAL_METRICS, resolveFinancialMetric, type FinancialMetricDefinition, type FinancialMetricObservation, type FinancialMetricStatus } from "./financialMetricRegistry";

export type FinancialProvenanceIssueKind =
  | "missing-source"
  | "missing-period"
  | "missing-as-of"
  | "missing-currency"
  | "invalid-as-of"
  | "invalid-confidence";

export interface FinancialProvenanceIssue {
  kind: FinancialProvenanceIssueKind;
  metricId: string;
  period: string;
  status: FinancialMetricStatus;
  detail: string;
}

export interface FinancialObservationTrust {
  metricId: string;
  period: string;
  status: FinancialMetricStatus;
  complete: boolean;
  issues: FinancialProvenanceIssue[];
}

export interface FinancialReconciliationResult {
  metricId: string;
  period: string;
  scenarioId?: string;
  observations: FinancialMetricObservation[];
  selected: FinancialMetricObservation | null;
  conflict: boolean;
  relativeDelta: number | null;
  reason: string;
}

export interface FinancialCoverageBand {
  id: string;
  label: string;
  weight: number;
  applicable: number;
  resolvable: number;
  coveragePct: number;
}

export interface FinancialTrustReport {
  score: number;
  observations: number;
  valuedObservations: number;
  provenanceComplete: number;
  provenanceIssues: FinancialProvenanceIssue[];
  reconciliations: FinancialReconciliationResult[];
  conflictCount: number;
  missingCount: number;
  resolvableCount: number;
  totalMetricCount: number;
  weightedCoveragePct: number;
  coverageBands: FinancialCoverageBand[];
}

const COVERAGE_BANDS = [
  { id: "core", label: "Core data", weight: 35, categories: new Set(["market", "statement"]) },
  { id: "valuation", label: "Valuation", weight: 25, categories: new Set(["valuation"]) },
  { id: "risk", label: "Quality & risk", weight: 20, categories: new Set(["credit", "leverage", "coverage", "liquidity", "efficiency", "cash-quality", "returns"]) },
  { id: "estimates", label: "Estimates", weight: 10, categories: new Set(["estimates"]) },
  { id: "sector", label: "Sector KPIs", weight: 5, categories: new Set(["sector-kpi"]) },
  { id: "other", label: "Other finance", weight: 5, categories: new Set(["growth", "margin", "capital-allocation", "derivatives", "portfolio", "ownership", "fixed-income"]) },
] as const;

function coverageBandFor(metric: FinancialMetricDefinition): (typeof COVERAGE_BANDS)[number] {
  return COVERAGE_BANDS.find(band => band.categories.has(metric.category)) ?? COVERAGE_BANDS[COVERAGE_BANDS.length - 1];
}

function buildCoverageBands(
  observations: readonly FinancialMetricObservation[],
  metricDefinitions: readonly FinancialMetricDefinition[],
  sector?: string,
): { bands: FinancialCoverageBand[]; weightedCoveragePct: number } {
  const applicable = metricDefinitions.filter(metric => !metric.sectors?.length || !sector || metric.sectors.some(value => sector.toLowerCase().includes(value.toLowerCase())));
  const bands = COVERAGE_BANDS.map(band => {
    const metrics = applicable.filter(metric => coverageBandFor(metric).id === band.id);
    const resolvable = metrics.filter(metric => resolveFinancialMetric(metric.id, observations)?.value !== null).length;
    return { id: band.id, label: band.label, weight: band.weight, applicable: metrics.length, resolvable, coveragePct: metrics.length ? Math.round((resolvable / metrics.length) * 100) : 100 };
  });
  const weightedCoveragePct = Math.round(bands.reduce((sum, band) => sum + (band.coveragePct * band.weight), 0) / 100);
  return { bands, weightedCoveragePct };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T|$)/;
const STATUS_PRIORITY: Record<FinancialMetricStatus, number> = {
  manual: 100, imported: 90, filed: 80, live: 75, estimate: 70, derived: 50,
  conflict: 40, stale: 20, missing: 0, "not-applicable": -1,
};

function periodOf(observation: FinancialMetricObservation): string { return observation.period?.trim() || "CURRENT"; }
function groupKey(observation: FinancialMetricObservation): string {
  return `${observation.metricId}|${periodOf(observation)}|${observation.scenarioId ?? "BASE"}`;
}
function requiresCurrency(definition: FinancialMetricDefinition | null): boolean {
  return definition?.unit === "currency" || definition?.unit === "currency-per-share";
}

export function assessFinancialObservationTrust(
  observation: FinancialMetricObservation,
  definition: FinancialMetricDefinition | null = null,
): FinancialObservationTrust {
  const metricId = observation.metricId;
  const period = periodOf(observation);
  const issues: FinancialProvenanceIssue[] = [];
  const add = (kind: FinancialProvenanceIssueKind, detail: string) => issues.push({ kind, metricId, period, status: observation.status, detail });

  if (observation.status !== "missing" && observation.status !== "not-applicable" && !observation.source?.trim()) {
    add("missing-source", "A valued observation must identify its source or calculation lineage.");
  }
  if (observation.status !== "missing" && observation.status !== "not-applicable" && !observation.period?.trim()) {
    add("missing-period", "A valued observation must identify its reporting or valuation period.");
  }
  if (["live", "filed", "estimate", "stale", "conflict", "manual", "imported"].includes(observation.status)) {
    if (!observation.asOf?.trim()) add("missing-as-of", "Source-backed and manual observations require an as-of timestamp.");
    else if (!ISO_DATE.test(observation.asOf)) add("invalid-as-of", "The as-of value must begin with an ISO date.");
  }
  if (requiresCurrency(definition) && observation.status !== "missing" && observation.status !== "not-applicable" && !observation.currency?.trim()) {
    add("missing-currency", "Currency-denominated values require an explicit currency.");
  }
  if (observation.confidence !== undefined && (!finite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1)) {
    add("invalid-confidence", "Confidence must be a finite value between 0 and 1.");
  }
  return { metricId, period, status: observation.status, complete: issues.length === 0, issues };
}

function chooseObservation(observations: readonly FinancialMetricObservation[]): FinancialMetricObservation | null {
  return [...observations]
    .filter(item => item.value !== null || item.status === "not-applicable")
    .sort((a, b) => STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status] || (b.asOf ?? "").localeCompare(a.asOf ?? ""))[0] ?? null;
}

export function reconcileFinancialObservations(
  observations: readonly FinancialMetricObservation[],
  tolerance = 0.005,
): FinancialReconciliationResult[] {
  const groups = new Map<string, FinancialMetricObservation[]>();
  for (const observation of observations) {
    if (observation.status === "missing" || observation.status === "not-applicable") continue;
    const key = groupKey(observation);
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  return Array.from(groups.entries()).map(([key, items]) => {
    const [metricId, period, scenarioId] = key.split("|");
    const valued = items.filter(item => finite(item.value));
    const values = valued.map(item => item.value as number);
    const minimum = values.length ? Math.min(...values) : null;
    const maximum = values.length ? Math.max(...values) : null;
    const relativeDelta = minimum !== null && maximum !== null ? Math.abs(maximum - minimum) / Math.max(1, Math.abs(minimum), Math.abs(maximum)) : null;
    const conflict = relativeDelta !== null && relativeDelta > tolerance;
    return {
      metricId,
      period,
      scenarioId: scenarioId === "BASE" ? undefined : scenarioId,
      observations: items,
      selected: chooseObservation(items),
      conflict,
      relativeDelta,
      reason: conflict ? `Values differ by ${(relativeDelta! * 100).toFixed(2)}%, exceeding ${(tolerance * 100).toFixed(2)}% tolerance.` : items.length > 1 ? "Observations reconcile within policy tolerance." : "Single observation; no cross-source comparison available.",
    };
  }).sort((a, b) => Number(b.conflict) - Number(a.conflict) || a.metricId.localeCompare(b.metricId));
}

export function buildFinancialTrustReport(
  observations: readonly FinancialMetricObservation[],
  metricDefinitions: readonly FinancialMetricDefinition[] = FINANCIAL_METRICS,
  sector?: string,
): FinancialTrustReport {
  const provenance = observations.flatMap(observation => {
    const definition = metricDefinitions.find(metric => metric.id === observation.metricId) ?? null;
    return assessFinancialObservationTrust(observation, definition);
  });
  const provenanceIssues = provenance.flatMap(item => item.issues);
  const reconciliations = reconcileFinancialObservations(observations);
  const valuedObservations = observations.filter(item => finite(item.value));
  const missingCount = metricDefinitions.filter(metric => resolveFinancialMetric(metric.id, observations)?.value === null).length;
  const resolvableCount = metricDefinitions.length - missingCount;
  const conflictCount = reconciliations.filter(item => item.conflict).length;
  const provenanceComplete = provenance.filter(item => item.complete).length;
  const coverage = buildCoverageBands(observations, metricDefinitions, sector);
  const valuedCount = Math.max(1, valuedObservations.length);
  const provenancePenalty = Math.round((provenanceIssues.length / valuedCount) * 35);
  const conflictPenalty = Math.min(35, conflictCount * 12);
  const coverageScore = Math.round((coverage.weightedCoveragePct / 100) * 30);
  const score = Math.max(0, Math.min(100, 35 + coverageScore + Math.max(0, 35 - provenancePenalty) - conflictPenalty));
  return {
    score,
    observations: observations.length,
    valuedObservations: valuedObservations.length,
    provenanceComplete,
    provenanceIssues,
    reconciliations,
    conflictCount,
    missingCount,
    resolvableCount,
    totalMetricCount: metricDefinitions.length,
    weightedCoveragePct: coverage.weightedCoveragePct,
    coverageBands: coverage.bands,
  };
}

export function financialTrustLabel(report: Pick<FinancialTrustReport, "score" | "conflictCount" | "provenanceIssues">): "TRUSTED" | "REVIEW" | "BLOCKED" {
  if (report.conflictCount > 0) return "BLOCKED";
  if (report.score >= 80 && report.provenanceIssues.length === 0) return "TRUSTED";
  return "REVIEW";
}
