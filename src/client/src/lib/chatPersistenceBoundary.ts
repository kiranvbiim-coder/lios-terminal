import type { ConversationRequest, ConversationSourceScope } from "@shared/conversationRuntime";

export type ChatPersistenceMode = "quick" | "project" | "temporary";
export type SavedChatSelection = { projectId: number | null; chatId: number | null };

/** Temporary means NO selected saved Project or Chat, including URL/bookmarks. */
export function selectionForTemporaryChat(): SavedChatSelection {
  return { projectId: null, chatId: null };
}

/** A local ephemeral run cannot quietly inherit the selected saved Artifact or Project text. */
export function contextForChatMode(
  mode: ChatPersistenceMode,
  context: ConversationRequest["context"],
): ConversationRequest["context"] {
  return mode === "temporary" ? undefined : context;
}

/**
 * Source dropdown choice from a saved Project is not an authorization grant
 * for a new Temporary Chat. The fresh ephemeral run starts with Auto.
 */
export function sourceScopeForChatMode(
  mode: ChatPersistenceMode,
  scope: ConversationSourceScope,
): ConversationSourceScope {
  return mode === "temporary" ? "auto" : scope;
}

/** A Temporary Chat never loads/saves a server Chat message history. */
export function savedChatIdForMode(mode: ChatPersistenceMode, chatId: number | null): number | null {
  return mode === "temporary" ? null : chatId;
}

/**
 * Only remove a location hash when it is an actual LiOS saved-work address.
 * Unrelated application hash anchors must remain untouched.
 */
export function shouldClearSavedChatAddress(
  next: SavedChatSelection,
  currentHashIsLiosAddress: boolean,
): boolean {
  return next.projectId === null && next.chatId === null && currentHashIsLiosAddress;
}
