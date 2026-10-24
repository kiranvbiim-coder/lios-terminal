/**
 * BYOAI Provider Router: user-controlled AI provider selection and
 * MCP tool permission layer. AI is optional — the terminal works
 * without it. When enabled, the user supplies their own API key,
 * selects a provider, and AI can only call explicitly approved tools.
 *
 * Design rules:
 * - AI is subordinate to deterministic engines — it explains,
 *   summarizes, maps, and orchestrates, but never invents numbers.
 * - AI confidence is always separate from data/model confidence.
 * - Every AI call records attribution (prompt hash, output hash,
 *   provider, model, tool calls).
 * - Client data never reaches external AI unless the user's policy
 *   explicitly allows it.
 */
import crypto from "crypto";
import { resolveCredential } from "./credentialVault";
import { classifyLiOSAIProviderAccess, type LiOSAIProviderAccessContract } from "./openclawAiAccessMethod";

// ─── Provider Registry ────────────────────────────────────────────────────

export type AIProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "groq"
  | "together"
  | "openrouter"
  | "xai"
  | "openai_compatible"
  | "ollama"
  | "lm_studio"
  | "azure_openai";

export interface AIProviderConfig {
  id: AIProviderType;
  name: string;
  envKey: string;
  vaultKey: string;
  defaultModel: string;
  models: string[];
  supportsStreaming: boolean;
  isLocal: boolean;
  /** Optional non-secret environment configuration required before selection. */
  requiredEnvKeys?: string[];
  /** Optional environment variable that overrides the provider's default model. */
  modelEnvKey?: string;
  /** Allows callers to provide model IDs not present in the curated models list. */
  allowCustomModel?: boolean;
  /** Suggested loopback endpoint; never connected or scanned without user action. */
  defaultEndpoint?: string;
}
export type AIProviderErrorCode =
  | "invalid_provider"
  | "invalid_request"
  | "not_configured"
  | "unavailable"
  | "rate_limited"
  | "quota_exhausted"
  | "timeout"
  | "upstream_error"
  | "empty_completion"
  | "policy_denied";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly provider?: AIProviderType;
  readonly status?: number;

  constructor(
    code: AIProviderErrorCode,
    message: string,
    details: { provider?: AIProviderType; status?: number } = {},
  ) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.provider = details.provider;
    this.status = details.status;
  }

  toJSON(): { code: AIProviderErrorCode; message: string; provider?: AIProviderType; status?: number } {
    return {
      code: this.code,
      message: this.message,
      ...(this.provider ? { provider: this.provider } : {}),
      ...(this.status === undefined ? {} : { status: this.status }),
    };
  }
}

