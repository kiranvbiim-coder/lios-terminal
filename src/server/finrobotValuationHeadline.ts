/**
 * FinRobot pinned summary_extractor.py target-headline trust rule, adapted for
 * the canonical LiOS P4 immutable valuation Artifact. Apache-2.0.
 *
 * AI4Finance-Foundation/FinRobot@2717499b8e30f242640af08c4ad9afd1113c2d45
 * finrobot_desktop/finrobot/artifact/summary_extractor.py
 *
 * Only reading already-saved values: NO donor API, report builder, provider,
 * model execution, recommendation, target-date inference or valuation math.
 */
import { z } from "zod";
import type { ArtifactContent } from "@shared/artifactContracts";

export const recordedValuationHeadlineSchema = z.object({
  status: z.enum(["recorded_unverified", "withheld", "unavailable", "not_valuation"]),
  targetPrice: z.number().finite().positive().nullable(),
  sourcePath: z.enum([
    "outputs.thesis.price_target",
    "outputs.thesis.target_price",
    "outputs.implied_price",
    "outputs.target_price",
    "outputs.equity_value_per_share",
    "outputs.structured.thesis.price_target",
    "outputs.structured.thesis.target_price",
    "outputs.structured.implied_price",
    "outputs.structured.target_price",
    "outputs.structured.equity_value_per_share",
  ]).nullable(),
  reason: z.enum(["explicit_withhold", "authoritative_thesis_without_target", "missing_or_invalid_target", "not_valuation", "recorded_target"]),
  verifiedMarketData: z.literal(false),
  recalculatedValue: z.literal(false),
  investmentRecommendation: z.literal(false),
}).strict();
export type RecordedValuationHeadline = z.infer<typeof recordedValuationHeadlineSchema>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function price(value: unknown): number | null {
  // Do not coerce number-looking text, infinities, zero or negative prices.
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function inspectRecordedValuationHeadline(content: ArtifactContent): RecordedValuationHeadline {
  const response = (status: RecordedValuationHeadline["status"], reason: RecordedValuationHeadline["reason"],
    targetPrice: number | null = null, sourcePath: RecordedValuationHeadline["sourcePath"] = null,
  ): RecordedValuationHeadline => recordedValuationHeadlineSchema.parse({
    status, targetPrice, sourcePath, reason,
    verifiedMarketData: false, recalculatedValue: false, investmentRecommendation: false,
  });

  if (content.kind !== "valuation") return response("not_valuation", "not_valuation");
  const outputs = content.outputs;
  const nested = Object.prototype.hasOwnProperty.call(outputs, "structured");
  const data = nested ? record(outputs.structured) : outputs;
  if (!data) return response("unavailable", "missing_or_invalid_target");

  // An explicit gate cannot be bypassed by a historical raw DCF result.
  // A malformed/ambiguous gate is also not affirmative clearance.
  for (const flags of [outputs, data]) {
    if (Object.prototype.hasOwnProperty.call(flags, "valuation_withheld")
      && flags.valuation_withheld !== false) return response("withheld", "explicit_withhold");
  }

  const stem = nested ? "outputs.structured." : "outputs.";
  if (Object.prototype.hasOwnProperty.call(data, "thesis")) {
    const thesis = record(data.thesis);
    if (!thesis) return response("withheld", "authoritative_thesis_without_target");
    for (const key of ["price_target", "target_price"] as const) {
      const target = price(thesis[key]);
      if (target !== null) return response("recorded_unverified", "recorded_target", target,
        (stem + "thesis." + key) as RecordedValuationHeadline["sourcePath"]);
    }
    return response("withheld", "authoritative_thesis_without_target");
  }
  // This flat fallback is allowed ONLY when there is no thesis gate.
  for (const key of ["implied_price", "target_price", "equity_value_per_share"] as const) {
    const target = price(data[key]);
    if (target !== null) return response("recorded_unverified", "recorded_target", target,
      (stem + key) as RecordedValuationHeadline["sourcePath"]);
  }
  return response("unavailable", "missing_or_invalid_target");
}

/**
 * Canonical P4 professional-work-package section; caller must already have
 * loaded the authorized immutable Artifact revision and checked its hash.
 */
export function recordedValuationReviewSection(content: ArtifactContent): { title: string; text: string } | null {
  if (content.kind !== "valuation") return null;
  const headline = inspectRecordedValuationHeadline(content);
  return {
    title: "Recorded valuation target trust gate (unverified, not investment advice)",
    text: JSON.stringify(headline, null, 2),
  };
}
