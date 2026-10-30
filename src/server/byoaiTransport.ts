export { AIProviderError } from "./byoaiRouter";
import { assertExecutionAllowed } from "./accessMode";
import {
  AIProviderError,
  AI_PROVIDERS,
  createAttribution,
  getAvailableProviders,
  getPreferredProvider,
  getProviderConfig,
  normalizeProviderId,
  type AICallAttribution,
  type AIProviderConfig,
  type AIProviderType,
} from "./byoaiRouter";
import { assertCurrentCredentialSnapshot, resolveCredential } from "./credentialVault";
import { isTransientBYOAIFailure } from "./openclawByoaiFailover";
import { recordConnectorVerification } from "./connectorVerification";
import { getRequestIdentity } from "./requestContext";
import { currentConversationTransmissionGuard, currentIncomingAiDispatchGuard } from "./exec/execution-scope";
import { getStoredEnterprisePolicy } from "./enterprisePolicyService";
import { evaluateEnterpriseAiProvider } from "@shared/enterpriseContracts";
import { readBoundedText } from "./sourceConnectionPolicy";
import { z } from "zod";

/** Server-only capability for the fixed, user-requested connectivity probe. JSON cannot forge it. */
export const AI_CHAT_VERIFICATION_PROBE = Symbol("LiOS fixed chat verification");

export interface AICompletionRequest {
  provider: AIProviderType;
  [AI_CHAT_VERIFICATION_PROBE]?: true;
  model?: string;
  system?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    images?: Array<{ mimeType: string; base64: string }>;
  }>;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Enterprise policy classification. Organization data is the conservative default. */
  dataClassification?: "public" | "organization";
  /** Explicit per-call approval when the organization policy requires it. */
  enterpriseApproval?: boolean;
  /** Server-only source release check, followed by a final enterprise-policy/revision gate before provider dispatch. */
  beforeTransmission?: () => Promise<void>;
}

export type AIRoutedCompletionRequest = Omit<AICompletionRequest, "provider"> & {
  provider?: AIProviderType;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  fallbackProviders?: string[];
  /** Hard per-invocation provider-attempt ceiling, including the first request. Default: two. */
  maxAttempts?: number;
  /**
   * Whether another connected provider may answer if the first fails. "configured" (default) tries
   * other providers the user has connected, honouring allow/deny/local-only policy. "none" keeps the
   * request with a single provider — required when the request carries private files or portfolios.
   */
  fallback?: "none" | "configured";
  /** Per-request Project/Conversation transmission policy. Enterprise policy is still enforced independently. */
  providerPolicy?: {
    localOnly?: boolean;
    anyConfigured?: boolean;
    allow?: string[];
    deny?: string[];
  };
};

function normalizeRequestedProvider(provider: unknown, fieldName: string): AIProviderType | null {
  if (provider === undefined || provider === null || (typeof provider === "string" && !provider.trim())) return null;
  const normalized = typeof provider === "string" ? normalizeProviderId(provider) : null;
  if (!normalized) throw new AIProviderError("invalid_provider", `${fieldName} is not registered.`);
  return normalized;
}

function normalizeRequestedModel(model: unknown, fieldName: string): string | undefined {
  if (model === undefined || model === null) return undefined;
  if (typeof model !== "string" || !model.trim()) throw new AIProviderError("invalid_request", `${fieldName} must be a non-empty string.`);
  return model.trim();
}

export interface AIFallbackAttempt {
  provider: AIProviderType;
  code: string;
  status?: number;
}

export interface AICompletionResult {
  provider: AIProviderType;
  model: string;
  /** Observed local response identity, validated against the admitted instance/model mapping. */
  servedModel?: string;
  localModelIdentity?: string;
  text: string;
  attribution: AICallAttribution;
  /** Present only when an earlier provider failed and this provider answered instead. */
  fallback?: { attempts: AIFallbackAttempt[] };
}

function providerCredential(provider: AIProviderType): string | null {
  const config = getProviderConfig(provider);
  return config ? resolveCredential(config.envKey, config.vaultKey) : null;
}

