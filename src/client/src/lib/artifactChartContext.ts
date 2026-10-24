import type { ArtifactContent } from "@shared/artifactContracts";
type ChartContent = Extract<ArtifactContent, { kind: "chart" }>;

export interface ChartRecordedContext {
  xLabel: string;
  yLabel: string;
  xUnit: string | null;
  yUnit: string | null;
  period: string | null;
  evidenceRefs: string[];
  totalRecordedSourceRefs: number;
  sourceBasis: "artifact_version" | "chart_options" | "none";
}

/**
 * Descriptive fields are copied only from explicitly recorded chart options.
 * The Artifact chart schema does not require units, dates or sources. Never
 * infer currencies, frequency, annualization or trusted provenance from x/y.
 * Options are user/Artifact-supplied metadata, not independent verification.
 */
export function chartRecordedContext(chart: ChartContent, versionSourceRefs?: readonly string[]): ChartRecordedContext {
  const options = chart.options;
  function label(key: string, max = 100): string | null {
    const value = options[key];
    if (typeof value !== "string") return null;
    const compact = value.trim().replace(/\s+/g, " ");
    if (!compact || compact.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
    return compact;
  }
  // The authenticated P4 saved Artifact *version* is the authoritative
  // source-reference inventory for the normal ArtifactPane. Chart options
  // are only a display-level fallback for read-only derived charts without
  // version metadata; never blend the two scopes or infer validation.
  const sourceRefs = versionSourceRefs ?? options.sourceRefs;
  const recorded = Array.isArray(sourceRefs)
    && sourceRefs.every(v => typeof v === "string" && v.trim().length > 0 && v.length <= 1_000)
    ? [...new Set(sourceRefs as string[])] : [];
  const evidenceRefs = recorded.slice(0, 100); // bounded DOM, not a bounded source count
  return {
    xLabel: label("xAxisLabel") ?? "X (label not recorded)",
    yLabel: label("yAxisLabel") ?? "Y (label not recorded)",
    xUnit: label("xUnit"),
    yUnit: label("yUnit"),
    period: label("periodLabel", 200),
    evidenceRefs,
    totalRecordedSourceRefs: recorded.length,
    sourceBasis: versionSourceRefs !== undefined ? "artifact_version" : evidenceRefs.length ? "chart_options" : "none",
  };
}

/** Preserve the exact numeric representation without rounding or imputation. */
export function exactChartValue(value: number | string): string {
  return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value);
}

export function chartSourceCaveat(context: ChartRecordedContext): string {
  const missing = [
    ...(!context.xUnit ? ["X unit"] : []),
    ...(!context.yUnit ? ["Y unit"] : []),
    ...(!context.period ? ["period"] : []),
    ...(!context.totalRecordedSourceRefs ? ["source references"] : []),
  ];
  return missing.length
    ? `Not recorded in the displayed chart or saved version: ${missing.join(", ")}. Values shown are saved Artifact observations, not independently verified data.`
    : "Labels, period, units and source references are recorded claims only; this view has not independently verified provider access, freshness or source identity.";
}
