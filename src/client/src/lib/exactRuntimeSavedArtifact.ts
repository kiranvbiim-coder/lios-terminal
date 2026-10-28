import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

export interface SavedRuntimeArtifactHandoff {
  artifactId: string;
  version: number;
  projectId: number | null;
  requestId: string;
}

/** The event is a saved-version *pointer*, never permission to read or modify P4.
 * The authenticated Artifact sidecar must re-fetch the exact version and check
 * permissions; the latest head must never replace this recorded revision.
 */
const ARTIFACT_ID = /^artifact:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function exactRuntimeSavedArtifact(
  event: ConversationRuntimeEvent | null | undefined,
  owner: { requestId: string | null; projectId: number | null; chatId: number | null },
): SavedRuntimeArtifactHandoff | null {
  if (!event || event.type !== "artifact" || !event.persistedArtifact ||
      !owner.chatId || !Number.isSafeInteger(owner.chatId) || owner.chatId < 1 ||
      !owner.requestId || event.requestId !== owner.requestId ||
      event.artifact.projectId !== owner.projectId ||
      !ARTIFACT_ID.test(event.persistedArtifact.id) ||
      !Number.isSafeInteger(event.persistedArtifact.version) ||
      event.persistedArtifact.version < 1) return null;
  return {
    artifactId: event.persistedArtifact.id,
    version: event.persistedArtifact.version,
    projectId: event.artifact.projectId,
    requestId: event.requestId,
  };
}

/** The user may leave the original Project or Chat while a confirmation dialog
 * is open. Never navigate a different owner merely because they acknowledged
 * the stale dialog.
 */
export function isCurrentSavedArtifactHandoff(
  handoff: SavedRuntimeArtifactHandoff,
  original: { projectId: number | null; chatId: number },
  current: { projectId: number | null; chatId: number | null },
  currentRequestId: string | null,
): boolean {
  return original.projectId === current.projectId &&
    original.chatId === current.chatId &&
    handoff.projectId === current.projectId &&
    handoff.requestId === currentRequestId;
}
