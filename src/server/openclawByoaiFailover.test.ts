import assert from "node:assert/strict";
import test from "node:test";
import { isTransientBYOAIFailure } from "./openclawByoaiFailover";
import { AIProviderError, invokeAIRoutedCompletion } from "./byoaiTransport";

test("OpenClaw-backed GM-22 failover classification admits genuine transient errors only", () => {
  for (const code of ["rate_limited", "timeout", "unavailable", "empty_completion"] as const) {
    assert.equal(isTransientBYOAIFailure({ code }), true, `${code} may retry an already permitted route`);
  }
  assert.equal(isTransientBYOAIFailure({ code: "upstream_error", status: 503 }), true);
  assert.equal(isTransientBYOAIFailure({ code: "upstream_error", status: 500 }), true);
  for (const status of [400, 401, 402, 403, 404, 422]) {
    assert.equal(isTransientBYOAIFailure({ code: "upstream_error", status }), false,
      `HTTP ${status} is a permanent or entitlement error, not a provider outage`);
  }
  assert.equal(isTransientBYOAIFailure({ code: "upstream_error" }), false, "unknown upstream status cannot grant fallback");
  for (const code of ["policy_denied", "not_configured", "invalid_provider", "invalid_request"] as const) {
    assert.equal(isTransientBYOAIFailure({ code }), false);
  }
});

async function withTwoConnectedApiProviders(
  perform: (calls: string[]) => Promise<void>,
  simulate: (url: string) => Response,
): Promise<void> {
  const previousXai = process.env.XAI_API_KEY;
  const previousOpenai = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    process.env.XAI_API_KEY = "gm22-test-xai-secret";
    process.env.OPENAI_API_KEY = "gm22-test-openai-secret";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return simulate(url);
    }) as typeof fetch;
    await perform(calls);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousXai;
    if (previousOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenai;
  }
}

const route = {
  preferredProvider: "xai",
  fallbackProviders: ["openai"],
  providerPolicy: { allow: ["xai", "openai"] },
  maxAttempts: 2,
  messages: [{ role: "user" as const, content: "The existing user-owned query must not reach a denied provider." }],
};

test("D2 a forbidden provider credential stops all cross-provider transmission", async () => {
  await withTwoConnectedApiProviders(async calls => {
    await assert.rejects(
      () => invokeAIRoutedCompletion(route),
      error => error instanceof AIProviderError && error.code === "upstream_error" && error.status === 401,
    );
    assert.deepEqual(calls, ["https://api.x.ai/v1/chat/completions"]);
  }, () => new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "untrusted remote echo" } }), { status: 401 }));
});

test("D2 current source-release / organization policy refusal cannot be bypassed through fallback", async () => {
  await withTwoConnectedApiProviders(async calls => {
    let policyChecks = 0;
    await assert.rejects(
      () => invokeAIRoutedCompletion({
        ...route,
        beforeTransmission: async () => {
          policyChecks++;
          throw new AIProviderError("policy_denied", "Current policy forbids sharing the source.", { provider: "xai" });
        },
      }),
      error => error instanceof AIProviderError && error.code === "policy_denied",
    );
    assert.equal(policyChecks, 1);
    assert.deepEqual(calls, [], "the request must not reach any vendor after a denial");
  }, () => new Response("unexpected"));
});

test("D2 a transient 503 still falls back to one already-authorized provider", async () => {
  await withTwoConnectedApiProviders(async calls => {
    const result = await invokeAIRoutedCompletion(route);
    assert.equal(result.provider, "openai");
    assert.deepEqual(result.fallback?.attempts, [{ provider: "xai", code: "upstream_error", status: 503 }]);
    assert.deepEqual(calls, ["https://api.x.ai/v1/chat/completions", "https://api.openai.com/v1/chat/completions"]);
  }, url => url.includes("api.x.ai")
    ? new Response("service unavailable", { status: 503 })
    : new Response(JSON.stringify({ choices: [{ message: { content: "safe fallback result" } }] }), { status: 200 }));
});
