import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

/** Only the latest attempt's observed Home terminal event establishes completion. */
export function hasObservedCompletion(events: readonly ConversationRuntimeEvent[], requestId: string | null): boolean {
  if (!requestId) return false;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.requestId !== requestId) continue;
    if (event.type === "done") return event.status === "completed";
    if (event.type === "plan" || event.type === "tool_start" || (event.type === "status" && event.state === "running")) return false;
  }
  return false;
}

/** Retry stages an editable request; unrelated unsent typing always wins. */
export function stageSafeRunRetry(current: string, previous: string): string {
  return current.trim() || !previous.trim() ? current : previous;
}
