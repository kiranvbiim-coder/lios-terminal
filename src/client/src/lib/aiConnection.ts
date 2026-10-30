import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/** Server-owned AI permission for this account (GET/PUT /api/wave-c/ai/state). */
export interface AiChatPermission {
  state: "on" | "off";
  mode: "manual" | "ai_assist" | "ai_build" | "ai_scenario";
  updatedAt?: string | null;
}

/** The subset of /api/setup/status this flow reads. Credentials never appear here, only slot names. */
export interface AiProviderChoice {
  id: string;
  name: string;
  available: boolean;
  isLocal: boolean;
  models: string[];
  credentialName: string;
  defaultModel: string;
  allowCustomModel: boolean;
  defaultEndpoint?: string;
  endpointEnvironmentManaged?: boolean;
}

export interface AiSetupSelection {
  selectedConnectorIds: string[];
  providerStackOrder?: string[];
  pythonRuntimeId: string;
  pythonEnvironmentPath?: string | null;
  pythonPackIds: string[];
  aiProviderId: string | null;
  aiModelId: string | null;
}

export interface AiSetupStatus {
  setupNeeded: boolean;
  setup: AiSetupSelection | null;
  aiProviders: AiProviderChoice[];
}

export const AI_PERMISSION_KEY = ["/api/wave-c/ai/state"];
export const SETUP_STATUS_KEY = ["/api/setup/status"];

/** Refusal code from Chat when no verified AI is connected (server/masterAiGate.ts). */
export const AI_NOT_CONNECTED_CODE = "ai_not_connected";

/** Providers offered on the Connect your AI step, in display order. */
export const CONNECT_AI_PROVIDER_IDS = ["openai", "anthropic", "gemini", "mistral", "groq", "together", "ollama", "lm_studio"] as const;

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  mistral: "Mistral",
  groq: "Groq",
  together: "Together AI",
  ollama: "Ollama",
  lm_studio: "LM Studio",
};

export function aiProviderLabel(provider: Pick<AiProviderChoice, "id" | "name">): string {
  return PROVIDER_LABELS[provider.id] ?? provider.name.replace(/\s*\(local\)\s*$/i, "");
}

/**
 * - not_required: new work is not allowed (trial/license gate owns the screen) or access is unknown.
 * - checking: waiting for the server.
 * - ready: a verified AI is connected and allowed for Chat.
 * - reconnect: a provider is saved but must be checked again (e.g. after a restart or a key change).
 * - connect: no usable provider; the user must connect one before Chat.
 */
export type AiConnectionGate = "not_required" | "checking" | "ready" | "reconnect" | "connect";

export function decideAiConnectionGate(input: {
  newWorkAllowed: boolean;
  permission: AiChatPermission | undefined;
  permissionUnavailable: boolean;
  setup: AiSetupStatus | undefined;
  setupUnavailable?: boolean;
}): AiConnectionGate {
  if (!input.newWorkAllowed) return "not_required";
  if (input.permission?.state === "on") return "ready";
  // Status that cannot load never opens Chat silently: Chat itself is refused by the server and asks to reconnect.
  if (!input.setup && input.setupUnavailable) return "reconnect";
  if (!input.setup || (!input.permission && !input.permissionUnavailable)) return "checking";
  return savedAiProvider(input.setup) ? "reconnect" : "connect";
}

/** The saved provider/model when its key or local address is still present. */
export function savedAiProvider(setup: AiSetupStatus | undefined): { provider: AiProviderChoice; model: string } | null {
  const providerId = setup?.setup?.aiProviderId;
  const model = setup?.setup?.aiModelId?.trim();
  if (!providerId || !model) return null;
  const provider = setup.aiProviders.find((item) => item.id === providerId);
  return provider?.available ? { provider, model } : null;
}

export function useAiConnectionGate(newWorkAllowed: boolean) {
  const permission = useQuery<AiChatPermission>({
    queryKey: AI_PERMISSION_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/wave-c/ai/state")).json(),
    enabled: newWorkAllowed,
    staleTime: 5_000,
  });
  const setup = useQuery<AiSetupStatus>({
    queryKey: SETUP_STATUS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/setup/status")).json(),
    enabled: newWorkAllowed,
    staleTime: 15_000,
  });
  return {
    gate: decideAiConnectionGate({ newWorkAllowed, permission: permission.data, permissionUnavailable: permission.isError, setup: setup.data, setupUnavailable: setup.isError }),
    setup: setup.data,
    permission: permission.data,
  };
}

