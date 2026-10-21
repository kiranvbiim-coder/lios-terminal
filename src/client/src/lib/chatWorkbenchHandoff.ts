/**
 * Navigation-only Chat → Workbench origin. It does not grant access to any Project,
 * Chat, source or Artifact: their existing server-owned routes must authorize reads.
 */
export type ChatWorkbenchMode = "project" | "quick" | "temporary";
export interface ChatWorkbenchOrigin {
  mode: ChatWorkbenchMode;
  projectId: number | null;
  chatId: number | null;
  /** Verified unique conversation symbol; navigation hint only, never a P5 rights grant. */
  symbol?: string;
}

function validId(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

/** No saved Chat or ticker/Artifact is invented to open the full existing Workbench. */
export function captureChatWorkbenchOrigin(
  mode: ChatWorkbenchMode, projectId: number | null, chatId: number | null, symbol?: string | null,
): ChatWorkbenchOrigin {
  const validatedSymbol = typeof symbol === "string" && /^[A-Z0-9][A-Z0-9.\\-]{0,15}$/.test(symbol) ? symbol : null;
  const hint = validatedSymbol ? { symbol: validatedSymbol } : {};
  if (mode === "temporary") return { mode, projectId: null, chatId: null, ...hint };
  if (mode === "quick") return { mode, projectId: null, chatId: validId(chatId) ? chatId : null, ...hint };
  const scopedProjectId = validId(projectId) ? projectId : null;
  return { mode, projectId: scopedProjectId, chatId: scopedProjectId && validId(chatId) ? chatId : null, ...hint };
}

/**
 * Return does not touch P4 Artifacts, saved layout or edited Workbench panes.
 * Never leave an unsaved Workbench draft behind.
 */
export function returnToChatWorkbenchOrigin(
  origin: ChatWorkbenchOrigin | null, dirty: boolean,
): ChatWorkbenchOrigin | null {
  return !dirty && origin ? { ...origin } : null;
}
