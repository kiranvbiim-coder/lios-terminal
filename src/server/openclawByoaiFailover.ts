/**
 * Bounded OpenClaw auth failover-policy assimilation (GM-12/GM-22).
 *
 * Upstream source: openclaw/openclaw
 *   src/agents/failover-policy.ts at c074824a27c96d3983043f9eeb33823cd1772d8c (MIT)
 * Upstream distinguishes transient outages from authorization, model and
 * credential failures; this LiOS adaptation maps those categories to our
 * existing AIProviderErrorCode without importing OpenClaw's agent router,
 * authentication store or account rotation.
 *
 * No quota circumvention, new provider grants or fallback authority here:
 * candidates still come from the existing current-owner BYOAI policy.
 */
import type { AIProviderErrorCode } from "./byoaiRouter";

export interface AIProviderFailureClassification {
  code: AIProviderErrorCode;
  status?: number;
}

/**
 * True only when a different already-authorized provider may be considered.
 *
 * A policy denial is NEVER transient. Authentication, missing model,
 * unsupported request and absent credentials also require user action. It is
 * unsafe to send the same context to another provider merely because one of
 * those requests was refused.
 */
export function isTransientBYOAIFailure(failure: AIProviderFailureClassification): boolean {
  switch (failure.code) {
    case "rate_limited":
    case "timeout":
    case "unavailable":
    case "empty_completion":
      return true;
    case "upstream_error":
      // A known HTTP 5xx may be retried on a different permitted route.
      // 401/403/404 and unknown upstream statuses cannot be silently
      // interpreted as outages: they can mean missing entitlement or access.
      return failure.status !== undefined
        && Number.isInteger(failure.status)
        && failure.status >= 500 && failure.status <= 599;
    case "policy_denied":
    case "not_configured":
    case "invalid_provider":
    case "invalid_request":
      return false;
    default:
      return false;
  }
}
