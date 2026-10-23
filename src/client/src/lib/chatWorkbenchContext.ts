import { restoreWorkingContext } from "@shared/workingContext";
import type { ChatWorkbenchMode } from "./chatWorkbenchHandoff";

/** Read-only projection of server-owned conversational Working Context into navigation. */
export interface ChatWorkbenchSelection {
  mode: ChatWorkbenchMode;
  projectId: number | null;
  chatId: number | null;
  messages: readonly { role: string; metadata: Record<string, unknown> }[];
  temporaryContext?: unknown;
}

/**
 * Never derive financial identity from a default terminal ticker, model prose,
 * an unrelated Chat's metadata, or a multi-company comparison.
 * The server's P5 identity, source and field permissions still govern panel data.
 */
export function resolveScopedWorkbenchSymbol(input: ChatWorkbenchSelection): string | null {
  const owner = {
    scope: input.mode,
    projectId: input.mode === "project" ? input.projectId : null,
    chatId: input.mode === "temporary" ? null : input.chatId,
  };
  const latestAssistant = input.mode === "temporary"
    ? null
    : [...input.messages].reverse().find(message => message.role === "assistant");
  const raw = input.mode === "temporary"
    ? input.temporaryContext
    : latestAssistant?.metadata?.workingContext;
  const snapshot = restoreWorkingContext(raw, owner);
  if (!snapshot || snapshot.entities.length !== 1) return null;
  const entity = snapshot.entities[0]!;
  // Ambient Workbench symbols are deliberately low-confidence navigation context.
  if (entity.source === "workspace") return null;
  return entity.symbol;
}
