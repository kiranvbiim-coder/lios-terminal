import type { WorkSearchResult } from "@shared/workSearch";

type SavedChatOwner = {
  id: number;
  projectId: number | null;
  scope: "quick" | "project";
  status: string;
  trashedAt: string | null;
};

/**
 * Re-check identity before following a result. The server remains the
 * authorization boundary; this rejects stale or mismatched references rather
 * than guessing another accessible destination.
 */
export function matchesSavedSearchChat(result: WorkSearchResult, chat: SavedChatOwner): boolean {
  return (result.kind === "chat" || result.kind === "artifact")
    && result.chatId === chat.id
    && result.projectId === chat.projectId
    && chat.scope === (chat.projectId === null ? "quick" : "project")
    && chat.status === "active"
    && chat.trashedAt === null;
}

/** Never close the search dialog unless its target actually opened. */
export function shouldCloseSearchAfterNavigation(opened: boolean): boolean {
  return opened === true;
}