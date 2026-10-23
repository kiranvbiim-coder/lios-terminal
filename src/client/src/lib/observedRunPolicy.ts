import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

/** Only Home-produced done(completed) establishes a successful finished run. */
export function hasObservedCompletion(events: readonly ConversationRuntimeEvent[], requestId: string | null): boolean {
  return Boolean(requestId) && events.some(event =>
    event.requestId === requestId && event.type === "done" && event.status === "completed");
}

/**
 * A retry suggestion is an editable draft, never a second invocation of a
 * previously executed tool. Preserve newer typing without silently replacing it.
 */
export function stageSafeRunRetry(current: string, previous: string): string {
  if (current.trim() || !previous.trim()) return current;
  return previous;
}

/** Status and receipts are always scoped to the exact observed requestId. */
export function eventsForRun(events: readonly ConversationRuntimeEvent[], requestId: string | null): ConversationRuntimeEvent[] {
  return requestId ? events.filter(event => event.requestId === requestId) : [];
}

/** No legacy replay of tool effects from streamed/replayed text. */
export function hasUncertainSideEffects(events: readonly ConversationRuntimeEvent[]): boolean {
  return events.some(event => event.type === "tool_start"
    || event.type === "tool_result"
    || event.type === "mutation_review"
    || event.type === "governed_tool_approval_required"
    || event.type === "approval_required"
    || event.type === "receipt");
}
