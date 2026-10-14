import type { ArtifactSemanticComparison } from "@shared/artifactSemanticDiffContracts";

/** Compact, source-safe user-facing summary of P4's recorded semantic diff.
 * This is a renderer only: no FX conversion, inference, re-pricing or rights decisions.
 */
export function semanticArtifactComparisonLabel(
  semantic: ArtifactSemanticComparison | null | undefined,
): string {
  if (!semantic) return "";
  const comparable = semantic.numericDeltas.filter(delta => delta.comparable).length;
  const currency = new Set(semantic.comparability.filter(
    f => f.kind === "currency" && f.path !== null,
  ).map(f => f.path));
  const period = new Set(semantic.comparability.filter(
    f => f.kind === "period" && f.path !== null,
  ).map(f => f.path));
  const qualifiers = [
    currency.size ? `currency basis unverified or different for ${currency.size} field${currency.size === 1 ? "" : "s"}` : "",
    period.size ? `accounting period unverified or different for ${period.size} field${period.size === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const suffix = qualifiers.length
    ? ` · Not like-for-like: ${qualifiers.join("; ")}; no change % computed for affected values`
    : "";
  return `Semantic: ${comparable} comparable numeric change${comparable === 1 ? "" : "s"}${suffix}`;
}
