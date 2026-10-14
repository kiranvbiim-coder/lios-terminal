import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  bindConversationExecutionSignal,
  currentConversationSignal,
  linkAbortSignal,
  onConversationScopeCancel,
  withConversationExecutionScope,
} from "./execution-scope";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test("linkAbortSignal propagates cancellation without forwarding a private source reason", () => {
  const secret = "private-cancel-reason-sentinel";
  const source = new AbortController();
  const target = new AbortController();
  linkAbortSignal(source.signal, target);
  source.abort(new Error(secret));
  assert.equal(target.signal.aborted, true);
  assert.notEqual(target.signal.reason, source.signal.reason);
  assert.equal(String(target.signal.reason).includes(secret), false);
  assert.match(String(target.signal.reason), /AbortError|cancelled/i);

  const already = new AbortController();
  already.abort({ secret });
  const immediate = new AbortController();
  linkAbortSignal(already.signal, immediate);
  assert.equal(immediate.signal.aborted, true);
  assert.equal(String(immediate.signal.reason).includes(secret), false);

  const detachedSource = new AbortController();
  const detachedTarget = new AbortController();
  linkAbortSignal(detachedSource.signal, detachedTarget)();
  detachedSource.abort(new Error(secret));
  assert.equal(detachedTarget.signal.aborted, false);

  linkAbortSignal(undefined, new AbortController())();
});

test("outside a conversation scope there is no cancellation signal and hooks are inert", () => {
  assert.equal(currentConversationSignal(), undefined);
  let ran = false;
  onConversationScopeCancel(() => { ran = true; })();
  assert.equal(ran, false);
});

test("a child hook fires with a secret-safe reason; an unregistered one does not", { timeout: 10_000 }, async () => {
  const requestId = crypto.randomUUID();
  const runSignal = new AbortController();
  const secret = "private-hook-cancel-reason";
  const fired: string[] = [];
  let hookReason: unknown;
  await withConversationExecutionScope(requestId, async () => {
    bindConversationExecutionSignal(requestId, runSignal.signal);
    const scopeSignal = currentConversationSignal();
    assert.ok(scopeSignal);
    assert.equal(scopeSignal.aborted, false);
    onConversationScopeCancel((reason) => {
      hookReason = reason;
      fired.push("kept");
    });
    onConversationScopeCancel(() => { fired.push("removed"); })();
    runSignal.abort(new Error(secret));
    await tick();
    assert.equal(scopeSignal.aborted, true);
    assert.equal(String(scopeSignal.reason).includes(secret), false);
  });
  assert.deepEqual(fired, ["kept"]);
  assert.equal(String(hookReason).includes(secret), false);
  assert.match(String(hookReason), /AbortError|cancelled/i);
});

test("a hook registered after cancellation runs immediately and a failing hook cannot break the scope", { timeout: 10_000 }, async () => {
  const requestId = crypto.randomUUID();
  const runSignal = new AbortController();
  const fired: string[] = [];
  await withConversationExecutionScope(requestId, async () => {
    bindConversationExecutionSignal(requestId, runSignal.signal);
    runSignal.abort();
    onConversationScopeCancel(() => { fired.push("late"); });
    onConversationScopeCancel(() => { throw new Error("hook failed"); });
    await tick();
  });
  assert.deepEqual(fired, ["late"]);
});

test("closing the scope also stops children that never unregistered, and the signal is gone afterwards", { timeout: 10_000 }, async () => {
  const fired: string[] = [];
  await withConversationExecutionScope(crypto.randomUUID(), async () => {
    onConversationScopeCancel(() => { fired.push("orphan"); });
  });
  await tick();
  assert.deepEqual(fired, ["orphan"]);
  assert.equal(currentConversationSignal(), undefined);
});

test("the scope joins async cancel hooks before it returns, so terminal persistence follows broker cleanup", async () => {
  const requestId = crypto.randomUUID();
  const order: string[] = [];
  await withConversationExecutionScope(requestId, async () => {
    onConversationScopeCancel(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      order.push("broker-cleanup");
    });
    return "ok";
  });
  order.push("terminal-persist");
  assert.deepEqual(order, ["broker-cleanup", "terminal-persist"]);
});
