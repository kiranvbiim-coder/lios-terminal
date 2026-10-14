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
  const startedAt = Date.now();
  const result = await invoker({
    provider,
    ...(model ? { model } : {}),
    system: "You are a connectivity probe for LiOS. Reply with a very short acknowledgement only.",
    messages: [{ role: "user", content: "Reply exactly with LIOS_AI_OK." }],
    maxTokens: 16,
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

  return {
    ok: true,
    provider,
    model: result.model,
    latencyMs: Math.max(0, Date.now() - startedAt),
    verifiedAt: new Date().toISOString(),
    detail: config.name + " completed a live BYOAI verification request.",
  };
}
