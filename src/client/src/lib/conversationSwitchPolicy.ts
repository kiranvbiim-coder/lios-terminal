/** Only presentation/draft state. No backend, storage, permission or provider logic. */
export interface UnsentConversationDraft {
  text: string;
  attachmentFiles: number;
  attachmentRefs: number;
  voiceTranscripts: number;
}

export function hasUnsentConversationDraft(draft: UnsentConversationDraft): boolean {
  return Boolean(draft.text.trim()) || draft.attachmentFiles > 0 || draft.attachmentRefs > 0 || draft.voiceTranscripts > 0;
}

export function remainingChatMode(projectId: number | null): "project" | "quick" {
  return projectId === null ? "quick" : "project";
}

/** Stable recent list: one row per saved conversation; no archived/trashed entries. */
export function canonicalRecentChats<T extends { id: number; status: string; trashedAt?: string | Date | null; lastActivityAt: string | Date }>(
  saved: readonly T[],
  quick: readonly T[],
  limit = 14,
): T[] {
  const unique = new Map<number, T>();
  for (const chat of [...saved, ...quick]) {
    if (chat.status !== "active" || chat.trashedAt) continue;
    const prior = unique.get(chat.id);
    if (!prior || safeActivityTime(chat.lastActivityAt) > safeActivityTime(prior.lastActivityAt)) unique.set(chat.id, chat);
  }
  return [...unique.values()]
    .sort((a, b) => safeActivityTime(b.lastActivityAt) - safeActivityTime(a.lastActivityAt) || b.id - a.id)
    .slice(0, Math.max(0, limit));
}

function safeActivityTime(value: string | Date): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
