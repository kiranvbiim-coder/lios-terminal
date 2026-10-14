export type AiModelAccessState = "verified" | "unknown" | "blocked";

export interface AiModelAccessInput {
  modelId: string;
  discoveredModels?: readonly string[] | null;
  discoveryComplete?: boolean;
}

/**
 * Provider model discovery is authoritative only when it is complete.
 *
 * - Returned model => verified, even from a partial page.
 * - Missing from a partial page => unknown; later pages may contain it.
 * - Missing from a complete list => blocked; do not enable/transmit with it.
 * - No discovery/model => unknown; curated IDs are not silently treated as verified.
 */
export function resolveAiModelAccess({
  modelId,
  discoveredModels,
  discoveryComplete = false,
}: AiModelAccessInput): AiModelAccessState {
  const selected = modelId.trim();
  if (!selected || !discoveredModels) return "unknown";
  if (discoveredModels.includes(selected)) return "verified";
  return discoveryComplete ? "blocked" : "unknown";
}

export function aiModelAccessMessage(state: AiModelAccessState): string | null {
  if (state !== "blocked") return null;
  return "The selected model was not returned by the provider's complete chat-capable model list. Choose a returned model or disable the AI provider before saving.";
}
