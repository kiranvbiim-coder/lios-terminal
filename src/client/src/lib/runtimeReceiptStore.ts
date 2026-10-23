import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

/**
 * Keeps the one-line receipt of a chat's last finished run across reloads. Only the small, non-sensitive
 * step events are kept (plan, step status, source references, gaps, errors, done); answer text, artifacts,
 * approvals and trust manifests are never stored here. Storage is per chat and best-effort.
 */
const KEY_PREFIX = "lios.runtime-receipt.v1.";
const KEPT_TYPES = new Set(["plan", "status", "tool_start", "tool_result", "data_gap", "error", "done"]);
const MAX_EVENTS = 80;
const MAX_CHATS = 60;
const INDEX_KEY = `${KEY_PREFIX}index`;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function compactReceiptEvents(events: readonly ConversationRuntimeEvent[]): ConversationRuntimeEvent[] {
  const done = [...events].reverse().find((event) => event.type === "done");
  if (!done || done.type !== "done" || done.status === "waiting_approval") return [];
  // A mixed/replayed buffer must not persist other runs' step status as
  // evidence for this final request. Raw text/approvals and the potentially
  // sensitive full receipt payload still never enter localStorage.
  return events.filter(event => event.requestId === done.requestId && KEPT_TYPES.has(event.type)).slice(-MAX_EVENTS);
}

export function saveRuntimeReceipt(chatId: number, events: readonly ConversationRuntimeEvent[], storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const compact = compactReceiptEvents(events);
  if (!compact.length) return;
  try {
    storage.setItem(`${KEY_PREFIX}${chatId}`, JSON.stringify(compact));
    const index = readIndex(storage).filter((id) => id !== chatId);
    index.push(chatId);
    while (index.length > MAX_CHATS) {
      const evicted = index.shift();
      if (evicted !== undefined) storage.removeItem(`${KEY_PREFIX}${evicted}`);
    }
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage may be full or blocked; the receipt is a convenience only.
  }
}

export function loadRuntimeReceipt(chatId: number, storage: StorageLike | null = defaultStorage()): ConversationRuntimeEvent[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(`${KEY_PREFIX}${chatId}`) ?? "null");
    if (!Array.isArray(parsed)) return [];
    const events = parsed.filter((event): event is ConversationRuntimeEvent => Boolean(event) && typeof event === "object" && KEPT_TYPES.has(event.type));
    return compactReceiptEvents(events);
  } catch {
    return [];
  }
}

function readIndex(storage: StorageLike): number[] {
  try {
    const parsed = JSON.parse(storage.getItem(INDEX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number") : [];
  } catch {
    return [];
  }
}
