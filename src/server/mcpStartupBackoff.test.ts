import assert from "node:assert/strict";
import test from "node:test";
import { McpStartupBackoff, McpStartupBackoffError } from "./mcpStartupBackoff";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("failed startup cooldown grows to its cap, refuses before connecting and clears after success", async () => {
  let now = 1000, physicalCalls = 0;
  const backoff = new McpStartupBackoff(() => now);
  const signal = new AbortController().signal;
  for (let failure = 0; failure < 8; failure++) {
    let retryAt = 0;
    await assert.rejects(backoff.connect("owner:server", signal, async () => { physicalCalls++; throw new Error("secret upstream diagnostic"); }), error => {
      assert.ok(error instanceof McpStartupBackoffError);
      assert.equal(error.message.includes("secret upstream"), false);
      assert.equal(error.cause, undefined);
      retryAt = error.retryAt!;
      assert.equal(retryAt - now, Math.min(600_000, 15_000 * 2 ** failure));
      return true;
    });
    await assert.rejects(backoff.connect("owner:server", signal, async () => { physicalCalls++; }), McpStartupBackoffError);
    assert.equal(physicalCalls, failure + 1);
    now = retryAt;
  }
  await backoff.connect("owner:server", signal, async () => { physicalCalls++; });
  await backoff.connect("owner:server", signal, async () => { physicalCalls++; });
  assert.equal(physicalCalls, 10, "healthy clients own independent connections");
});

test("same-key startups serialize and cancellation of a queued caller does not poison the active owner", async () => {
  const backoff = new McpStartupBackoff();
  const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const queuedAbort = new AbortController();
  let calls = 0;
  const first = backoff.connect("same", new AbortController().signal, async () => { calls++; entered.resolve(); await release.promise; });
  await entered.promise;
  const second = backoff.connect("same", queuedAbort.signal, async () => { calls++; });
  const rejected = assert.rejects(second, /cancelled/);
  await tick();
  assert.equal(calls, 1);
  queuedAbort.abort();
  await rejected;
  release.resolve();
  await first;
  await backoff.connect("same", new AbortController().signal, async () => { calls++; });
  assert.equal(calls, 2);
});

test("capacity cannot evict a live cooldown or retain an unbounded number of failed configurations", async () => {
  let now = 0, calls = 0;
  const backoff = new McpStartupBackoff(() => now);
  const signal = new AbortController().signal;
  for (let i = 0; i < 1024; i++) await assert.rejects(backoff.connect(String(i), signal, async () => { calls++; throw new Error(); }), McpStartupBackoffError);
  await assert.rejects(backoff.connect("one-too-many", signal, async () => { calls++; }), error => error instanceof McpStartupBackoffError && error.retryAt === null);
  await assert.rejects(backoff.connect("0", signal, async () => { calls++; }), McpStartupBackoffError);
  assert.equal(calls, 1024);
  now = 15_000;
  await backoff.connect("expired-capacity", signal, async () => { calls++; });
  assert.equal(calls, 1025);
});
