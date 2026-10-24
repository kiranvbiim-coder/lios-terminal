/**
 * Turn-level Chat answer custody. A real P4 write can succeed when a tool
 * returns no narration. Do not leave those persisted IDs/versions stranded
 * with no saved Chat message to hold their canonical Artifact cards.
 *
 * This does not create an Artifact, grant access, or save Temporary work.
 */
export interface ChatArtifactAnswerInput {
  text: string;
  persistedArtifactCount: number;
  cancelled: boolean;
  awaitingApproval: boolean;
  failed: boolean;
}

export function savedChatArtifactAnswer(input: ChatArtifactAnswerInput): string | null {
  if (input.cancelled || input.awaitingApproval || input.failed) return null;
  // Do not rewrite a real model/deterministic response or change its wording.
  if (input.text.trim()) return input.text;
  // Count only confirmed writes already returned by canonical P4, never
  // pending runtime drafts or untrusted model-declared Artifact IDs.
  if (!Number.isSafeInteger(input.persistedArtifactCount) || input.persistedArtifactCount <= 0) return null;
  const count = input.persistedArtifactCount;
  return count === 1
    ? "An Artifact was saved to this conversation. Open its saved Artifact card to review the recorded version."
    : `${count} Artifacts were saved to this conversation. Open their saved Artifact cards to review each recorded version.`;
}
