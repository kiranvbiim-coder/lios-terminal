import { TextDecoder } from "node:util";

/**
 * Selected mechanisms adapted from openclaw/openclaw (MIT), approved commit
 * c074824a27c96d3983043f9eeb33823cd1772d8c:
 * extensions/telegram/src/telegram-ingress-worker.runtime.ts (4 MiB / 100,
 * Bot API error_code), telegram-ingress-spool.ts (safe nonnegative update ID),
 * bot-updates.ts (chat/message versus callback identity), network-errors.ts
 * (401/404 authentication and retry_after seconds). Copyright (c) 2026
 * OpenClaw Foundation; MIT notice in THIRD_PARTY_NOTICES.md.
 * Header semantics inspected against grammy@1.46.0's exact dependency
 * @grammyjs/types@5.0.0: update, message, manage, markup and api .d.ts files.
 * No SDK/type-package code, donor state, routing or retry loop is imported.
 * LiOS additions: fatal UTF-8, structural/order bounds, redacted errors and
 * explicit unresolved business/guest/inline namespaces. Headers are not a
 * claim of media, callback, business, native-operation or AI-use support.
 */
export type NormalizedTelegramUpdate = {
  updateId: number;
  eventType: string;
  conversationId: string | null;
  messageId: string | null;
  occurredAt: string | null;
  editedAt: string | null;
  text: string | null;
  /** Entire bounded provider update, untrusted data only; never Home authority. */
  payload: Record<string, unknown>;
};

type ProviderErrorCode = "unauthorized" | "conflict" | "rate_limited" | "unavailable";
type PollResult =
  | { kind: "updates"; updates: NormalizedTelegramUpdate[] }
  | { kind: "provider_error"; code: ProviderErrorCode; retryAfterMs: number | null };

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_UPDATES = 100;
// Bounds apply to the entire envelope, before any downstream recursive hashing.
const MAX_DEPTH = 32;
const MAX_NODES = 65_536;
const MAX_RETRY_DIAGNOSTIC_MS = 300_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

// Bot API Update keys from the exact inspected provider types, not grammY's
// default subscription list. Classification does not enable these operations.
const updateTypes = new Set([
  "message", "edited_message", "channel_post", "edited_channel_post",
  "business_connection", "business_message", "edited_business_message",
  "deleted_business_messages", "guest_message", "stopped_message_generation",
  "message_reaction", "message_reaction_count", "inline_query", "chosen_inline_result",
  "callback_query", "shipping_query", "pre_checkout_query", "purchased_paid_media",
  "poll", "poll_answer", "my_chat_member", "chat_member", "chat_join_request",
  "chat_boost", "removed_chat_boost", "managed_bot", "subscription",
]);
const messageTypes = new Set([
  "message", "edited_message", "channel_post", "edited_channel_post",
  "business_message", "edited_business_message", "guest_message",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(): never {
  // This private error is swallowed below, without raw input, cause or description.
  throw new Error("Invalid Telegram polling body.");
}

function assertBounded(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 1;
  while (pending.length) {
    const entry = pending.pop()!;
    if (entry.depth > MAX_DEPTH) invalid();
    if (typeof entry.value === "number" && !Number.isFinite(entry.value)) invalid();
    if (entry.value === null || typeof entry.value !== "object") continue;
    const children = Array.isArray(entry.value) ? entry.value : Object.values(entry.value);
    nodes += children.length;
    if (nodes > MAX_NODES) invalid();
    for (const child of children) pending.push({ value: child, depth: entry.depth + 1 });
  }
}

function numericId(value: unknown, signed = false): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      (signed ? value === 0 : value < 0)) invalid();
  return String(value);
}

function chatId(event: Record<string, unknown>): string {
  if (!isRecord(event.chat)) invalid();
  return numericId(event.chat.id, true);
}

function timestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 ||
      value > 8_640_000_000_000) invalid();
  return new Date(value * 1000).toISOString();
}

function optionalText(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") invalid();
  return value;
}

function hasSeparateMessageNamespace(message: Record<string, unknown>): boolean {
  const business = optionalText(message.business_connection_id);
  const guest = optionalText(message.guest_query_id);
  return Boolean(business || guest);
}

