import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { inspectRecordedActionRecovery } from "./recordedActionRecovery";

export interface ProjectAutomationDraftFacts {
  mode: "project" | "quick" | "temporary";
  projectId: number | null;
  chatId: number | null;
  /** Project and Chat captured with the original submit. */
  originProjectId: number | null;
  originChatId: number | null;
  activeChatScope: string | null;
  sourceRequestId: string | null;
  currentRequestId: string | null;
  hasSavedRequest: boolean;
  busy: boolean;
  events: readonly ConversationRuntimeEvent[];
}

/** A Chat-to-P9 action only opens the canonical P9 review dialog.
 * No automation should be offered using a different Chat turn, an earlier
 * failed attempt, an unresolved tool outcome or a continuation whose saved
 * request cannot be proven to match this exact runtime request.
 */
export function canPrepareProjectAutomationDraft(facts: ProjectAutomationDraftFacts): boolean {
  const {
    mode, projectId, chatId, originProjectId, originChatId, activeChatScope,
    sourceRequestId, currentRequestId, hasSavedRequest, busy, events,
  } = facts;
  if (mode !== "project" || !projectId || !chatId ||
      activeChatScope !== "project" || originProjectId !== projectId || originChatId !== chatId || !hasSavedRequest || busy ||
      !sourceRequestId || !currentRequestId || sourceRequestId !== currentRequestId) return false;
  const runEvents = events.filter(event => event.requestId === currentRequestId);
  if (!runEvents.length || runEvents.some(event => event.type === "error")) return false;
  const final = [...runEvents].reverse().find(event => event.type === "done");
  if (final?.type !== "done" || final.status !== "completed") return false;
  if (inspectRecordedActionRecovery(runEvents, currentRequestId).needsReconciliation) return false;
  return true;
}
