import assert from "node:assert/strict";
import test from "node:test";
import { presentRuntimeError } from "./runtimeErrorKit";

test("quota and rate limit errors point to Connect first", () => {
  const view = presentRuntimeError("runtime_failed", "OpenAI could not answer (openai: rate_limited 429).");
  assert.equal(view.kind, "rate_limit");
  assert.equal(view.recoveries[0], "connect");
});

test("provider key problems offer Connect and retry", () => {
  const view = presentRuntimeError("runtime_failed", "Invalid API key for the selected provider");
  assert.equal(view.kind, "ai_provider");
  assert.deepEqual(view.recoveries, ["connect", "retry"]);
});

test("budget, network, storage and unknown errors are distinct and never headline the raw code", () => {
  assert.equal(presentRuntimeError("budget_exceeded", "Step limit reached").kind, "budget");
  assert.equal(presentRuntimeError("request_failed", "fetch failed").kind, "network");
  assert.equal(presentRuntimeError("runtime_failed", "Could not save because the database is unavailable").kind, "storage");
  const unknown = presentRuntimeError("runtime_failed", "boom");
  assert.equal(unknown.kind, "unknown");
  assert.doesNotMatch(unknown.title, /runtime_failed/);
});
