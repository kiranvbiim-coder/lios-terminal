import {
  AIProviderError,
  getProviderConfig,
  normalizeProviderId,
  type AIProviderType,
} from "./byoaiRouter";
import {
  invokeAIProvider,
  type AICompletionResult,
} from "./byoaiTransport";
import { issueAIConnectionChallenge, acceptsAIConnectionAcknowledgement } from "./aiVerificationChallenge";

export interface AIProviderVerificationResult {
  ok: true;
  provider: AIProviderType;
  model: string;
  latencyMs: number;
  verifiedAt: string;
  detail: string;
}

export type AIProviderVerificationInvoker = (request: {
  provider: AIProviderType;
  model?: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  dataClassification?: "public" | "organization";
  enterpriseApproval?: boolean;
}) => Promise<AICompletionResult>;

export async function verifyAIProviderConnection(
  input: { provider: string; model?: string | null },
  invoker: AIProviderVerificationInvoker = invokeAIProvider,
): Promise<AIProviderVerificationResult> {
  const provider = normalizeProviderId(input.provider);
  if (!provider) throw new AIProviderError("invalid_provider", "AI provider is not registered.");

  const config = getProviderConfig(provider);
  if (!config) throw new AIProviderError("invalid_provider", "AI provider is not registered.", { provider });

  const model = input.model?.trim() || undefined;
  // Fresh challenge, bound to this exact call. A replayed static placeholder
  // must never be interpreted as a verified BYOAI provider connection.
  const challenge = issueAIConnectionChallenge();
  const startedAt = Date.now();
  const result = await invoker({
    provider,
    ...(model ? { model } : {}),
    system: "You are a connectivity probe for LiOS. Repeat the exact requested token only. No other text.",
    messages: [{ role: "user", content: `Reply exactly with ${challenge}.` }],
    maxTokens: 48,
    dataClassification: "public",
    enterpriseApproval: true,
  });

  if (
    result.provider !== provider
    || !result.model.trim()
    || (model && result.model !== model)
    || result.attribution.provider !== provider
    || result.attribution.model !== result.model
  ) {
    throw new AIProviderError(
      "upstream_error",
      config.name + " verification returned unexpected provider/model metadata.",
      { provider },
    );
  }

  if (!result.text.trim()) {
    throw new AIProviderError("empty_completion", config.name + " returned an empty completion.", { provider });
  }
  // Metadata and nonempty text do not establish that the provider answered
  // the current prompt: a proxy or cache can replay an old OK response.
  if (!acceptsAIConnectionAcknowledgement(result.text, challenge)) {
    throw new AIProviderError(
      "upstream_error",
      config.name + " did not complete the LiOS connection verification challenge.",
      { provider },
    );
  }

  return {
    ok: true,
    provider,
    model: result.model,
    latencyMs: Math.max(0, Date.now() - startedAt),
    verifiedAt: new Date().toISOString(),
    detail: config.name + " completed a live BYOAI verification request.",
  };
}
