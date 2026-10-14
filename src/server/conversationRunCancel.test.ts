import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { cancelConversationRun } from "./conversationRunCancel";
import { conversationRuns } from "./conversationRunRegistry";

const ID = "22222222-2222-4222-8222-222222222222";
const at = "2026-10-05T00:00:00.000Z";
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("the single cancel entry reaches a registry-owned run for its owner only", async () => {
  let seen: AbortSignal | null = null;
  conversationRuns.start({ requestId: ID, userId: 41, projectId: null, chatId: null }, async (emit, signal) => {
    seen = signal;
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    emit({ type: "done", requestId: ID, at, status: "cancelled" } as ConversationRuntimeEvent);
  });
  await tick();
  assert.ok(seen);
  assert.equal(cancelConversationRun(ID, 42), false);
  assert.equal((seen as AbortSignal).aborted, false);
  assert.equal(cancelConversationRun(ID, 41), true);
  assert.equal((seen as AbortSignal).aborted, true);
  await tick();
  assert.equal(cancelConversationRun(ID, 41), false);
});

test("an unknown execution is not cancellable", () => {
  assert.equal(cancelConversationRun("33333333-3333-4333-8333-333333333333", 1), false);
});
