import type { RecordedClaimReview } from "@shared/conversationRuntime";
import { trustManifestSchema } from "@shared/trustContracts";
import type { TenantContext } from "./tenantContext";
import { listProjectChatMessages } from "./projectChatStore";

/** Local inspection only: historical trust is not current source or transmission permission. */
export async function resolveRecordedClaimReview(ctx: TenantContext, chatId: number, binding: RecordedClaimReview): Promise<string> {
  const messages = await listProjectChatMessages(ctx, chatId);
  const saved = messages.find(message => message.role === "assistant" && message.metadata.runtimeRequestId === binding.sourceRequestId);
  const parsed = trustManifestSchema.safeParse(saved?.metadata.recordedTrustManifest);
  if (!parsed.success || parsed.data.requestId !== binding.sourceRequestId || parsed.data.trustId !== binding.trustId)
    throw new Error("The selected trust record is unavailable in this owned Chat. Re-run the original source-backed request before reviewing it.");
  const manifest = parsed.data;
  const claim = manifest.claims.find(item => item.claimId === binding.claimId);
  if (!claim) throw new Error("The exact selected claim was not retained in this trust record.");
  const observations = manifest.evidence.filter(item => claim.sourceRefs.includes(item.sourceRef));
  if (!claim.sourceRefs.length || claim.sourceRefs.some(ref => !observations.some(item => item.sourceRef === ref && item.kind !== "ai")))
    throw new Error("The selected claim has incomplete or AI-only recorded evidence. No decision review is available.");
  const assumptions = manifest.assumptions.filter(item => claim.assumptionRefs.includes(item.ref));
  const unresolved = claim.assumptionRefs.filter(ref => !assumptions.some(item => item.ref === ref));
  return [
    "## Selected recorded claim review",
    `Claim: ${claim.label}`,
    "Local inspection of the exact saved Chat trust record. No provider was contacted, no content was transmitted to AI, and no tool, calculation, recommendation or automation was executed. Historical source access does not establish current permission.",
    `Recorded status: ${claim.status}. Recorded ${manifest.generatedAt}.`,
    `Evidence: ${new Set(observations.map(item => item.sourceRef)).size} recorded source reference(s). Inspect their dates, conflicts and access posture in the original Show work before relying on them.`,
    `Assumptions: ${assumptions.length} retained; ${unresolved.length} unresolved reference(s).`,
    `Conflicts: ${manifest.conflicts.length}; warnings: ${manifest.warnings.length}; missing inputs: ${manifest.missing.length}.`,
    "### Decision alternatives to review",
    "- Defer the decision when a supporting source, assumption or current permission is unresolved; obtain the missing input first.",
    "- Recheck the original source-backed analysis if recency or source agreement matters. A new source read requires its normal authorization; this inspection does not grant it.",
    "- If a numerical comparison is needed, state the alternatives and assumptions in a separate request and require a deterministic calculation receipt before acting.",
    "These are review paths, not a ranking of alternatives or financial advice. The retained claim alone cannot establish causal impact or a forecast.",
  ].join("\n\n");
}
