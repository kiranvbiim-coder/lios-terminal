/**
 * Quiet entry: an authenticated user lands in a chat composer, never on a
 * dashboard. These pure rules decide what is restored and which surface shows.
 */

export interface EntrySelection {
  projectId: number | null;
  chatId: number | null;
}

/** A LiOS address in the URL wins over the remembered (localStorage) selection. */
export function resolveInitialSelection(
  fromAddress: EntrySelection | null,
  remembered: EntrySelection,
): EntrySelection {
  return fromAddress ? { projectId: fromAddress.projectId, chatId: fromAddress.chatId } : remembered;
}

export type ConversationMode = "project" | "quick" | "temporary";

/** Quick unless a Project is already deliberately selected. */
export function resolveInitialChatMode(selection: EntrySelection): ConversationMode {
  return selection.projectId ? "project" : "quick";
}

export type EntrySurface = "project-home" | "conversation";

/**
 * Project Home appears only when the user deliberately opened it (Projects
 * rail) and no chat is open. With no chat and no request the composer shows,
 * ready for a new Quick/Project chat; a restored chat always wins.
 */
export function resolveEntrySurface(input: {
  chatMode: ConversationMode;
  chatId: number | null;
  projectHomeRequested: boolean;
  projectHomeAvailable: boolean;
}): EntrySurface {
  if (input.chatMode === "temporary" || input.chatId) return "conversation";
  return input.projectHomeRequested && input.projectHomeAvailable ? "project-home" : "conversation";
}
