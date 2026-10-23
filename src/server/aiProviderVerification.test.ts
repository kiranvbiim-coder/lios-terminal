import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyAIProviderConnection,
  type AIProviderVerificationInvoker,
} from "./aiProviderVerification";

test("live AI verification uses a tiny public probe and returns safe metadata", async () => {
  const calls: Parameters<AIProviderVerificationInvoker>[0][] = [];
  const result = await verifyAIProviderConnection(
    { provider: "openai", model: "gpt-4o-mini" },
    async (request) => {
      calls.push(request);
      return {
        provider: "openai",
        model: request.model ?? "gpt-4o-mini",
        text: "LIOS_AI_OK",
        attribution: {
          id: "11111111-1111-4111-8111-111111111111",
          provider: "openai",
          model: request.model ?? "gpt-4o-mini",
          promptHash: "a".repeat(64),
          outputHash: "b".repeat(64),
          toolsCalled: [],
          dataAccessed: [],
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-4o-mini");
  assert.ok(result.latencyMs >= 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dataClassification, "public");
  assert.equal(calls[0].enterpriseApproval, true);
  assert.equal(calls[0].maxTokens, 16);
  assert.match(calls[0].messages[0].content, /LIOS_AI_OK/);
});

test("live AI verification rejects unknown providers before any outbound call", async () => {
  let called = false;
  await assert.rejects(
    () => verifyAIProviderConnection(
      { provider: "not-real" },
      async () => {
        called = true;
        throw new Error("should not run");
      },
    ),
    /not registered/,
  );
  assert.equal(called, false);
});

test("live AI verification fails on an empty provider completion", async () => {
  await assert.rejects(
    () => verifyAIProviderConnection(
      { provider: "gemini" },
      async () => ({
        provider: "gemini",
        model: "gemini-2.5-flash",
        text: "",
        attribution: {
          id: "22222222-2222-4222-8222-222222222222",
          provider: "gemini",
          model: "gemini-2.5-flash",
          promptHash: "c".repeat(64),
          outputHash: "d".repeat(64),
          toolsCalled: [],
          dataAccessed: [],
          timestamp: new Date().toISOString(),
        },
      }),
    ),
    /empty completion/,
  );
});

test("live AI verification rejects provider or model metadata that does not match the request", async () => {
  await assert.rejects(
    () => verifyAIProviderConnection(
      { provider: "openai", model: "gpt-4o-mini" },
      async () => ({
        provider: "openai",
        model: "gpt-4o",
        text: "LIOS_AI_OK",
        attribution: {
          id: "33333333-3333-4333-8333-333333333333",
          provider: "openai",
          model: "gpt-4o",
          promptHash: "e".repeat(64),
          outputHash: "f".repeat(64),
          toolsCalled: [],
          dataAccessed: [],
          timestamp: new Date().toISOString(),
        },
      }),
    ),
    /unexpected provider\/model metadata/,
  );

  await assert.rejects(
    () => verifyAIProviderConnection(
      { provider: "gemini", model: "gemini-2.5-flash" },
      async () => ({
        provider: "openai",
        model: "gemini-2.5-flash",
        text: "LIOS_AI_OK",
        attribution: {
          id: "44444444-4444-4444-8444-444444444444",
          provider: "openai",
          model: "gemini-2.5-flash",
          promptHash: "1".repeat(64),
          outputHash: "2".repeat(64),
          toolsCalled: [],
          dataAccessed: [],
          timestamp: new Date().toISOString(),
        },
      }),
    ),
    /unexpected provider\/model metadata/,
  );

  await assert.rejects(
    () => verifyAIProviderConnection(
      { provider: "openai", model: "gpt-4o-mini" },
      async () => ({
        provider: "openai",
        model: "gpt-4o-mini",
        text: "LIOS_AI_OK",
        attribution: {
          id: "55555555-5555-4555-8555-555555555555",
          provider: "openai",
          model: "gpt-4o",
          promptHash: "3".repeat(64),
          outputHash: "4".repeat(64),
          toolsCalled: [],
          dataAccessed: [],
          timestamp: new Date().toISOString(),
        },
      }),
    ),
    /unexpected provider\/model metadata/,
  );
});


test("GM12 a nonempty but incorrect AI acknowledgement is not a verified model connection", async () => {
  const unsafeReplies = [
    "Ready to help!", "LIOS_AI_OK followed by fabricated output",
    "LIOS_AI_0K", "{\"status\":\"ok\"}", "Wrong model but successful completion",
  ];
  for (const reply of unsafeReplies) {
    await assert.rejects(
      () => verifyAIProviderConnection({ provider: "openai", model: "gpt-4o-mini" }, async () => ({
        provider: "openai", model: "gpt-4o-mini", text: reply,
        attribution: {
          id: "99999999-9999-4999-8999-999999999999",
          provider: "openai", model: "gpt-4o-mini",
          promptHash: "a".repeat(64), outputHash: "b".repeat(64),
          toolsCalled: [], dataAccessed: [], timestamp: new Date().toISOString(),
        },
      })),
      (error: unknown) =>
        error instanceof Error && /did not complete the LiOS connection verification challenge/.test(error.message) && !error.message.includes(reply),
      "failed verification should never leak the arbitrary provider response",
    );
  }
});

test("GM12 minor model acknowledgement punctuation does not produce a false negative", async () => {
  for (const text of ["  LIOS_AI_OK  ", '"LIOS_AI_OK"', "LIOS_AI_OK."]) {
    const result = await verifyAIProviderConnection({ provider: "openai", model: "gpt-4o-mini" }, async () => ({
      provider: "openai", model: "gpt-4o-mini", text,
      attribution: {
        id: "77777777-7777-4777-8777-777777777777",
        provider: "openai", model: "gpt-4o-mini",
        promptHash: "a".repeat(64), outputHash: "b".repeat(64),
        toolsCalled: [], dataAccessed: [], timestamp: new Date().toISOString(),
      },
    }));
    assert.equal(result.ok, true);
  }
});
