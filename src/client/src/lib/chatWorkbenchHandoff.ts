/** Navigation-only origin from PR #96; P4 and server routes retain authority. */
export type ChatWorkbenchMode = "project" | "quick" | "temporary";
export interface ChatWorkbenchOrigin { mode: ChatWorkbenchMode; projectId: number | null; chatId: number | null }
function validId(value: number | null): value is number { return value !== null && Number.isSafeInteger(value) && value > 0; }
export function captureChatWorkbenchOrigin(mode: ChatWorkbenchMode, projectId: number | null, chatId: number | null): ChatWorkbenchOrigin {
  if (mode === "temporary") return { mode, projectId: null, chatId: null };
  if (mode === "quick") return { mode, projectId: null, chatId: validId(chatId) ? chatId : null };
  const scopedProjectId = validId(projectId) ? projectId : null;
  return { mode, projectId: scopedProjectId, chatId: scopedProjectId && validId(chatId) ? chatId : null };
}
export function returnToChatWorkbenchOrigin(origin: ChatWorkbenchOrigin | null, dirty: boolean): ChatWorkbenchOrigin | null {
  return !dirty && origin ? { ...origin } : null;
}