function resolveHttpUrl(baseUrl: string, fieldName: string): URL {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new Error(`${fieldName} requires a URL.`);
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error(`${fieldName} must be a valid HTTP(S) URL.`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${fieldName} must use HTTP or HTTPS.`);
  if (url.username || url.password) throw new Error(`${fieldName} must not contain embedded credentials.`);
  if (url.search || url.hash) throw new Error(`${fieldName} must not contain a query string or fragment.`);
  return url;
}

export function resolveOpenAICompatibleChatEndpoint(baseUrl: string, fieldName = "OPENAI_COMPATIBLE_BASE_URL"): string {
  const url = resolveHttpUrl(baseUrl, fieldName);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return url.toString();
}

export function resolveOllamaChatEndpoint(baseUrl: string): string {
  const url = resolveHttpUrl(baseUrl, "OLLAMA_BASE_URL");
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api/chat") ? path : path.endsWith("/api") ? `${path}/chat` : `${path}/api/chat`;
  return url.toString();
}

export function resolveLocalProviderChatEndpoint(provider: "ollama" | "lm_studio", baseUrl: string): string {
  const url = resolveHttpUrl(baseUrl, provider === "ollama" ? "OLLAMA_BASE_URL" : "LM_STUDIO_BASE_URL");
  const host = url.hostname.toLowerCase();
  if (host !== "localhost" && host !== "[::1]" && !/^127(?:\.\d{1,3}){3}$/.test(host)) {
    throw new AIProviderError("policy_denied", "Local AI requires a loopback endpoint. Configure remote inference as an explicitly external provider.", { provider });
  }
  // Avoid depending on DNS or a hosts-file entry to keep a local-only prompt on this machine.
  if (host === "localhost") url.hostname = "127.0.0.1";
  return provider === "ollama" ? resolveOllamaChatEndpoint(url.toString()) : resolveOpenAICompatibleChatEndpoint(url.toString(), "LM_STUDIO_BASE_URL");
}

export interface LocalAIModelDiscovery {
  provider: "ollama" | "lm_studio";
  endpoint: string;
  models: string[];
  modelIdentities: Record<string, { modelKey: string; signature: string }>;
  excludedModels: Array<{ id: string; reason: string }>;
  complete: true;
  detail: string;
}

const localModelId = z.string().trim().min(1).max(200);
const ollamaModelList = z.object({ models: z.array(z.object({
  name: localModelId,
  size: z.number().nonnegative().optional(),
  digest: z.string().optional(),
  details: z.object({ format: z.string().optional() }).optional(),
  remote_model: z.string().optional(),
  remote_host: z.string().optional(),
})).max(2_000) });
const studioModelList = z.object({ models: z.array(z.object({
  key: localModelId,
  type: z.string(),
  format: z.string().nullable().optional(),
  size_bytes: z.number().nonnegative().optional(),
  loaded_instances: z.array(z.object({ id: localModelId })).max(2_000).optional(),
  remote_model: z.string().optional(),
  remote_host: z.string().optional(),
})).max(2_000) });

/** A loopback URL is not local execution: Ollama can forward cloud models through localhost. */
export async function discoverLocalAIModels(providerId: string, purpose: "chat" | "embedding" = "chat"): Promise<LocalAIModelDiscovery> {
  const provider = normalizeProviderId(providerId);
  if (provider !== "ollama" && provider !== "lm_studio") {
    throw new AIProviderError("invalid_provider", "Model discovery here supports only the registered local AI providers.");
  }
  const config = getProviderConfig(provider)!;
  const credential = providerCredential(provider);
  if (!credential) throw new AIProviderError("not_configured", "Save your local model server endpoint first.", { provider });
  const endpoint = resolveLocalProviderChatEndpoint(provider, credential);
  const url = new URL(endpoint);
  url.pathname = provider === "ollama"
    ? url.pathname.replace(/\/chat$/, "/tags")
    : url.pathname.replace(/(?:\/v1)?\/chat\/completions$/, "/api/v1/models");
  const models: string[] = [];
  const modelIdentities: LocalAIModelDiscovery["modelIdentities"] = Object.create(null);
  const excludedModels: LocalAIModelDiscovery["excludedModels"] = [];
  try {
    const response = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new AIProviderError("upstream_error", `${config.name} model listing returned HTTP ${response.status}.`, { provider, status: response.status });
    const payload: unknown = JSON.parse(await readBoundedText(response, 512 * 1024));
    if (provider === "ollama") {
      // /api/tags exposes remote_model/remote_host as well as installed file size, digest and format.
      for (const entry of ollamaModelList.parse(payload).models) {
        const remote = Boolean(entry.remote_model || entry.remote_host || /(?:[-:]cloud)(?::|$)/i.test(entry.name));
        if (remote || !entry.size || entry.details?.format !== "gguf" || !/^[a-f0-9]{64}$/i.test(entry.digest ?? "")) {
          excludedModels.push({ id: entry.name, reason: remote ? "Remote/cloud model; not a local-only route." : "Installed local model metadata is incomplete." });
        } else {
          models.push(entry.name);
          modelIdentities[entry.name] = { modelKey: entry.name, signature: JSON.stringify([entry.name, entry.digest, entry.size, entry.details?.format]) };
        }
      }
    } else {
      // LM Studio's native list proves on-disk format/size and loaded instance IDs; /v1/models alone cannot.
      for (const entry of studioModelList.parse(payload).models) {
        const local = !entry.remote_model && !entry.remote_host && Boolean(entry.size_bytes)
          && (entry.format === "gguf" || entry.format === "mlx")
          && entry.type === (purpose === "embedding" ? "embedding" : "llm");
        if (!local || !entry.loaded_instances?.length) {
          excludedModels.push({ id: entry.key, reason: "Model must have local file metadata, the requested model type and a loaded instance." });
        } else {
          for (const instance of entry.loaded_instances) {
            models.push(instance.id);
            modelIdentities[instance.id] = { modelKey: entry.key, signature: JSON.stringify([instance.id, entry.key, entry.type, entry.format, entry.size_bytes]) };
          }
        }
      }
    }
    return {
      provider, endpoint, models: [...new Set(models)], modelIdentities, excludedModels, complete: true,
      detail: `Found ${models.length} runtime-reported installed local model(s); excluded ${excludedModels.length} remote, unknown, unloaded or incompatible model(s). No prompt, download or inference was requested; chat, tools and vision remain unverified.`,
    };
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError("unavailable", `${config.name} could not provide installed local model metadata. Check the endpoint and server version; no inference was sent.`, { provider });
  }
}

async function requireInstalledLocalModel(provider: "ollama" | "lm_studio", model: string, endpoint: string, purpose: "chat" | "embedding" = "chat"): Promise<{ modelKey: string; signature: string }> {
  let discovery: LocalAIModelDiscovery;
  try {
    discovery = await discoverLocalAIModels(provider, purpose);
  } catch {
    throw new AIProviderError("policy_denied", "Installed local model metadata could not be established. No inference or cloud fallback is permitted for this local-only request.", { provider });
  }
  if (discovery.endpoint !== endpoint || !discovery.models.includes(model)) {
    throw new AIProviderError("policy_denied", "Local AI requires an installed local model with matching server metadata. Remote/cloud, unknown and unloaded models cannot receive prompts through a local-only route.", { provider });
  }
  return discovery.modelIdentities[model];
}

function openAiEndpoint(provider: AIProviderType, credential: string): { url: string; headers: Record<string, string> } {
  if (provider === "ollama" || provider === "lm_studio") return { url: resolveLocalProviderChatEndpoint(provider, credential), headers: {} };
  if (provider === "mistral") return { url: "https://api.mistral.ai/v1/chat/completions", headers: { Authorization: `Bearer ${credential}` } };
  if (provider === "groq") return { url: "https://api.groq.com/openai/v1/chat/completions", headers: { Authorization: `Bearer ${credential}` } };
  if (provider === "together") return { url: "https://api.together.xyz/v1/chat/completions", headers: { Authorization: `Bearer ${credential}` } };
  if (provider === "openrouter") return { url: "https://openrouter.ai/api/v1/chat/completions", headers: { Authorization: `Bearer ${credential}` } };
  if (provider === "xai") return { url: "https://api.x.ai/v1/chat/completions", headers: { Authorization: `Bearer ${credential}` } };
  if (provider === "openai_compatible") {
    const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
    if (!baseUrl) throw new Error("OpenAI-compatible endpoint requires OPENAI_COMPATIBLE_BASE_URL.");
    if (!baseUrl) throw new AIProviderError("unavailable", "OpenAI-compatible endpoint is not configured.", { provider });
    return { url: resolveOpenAICompatibleChatEndpoint(baseUrl), headers: { Authorization: `Bearer ${credential}` } };
  }
  if (provider === "azure_openai") {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim();
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() || "2024-10-21";
    if (!endpoint || !deployment) throw new AIProviderError("unavailable", "Azure OpenAI endpoint configuration is incomplete.", { provider });
    const endpointUrl = resolveHttpUrl(endpoint, "AZURE_OPENAI_ENDPOINT");
    endpointUrl.pathname = `${endpointUrl.pathname.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions`;
    endpointUrl.search = `?api-version=${encodeURIComponent(apiVersion)}`;
    return { url: endpointUrl.toString(), headers: { "api-key": credential } };
  }
  return { url: "https://api.openai.com/v1/chat/completions", headers: { Authorization: `Bearer ${credential}` } };
}

function resolveProviderModel(config: AIProviderConfig, requestedModel?: string): string {
  const requested = requestedModel?.trim();
  if (requested && (config.allowCustomModel || config.models.includes(requested))) return requested;
  if (requested) {
    if (config.allowCustomModel || config.models.includes(requested)) return requested;
    throw new AIProviderError("invalid_request", `${config.name} does not support model "${requested}".`, { provider: config.id });
  }
  const configuredDefault = config.modelEnvKey ? process.env[config.modelEnvKey]?.trim() : undefined;
  return configuredDefault || config.defaultModel;
}

function boundedMaxTokens(maxTokens: number | undefined): number {
  return Math.min(Math.max(maxTokens ?? 1_024, 1), 8_192);
}

/**
 * Gemini 2.5 Flash "thinks" by default and thinking tokens count against maxOutputTokens, so a
 * bounded conversational answer can come back with no text at all. Flash allows thinking to be
 * switched off; other models keep their defaults.
 */
export function geminiGenerationConfig(model: string, maxTokens: number | undefined): Record<string, unknown> {
  const config: Record<string, unknown> = { maxOutputTokens: boundedMaxTokens(maxTokens) };
  if (/^gemini-2\.5-flash(?:-|$)/i.test(model.trim())) config.thinkingConfig = { thinkingBudget: 0 };
  return config;
}

export function supportsImageInput(provider: AIProviderType, model: string): boolean {
  const candidate = model.trim().toLowerCase();
  if (provider === "openai" || provider === "azure_openai") return /^gpt-4o(?:-mini)?(?:-|$)/.test(candidate);
  if (provider === "anthropic") return /^claude-(?:sonnet|opus)-4(?:-|$)/.test(candidate) || /^claude-haiku-3(?:-|$)/.test(candidate);
  if (provider === "gemini") return /^gemini-(?:2\.5-(?:flash|pro)|3\.5-flash(?:-lite)?|3\.8-flash)(?:-|$)/.test(candidate);
  if (provider === "openrouter") return /^(?:openai\/gpt-4o(?:-mini)?|anthropic\/claude-(?:sonnet|opus)-4|google\/gemini-(?:2\.5-(?:flash|pro)|3\.5-flash(?:-lite)?|3\.8-flash))(?:-|$)/.test(candidate);
  return false;
}

function validateImages(request: AICompletionRequest, provider: AIProviderType, model: string): void {
  const images = request.messages.flatMap((message) => message.images ?? []);
  if (!images.length) return;
  if (!supportsImageInput(provider, model)) {
    throw new AIProviderError("invalid_request", `The selected ${provider} model is not verified for image input. Select a supported vision model or remove the image.`, { provider });
  }
  if (images.length > 5) throw new AIProviderError("invalid_request", "A single AI request may include at most five images.", { provider });
  let totalBytes = 0;
  for (const image of images) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) {
      throw new AIProviderError("invalid_request", "Image attachments must be PNG, JPEG or WebP.", { provider });
    }
    if (typeof image.base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.base64)) {
      throw new AIProviderError("invalid_request", "An image attachment is malformed.", { provider });
    }
    const byteLength = Buffer.from(image.base64, "base64").byteLength;
    if (!byteLength || byteLength > 6 * 1024 * 1024) throw new AIProviderError("invalid_request", "Each image must be 6 MiB or smaller.", { provider });
    totalBytes += byteLength;
  }
  if (totalBytes > 12 * 1024 * 1024) throw new AIProviderError("invalid_request", "Images in one AI request must total 12 MiB or less.", { provider });
}

const OLLAMA_CONTEXT_TOKENS = 8192;

function openAiBody(request: AICompletionRequest, model: string, isOllama = false): Record<string, unknown> {
  const messages = request.messages.map((message) => {
    const images = message.images ?? [];
    if (isOllama) return { role: message.role, content: message.content, ...(images.length ? { images: images.map((image) => image.base64) } : {}) };
    if (!images.length) return { role: message.role, content: message.content };
    return {
      role: message.role,
      content: [
        { type: "text", text: message.content },
        ...images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } })),
      ],
    };
  });
  return {
    model,
    messages: [...(request.system ? [{ role: "system", content: request.system }] : []), ...messages],
    ...(isOllama
      // Ollama's native chat API ignores max_tokens and silently truncates prompts to a 4096-token default window, so
      // free local models need the output bound and a window large enough for the planning prompt set explicitly.
      ? { stream: false, options: { num_predict: boundedMaxTokens(request.maxTokens), num_ctx: OLLAMA_CONTEXT_TOKENS } }
      : { max_tokens: boundedMaxTokens(request.maxTokens) }),
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1_000) || `HTTP ${response.status}`;
}

/**
 * Classifies a provider error body into a small fixed set of reasons. Only the classification is
 * used; provider text is never copied into a message, because it can echo request content.
 */
export function classifyProviderFailure(body: string): "insufficient_quota" | "invalid_api_key" | "model_unavailable" | null {
  const text = body.toLowerCase();
  if (/insufficient_quota|exceeded your current quota|check your plan and billing|billing_not_active|resource_exhausted.*(?:quota|billing)/.test(text)) return "insufficient_quota";
  if (/invalid_api_key|incorrect api key|api key not valid|api_key_invalid/.test(text)) return "invalid_api_key";
  if (/model_not_found|does not have access to model|model .* does not exist/.test(text)) return "model_unavailable";
  return null;
}

const RETRY_AFTER_MAX_MS = 300_000;
/**
 * Retry-After semantics adapted from OpenClaw packages/retry/src/index.ts (c074824a, MIT): a server hint is a lower
 * bound, never an authority to retry. Only the integer-seconds or HTTP-date header is read, clamped to 0..5 minutes.
 */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const ms = /^\d{1,9}$/.test(text) ? Number(text) * 1000
    : /^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text) ? Date.parse(text) - now : Number.NaN;
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(Math.round(ms), 0), RETRY_AFTER_MAX_MS);
}

// Bounded in-memory ordering hint only: per request owner and provider, it can move a cooling provider later among
// ALREADY permitted candidates. It never admits a provider, never blocks a sole candidate and never delays or replays.
const providerCooldowns = new Map<string, number>();
const MAX_COOLDOWNS = 256;
export function noteProviderCooldown(provider: AIProviderType, ms: number, now = Date.now()): void {
  const owner = getRequestIdentity()?.userId;
  if (owner == null || ms <= 0) return;
  for (const [key, until] of providerCooldowns) if (until <= now) providerCooldowns.delete(key);
  if (providerCooldowns.size >= MAX_COOLDOWNS) providerCooldowns.delete(providerCooldowns.keys().next().value!);
  providerCooldowns.set(`${owner}:${provider}`, now + ms);
}
export function orderByCooldown(candidates: AIProviderType[], now = Date.now()): AIProviderType[] {
  const owner = getRequestIdentity()?.userId;
  if (owner == null || candidates.length < 2) return candidates;
  const cooling = (provider: AIProviderType) => (providerCooldowns.get(`${owner}:${provider}`) ?? 0) > now;
  return [...candidates.filter(p => !cooling(p)), ...candidates.filter(cooling)];
}
export function resetProviderCooldownsForTest(): void { providerCooldowns.clear(); }

function responseError(config: AIProviderConfig, provider: AIProviderType, response: Response, body: string): AIProviderError {
  const reason = classifyProviderFailure(body);
  if (reason === "insufficient_quota") {
    return new AIProviderError("quota_exhausted", `${config.name} reports no available quota for this API key (credits or billing). Add credits or enable billing with the provider, or choose another provider.`, { provider, status: response.status });
  }
  if (reason === "invalid_api_key") {
    return new AIProviderError("upstream_error", `${config.name} rejected the API key. Re-enter it in the Connection Center.`, { provider, status: response.status });
  }
  if (reason === "model_unavailable") {
    return new AIProviderError("upstream_error", `${config.name} says the selected model is unavailable to this key. Choose another model in the Connection Center.`, { provider, status: response.status });
  }
  if (provider === "gemini" && response.status === 404) {
    return new AIProviderError(
      "upstream_error",
      "Google Gemini could not find the selected model or API route (HTTP 404). Verify the model ID and that this API key can use it; Gemini 2.5 access is restricted for some newer projects. Try Gemini 3.5 Flash-Lite if this is a new key.",
      { provider, status: response.status },
    );
  }
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const wait = retryAfterMs && retryAfterMs > 0 ? ` Retry in about ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.` : "";
    return new AIProviderError("rate_limited", `${config.name} rate limit exceeded.${wait}`, { provider, status: 429, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
  }
  return new AIProviderError("upstream_error", `${config.name} request failed with HTTP ${response.status}.`, { provider, status: response.status });
}

function validateRequest(request: AICompletionRequest, provider: AIProviderType): void {
  if (!Array.isArray(request.messages) || request.messages.length === 0) throw new AIProviderError("invalid_request", "At least one message is required.", { provider });
  if (request.messages.some((message) => !message || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || !message.content.trim())) {
    throw new AIProviderError("invalid_request", "Messages must have a supported role and non-empty string content.", { provider });
  }
  if (request.maxTokens !== undefined && (!Number.isFinite(request.maxTokens) || request.maxTokens <= 0)) throw new AIProviderError("invalid_request", "maxTokens must be a positive finite number.", { provider });
}
 
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

// Enterprise policy is enforced at the provider invocation boundary, not only
// in the admin console. Standard/non-enterprise organizations have no stored
// policy row and keep the existing BYOAI behavior.
async function enforceEnterpriseAiPolicy(
  request: AICompletionRequest,
  config: AIProviderConfig,
  model: string,
): Promise<number | null> {
  const identity = getRequestIdentity();
  const organizationId = identity?.organizationId ?? null;
  if (!organizationId) return null;
  const record = await getStoredEnterprisePolicy(organizationId);
  if (!record) return 0;
  const policy = record.policy;

  const decision = evaluateEnterpriseAiProvider(policy, config.id, model);
  if (!decision.allowed) {
    throw new AIProviderError("policy_denied", decision.reason, { provider: config.id });
  }
  if (policy.ai.endpointMode === "local_only" && !config.isLocal) {
    throw new AIProviderError("policy_denied", "Organization policy permits only local AI endpoints.", { provider: config.id });
  }
  if (!config.isLocal && (request.dataClassification ?? "organization") !== "public" && !policy.ai.allowExternalData) {
    throw new AIProviderError("policy_denied", "Organization policy forbids sending organization data to an external AI provider.", { provider: config.id });
  }
  if (policy.ai.requireApproval && request.enterpriseApproval !== true) {
    throw new AIProviderError("policy_denied", "Organization policy requires explicit approval for this AI call.", { provider: config.id });
  }
  if (policy.ai.endpointMode === "configured_private") {
    if (config.id !== "openai_compatible") {
      throw new AIProviderError("policy_denied", "Configured-private AI policy requires the approved OpenAI-compatible endpoint.", { provider: config.id });
    }
    const configured = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
    const approved = policy.ai.endpointUrl?.trim();
    if (!configured || !approved) {
      throw new AIProviderError("policy_denied", "The approved private AI endpoint is not configured.", { provider: config.id });
    }
    let configuredOrigin: string;
    let approvedOrigin: string;
    try {
      configuredOrigin = new URL(configured).origin;
      approvedOrigin = new URL(approved).origin;
    } catch {
      throw new AIProviderError("policy_denied", "The approved private AI endpoint is invalid.", { provider: config.id });
    }
    if (configuredOrigin !== approvedOrigin) {
      throw new AIProviderError("policy_denied", "Runtime AI endpoint does not match the organization-approved private endpoint.", { provider: config.id });
    }
  }
  return record.revision;
}

// Every governed BYOAI call records a process-local verification outcome.
const VERIFIABLE_CONNECTOR_PROVIDERS = new Set<AIProviderType>(AI_PROVIDERS.map((provider) => provider.id));

export async function invokeAIProvider(request: AICompletionRequest): Promise<AICompletionResult> {
  await assertExecutionAllowed("ai");
  const provider = typeof request.provider === "string" ? normalizeProviderId(request.provider) : null;
  if (!provider) throw new AIProviderError("invalid_provider", "AI provider is not registered.");
  const incomingDispatch = currentIncomingAiDispatchGuard();
  const canonicalRequest: AICompletionRequest = { ...request, provider,
    ...(incomingDispatch ? { dataClassification: "organization" as const } : {}) };
  validateRequest(canonicalRequest, provider);
  const config = getProviderConfig(provider);
  if (!config) throw new AIProviderError("invalid_provider", "AI provider is not registered.");
  const resolvedModel = resolveProviderModel(config, canonicalRequest.model);
  validateImages(canonicalRequest, provider, resolvedModel);
  const enterpriseRevision = await enforceEnterpriseAiPolicy(canonicalRequest, config, resolvedModel);
  const assertCredentialCurrent = await assertCurrentCredentialSnapshot(config.envKey, config.vaultKey);
  let localCredential: string | undefined;
  let localModelIdentity: { modelKey: string; signature: string } | undefined;
  if (provider === "ollama" || provider === "lm_studio") {
    localCredential = providerCredential(provider) ?? undefined;
    if (!localCredential) throw new AIProviderError("not_configured", "The local model endpoint is not configured.", { provider });
    localModelIdentity = await requireInstalledLocalModel(provider, resolvedModel, resolveLocalProviderChatEndpoint(provider, localCredential));
  }
  // A local release-policy refusal did not contact the provider and must not change connector health.
  const scopeRelease = currentConversationTransmissionGuard();
  try { await scopeRelease?.(); } catch {
    throw new AIProviderError("policy_denied", "Conversation source permission changed; provider transmission was refused.", { provider });
  }
  await canonicalRequest.beforeTransmission?.();
  if (incomingDispatch) await incomingDispatch();
  if (scopeRelease || canonicalRequest.beforeTransmission || localCredential !== undefined) {
    // Source-release checks await mutable state. Bind the enterprise revision and re-evaluate the complete policy last.
    const releaseRevision = await enforceEnterpriseAiPolicy(canonicalRequest, config, resolvedModel);
    if (releaseRevision !== enterpriseRevision) {
      throw new AIProviderError("policy_denied", "Organization AI policy changed before dispatch; retry under the current policy.", { provider });
    }
  }
  const identity = getRequestIdentity();
  if (identity?.userId != null && canonicalRequest[AI_CHAT_VERIFICATION_PROBE] !== true) {
    try {
      const { requireMasterAiDispatchOn } = await import("./masterAiGate");
      const assertCurrent = await requireMasterAiDispatchOn(identity.userId, identity.organizationId, provider, resolvedModel, localModelIdentity?.signature);
      const finalEnterpriseRevision = await enforceEnterpriseAiPolicy(canonicalRequest, config, resolvedModel);
      if (finalEnterpriseRevision !== enterpriseRevision) throw new Error("Organization policy changed.");
      assertCurrent();
    } catch {
      throw new AIProviderError("policy_denied", "AI is off or its current provider/model authorization is no longer valid. Verify the selected model and enable AI again.", { provider });
    }
  }
  assertCredentialCurrent();
  try {
    const result = await invokeAIProviderUnverified({ ...canonicalRequest, model: resolvedModel }, localCredential, localModelIdentity);
    if (VERIFIABLE_CONNECTOR_PROVIDERS.has(provider)) recordConnectorVerification(provider, true, `${result.provider} responded to a live completion request.`);
    return result;
  } catch (error) {
    const sanitized = error instanceof AIProviderError ? error : error instanceof DOMException && error.name === "AbortError" ? new AIProviderError("timeout", `${provider} request timed out.`, { provider }) : new AIProviderError("unavailable", `${provider} is unavailable.`, { provider });
    if (VERIFIABLE_CONNECTOR_PROVIDERS.has(provider)) recordConnectorVerification(provider, false, sanitized.message);
    throw sanitized;
  }
}

function configuredProviderIds(): Set<AIProviderType> {
  return new Set(getAvailableProviders().filter((provider) => provider.available).map((provider) => provider.id));
}

function routedProviderCandidates(request: AIRoutedCompletionRequest): AIProviderType[] {
  const configured = configuredProviderIds();
  const preferred = normalizeRequestedProvider(request.preferredProvider, "preferredProvider");
  const fallbacks = (request.fallbackProviders ?? []).map((provider, index) =>
    normalizeRequestedProvider(provider, `fallbackProviders[${index}]`),
  );
  const allow = new Set((request.providerPolicy?.allow ?? []).map((provider) => provider.trim().toLowerCase()).filter(Boolean));
  const deny = new Set((request.providerPolicy?.deny ?? []).map((provider) => provider.trim().toLowerCase()).filter(Boolean));
  const candidates: AIProviderType[] = [];
  const permitted = (provider: AIProviderType): boolean => {
    if (deny.has(provider)) return false;
    if (allow.size > 0 && !allow.has(provider)) return false;
    if (request.providerPolicy?.localOnly && !getProviderConfig(provider)?.isLocal) return false;
    return true;
  };
  const add = (provider: AIProviderType | null): void => {
    if (provider && configured.has(provider) && permitted(provider) && !candidates.includes(provider)) candidates.push(provider);
  };
  const fallbackAllowed = request.fallback !== "none";
  // The provider the user chose answers first; the global default only leads when nothing was chosen.
  add(preferred);
  if (!preferred) add(getPreferredProvider()?.id ?? null);
  // Other vendors receive the prompt only when fallback is allowed. Every candidate still passes the
  // Project allow/deny/local-only policy above, so a policy can never be escaped through fallback.
  if (fallbackAllowed) {
    fallbacks.forEach(add);
    add(getPreferredProvider()?.id ?? null);
    for (const provider of getAvailableProviders()) {
      if (provider.available) add(provider.id);
    }
  }
  return candidates;
}

export async function invokeAIRoutedCompletion(request: AIRoutedCompletionRequest): Promise<AICompletionResult> {
  await assertExecutionAllowed("ai");
  if (currentIncomingAiDispatchGuard()) request = { ...request, fallback: "none", maxAttempts: 1, dataClassification: "organization" };
  const preferredProvider = normalizeRequestedProvider(request.preferredProvider, "preferredProvider");
  const preferredModel = normalizeRequestedModel(request.preferredModel, "preferredModel");
  const requestModel = normalizeRequestedModel(request.model, "model");
  const maxAttempts = request.maxAttempts ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new AIProviderError("invalid_request", "AI provider attempts must be an integer from 1 to 3.");
  // The chosen (or default) provider always answers first; a cooldown hint only reorders the fallbacks behind it.
  const routed = routedProviderCandidates(request);
  const candidates = routed.length < 2 ? routed : [routed[0]!, ...orderByCooldown(routed.slice(1))];
  if (candidates.length === 0) {
    throw new AIProviderError("not_configured", "No configured AI providers are available.");
  }
  const hasImages = request.messages.some((message) => Boolean(message.images?.length));
  if (hasImages) {
    const configuredPreference = preferredProvider ?? getPreferredProvider()?.id ?? null;
    const visionCandidates = configuredPreference ? candidates.filter((provider) => provider === configuredPreference) : candidates;
    const visionProvider = visionCandidates.find((provider) => {
      const config = getProviderConfig(provider);
      if (!config) return false;
      try {
        const model = provider === preferredProvider ? preferredModel ?? requestModel : requestModel;
        return supportsImageInput(provider, resolveProviderModel(config, model));
      } catch {
        return false;
      }
    });
    if (!visionProvider) {
      throw new AIProviderError("invalid_request", "The selected AI provider/model is not verified for vision, or is blocked by Project policy. Choose a supported OpenAI GPT-4o, Anthropic Claude 4, or Gemini vision model, or remove the image.");
    }
    const config = getProviderConfig(visionProvider)!;
    const model = visionProvider === preferredProvider ? preferredModel ?? requestModel : requestModel;
    // Do not silently transmit private images to a different provider after a
    // vision endpoint fails. A subsequent attempt requires an explicit retry.
    return invokeAIProvider({ ...request, provider: visionProvider, model: model ?? resolveProviderModel(config) });
  }
  const failures: AIProviderError[] = [];
  const attempts: AIFallbackAttempt[] = [];
  for (let attempt = 0; attempt < candidates.length && attempt < maxAttempts; attempt += 1) {
    const provider = candidates[attempt]!;
    try {
      const model = provider === preferredProvider ? preferredModel ?? requestModel : requestModel;
      const answered = await invokeAIProvider({ ...request, provider, ...(model ? { model } : {}) });
      return attempts.length ? { ...answered, fallback: { attempts } } : answered;
    } catch (error) {
      if (!(error instanceof AIProviderError)) throw error;
      if (error.code === "rate_limited") noteProviderCooldown(provider, error.retryAfterMs ?? 30_000);
      failures.push(error);
      console.warn(`[byoai] ${provider} failed: code=${error.code}${error.status ? ` status=${error.status}` : ""}`);
      attempts.push({ provider, code: error.code, ...(error.status ? { status: error.status } : {}) });
      // A denial or missing entitlement is not an outage: never forward the
      // prompt to a second provider after authorization, access or model failure.
      if (error.code === "policy_denied" || !isTransientBYOAIFailure(error)) throw error;
    }
  }
  const lastFailure = failures[failures.length - 1];
  const detail = failures.map((failure) => `${failure.provider ?? "provider"}: ${failure.code}${failure.status ? ` ${failure.status}` : ""}`).join("; ");
  throw new AIProviderError(
    lastFailure?.code ?? "unavailable",
    failures.length === 1
      ? `${lastFailure.message} (${detail})`
      : `All configured AI providers failed to complete the request (${detail}).`,
    { provider: lastFailure?.provider, ...(lastFailure?.status ? { status: lastFailure.status } : {}),
      // Only when every attempted provider was rate limited is "wait this long" true for the whole request.
      ...(failures.length > 0 && failures.every(f => f.code === "rate_limited" && f.retryAfterMs !== undefined)
        ? { retryAfterMs: Math.min(...failures.map(f => f.retryAfterMs!)) } : {}) },
  );
}

async function invokeAIProviderUnverified(request: AICompletionRequest, expectedLocalCredential?: string, localIdentity?: { modelKey: string; signature: string }): Promise<AICompletionResult> {
  const config = getProviderConfig(request.provider);
  if (!config) throw new AIProviderError("invalid_provider", "AI provider is not registered.");
  const credential = providerCredential(request.provider);
  if (!credential) throw new AIProviderError("not_configured", `No credential is configured for ${request.provider}.`, { provider: request.provider });
  const model = resolveProviderModel(config, request.model);
  if (expectedLocalCredential !== undefined && credential !== expectedLocalCredential) {
    throw new AIProviderError("policy_denied", "The local endpoint changed before dispatch. Retry under the current configuration.", { provider: request.provider });
  }
  const signal = request.signal ?? AbortSignal.timeout(60_000);
  let response: Response;
  let text = "";
  let servedModel: string | undefined;
  try {
    if (request.provider === "anthropic") {
      const messages = request.messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: [
          { type: "text", text: message.content },
          ...(message.images ?? []).map((image) => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } })),
        ],
      }));
      response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": credential, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, system: request.system, messages, max_tokens: boundedMaxTokens(request.maxTokens) }), signal });
      if (!response.ok) throw responseError(config, request.provider, response, await readError(response));
      const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
      text = payload.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("") ?? "";
    } else if (request.provider === "gemini") {
      const contents = request.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [
          { text: message.content },
          ...(message.images ?? []).map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } })),
        ],
      }));
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": credential }, body: JSON.stringify({ systemInstruction: request.system ? { parts: [{ text: request.system }] } : undefined, contents, generationConfig: geminiGenerationConfig(model, request.maxTokens) }), signal });
      if (!response.ok) throw responseError(config, request.provider, response, await readError(response));
      const payload = await response.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>; promptFeedback?: { blockReason?: string } };
      text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (!text.trim()) {
        const finishReason = payload.candidates?.[0]?.finishReason;
        if (payload.promptFeedback?.blockReason) throw new AIProviderError("empty_completion", `${config.name} declined the request (${payload.promptFeedback.blockReason.toLowerCase()}).`, { provider: request.provider });
        if (finishReason === "MAX_TOKENS") throw new AIProviderError("empty_completion", `${config.name} reached its output limit before producing text.`, { provider: request.provider });
      }
    } else {
      const endpoint = openAiEndpoint(request.provider, credential);
      response = await fetch(endpoint.url, { method: "POST", headers: { "content-type": "application/json", ...endpoint.headers }, body: JSON.stringify(openAiBody(request, model, request.provider === "ollama")), signal, ...(config.isLocal ? { redirect: "error" as const } : {}) });
      if (!response.ok) throw responseError(config, request.provider, response, await readError(response));
      const payload = await response.json() as { model?: string; choices?: Array<{ message?: { content?: string } }>; message?: { content?: string } };
      if (localIdentity) {
        servedModel = payload.model?.trim();
        if (!servedModel || (servedModel !== model && servedModel !== localIdentity.modelKey)) {
          throw new AIProviderError("upstream_error", "The local server did not identify the admitted model in its response. Verify the loaded model again.", { provider: request.provider });
        }
      }
      text = request.provider === "ollama" ? payload.message?.content ?? "" : payload.choices?.[0]?.message?.content ?? "";
    }
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new AIProviderError("timeout", `${config.name} request timed out.`, { provider: request.provider });
    throw new AIProviderError("unavailable", `${config.name} is unavailable.`, { provider: request.provider });
  }

  if (!text.trim()) throw new AIProviderError("empty_completion", `${config.name} returned an empty completion.`, { provider: request.provider });
  const attributionMessages = request.messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.images?.length ? { images: message.images.map((image) => ({ mimeType: image.mimeType, byteLength: Buffer.from(image.base64, "base64").byteLength })) } : {}),
  }));
  return { provider: request.provider, model, text, ...(servedModel ? { servedModel } : {}), ...(localIdentity ? { localModelIdentity: localIdentity.signature } : {}), attribution: createAttribution({ provider: request.provider, model, prompt: JSON.stringify({ system: request.system, messages: attributionMessages }), output: text }) };
}

/** Explicit local-only embedding operation; never uses completion fallback or downloads a model. */
export async function invokeLocalEmbeddings(request: {
  provider: "ollama" | "lm_studio";
  model: string;
  inputs: string[];
  signal?: AbortSignal;
}): Promise<{ vectors: number[][]; model: string; dimensions: number }> {
  const config = getProviderConfig(request.provider);
  const model = request.model.trim();
  if (!config?.isLocal || !model || model.length > 200 || !request.inputs.length || request.inputs.length > 65
    || request.inputs.some(text => !text.trim() || text.length > 4_096)
    || Buffer.byteLength(JSON.stringify(request.inputs), "utf8") > 1_048_576) {
    throw new AIProviderError("invalid_request", "Local embedding input exceeds its bounded model/text contract.");
  }
  const credential = providerCredential(request.provider);
  if (!credential) throw new AIProviderError("not_configured", "The selected local embedding endpoint is not configured.", { provider: request.provider });
  const policyRevision = await enforceEnterpriseAiPolicy({ provider: request.provider, model, messages: [], dataClassification: "organization" }, config, model);
  await requireInstalledLocalModel(request.provider, model, resolveLocalProviderChatEndpoint(request.provider, credential), "embedding");
  const releaseRevision = await enforceEnterpriseAiPolicy({ provider: request.provider, model, messages: [], dataClassification: "organization" }, config, model);
  if (releaseRevision !== policyRevision || providerCredential(request.provider) !== credential) {
    throw new AIProviderError("policy_denied", "Local embedding policy or endpoint changed before dispatch.", { provider: request.provider });
  }
  const endpoint = new URL(resolveLocalProviderChatEndpoint(request.provider, credential));
  endpoint.pathname = request.provider === "ollama"
    ? endpoint.pathname.replace(/\/chat$/, "/embed")
    : endpoint.pathname.replace(/\/chat\/completions$/, "/embeddings");
  let response: Response;
  let value: unknown;
  try {
    response = await fetch(endpoint, {
      method: "POST", redirect: "error", signal: request.signal ?? AbortSignal.timeout(60_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: request.inputs, ...(request.provider === "ollama" ? { truncate: false } : {}) }),
    });
    if (!response.ok) throw new AIProviderError("unavailable", `Local embedding endpoint returned HTTP ${response.status}.`, { provider: request.provider, status: response.status });
    value = JSON.parse(await readBoundedText(response, 8 * 1024 * 1024));
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError("unavailable", "Local embeddings are unavailable; use lexical retrieval. No remote fallback was attempted.", { provider: request.provider });
  }
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  let rawVectors: unknown = body.embeddings;
  if (request.provider === "lm_studio" && Array.isArray(body.data)) {
    const ordered = new Array<unknown>(request.inputs.length);
    for (const item of body.data) {
      if (!item || typeof item !== "object") throw new AIProviderError("invalid_request", "Invalid local embedding response.");
      const row = item as Record<string, unknown>;
      if (!Number.isInteger(row.index) || (row.index as number) < 0 || (row.index as number) >= ordered.length || ordered[row.index as number] !== undefined) {
        throw new AIProviderError("invalid_request", "Invalid local embedding response indices.");
      }
      ordered[row.index as number] = row.embedding;
    }
    rawVectors = ordered;
  }
  if (!Array.isArray(rawVectors) || rawVectors.length !== request.inputs.length) throw new AIProviderError("invalid_request", "Local embedding response did not cover every requested input.");
  let dimensions = 0;
  const vectors: number[][] = [];
  for (const raw of rawVectors) {
    if (!Array.isArray(raw) || !raw.length || raw.length > 8_192 || raw.some(number => typeof number !== "number" || !Number.isFinite(number))) {
      throw new AIProviderError("invalid_request", "Local embedding response contains an invalid vector.");
    }
    const norm = Math.hypot(...raw);
    if (!Number.isFinite(norm) || norm === 0 || (dimensions && dimensions !== raw.length)) throw new AIProviderError("invalid_request", "Local embedding dimensions or norms are inconsistent.");
    dimensions = raw.length;
    const vector = raw as number[];
    for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
    vectors.push(vector);
  }
  if (typeof body.model !== "string" || !body.model.trim() || body.model.trim().length > 200) throw new AIProviderError("invalid_request", "Local embedding response did not identify its served model.");
  return { vectors, model: body.model.trim(), dimensions };
}
