import type { TrustManifest } from "@shared/trustContracts";

export interface TrustDisclosure {
  summary: string;
  /** Short, material limitations that must remain visible without expanding Show work. */
  visibleLimitations: string[];
  additionalLimitationCount: number;
}

/** View-only projection of the canonical P3 manifest; never promotes a score to verification. */
export function projectTrustDisclosure(manifest: TrustManifest): TrustDisclosure {
  const { summary, warnings } = manifest;
  const sourceLabel = summary.sourceCount === 1 ? "recorded source" : "recorded sources";
  const freshnessLabel = summary.freshness === "ai_generated" ? "AI-generated evidence" : `${summary.freshness.replaceAll("_", " ")} evidence`;
  const conciseSummary = `${summary.sourceCount} ${sourceLabel} · ${freshnessLabel}`;
  const limitations: string[] = [];
  // Warnings arrive with the canonical manifest and can be safety/rights material.
  // Preserve their actual wording, never imply they are a successful source check.
  for (const warning of warnings) {
    if (!limitations.includes(warning)) limitations.push(warning);
  }
  const restricted = manifest.evidence.filter((item) => item.access?.entitlementRequired === true).length;
  if (restricted) limitations.push(`${restricted} recorded source${restricted === 1 ? "" : "s"} require additional access or entitlement. Review the source details.`);
  const unsupported = manifest.claims.filter((item) => item.status === "unsupported" || item.status === "conflicted").length;
  if (unsupported) limitations.push(`${unsupported} claim${unsupported === 1 ? "" : "s"} lack support or contain conflicting evidence.`);
  if (summary.sourceCount === 0) limitations.push("No source references are recorded for this result.");
  if (summary.freshness === "delayed") limitations.push("Some recorded evidence is delayed. Check its as-of dates.");
  if (summary.freshness === "unknown") limitations.push("Source freshness has not been established.");
  if (summary.freshness === "ai_generated") limitations.push("AI-generated content is not independently observed source data.");
  if (summary.quality === "low" || summary.quality === "unknown") {
    limitations.push(summary.quality === "low" ? "Recorded evidence quality is low." : "Recorded evidence quality is unknown.");
  }
  if (summary.confidence === "low" || summary.confidence === "unknown") {
    limitations.push(summary.confidence === "low" ? "Reported confidence is low." : "Reported confidence is unknown.");
  }
  if (summary.conflictState === "material" || summary.conflictState === "minor") {
    limitations.push(summary.conflictState === "material" ? "Material source disagreements are recorded." : "Source disagreements are recorded.");
  } else if (summary.conflictState === "not_evaluated_single_source") {
    limitations.push("Cross-source agreement has not been checked.");
  }
  if (summary.missingCount > 0) {
    limitations.push(`${summary.missingCount} missing input${summary.missingCount === 1 ? "" : "s"} recorded; review the gaps and recovery actions.`);
  }
  return {
    summary: conciseSummary,
    visibleLimitations: limitations.slice(0, 5),
    additionalLimitationCount: Math.max(0, limitations.length - 5),
  };
}