function normalizeUpdate(payload: Record<string, unknown>, updateId: number): NormalizedTelegramUpdate {
  const keys = Object.keys(payload).filter(key => updateTypes.has(key));
  // Telegram specifies at most one optional Update field. Never pick a winner
  // from conflicting event families and then ACK the other family accidentally.
  if (keys.length > 1) invalid();
  const eventType = keys[0] ?? "unknown";
  const result: NormalizedTelegramUpdate = {
    updateId, eventType, conversationId: null, messageId: null,
    occurredAt: null, editedAt: null, text: null, payload,
  };
  if (eventType === "unknown") return result;
  const event = payload[eventType];
  if (!isRecord(event)) invalid();

  if (messageTypes.has(eventType)) {
    const conversationId = chatId(event);
    const messageId = numericId(event.message_id);
    result.occurredAt = timestamp(event.date);
    result.editedAt = event.edit_date === undefined ? null : timestamp(event.edit_date);
    if (eventType.startsWith("edited_") && result.editedAt === null) invalid();
    const text = optionalText(event.text);
    const caption = optionalText(event.caption);
    result.text = text ?? caption;
    // Business/guest chats explicitly inhabit independent provider namespaces,
    // even when their numeric chat IDs equal ordinary bot chats. Keep them
    // unresolved until canonical routing models those scopes; no synthetic IDs.
    if (eventType !== "business_message" && eventType !== "edited_business_message" &&
        eventType !== "guest_message" && !hasSeparateMessageNamespace(event)) {
      result.conversationId = conversationId;
      result.messageId = messageId;
    }
  } else if (eventType === "callback_query") {
    if (event.message !== undefined) {
      if (!isRecord(event.message)) invalid();
      const conversationId = chatId(event.message);
      const messageId = numericId(event.message.message_id);
      if (!hasSeparateMessageNamespace(event.message)) {
        result.conversationId = conversationId;
        result.messageId = messageId;
      }
    }
    // inline_message_id, callback id, chat_instance and sender id are not chat
    // IDs. A callback has no event date/text: its originating message is not it.
  } else if (eventType === "message_reaction" || eventType === "message_reaction_count") {
    result.conversationId = chatId(event);
    result.messageId = numericId(event.message_id);
    result.occurredAt = timestamp(event.date);
  } else if (eventType === "my_chat_member" || eventType === "chat_member" ||
             eventType === "chat_join_request") {
    result.conversationId = chatId(event);
    result.occurredAt = timestamp(event.date);
  } else if (eventType === "chat_boost") {
    result.conversationId = chatId(event);
    if (!isRecord(event.boost)) invalid();
    result.occurredAt = timestamp(event.boost.add_date);
  } else if (eventType === "removed_chat_boost") {
    result.conversationId = chatId(event);
    result.occurredAt = timestamp(event.remove_date);
  } else if (eventType === "business_connection") {
    // user_chat_id is the connection owner's private chat, not a business
    // conversation or the business connection id. Do not promote either.
    result.occurredAt = timestamp(event.date);
  }
  // Other known families (including deleted business batches, polls, inline,
  // payments, stopped drafts and managed bots) remain explicit raw payloads.
  return result;
}

function providerError(httpStatus: number, envelope?: Record<string, unknown>): PollResult {
  const providerCode = envelope?.error_code;
  const status = typeof providerCode === "number" && Number.isInteger(providerCode) &&
    providerCode >= 100 && providerCode <= 599 ? providerCode : httpStatus;
  const code: ProviderErrorCode = status === 401 || status === 404 ? "unauthorized" :
    status === 409 ? "conflict" : status === 429 ? "rate_limited" : "unavailable";
  let retryAfterMs: number | null = null;
  const parameters = envelope?.parameters;
  if (code === "rate_limited" && isRecord(parameters)) {
    const seconds = parameters.retry_after;
    const milliseconds = typeof seconds === "number" ? seconds * 1000 : NaN;
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      // Bounded diagnostic only, NOT a retry schedule or replay authorization.
      retryAfterMs = Math.min(MAX_RETRY_DIAGNOSTIC_MS, Math.ceil(milliseconds));
    }
  }
  return { kind: "provider_error", code, retryAfterMs };
}

/**
 * Pure Home-side parsing of an unadopted getUpdates response. Nothing is ACKed,
 * persisted, routed, authorized or replayed here. Malformed/ambiguous success
 * refuses the whole batch as unavailable; no partial list may advance a cursor.
 */
export function normalizeTelegramPollBody(body: Uint8Array, httpStatus: number): PollResult {
  if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
    return providerError(503);
  }
  let envelope: unknown;
  try {
    if (body.byteLength > MAX_BODY_BYTES) invalid();
    envelope = JSON.parse(decoder.decode(body));
    assertBounded(envelope);
  } catch {
    return providerError(httpStatus >= 200 && httpStatus < 300 ? 503 : httpStatus);
  }
  if (!isRecord(envelope)) return providerError(httpStatus);
  if (httpStatus < 200 || httpStatus >= 300 || envelope.ok !== true) {
    return providerError(httpStatus, envelope);
  }
  try {
    if (!Array.isArray(envelope.result) || envelope.result.length > MAX_UPDATES) invalid();
    const updates: NormalizedTelegramUpdate[] = [];
    let previousId = -1;
    for (const payload of envelope.result) {
      if (!isRecord(payload)) invalid();
      const id = payload.update_id;
      // MAX_SAFE_INTEGER itself cannot be accepted: next getUpdates offset +1
      // must remain exactly representable. Gaps are legal; sorting is not repair.
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 ||
          id >= Number.MAX_SAFE_INTEGER || id <= previousId) invalid();
      updates.push(normalizeUpdate(payload, id));
      previousId = id;
    }
    return { kind: "updates", updates };
  } catch {
    return providerError(503);
  }
}
