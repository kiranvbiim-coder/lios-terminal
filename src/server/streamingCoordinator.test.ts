import assert from "node:assert/strict";
import test from "node:test";
import { buildStreamingLifecycle, quotaAwarePollInterval } from "./streamingCoordinator";

test("P5 streaming falls back to provider/quota-aware polling without one hardcoded interval", () => {
  const quota = { limit: 100, remaining: 0, resetAt: new Date(Date.now() + 120_000).toISOString(), retryAfterMs: 90_000, source: "response_headers" as const };
  const interval = quotaAwarePollInterval({ suggestedMs: 5_000, quota });
  assert.ok(interval >= 90_000);
  const lifecycle = buildStreamingLifecycle({ providerId: "fixture", capability: "prices", supportsStream: true, streamHealthy: false, quota, suggestedPollMs: 5_000 });
  assert.equal(lifecycle.transport, "polling");
  assert.ok((lifecycle.pollIntervalMs ?? 0) >= 90_000);
});
