/**
 * GM-12/22 bounded adaptation of OpenClaw's secret-free prepared credential
 * modes. Exact primary donor: openclaw/openclaw
 * src/agents/agent-auth-credential-modes.ts at
 * c074824a27c96d3983043f9eeb33823cd1772d8c (MIT).
 *
 * This describes what LiOS can ACTUALLY execute through its existing BYOAI
 * transport today. Discovery never probes CLI installs or reads credential
 * values, and it never mistakes a consumer chat subscription for API access.
 */
import type { AIProviderType } from "./byoaiRouter";

export type LiOSAIExecutableAccessMethod =
  | "provider_api_key"
  | "self_hosted_compatible_endpoint"
  | "local_model_endpoint";

export type LiOSAICostExposure =
  | "external_metered_or_credits"
  | "endpoint_operator_defined"
  | "local_compute";

export interface LiOSAIProviderAccessContract {
  executableMethod: LiOSAIExecutableAccessMethod;
  costExposure: LiOSAICostExposure;
  /** True means configured, NOT that a provider answered a real completion. */
  requiresLiveVerification: true;
  /** These need independent, provider-authorized import before being offered. */
  oauthAvailable: false;
  subscriptionCliAvailable: false;
}

/** No new provider store; a classification of the existing executable adapters. */
export function classifyLiOSAIProviderAccess(provider: AIProviderType): LiOSAIProviderAccessContract {
  if (provider === "ollama" || provider === "lm_studio") {
    return {
      executableMethod: "local_model_endpoint",
      costExposure: "local_compute",
      requiresLiveVerification: true,
      oauthAvailable: false,
      subscriptionCliAvailable: false,
    };
  }
  if (provider === "openai_compatible") {
    return {
      executableMethod: "self_hosted_compatible_endpoint",
      costExposure: "endpoint_operator_defined",
      requiresLiveVerification: true,
      oauthAvailable: false,
      subscriptionCliAvailable: false,
    };
  }
  return {
    executableMethod: "provider_api_key",
    costExposure: "external_metered_or_credits",
    requiresLiveVerification: true,
    oauthAvailable: false,
    subscriptionCliAvailable: false,
  };
}
