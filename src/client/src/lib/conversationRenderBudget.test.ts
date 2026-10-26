import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import {
  appendConversationPresentationEvent,
  CHAT_RENDER_BATCH,
  selectConversationMessageWindow,
} from "./conversationRenderBudget";

const ID = "44444444-4444-4444-8444-444444444444";
const ANOTHER_ID = "55555555-5555-4555-8555-555555555555";
const at = "2026-10-25T02:00:00.000Z";
const textEvent = (value: string, requestId = ID): ConversationRuntimeEvent =>
  ({ type: "text", requestId, at, text: value, label: "deterministic" });

test("WS-62 renders at most the last 80 messages on first open without losing canonical history", () => {
  for (const total of [0, 1, 79, 80, 81, 100, 10_000]) {
    const source = Array.from({ length: total }, (_, id) => ({ id, role: id % 2 ? "user" : "assistant" }));
    const selected = selectConversationMessageWindow(source);
    assert.equal(selected.messages.length, Math.min(CHAT_RENDER_BATCH, total));
    assert.equal(selected.hiddenCount, Math.max(0, total - CHAT_RENDER_BATCH));
    assert.deepEqual(selected.messages, source.slice(-CHAT_RENDER_BATCH));
    assert.equal(source.length, total, "no trimming of saved messages");
    assert.equal(selected.nextBatchCount, Math.min(80, selected.hiddenCount));
  }
});

test("WS-62 earlier-message reveal keeps stable message identity, ordering and exact content", () => {
  const messages = Array.from({ length: 1_001 }, (_, id) => ({ id, body: `Full saved answer ${id}` }));
  let count = CHAT_RENDER_BATCH;
  const first = selectConversationMessageWindow(messages, count);
  assert.equal(first.messages[0], messages[921]);
  count += first.nextBatchCount;
  const second = selectConversationMessageWindow(messages, count);
  assert.equal(second.messages[0], messages[841]);
  assert.equal(second.messages[80], first.messages[0], "existing visible objects preserve identity");
  assert.equal(second.messages.at(-1), messages[1_000]);
  const all = selectConversationMessageWindow(messages, 10_000);
  assert.equal(all.messages, messages, "fully expanded uses the original canonical array");
  assert.equal(all.hiddenCount, 0);
});

test("WS-62 invalid page budgets do not accidentally render an unbounded history", () => {
  const messages = Array.from({ length: 10_000 }, (_, i) => i);
  for (const budget of [-1, NaN, Infinity, 1.2, 0, 40, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(selectConversationMessageWindow(messages, budget).messages.length, CHAT_RENDER_BATCH);
  }
});

test("WS-62 cumulative streaming text uses one snapshot per request; status, approvals and done survive", () => {
  const status: ConversationRuntimeEvent = { type: "status", requestId: ID, at, message: "Working", state: "running", stepId: null };
  const error: ConversationRuntimeEvent = { type: "error", requestId: ID, at, message: "Missing data", code: "missing_data" };
  const done: ConversationRuntimeEvent = { type: "done", requestId: ID, at, status: "failed" };
  let events: ConversationRuntimeEvent[] = [];
  events = appendConversationPresentationEvent(events, status);
  for (let i = 1; i <= 5_000; i += 1) events = appendConversationPresentationEvent(events, textEvent("x".repeat(i)));
  events = appendConversationPresentationEvent(events, error);
  events = appendConversationPresentationEvent(events, textEvent("final answer"));
  events = appendConversationPresentationEvent(events, done);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(event => event.type), ["status", "error", "text", "done"]);
  assert.equal(events[2].type === "text" ? events[2].text : null, "final answer");
  assert.equal(events[1], error, "no loss of negative evidence");
  assert.equal(events[3], done, "no loss of server termination proof");
});

test("WS-62 text from separate requests remains independently attributable", () => {
  let events: ConversationRuntimeEvent[] = [];
  events = appendConversationPresentationEvent(events, textEvent("first", ID));
  events = appendConversationPresentationEvent(events, textEvent("second", ANOTHER_ID));
  events = appendConversationPresentationEvent(events, textEvent("last", ID));
  assert.deepEqual(events.map(event => event.type === "text" ? [event.requestId, event.text] : []),
    [[ANOTHER_ID, "second"], [ID, "last"]]);
});