import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTelegramPollBody } from "./telegramPollNormalizer";

const body = (value: unknown) => Buffer.from(JSON.stringify(value));
const ok = (result: unknown[]) => normalizeTelegramPollBody(body({ ok: true, result }), 200);
const message = (extra: Record<string, unknown> = {}) => ({ message_id: 9, date: 1_700_000_000, chat: { id: 123 }, text: "exact  text ", ...extra });
const unavailable = { kind: "provider_error", code: "unavailable", retryAfterMs: null };

test("ordinary and edited messages retain exact provider identity and text", () => {
  const result = ok([{ update_id: 5, message: message() }, { update_id: 9, edited_message: message({ edit_date: 1_700_000_100, text: undefined, caption: "cap" }) }]);
  assert.equal(result.kind, "updates");
  if (result.kind !== "updates") return;
  assert.deepEqual(result.updates.map(u => [u.updateId, u.eventType, u.conversationId, u.messageId, u.text]), [[5, "message", "123", "9", "exact  text "], [9, "edited_message", "123", "9", "cap"]]);
  assert.equal(result.updates[1].editedAt, "2023-11-14T22:15:00.000Z");
});

test("both channel families retain native logical identity without requiring sender or username", () => {
  const result = ok([
    { update_id: 10, channel_post: message({ chat: { id: -100123, type: "channel", title: "Private channel" }, text: undefined, caption: "caption" }) },
    { update_id: 11, edited_channel_post: message({ chat: { id: -100123, type: "channel" }, text: undefined, edit_date: 1_700_000_200 }) },
  ]);
  assert.equal(result.kind, "updates");
  if (result.kind !== "updates") return;
  assert.deepEqual(result.updates.map(update => [update.eventType, update.messageFamily, update.conversationId, update.messageId, update.text]), [
    ["channel_post", "channel_post", "-100123", "9", "caption"],
    ["edited_channel_post", "channel_post", "-100123", "9", null],
  ]);
  assert.equal(result.updates[1].occurredAt, result.updates[0].occurredAt, "original provider date is not replaced by edit_date");
  assert.equal(result.updates[1].editedAt, "2023-11-14T22:16:40.000Z");
});

test("incoming execution identity uses the observed author, never forwarded or compatibility identities", () => {
  const result = ok([
    { update_id: 1, message: message({ from: { id: 42 } }) },
    { update_id: 2, message: message({ from: { id: 42 }, sender_chat: { id: -100123 } }) },
    { update_id: 3, message: message({ from: { id: 42 }, sender_chat: { id: "invalid" } }) },
    { update_id: 4, message: message({ forward_origin: { type: "user", sender_user: { id: 42 } } }) },
    { update_id: 5, channel_post: message({ chat: { id: -100123 } }) },
    { update_id: 6, business_message: message({ from: { id: 42 } }) },
    { update_id: 7, message: message({ from: { id: Number.MAX_SAFE_INTEGER + 1 } }) },
  ]);
  assert.equal(result.kind, "updates");
  if (result.kind !== "updates") return;
  assert.deepEqual(result.updates.map(update => update.senderRef),
    ["user:42", "chat:-100123", null, null, null, null, null]);
});

test("zero unsent message IDs and independent business/guest namespaces cannot become durable anchors", () => {
  const result = ok([
    { update_id: 1, message: message({ message_id: 0 }) },
    { update_id: 2, edited_channel_post: message({ guest_query_id: "guest", edit_date: 1_700_000_100 }) },
    { update_id: 3, edited_message: message({ business_connection_id: "business", edit_date: 1_700_000_100 }) },
  ]);
  assert.equal(result.kind, "updates");
  if (result.kind !== "updates") return;
  for (const update of result.updates) assert.deepEqual([update.conversationId, update.messageId, update.messageFamily], [null, null, null]);
});

test("business, guest, inline callback and unknown updates never receive invented identities", () => {
  const result = ok([
    { update_id: 1, business_message: message() },
    { update_id: 2, message: message({ business_connection_id: "bc" }) },
    { update_id: 3, callback_query: { id: "cb", inline_message_id: "inline" } },
    { update_id: 4, brand_new_provider_update: { x: 1 } },
  ]);
  assert.equal(result.kind, "updates");
  if (result.kind !== "updates") return;
  for (const update of result.updates) assert.deepEqual([update.conversationId, update.messageId], [null, null]);
  assert.equal(result.updates[3].eventType, "unknown");
});

test("malformed ordering, duplicates, conflicting families and unsafe offsets refuse the whole batch", () => {
  for (const result of [
    [{ update_id: 2, message: message() }, { update_id: 1, message: message() }],
    [{ update_id: 2, message: message() }, { update_id: 2, message: message() }],
    [{ update_id: 1, message: message(), edited_message: message({ edit_date: 1 }) }],
    [{ update_id: Number.MAX_SAFE_INTEGER, message: message() }],
    [{ update_id: 1, edited_message: message() }],
    [{ update_id: 1, message: message({ chat: { id: 0 } }) }],
  ]) assert.deepEqual(ok(result), unavailable);
  assert.deepEqual(ok(Array.from({ length: 101 }, (_, i) => ({ update_id: i }))), unavailable);
});

test("bounds, invalid UTF-8 and oversized bodies fail closed without partial updates", () => {
  let deep: unknown = { value: 1 };
  for (let i = 0; i < 40; i++) deep = { child: deep };
  assert.deepEqual(ok([{ update_id: 1, message: message(), unknown: deep }]), unavailable);
  assert.deepEqual(normalizeTelegramPollBody(Buffer.from([0x7b, 0xff, 0x7d]), 200), unavailable);
  assert.deepEqual(normalizeTelegramPollBody(Buffer.alloc(4 * 1024 * 1024 + 1, 0x20), 200), unavailable);
});

test("provider errors are typed and redacted with bounded diagnostic hints", () => {
  const error = (status: number, envelope: unknown) => normalizeTelegramPollBody(body(envelope), status);
  assert.deepEqual(error(401, { ok: false, description: "bot123:SECRET" }), { kind: "provider_error", code: "unauthorized", retryAfterMs: null });
  assert.deepEqual(error(409, { ok: false, error_code: 409 }), { kind: "provider_error", code: "conflict", retryAfterMs: null });
  assert.deepEqual(error(429, { ok: false, parameters: { retry_after: 7 } }), { kind: "provider_error", code: "rate_limited", retryAfterMs: 7000 });
  assert.equal((error(429, { ok: false, parameters: { retry_after: 1e9 } }) as { retryAfterMs: number }).retryAfterMs, 300_000);
  assert.deepEqual(error(200, { ok: false, error_code: 429, parameters: { retry_after: 1 } }), { kind: "provider_error", code: "rate_limited", retryAfterMs: 1000 });
});