/** Plain text for a failed step; provider error bodies arrive as `{ error: { code, message } }`. */
export function aiConnectionErrorText(error: unknown, providerName: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const body = raw.replace(/^\d+:\s*/, "");
  let code: string | undefined;
  let message: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: unknown; code?: unknown };
    if (typeof parsed.error === "string") message = parsed.error;
    else if (parsed.error && typeof parsed.error === "object") {
      const nested = parsed.error as { code?: unknown; message?: unknown };
      code = typeof nested.code === "string" ? nested.code : undefined;
      message = typeof nested.message === "string" ? nested.message : undefined;
    }
  } catch { message = body; }
  if (code === "rate_limited" || code === "quota_exhausted") return `${providerName} is limiting requests on this account right now. Try again shortly or check your plan.`;
  if (code === "timeout") return `${providerName} did not answer in time. Check that it is running or reachable, then try again.`;
  if (code === "not_configured") return `${providerName} is not set up yet. Add your key or start the app, then try again.`;
  if (code === "upstream_error" || code === "unavailable" || code === "empty_completion") return `${providerName} could not be reached or did not accept this key and model. Check them and try again.`;
  return message?.trim() ? message.trim().slice(0, 240) : `${providerName} could not be connected. Try again.`;
}

async function saveAiSelection(setup: AiSetupStatus | undefined, providerId: string, modelId: string): Promise<void> {
  const current = setup?.setup;
  await apiRequest("PUT", "/api/setup/status", {
    selectedConnectorIds: current?.selectedConnectorIds ?? [],
    providerStackOrder: current?.providerStackOrder ?? current?.selectedConnectorIds ?? [],
    pythonRuntimeId: current?.pythonRuntimeId ?? "lios-managed",
    pythonEnvironmentPath: current?.pythonEnvironmentPath ?? null,
    pythonPackIds: current?.pythonPackIds ?? ["core"],
    aiProviderId: providerId,
    aiModelId: modelId,
    complete: true,
  });
}

/** Saves a cloud key in the existing credential vault. */
export async function saveCloudKey(provider: AiProviderChoice, key: string): Promise<void> {
  await apiRequest("PUT", `/api/setup/credentials/${encodeURIComponent(provider.credentialName)}`, { value: key.trim(), label: `${aiProviderLabel(provider)} key` });
}

/** Finds the models a local server offers; saves the address first when it is new. Contacts only that address. */
export async function detectLocalModels(provider: AiProviderChoice, address?: string): Promise<{ endpoint: string; models: string[] }> {
  const chosen = address?.trim();
  if (chosen || !provider.available) {
    const value = chosen || provider.defaultEndpoint;
    if (!value) throw new Error(`Enter the address of your ${aiProviderLabel(provider)} server.`);
    await apiRequest("PUT", `/api/setup/credentials/${encodeURIComponent(provider.credentialName)}`, { value, label: `${aiProviderLabel(provider)} address` });
  }
  const discovery = await (await apiRequest("POST", "/api/setup/ai/models", { provider: provider.id })).json() as { endpoint: string; models: string[] };
  return { endpoint: discovery.endpoint, models: discovery.models };
}

/** Saves the selection, then runs the existing live check (one short test message to the provider). */
export async function verifyAiSelection(input: { setup: AiSetupStatus | undefined; provider: AiProviderChoice; model: string; endpoint?: string }): Promise<void> {
  await saveAiSelection(input.setup, input.provider.id, input.model.trim());
  await apiRequest("POST", "/api/setup/ai/test", {
    provider: input.provider.id,
    model: input.model.trim(),
    ...(input.provider.isLocal && input.endpoint ? { endpoint: input.endpoint } : {}),
  });
}

/** The user's explicit Continue: allow the verified AI for Chat through the existing permission route. */
export async function allowAiForChat(queryClient: QueryClient, mode: AiChatPermission["mode"] = "ai_assist"): Promise<void> {
  const saved = await (await apiRequest("PUT", "/api/wave-c/ai/state", { state: "on", mode })).json() as AiChatPermission;
  queryClient.setQueryData(AI_PERMISSION_KEY, saved);
}

export async function refreshAiConnection(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY }),
    queryClient.invalidateQueries({ queryKey: AI_PERMISSION_KEY }),
  ]);
}

/** One-click reconnect of the saved provider: check it again, then allow it for Chat. */
export async function reconnectSavedAi(queryClient: QueryClient, setup: AiSetupStatus | undefined, permission: AiChatPermission | undefined): Promise<void> {
  const saved = savedAiProvider(setup);
  if (!saved) throw new Error("No saved AI to reconnect. Choose an AI to connect.");
  try {
    let endpoint: string | undefined;
    if (saved.provider.isLocal) {
      const found = await detectLocalModels(saved.provider);
      if (!found.models.includes(saved.model)) throw new Error(`${aiProviderLabel(saved.provider)} no longer offers ${saved.model}. Choose another model.`);
      endpoint = found.endpoint;
    }
    await verifyAiSelection({ setup, provider: saved.provider, model: saved.model, endpoint });
    await allowAiForChat(queryClient, permission?.mode && permission.mode !== "manual" ? permission.mode : "ai_assist");
  } finally {
    await refreshAiConnection(queryClient);
  }
}