export const AI_PROVIDERS: AIProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    vaultKey: "anthropicApiKey",
    defaultModel: "claude-sonnet-4-20250514",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-3"],
    supportsStreaming: true,
    isLocal: false,
    allowCustomModel: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    vaultKey: "geminiApiKey",
    defaultModel: "gemini-3.5-flash-lite",
    models: ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    supportsStreaming: true,
    isLocal: false,
    allowCustomModel: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    vaultKey: "openaiApiKey",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    supportsStreaming: true,
    isLocal: false,
    allowCustomModel: true,
  },
  {
    id: "mistral",
    name: "Mistral AI",
    envKey: "MISTRAL_API_KEY",
    vaultKey: "mistralApiKey",
    defaultModel: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-small-latest"],
    supportsStreaming: true,
    isLocal: false,
    allowCustomModel: true,
    modelEnvKey: "MISTRAL_MODEL",
  },
  {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    vaultKey: "groqApiKey",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile"],
    supportsStreaming: true,
    isLocal: false,
    allowCustomModel: true,
    modelEnvKey: "GROQ_MODEL",
  },
  {
    id: "together",
    name: "Together AI",
    envKey: "TOGETHER_API_KEY",
    vaultKey: "togetherApiKey",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    supportsStreaming: true,
    isLocal: false,
    allowCustomModel: true,
    modelEnvKey: "TOGETHER_MODEL",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    vaultKey: "openrouterApiKey",
    defaultModel: "anthropic/claude-sonnet-4",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-3.5-flash-lite", "google/gemini-3.8-flash"],
    supportsStreaming: true,
    isLocal: false,
    allowCustomModel: true,
  },
  {
    id: "xai",
    name: "xAI / Grok",
    envKey: "XAI_API_KEY",
    vaultKey: "xaiApiKey",
    defaultModel: "grok-4.6",
    models: ["grok-4.6", "grok-4.3", "grok-4.20"],
    supportsStreaming: true,
    isLocal: false,
    allowCustomModel: true,
  },
  {
    id: "openai_compatible",
    name: "OpenAI-Compatible Endpoint",
    envKey: "OPENAI_COMPATIBLE_API_KEY",
    vaultKey: "openaiCompatibleApiKey",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
    supportsStreaming: true,
    isLocal: false,
    requiredEnvKeys: ["OPENAI_COMPATIBLE_BASE_URL"],
    modelEnvKey: "OPENAI_COMPATIBLE_MODEL",
    allowCustomModel: true,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    envKey: "OLLAMA_BASE_URL",
    vaultKey: "ollamaBaseUrl",
    defaultModel: "llama3.1",
    models: ["llama3.1", "mistral", "codellama", "phi-3"],
    supportsStreaming: true,
    isLocal: true,
    modelEnvKey: "OLLAMA_MODEL",
    allowCustomModel: true,
    defaultEndpoint: "http://127.0.0.1:11434",
  },
  {
    id: "lm_studio",
    name: "LM Studio (Local)",
    envKey: "LM_STUDIO_BASE_URL",
    vaultKey: "lmStudioBaseUrl",
    defaultModel: "local-model",
    models: ["local-model"],
    supportsStreaming: true,
    isLocal: true,
    modelEnvKey: "LM_STUDIO_MODEL",
    allowCustomModel: true,
    defaultEndpoint: "http://127.0.0.1:1234/v1",
  },
  {
    id: "azure_openai",
    name: "Azure OpenAI",
    envKey: "AZURE_OPENAI_API_KEY",
    vaultKey: "azureOpenaiApiKey",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini"],
    supportsStreaming: true,
    isLocal: false,
    requiredEnvKeys: ["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"],
  },
];

// ─── Provider Selection ───────────────────────────────────────────────────

export interface ProviderAvailability {
  id: AIProviderType;
  name: string;
  available: boolean;
  isLocal: boolean;
  models: string[];
}

export interface AIProviderSetupOption extends ProviderAvailability {
  /** Executable access only. A consumer chat subscription is not an API credential. */
  access: LiOSAIProviderAccessContract;
  /** Safe credential slot identifier; never a credential value. */
  credentialName: string;
  requiresExternalConfig: boolean;
  defaultModel: string;
  allowCustomModel: boolean;
  defaultEndpoint?: string;
  endpointEnvironmentManaged?: boolean;
}

function hasRequiredProviderConfig(provider: AIProviderConfig): boolean {
  return (provider.requiredEnvKeys ?? []).every((envKey) => Boolean(process.env[envKey]?.trim()));
}

function hasProviderCredential(provider: AIProviderConfig): boolean {
  const credential = resolveCredential(provider.envKey, provider.vaultKey);
  return Boolean(credential && credential.length > 0 && hasRequiredProviderConfig(provider));
}

export function normalizeProviderId(providerId: string): AIProviderType | null {
  const normalized = providerId.trim().toLowerCase().replace(/[-\s]+/g, "_");
  const aliases: Record<string, AIProviderType> = {
    anthropic: "anthropic",
    gemini: "gemini",
    google: "gemini",
    google_gemini: "gemini",
    openai: "openai",
    mistral: "mistral",
    groq: "groq",
    together: "together",
    together_ai: "together",
    openrouter: "openrouter",
    xai: "xai",
    grok: "xai",
    xai_grok: "xai",
    openai_compatible: "openai_compatible",
    openai_compat: "openai_compatible",
    ollama: "ollama",
    local: "ollama",
    lm_studio: "lm_studio",
    lmstudio: "lm_studio",
    azure_openai: "azure_openai",
    azure: "azure_openai",
  };
  return aliases[normalized] ?? null;
}

