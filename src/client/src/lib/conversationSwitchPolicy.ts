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

/** Never clear an unsent draft when a server mutation or owner check fails. */
export function shouldDiscardAfterSuccessfulTransition(succeeded: boolean, wasConfirmed: boolean): boolean {
  return succeeded && wasConfirmed;
}
