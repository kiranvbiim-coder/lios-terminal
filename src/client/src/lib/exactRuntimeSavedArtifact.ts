import type {ConversationRuntimeEvent} from "@shared/conversationRuntime";

export interface SavedRuntimeArtifactHandoff {
  artifactId: string;
  version: number;
  projectId: number | null;
  requestId: string;
}
const ID = /^artifact:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** C06: a runtime output points to an existing P4 saved version; it is not itself
 * authority to read, modify or export that version. Canonical P4 must recheck
 * access upon opening. Never silently substitute the newer head revision.
 */
export function exactRuntimeSavedArtifact(
  event: ConversationRuntimeEvent | null | undefined,
  owner: { requestId: string | null; projectId: number | null; chatId: number | null },
): SavedRuntimeArtifactHandoff | null {
  if (!event || event.type !== "artifact" || !event.persistedArtifact ||
    !owner.chatId || !owner.requestId || event.requestId !== owner.requestId ||
    event.artifact.projectId !== owner.projectId ||
    !ID.test(event.persistedArtifact.id) ||
    !Number.isSafeInteger(event.persistedArtifact.version) || event.persistedArtifact.version < 1) return null;
  return {
    artifactId:event.persistedArtifact.id,
    version:event.persistedArtifact.version,
    projectId:event.artifact.projectId,
    requestId:event.requestId,
  };
}