export function getAvailableProviders(): ProviderAvailability[] {
  return AI_PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    available: hasProviderCredential(provider),
    isLocal: provider.isLocal,
    models: [...provider.models],
  }));
}

export function getProviderSetupOptions(): AIProviderSetupOption[] {
  const availability = new Map(getAvailableProviders().map((provider) => [provider.id, provider]));
  return AI_PROVIDERS.map((provider) => ({
    ...availability.get(provider.id)!,
    credentialName: provider.vaultKey,
    access: classifyLiOSAIProviderAccess(provider.id),
    requiresExternalConfig: (provider.requiredEnvKeys?.length ?? 0) > 0,
    defaultModel: provider.defaultModel,
    allowCustomModel: provider.allowCustomModel === true,
    ...(provider.defaultEndpoint ? {
      defaultEndpoint: provider.defaultEndpoint,
      endpointEnvironmentManaged: Boolean(process.env[provider.envKey]?.trim()),
    } : {}),
  }));
}

export function getPreferredProvider(): AIProviderConfig | null {
  for (const provider of AI_PROVIDERS) {
    if (hasProviderCredential(provider)) return provider;
  }
  return null;
}

export function getProviderConfig(providerId: AIProviderType | string): AIProviderConfig | undefined {
  const normalized = normalizeProviderId(providerId);
  return normalized ? AI_PROVIDERS.find((provider) => provider.id === normalized) : undefined;
}

export function isAIEnabled(): boolean {
  return getPreferredProvider() !== null;
}

// ─── MCP Tool Permission Layer ────────────────────────────────────────────

export type ToolCategory = "read" | "compute" | "write" | "external";

export interface MCPToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  /** Data contract families this tool accesses */
  dataAccess: string[];
  /** Whether this tool modifies state */
  isWrite: boolean;
  /** Whether this tool sends data to external services */
  isExternal: boolean;
  /** Whether this tool requires explicit user approval per call */
  requiresApproval: boolean;
}

