import type { FinancialMetricObservation } from "./financialMetricRegistry";

export type NormalizationAdjustmentKind =
  | "add-back"
  | "subtract"
  | "reclassify"
  | "exclude"
  | "replace";

export interface FinancialNormalizationAdjustment {
  id: string;
  label: string;
  metricId: string;
  kind: NormalizationAdjustmentKind;
  amount: number;
  period: string;
  rationale?: string;
  source?: string;
  createdAt: string;
}

export interface FinancialNormalizationPolicy {
  id: string;
  label: string;
  adjustments: FinancialNormalizationAdjustment[];
}

export interface NormalizedMetricResult {
  metricId: string;
  period: string;
  reportedValue: number | null;
  normalizedValue: number | null;
  reportedSource?: string;
  reportedAsOf?: string;
  reportedPublishedAt?: string;
  reportedCurrency?: string;
  reportedScenarioId?: string;
  adjustments: FinancialNormalizationAdjustment[];
}
export const NORMALIZATION_LIBRARY: readonly { id: string; label: string; suggestedKind: NormalizationAdjustmentKind; description: string }[] = [
  { id: "stock-based-compensation", label: "Stock-Based Compensation", suggestedKind: "add-back", description: "Analyst-selected treatment of SBC; never automatically excluded from economic cost." },
  { id: "restructuring", label: "Restructuring Charges", suggestedKind: "add-back", description: "Potentially non-recurring restructuring costs, subject to recurrence review." },
  { id: "acquisition-costs", label: "Acquisition / Integration Costs", suggestedKind: "add-back", description: "Deal-related costs when the analyst determines they are non-core." },
  { id: "asset-impairment", label: "Asset Impairments", suggestedKind: "add-back", description: "Non-cash impairment adjustments with explicit rationale." },
  { id: "litigation", label: "Litigation / Regulatory Charges", suggestedKind: "add-back", description: "Exceptional legal charges only when analyst-classified as non-recurring." },
  { id: "asset-sale", label: "Gain / Loss on Asset Sale", suggestedKind: "subtract", description: "Remove non-operating disposal gains or losses from normalized earnings." },
  { id: "one-time-tax", label: "One-Time Tax Item", suggestedKind: "replace", description: "Replace unusual tax impacts with analyst-normalized tax assumptions." },
  { id: "pension", label: "Pension Adjustment", suggestedKind: "reclassify", description: "Separate operating service cost from financing components where appropriate." },
  { id: "lease", label: "Operating Lease Adjustment", suggestedKind: "reclassify", description: "Reclassify lease expense/capital structure consistently across comparables." },
  { id: "capitalized-rd", label: "Capitalized R&D", suggestedKind: "reclassify", description: "Analyst capitalization/amortization treatment for long-lived R&D investment." },
  { id: "capitalized-software", label: "Capitalized Software", suggestedKind: "reclassify", description: "Normalize software development capitalization policy across peers." },
  { id: "exceptional-item", label: "Other Exceptional Item", suggestedKind: "exclude", description: "Explicit user-defined exceptional item; requires rationale." },
];

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

export function normalizeFinancialMetric(
  metricId: string,
  period: string,
  observations: readonly FinancialMetricObservation[],
  policy: FinancialNormalizationPolicy,
): NormalizedMetricResult {
  const candidates = observations.filter(item => item.metricId === metricId && (item.period ?? "CURRENT") === period && finite(item.value));
  const manual = candidates.find(item => item.status === "manual");
  const reported = manual ?? candidates.find(item => item.status === "filed") ?? candidates.find(item => item.status === "live") ?? candidates[0];
  const reportedValue = reported?.value ?? null;
  const adjustments = policy.adjustments.filter(item => item.metricId === metricId && item.period === period);
  let normalizedValue = reportedValue;

  for (const adjustment of adjustments) {
    if (!finite(normalizedValue)) break;
    if (adjustment.kind === "add-back") normalizedValue += adjustment.amount;
    else if (adjustment.kind === "subtract" || adjustment.kind === "exclude") normalizedValue -= adjustment.amount;
    else if (adjustment.kind === "replace") normalizedValue = adjustment.amount;
    // Reclassifications are represented in lineage but do not change the selected metric unless paired with another adjustment.
  }

  return {
    metricId,
    period,
    reportedValue,
    normalizedValue,
    reportedSource: reported?.source,
    reportedAsOf: reported?.asOf,
    reportedPublishedAt: reported?.publishedAt,
    reportedCurrency: reported?.currency,
    reportedScenarioId: reported?.scenarioId,
    adjustments,
  };
}

export function normalizedObservation(result: NormalizedMetricResult, policy: FinancialNormalizationPolicy): FinancialMetricObservation | null {
  if (!finite(result.normalizedValue)) return null;
  return {
    metricId: result.metricId,
    value: result.normalizedValue,
    status: "manual",
    period: result.period,
    asOf: result.reportedAsOf,
    publishedAt: result.reportedPublishedAt,
    currency: result.reportedCurrency,
    scenarioId: result.reportedScenarioId,
    source: `Normalization policy: ${policy.label}`,
    note: `${result.adjustments.length} explicit analyst adjustment(s); reported value preserved in normalization lineage${result.reportedSource ? ` from ${result.reportedSource}` : ""}.`,
    manualOverride: true,
  };
}
