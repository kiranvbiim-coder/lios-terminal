import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
type GovernedReview = Extract<ConversationRuntimeEvent, { type: "governed_tool_approval_required" }>;
type LegacyReview = Extract<ConversationRuntimeEvent, { type: "approval_required" }>;

/** Presentation only: choices and current grant authority remain server owned. */
export function governedReviewRisk(review: GovernedReview, nowMs: number) {
  const effect = review.sideEffect ?? (review.externalSideEffect ? "external" : "unspecified");
  const risk = effect === "external" ? "External side effect"
    : effect === "internal_write" ? "LiOS or Project write"
    : effect === "none" ? "No declared side effect" : "Side effect not declared";
  const expired = review.expiresAt !== null && (Number.isNaN(Date.parse(review.expiresAt)) || Date.parse(review.expiresAt) <= nowMs);
  const binding = review.reviewBinding;
  const exactBinding = !!binding && binding.toolId.length > 0 && binding.stepId.length > 0
    && binding.toolCallId.length > 0 && /^[a-f0-9]{64}$/.test(binding.inputSha256)
    && /^[a-f0-9]{64}$/.test(binding.planSha256);
  // For old replay events without an exact binding, viewing and denial remain possible,
  // but a newly rendered privileged or side-effectful approval must fail closed.
  const needsExactBinding = review.permissionClass === "admin_confirm"
    || effect === "external" || effect === "internal_write" || effect === "unspecified";
  const highRisk = review.permissionClass === "admin_confirm" || effect === "external";
  return {
    effect, risk, highRisk, expired, exactBinding,
    blockAllow: expired || (needsExactBinding && !exactBinding) || (binding?.toolId === "lios.channel.telegram.send_text" && !review.channelTextReview),
    projectScope: review.choices.includes("allow_project") && binding?.projectId != null && binding.toolId !== "lios.channel.telegram.send_text",
    scopeLabel: binding ? binding.projectId === null
      ? `Chat ${binding.chatId ?? "unavailable"} · one-time only`
      : `Project ${binding.projectId} · Chat ${binding.chatId ?? "unavailable"}`
      : "Exact run/target binding is not included in this recorded review",
    inputDisclosure: review.channelTextReview ? "The exact server-bound Telegram recipient, text and reply/topic are shown below. Allow once permits only this message; provider acceptance is not recipient delivery or read."
      : binding ? "Input SHA-256 is shown below. Raw input and external target are NOT exposed; verify out of band before permitting effects." : "Exact input hash and tool-call binding unavailable. Do not approve an unverified action.",
  };
}

/** The legacy P2 review already includes action and target but does not
 * authenticate that event as a server-owned governed tool review. */
export function legacyReviewFacts(review: LegacyReview) {
  return {
    action: review.action,
    component: review.actionRequest.componentId,
    target: review.actionRequest.targetRef == null ? "not specified" : String(review.actionRequest.targetRef),
    sideEffect: review.actionRequest.externalSideEffect ? "External side effect" : review.actionRequest.reversible ? "Reversible request" : "Effect not independently verified",
    permission: review.actionRequest.permissionClass,
  };
}