export const MCP_TOOL_REGISTRY: MCPToolDefinition[] = [
  // Read-only data tools
  { id: "lios.quote", name: "Market Quote", description: "Get current market quote for a symbol", category: "read", dataAccess: ["market_data"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.financials", name: "Financial Statements", description: "Get financial statements for a company", category: "read", dataAccess: ["financial_statements"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.estimates", name: "Analyst Estimates", description: "Get consensus estimates", category: "read", dataAccess: ["estimates"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.macro", name: "Economic Indicators", description: "Get macro/economic data", category: "read", dataAccess: ["macro"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.research_search", name: "Research Search", description: "Search filings, news, and research", category: "read", dataAccess: ["filings"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.portfolio", name: "Portfolio Holdings", description: "Read portfolio holdings", category: "read", dataAccess: ["portfolio"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.calculation_job", name: "Calculation Job", description: "Read the caller's durable deterministic calculation job status and result", category: "read", dataAccess: ["calculation_jobs"], isWrite: false, isExternal: false, requiresApproval: false },

  // Compute tools (deterministic engines)
  { id: "lios.dcf", name: "DCF Valuation", description: "Run DCF valuation model", category: "compute", dataAccess: ["financial_statements", "market_data", "assumptions"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.wacc", name: "WACC Calculator", description: "Compute WACC", category: "compute", dataAccess: ["market_data", "financial_statements"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.var", name: "Value at Risk", description: "Compute portfolio VaR", category: "compute", dataAccess: ["portfolio", "price_history"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.bond_price", name: "Bond Pricer", description: "Price a fixed income instrument", category: "compute", dataAccess: ["fixed_income"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.options_greeks", name: "Options Greeks", description: "Compute option Greeks", category: "compute", dataAccess: ["derivatives"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.macro_shock", name: "Macro Shock", description: "Run macro shock scenario", category: "compute", dataAccess: ["macro", "portfolio"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.factor_risk_capture", name: "Factor Risk Capture", description: "Queue a durable deterministic factor-risk snapshot calculation", category: "compute", dataAccess: ["market_data", "price_history"], isWrite: false, isExternal: false, requiresApproval: false },
  { id: "lios.scenario_pipeline", name: "Scenario-to-Action Pipeline", description: "Queue the deterministic financial scenario, valuation, risk, and action pipeline", category: "compute", dataAccess: ["financial_statements", "portfolio", "assumptions"], isWrite: false, isExternal: false, requiresApproval: false },

  // Write tools (require approval)
  { id: "lios.create_workspace", name: "Create Workspace", description: "Create a new research workspace", category: "write", dataAccess: [], isWrite: true, isExternal: false, requiresApproval: true },
  { id: "lios.log_decision", name: "Log Decision", description: "Record a decision case", category: "write", dataAccess: [], isWrite: true, isExternal: false, requiresApproval: true },

  // External tools (require approval, send data out)
  { id: "lios.web_search", name: "Web Search", description: "Search the web for information", category: "external", dataAccess: [], isWrite: false, isExternal: true, requiresApproval: true },
];

export interface ToolPermissionPolicy {
  /** Allowed tool IDs (empty = all registered tools allowed) */
  allowedTools: string[];
  /** Blocked tool IDs (takes precedence over allowed) */
  blockedTools: string[];
  /** Whether write tools require explicit per-call approval */
  requireWriteApproval: boolean;
  /** Whether external tools require explicit per-call approval */
  requireExternalApproval: boolean;
  /** Data contract families that AI is NOT allowed to access */
  blockedDataAccess: string[];
}

export const DEFAULT_TOOL_POLICY: ToolPermissionPolicy = {
  allowedTools: [],
  blockedTools: [],
  requireWriteApproval: true,
  requireExternalApproval: true,
  blockedDataAccess: [],
};

export interface ToolPermissionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export function evaluateToolPermission(
  toolId: string,
  policy: ToolPermissionPolicy = DEFAULT_TOOL_POLICY,
): ToolPermissionDecision {
  const tool = MCP_TOOL_REGISTRY.find((t) => t.id === toolId);
  if (!tool) return { allowed: false, requiresApproval: false, reason: "tool_not_registered" };

  if (policy.blockedTools.includes(toolId)) {
    return { allowed: false, requiresApproval: false, reason: "tool_explicitly_blocked" };
  }

  if (policy.allowedTools.length > 0 && !policy.allowedTools.includes(toolId)) {
    return { allowed: false, requiresApproval: false, reason: "tool_not_in_allowed_list" };
  }

  // Check data access restrictions
  for (const access of tool.dataAccess) {
    if (policy.blockedDataAccess.includes(access)) {
      return { allowed: false, requiresApproval: false, reason: `data_access_blocked:${access}` };
    }
  }

  const requiresApproval =
    tool.requiresApproval ||
    (tool.isWrite && policy.requireWriteApproval) ||
    (tool.isExternal && policy.requireExternalApproval);

  return { allowed: true, requiresApproval, reason: "permitted" };
}

// ─── AI Attribution ───────────────────────────────────────────────────────

export interface AICallAttribution {
  id: string;
  provider: AIProviderType;
  model: string;
  promptHash: string;
  outputHash: string;
  toolsCalled: string[];
  dataAccessed: string[];
  timestamp: string;
  tokenCount?: { prompt: number; completion: number };
}

export function createAttribution(input: {
  provider: AIProviderType;
  model: string;
  prompt: string;
  output: string;
  toolsCalled?: string[];
  dataAccessed?: string[];
  tokenCount?: { prompt: number; completion: number };
}): AICallAttribution {
  return {
    id: crypto.randomUUID(),
    provider: input.provider,
    model: input.model,
    promptHash: crypto.createHash("sha256").update(input.prompt).digest("hex"),
    outputHash: crypto.createHash("sha256").update(input.output).digest("hex"),
    toolsCalled: input.toolsCalled ?? [],
    dataAccessed: input.dataAccessed ?? [],
    timestamp: new Date().toISOString(),
    tokenCount: input.tokenCount,
  };
}
