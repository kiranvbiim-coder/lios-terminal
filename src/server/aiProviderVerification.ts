import {
  AIProviderError,
  getProviderConfig,
  getAvailableProviders,
  normalizeProviderId,
  type AIProviderType,
} from "./byoaiRouter";
import {
  invokeAIProvider, AI_CHAT_VERIFICATION_PROBE, resolveLocalProviderChatEndpoint, discoverLocalAIModels,
  type AICompletionResult,
} from "./byoaiTransport";
import { assertCurrentCredentialSnapshot, resolveCredential } from "./credentialVault";
import crypto from "node:crypto";
import { aiChatVerificationAttemptId, beginAIChatVerification, hasAIChatVerification, publishAIChatVerification, recordConnectorVerification, type AIChatVerificationAttempt } from "./connectorVerification";
import { getRequestIdentity } from "./requestContext";
import { getEnvironmentSetupForUser } from "./environmentSetupService";

export interface AIProviderVerificationResult {
  ok: true;
  provider: AIProviderType;
  model: string;
  latencyMs: number;
  verifiedAt: string;
  detail: string;
  verifiedCapabilities: ["chat"];
  endpoint?: string;
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

export function hasVerifiedAIChatSelection(userId: number, providerId: string | null, modelId: string | null, organizationId = getRequestIdentity()?.organizationId ?? null, localModelIdentity?: string): boolean {
  if (!providerId || !modelId) return false;
  const config = getProviderConfig(providerId);
  if (!config) return false;
  if (!getAvailableProviders().some((provider) => provider.id === config.id && provider.available)) return false;
  const credential = resolveCredential(config.envKey, config.vaultKey);
  return Boolean(credential && hasAIChatVerification({
    userId, organizationId, provider: config.id,
  }, modelId, crypto.createHash("sha256").update(credential).digest("hex"), localModelIdentity));
}

export function verifiedAIChatSelectionAttempt(userId: number, providerId: string | null, modelId: string | null, organizationId: number | null): number | null {
  if (!providerId || !hasVerifiedAIChatSelection(userId, providerId, modelId, organizationId)) return null;
  return aiChatVerificationAttemptId({ userId, organizationId, provider: providerId });
}

export async function verifyAIProviderConnection(
  input: { provider: string; model?: string | null; endpoint?: string },
  invoker: AIProviderVerificationInvoker = request => invokeAIProvider({ ...request, [AI_CHAT_VERIFICATION_PROBE]: true }),
  actor?: { userId: number; attempt?: AIChatVerificationAttempt },
): Promise<AIProviderVerificationResult> {
  const provider = normalizeProviderId(input.provider);
  if (!provider) throw new AIProviderError("invalid_provider", "AI provider is not registered.");

  const config = getProviderConfig(provider);
  if (!config) throw new AIProviderError("invalid_provider", "AI provider is not registered.", { provider });
  const credentialAtStart = actor ? resolveCredential(config.envKey, config.vaultKey) : null;
  const assertCredentialCurrent = await assertCurrentCredentialSnapshot(config.envKey, config.vaultKey);
  const attempt = actor ? actor.attempt ?? beginAIChatVerification({
    userId: actor.userId, organizationId: getRequestIdentity()?.organizationId ?? null, provider, credentialName: config.vaultKey,
  }) : null;
  if (actor) {
    const selection = await getEnvironmentSetupForUser(actor.userId);
    if (selection?.aiProviderId !== provider || selection.aiModelId !== input.model?.trim()) {
      throw new AIProviderError("invalid_request", "Save the selected provider and model before explicitly testing chat.", { provider });
    }
  }

  const model = input.model?.trim() || undefined;
  let endpoint: string | undefined;
  let localModelIdentity: string | undefined;
  if (provider === "ollama" || provider === "lm_studio") {
    if (!model) throw new AIProviderError("invalid_request", "Choose a model returned by the local server before verifying chat.", { provider });
    const discovery = await discoverLocalAIModels(provider);
    endpoint = discovery.endpoint;
    if (input.endpoint && resolveLocalProviderChatEndpoint(provider, input.endpoint) !== endpoint) {
      throw new AIProviderError("invalid_request", "The local endpoint changed. List models again before verifying chat.", { provider });
    }
    if (!discovery.models.includes(model)) {
      throw new AIProviderError("invalid_request", "The selected model was not returned by the local server. List models again and choose an available model.", { provider });
    }
    localModelIdentity = discovery.modelIdentities[model]?.signature;
    const credential = resolveCredential(config.envKey, config.vaultKey);
    if (!credential || resolveLocalProviderChatEndpoint(provider, credential) !== endpoint) {
      throw new AIProviderError("not_configured", "The local endpoint changed during model discovery. Retry verification.", { provider });
    }
  }
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
  if (localModelIdentity !== undefined && result.localModelIdentity !== localModelIdentity) {
    throw new AIProviderError("upstream_error", "The loaded local model changed during chat verification. List and verify it again.", { provider });
  }

  if (actor) {
    const credential = resolveCredential(config.envKey, config.vaultKey);
    if (!credential || credential !== credentialAtStart) {
      throw new AIProviderError("not_configured", "The provider credential or endpoint changed during verification. Verify again.", { provider });
    }
    const selection = await getEnvironmentSetupForUser(actor.userId);
    assertCredentialCurrent();
    if (selection?.aiProviderId !== provider || selection.aiModelId !== result.model || !attempt
      || !publishAIChatVerification(attempt, result.model, crypto.createHash("sha256").update(credential).digest("hex"), localModelIdentity)) {
      throw new AIProviderError("not_configured", "The AI configuration or verification attempt changed. Verify the current selection again.", { provider });
    }
    recordConnectorVerification(provider, true, "Explicit chat-only verification succeeded; native tools and vision were not tested.");
  }
  return {
    ok: true,
    provider,
    model: result.model,
    latencyMs: Math.max(0, Date.now() - startedAt),
    verifiedAt: new Date().toISOString(),
    detail: config.name + " completed a live chat-only verification request. Native tool calling and vision were not tested.",
    verifiedCapabilities: ["chat"],
    ...(endpoint ? { endpoint } : {}),
  };
}
