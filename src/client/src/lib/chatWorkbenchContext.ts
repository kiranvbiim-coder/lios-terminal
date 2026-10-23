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
  // A new user question supersedes the older assistant's entity selection
  // even before its response arrives. Otherwise a general Chat can open an
  // unrelated finance/security tab by borrowing a stale prior-turn ticker.
  // Tool/system messages do not themselves establish a new user-facing turn.
  const latestTurn = [...input.messages].reverse().find(message => message.role === "assistant" || message.role === "user");
  const raw = input.mode === "temporary"
    // Temporary messages stay in local memory; while a newer user turn is
    // unanswered, its previous in-memory entity is not a current navigation hint.
    ? latestTurn?.role === "user" ? null : input.temporaryContext
    : latestTurn?.role === "assistant" ? latestTurn.metadata?.workingContext : null;
  const snapshot = restoreWorkingContext(raw, owner);
  if (!snapshot || snapshot.entities.length !== 1) return null;
  const entity = snapshot.entities[0]!;
  // Ambient Workbench symbols are deliberately low-confidence navigation context.
  if (entity.source === "workspace") return null;
  return entity.symbol;
}
