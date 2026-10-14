import { conversationRuns } from "./conversationRunRegistry";

/**
 * The one cancel entry (SI-02.07). The run registry controller is the source
 * of truth and fans out through the execution scope to supervised descendants.
 */
export function cancelConversationRun(requestId: string, userId: number): boolean {
  return conversationRuns.cancel(requestId, userId);
}
