import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { cancelConversationRun } from "./conversationRunCancel";
import { conversationRuns, ConversationRunRegistry } from "./conversationRunRegistry";

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

test("accepted Stop wins before completion claim, while a claimed durable commit refuses late Stop", async () => {
  const registry = new ConversationRunRegistry({ retainFinishedMs: 0 });
  const release = Promise.withResolvers<void>();
  const owner = { userId: 51, projectId: null, chatId: null };
  const first = "44444444-4444-4444-8444-444444444444";
  registry.start({ ...owner, requestId: first }, async emit => { await release.promise; emit({ type: "done", requestId: first, at, status: "cancelled" }); });
  assert.equal(registry.cancel(first, owner.userId), true);
  assert.equal(registry.claimCompletion(first, owner.userId), false);
  release.resolve();
  const second = "55555555-5555-4555-8555-555555555555";
  const commit = Promise.withResolvers<void>();
  registry.start({ ...owner, requestId: second }, async emit => { await commit.promise; emit({ type: "done", requestId: second, at, status: "completed" }); });
  assert.equal(registry.claimCompletion(second, owner.userId + 1), false);
  assert.equal(registry.claimCompletion(second, owner.userId), true);
  assert.equal(registry.cancel(second, owner.userId), false);
  assert.equal(registry.cancelScoped(second, owner), false);
  commit.resolve();
  await tick();
});
