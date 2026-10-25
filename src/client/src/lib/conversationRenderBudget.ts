import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

/** WS-62: render a bounded tail of Chat messages; the original messages remain untouched. */
export const CHAT_RENDER_BATCH = 80;

export function selectConversationMessageWindow<T>(
  all: readonly T[],
  requestedCount = CHAT_RENDER_BATCH,
): { messages: readonly T[]; hiddenCount: number; nextBatchCount: number } {
  const count = Number.isSafeInteger(requestedCount) && requestedCount >= CHAT_RENDER_BATCH
    ? requestedCount : CHAT_RENDER_BATCH;
  const start = Math.max(0, all.length - count);
  return {
    messages: start === 0 ? all : all.slice(start),
    hiddenCount: start,
    nextBatchCount: Math.min(CHAT_RENDER_BATCH, start),
  };
}

/**
 * A text event carries the accumulated answer, not a delta. Keep only the newest
 * text snapshot for a request in the presentation trace. Every nontext source,
 * approval, error, receipt and done event remains in sequence and unchanged.
 * The Gateway wire and original canonical saved Chat remain the authorities.
 */
export function appendConversationPresentationEvent(
  current: readonly ConversationRuntimeEvent[],
  next: ConversationRuntimeEvent,
): ConversationRuntimeEvent[] {
  if (next.type !== "text") return [...current, next];
  const latest = current.filter((event) => event.type !== "text" || event.requestId !== next.requestId);
  latest.push(next);
  return latest;
}
