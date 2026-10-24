import test from "node:test";
import assert from "node:assert/strict";
import { AIProviderError, classifyProviderFailure, invokeAIProvider, invokeAIRoutedCompletion, resolveOllamaChatEndpoint, resolveOpenAICompatibleChatEndpoint, supportsImageInput } from "./byoaiTransport";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function assertProviderError(error: unknown, code: string): AIProviderError {
  assert.ok(error instanceof AIProviderError);
  assert.equal(error.code, code);
  return error;
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("BYOAI OpenAI-compatible transport returns text and attribution", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-openai-key";
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "evidence-backed answer" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await invokeAIProvider({ provider: "openai", messages: [{ role: "user", content: "Question" }] });
    assert.equal(result.text, "evidence-backed answer");
    assert.equal(result.attribution.provider, "openai");
    assert.equal(result.attribution.outputHash.length, 64);
    assert.ok(Array.isArray(requestBody?.messages));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("vision-capable BYOAI transports encode image bytes using provider-specific request formats", async () => {
  const envNames = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const;
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]])) as Record<string, string | undefined>;
  const previousFetch = globalThis.fetch;
  const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  const bodies: Record<string, Record<string, unknown>> = {};
  const keys: Record<(typeof envNames)[number], string> = {
    OPENAI_API_KEY: "test-openai-key",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    GEMINI_API_KEY: "test-gemini-key",
  };
  for (const name of envNames) process.env[name] = keys[name];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = inputUrl(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const provider = url.includes("anthropic") ? "anthropic" : url.includes("googleapis") ? "gemini" : "openai";
    bodies[provider] = body;
    if (provider === "anthropic") return new Response(JSON.stringify({ content: [{ type: "text", text: "image understood" }] }), { status: 200 });
    if (provider === "gemini") return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "image understood" }] } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "image understood" } }] }), { status: 200 });
  }) as typeof fetch;

  try {
    assert.equal(supportsImageInput("openai", "gpt-4o"), true);
    assert.equal(supportsImageInput("anthropic", "claude-sonnet-4-20250514"), true);
    assert.equal(supportsImageInput("gemini", "gemini-2.5-flash"), true);
    assert.equal(supportsImageInput("gemini", "gemini-3.5-flash-lite"), true);
    assert.equal(supportsImageInput("gemini", "gemini-3.8-flash"), true);
    assert.equal(supportsImageInput("gemini", "gemini-embedding-001"), false);
    assert.equal(supportsImageInput("xai", "grok-4.6"), false);
    for (const provider of ["openai", "anthropic", "gemini"] as const) {
      const result = await invokeAIProvider({
        provider,
        messages: [{ role: "user", content: "Describe this image.", images: [{ mimeType: "image/png", base64: pngBase64 }] }],
      });
      assert.equal(result.text, "image understood");
      assert.equal(JSON.stringify(result.attribution).includes(pngBase64), false, "base64 image content must not enter attribution or persisted receipts");
    }
    const openAiMessage = (bodies.openai?.messages as Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>)[0];
    assert.equal(openAiMessage.content[1]?.type, "image_url");
    assert.equal(openAiMessage.content[1]?.image_url?.url, `data:image/png;base64,${pngBase64}`);
    const anthropicMessage = (bodies.anthropic?.messages as Array<{ content: Array<{ type: string; source?: { type: string; media_type: string; data: string } }> }>)[0];
    assert.deepEqual(anthropicMessage.content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } });
    const geminiContent = (bodies.gemini?.contents as Array<{ parts: Array<{ inlineData?: { mimeType: string; data: string } }> }>)[0];
    assert.deepEqual(geminiContent.parts[1]?.inlineData, { mimeType: "image/png", data: pngBase64 });
  } finally {
    globalThis.fetch = previousFetch;
    for (const name of envNames) restoreEnv(name, previous[name]);
  }
});

test("routed image requests fail closed for an unsupported selected provider instead of falling back", async () => {
  const previousXai = process.env.XAI_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.XAI_API_KEY = "xai-test-key";
  process.env.OPENAI_API_KEY = "openai-test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "must not run" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => invokeAIRoutedCompletion({
      preferredProvider: "xai",
      messages: [{ role: "user", content: "Read the chart.", images: [{ mimeType: "image/png", base64: Buffer.from([1, 2, 3]).toString("base64") }] }],
    }), (error: unknown) => {
      assertProviderError(error, "invalid_request");
      return true;
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("XAI_API_KEY", previousXai);
    restoreEnv("OPENAI_API_KEY", previousOpenAI);
  }
});

test("BYOAI Gemini transport uses the current lightweight default and keeps the API key out of URLs", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  let capturedUrl = "";
  let capturedKey = "";
  let capturedModel = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = inputUrl(input);
    capturedKey = new Headers(init?.headers).get("x-goog-api-key") ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as { contents?: unknown[] };
    capturedModel = capturedUrl.match(/models\/([^:]+):generateContent/)?.[1] ?? "";
    assert.ok(Array.isArray(body.contents));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "LIOS_AI_OK" }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await invokeAIProvider({ provider: "gemini", messages: [{ role: "user", content: "Reply exactly with LIOS_AI_OK." }] });
    assert.equal(result.model, "gemini-3.5-flash-lite");
    assert.equal(result.text, "LIOS_AI_OK");
    assert.equal(capturedModel, "gemini-3.5-flash-lite");
    assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    assert.equal(capturedKey, "test-gemini-key");
    assert.equal(capturedUrl.includes("test-gemini-key"), false);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("GEMINI_API_KEY", previousKey);
  }
});

test("BYOAI Gemini 404 points users to model availability without exposing response bodies", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "private provider diagnostic" } }), { status: 404 })) as typeof fetch;
  try {
    await assert.rejects(
      () => invokeAIProvider({ provider: "gemini", model: "gemini-2.5-flash", messages: [{ role: "user", content: "Tiny test" }] }),
      (error: unknown) => error instanceof AIProviderError
        && error.status === 404
        && /model ID|model access/i.test(error.message)
        && !error.message.includes("private provider diagnostic"),
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("GEMINI_API_KEY", previousKey);
  }
});

test("BYOAI transport fails closed without provider credentials", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(() => invokeAIProvider({ provider: "openai", messages: [{ role: "user", content: "Question" }] }), /No credential/);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("BYOAI transport normalizes OpenAI-compatible base URLs", () => {
  assert.equal(
    resolveOpenAICompatibleChatEndpoint("https://inference.example.com/v1"),
    "https://inference.example.com/v1/chat/completions",
  );
  assert.equal(
    resolveOpenAICompatibleChatEndpoint("https://inference.example.com/v1/chat/completions/"),
    "https://inference.example.com/v1/chat/completions",
  );
  assert.equal(
    resolveOpenAICompatibleChatEndpoint("http://127.0.0.1:8080/v1/"),
    "http://127.0.0.1:8080/v1/chat/completions",
  );
});

test("BYOAI transport rejects unsafe or malformed compatible base URLs", () => {
  assert.throws(() => resolveOpenAICompatibleChatEndpoint("ftp://example.com/v1"), /HTTP or HTTPS/);
  assert.throws(() => resolveOpenAICompatibleChatEndpoint("https://user:pass@example.com/v1"), /embedded credentials/);
  assert.throws(() => resolveOpenAICompatibleChatEndpoint("https://example.com/v1?tenant=1"), /query string or fragment/);
  assert.throws(() => resolveOpenAICompatibleChatEndpoint("not-a-url"), /valid HTTP\(S\) URL/);
});

test("BYOAI transport routes xAI to chat completions with the Grok default", async () => {
  const previousKey = process.env.XAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedAuthorization = "";
  let capturedBody: Record<string, unknown> = {};

  process.env.XAI_API_KEY = "xai-test-key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = inputUrl(input);
    capturedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "Grok response" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await invokeAIProvider({
      provider: "xai",
      messages: [{ role: "user", content: "Summarize the scenario." }],
    });
    assert.equal(capturedUrl, "https://api.x.ai/v1/chat/completions");
    assert.equal(capturedAuthorization, "Bearer xai-test-key");
    assert.equal(capturedBody.model, "grok-4.6");
    assert.equal(result.model, "grok-4.6");
    assert.equal(result.text, "Grok response");
    assert.equal(result.attribution.provider, "xai");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousKey;
  }
});

test("BYOAI transport routes Mistral, Groq and Together to their governed chat endpoints", async () => {
  const envNames = ["MISTRAL_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY"] as const;
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]])) as Record<string, string | undefined>;
  const previousFetch = globalThis.fetch;
  const seen: Array<{ url: string; authorization: string; model: string }> = [];
  process.env.MISTRAL_API_KEY = "mistral-test-key";
  process.env.GROQ_API_KEY = "groq-test-key";
  process.env.TOGETHER_API_KEY = "together-test-key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    seen.push({
      url: inputUrl(input),
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      model: body.model ?? "",
    });
    return new Response(JSON.stringify({ choices: [{ message: { content: "provider response" } }] }), { status: 200 });
  }) as typeof fetch;

  try {
    const mistral = await invokeAIProvider({ provider: "mistral", messages: [{ role: "user", content: "Hello" }] });
    const groq = await invokeAIProvider({ provider: "groq", messages: [{ role: "user", content: "Hello" }] });
    const together = await invokeAIProvider({ provider: "together", messages: [{ role: "user", content: "Hello" }] });
    assert.deepEqual(seen.map((item) => item.url), [
      "https://api.mistral.ai/v1/chat/completions",
      "https://api.groq.com/openai/v1/chat/completions",
      "https://api.together.xyz/v1/chat/completions",
    ]);
    assert.deepEqual(seen.map((item) => item.authorization), [
      "Bearer mistral-test-key",
      "Bearer groq-test-key",
      "Bearer together-test-key",
    ]);
    assert.equal(mistral.provider, "mistral");
    assert.equal(groq.provider, "groq");
    assert.equal(together.provider, "together");
  } finally {
    globalThis.fetch = previousFetch;
    for (const name of envNames) restoreEnv(name, previous[name]);
  }
});

test("BYOAI transport compatible endpoint honors configured and caller-supplied model IDs", async () => {
  const previousKey = process.env.OPENAI_COMPATIBLE_API_KEY;
  const previousBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;
  const previousModel = process.env.OPENAI_COMPATIBLE_MODEL;
  const previousFetch = globalThis.fetch;
  const capturedModels: string[] = [];
  let capturedUrl = "";
  let capturedAuthorization = "";

  process.env.OPENAI_COMPATIBLE_API_KEY = "compatible-test-key";
  process.env.OPENAI_COMPATIBLE_BASE_URL = "https://enterprise.example.com/openai/v1/";
  process.env.OPENAI_COMPATIBLE_MODEL = "enterprise-default-model";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = inputUrl(input);
    capturedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    capturedModels.push(body.model ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content: "Compatible response" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const configured = await invokeAIProvider({
      provider: "openai_compatible",
      messages: [{ role: "user", content: "First request" }],
    });
    const explicit = await invokeAIProvider({
      provider: "openai_compatible",
      model: "tenant-special-model",
      messages: [{ role: "user", content: "Second request" }],
    });

    assert.equal(capturedUrl, "https://enterprise.example.com/openai/v1/chat/completions");
    assert.equal(capturedAuthorization, "Bearer compatible-test-key");
    assert.deepEqual(capturedModels, ["enterprise-default-model", "tenant-special-model"]);
    assert.equal(configured.model, "enterprise-default-model");
    assert.equal(explicit.model, "tenant-special-model");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_COMPATIBLE_API_KEY;
    else process.env.OPENAI_COMPATIBLE_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    else process.env.OPENAI_COMPATIBLE_BASE_URL = previousBaseUrl;
    if (previousModel === undefined) delete process.env.OPENAI_COMPATIBLE_MODEL;
    else process.env.OPENAI_COMPATIBLE_MODEL = previousModel;
  }
});
test("BYOAI transport normalizes provider aliases and returns structured invalid-provider errors", async () => {
  await assert.rejects(
    () =>
      invokeAIProvider({
        provider: "openai-compatible" as never,
        messages: [{ role: "user", content: "Hello" }],
      }),
    (error: unknown) => {
      const providerError = assertProviderError(error, "not_configured");
      assert.equal(providerError.provider, "openai_compatible");
      return true;
    },
  );

  await assert.rejects(
    () =>
      invokeAIProvider({
        provider: "unknown-provider" as never,
        messages: [{ role: "user", content: "Hello" }],
      }),
    (error: unknown) => {
      const providerError = assertProviderError(error, "invalid_provider");
      assert.equal(providerError.toJSON().message, "AI provider is not registered.");
      return true;
    },
  );
});

test("BYOAI transport sanitizes bounded upstream failures and classifies rate limits", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "openai-test-key";
  globalThis.fetch = (async () => new Response("secret=do-not-return-" + "x".repeat(2000), { status: 429 })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        invokeAIProvider({
          provider: "openai",
          messages: [{ role: "user", content: "Hello" }],
        }),
      (error: unknown) => {
        const providerError = assertProviderError(error, "rate_limited");
        assert.equal(providerError.status, 429);
        assert.doesNotMatch(providerError.message, /do-not-return/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OPENAI_API_KEY", previousKey);
  }
});

test("BYOAI transport classifies aborted requests as timeouts", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "openai-test-key";
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted", "AbortError");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        invokeAIProvider({
          provider: "openai",
          messages: [{ role: "user", content: "Hello" }],
        }),
      (error: unknown) => {
        assertProviderError(error, "timeout");
        return true;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OPENAI_API_KEY", previousKey);
  }
});

test("BYOAI transport routes Ollama base URLs to the local chat endpoint without credentials", async () => {
  const previousBaseUrl = process.env.OLLAMA_BASE_URL;
  const previousFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedAuthorization: string | null = null;
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (inputUrl(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "llama3.1", size: 2_000_000, digest: "a".repeat(64), details: { format: "gguf" } }] }));
    capturedUrl = inputUrl(input);
    capturedAuthorization = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({ model: "llama3.1", message: { content: "Local response" } }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await invokeAIProvider({
      provider: "ollama",
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.equal(capturedUrl, "http://127.0.0.1:11434/api/chat");
    assert.equal(capturedAuthorization, null);
    assert.equal(result.text, "Local response");
    assert.equal(resolveOllamaChatEndpoint("https://ollama.example/api"), "https://ollama.example/api/chat");
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OLLAMA_BASE_URL", previousBaseUrl);
  }
});

test("routed completion prefers the configured preferred provider", async () => {
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousXai = process.env.XAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.XAI_API_KEY = "xai-test-key";
  let capturedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl = inputUrl(input);
    return new Response(JSON.stringify({ choices: [{ message: { content: "preferred response" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await invokeAIRoutedCompletion({
      preferredProvider: "xai",
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.equal(result.provider, "xai");
    assert.equal(capturedUrl, "https://api.x.ai/v1/chat/completions");
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OPENAI_API_KEY", previousOpenAI);
    restoreEnv("XAI_API_KEY", previousXai);
  }
});

test("routed completion tries configured fallbacks in deterministic order without duplicates", async () => {
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousXai = process.env.XAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.XAI_API_KEY = "xai-test-key";
  const attempted: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = inputUrl(input);
    attempted.push(url);
    if (url.includes("api.x.ai")) return new Response("upstream failure", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "fallback response" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await invokeAIRoutedCompletion({
      preferredProvider: "xai",
      fallbackProviders: ["xai", "openai", "openai"],
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.equal(result.provider, "openai");
    assert.deepEqual(attempted, ["https://api.x.ai/v1/chat/completions", "https://api.openai.com/v1/chat/completions"]);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OPENAI_API_KEY", previousOpenAI);
    restoreEnv("XAI_API_KEY", previousXai);
  }
});

test("routed completion applies a selected model only to its selected provider", async () => {
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousXai = process.env.XAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.XAI_API_KEY = "xai-test-key";
  const attemptedModels: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = inputUrl(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    attemptedModels.push(body.model ?? "");
    if (url.includes("api.x.ai")) return new Response("upstream failure", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "fallback response" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await invokeAIRoutedCompletion({
      preferredProvider: "xai",
      preferredModel: "grok-4.6",
      fallbackProviders: ["openai"],
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.equal(result.provider, "openai");
    assert.deepEqual(attemptedModels, ["grok-4.6", "gpt-4o"]);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OPENAI_API_KEY", previousOpenAI);
    restoreEnv("XAI_API_KEY", previousXai);
  }
});

test("routed completion rejects invalid providers and forwards explicit custom models for providers that allow them", async () => {
  await assert.rejects(
    () => invokeAIRoutedCompletion({ preferredProvider: "not-real", messages: [{ role: "user", content: "Hello" }] }),
    (error: unknown) => {
      const providerError = assertProviderError(error, "invalid_provider");
      assert.equal(providerError.provider, undefined);
      return true;
    },
  );

  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "openai-test-key";
  let observedModel = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    observedModel = body.model ?? "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "custom model response" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await invokeAIRoutedCompletion({
      preferredProvider: "openai",
      preferredModel: "future-model-id",
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.equal(result.provider, "openai");
    assert.equal(result.model, "future-model-id");
    assert.equal(observedModel, "future-model-id");
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OPENAI_API_KEY", previousOpenAI);
  }
});

test("routed completion fails explicitly when no providers are configured", async () => {
  const previousOpenAI = process.env.OPENAI_API_KEY;
  const previousXai = process.env.XAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    await assert.rejects(
      () => invokeAIRoutedCompletion({ messages: [{ role: "user", content: "Hello" }] }),
      (error: unknown) => {
        assert.equal(assertProviderError(error, "not_configured").provider, undefined);
        return true;
      },
    );
  } finally {
    restoreEnv("OPENAI_API_KEY", previousOpenAI);
    restoreEnv("XAI_API_KEY", previousXai);
  }
});


test("Gemini 2.5 Flash requests disable thinking so it cannot consume the answer allowance", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  let body: { generationConfig?: Record<string, unknown> } = {};
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await invokeAIProvider({ provider: "gemini", model: "gemini-2.5-flash", maxTokens: 900, messages: [{ role: "user", content: "Question" }] });
    assert.deepEqual(body.generationConfig, { maxOutputTokens: 900, thinkingConfig: { thinkingBudget: 0 } });
    await invokeAIProvider({ provider: "gemini", model: "gemini-2.5-pro", maxTokens: 900, messages: [{ role: "user", content: "Question" }] });
    assert.deepEqual(body.generationConfig, { maxOutputTokens: 900 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("empty Gemini completions explain the cause and routed failures name the provider and code", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-gemini-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      () => invokeAIProvider({ provider: "gemini", model: "gemini-2.5-pro", messages: [{ role: "user", content: "Question" }] }),
      (error: unknown) => assertProviderError(error, "empty_completion").message.includes("output limit"),
    );
    await assert.rejects(
      () => invokeAIRoutedCompletion({ preferredProvider: "gemini", model: "gemini-2.5-pro", messages: [{ role: "user", content: "Question" }] }),
      (error: unknown) => {
        const failure = assertProviderError(error, "empty_completion");
        return /\(gemini: empty_completion\)/.test(failure.message) && !/test-gemini-key/.test(failure.message);
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});


test("provider failures are classified into actionable reasons without echoing provider text", async () => {
  assert.equal(classifyProviderFailure('{"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}'), "insufficient_quota");
  assert.equal(classifyProviderFailure('{"error":{"code":"invalid_api_key"}}'), "invalid_api_key");
  assert.equal(classifyProviderFailure('{"error":{"code":"model_not_found"}}'), "model_unavailable");
  assert.equal(classifyProviderFailure('{"error":{"message":"slow down"}}'), null);

  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "SECRET PROMPT ECHO" } }), { status: 429 })) as typeof fetch;
  try {
    await assert.rejects(
      () => invokeAIProvider({ provider: "openai", messages: [{ role: "user", content: "Question" }] }),
      (error: unknown) => {
        const failure = assertProviderError(error, "quota_exhausted");
        return /no available quota/.test(failure.message) && !/SECRET PROMPT ECHO/.test(failure.message) && failure.status === 429;
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

// Ordinary 429 rate pressure can use a permitted fallback. Billing/quota
// exhaustion is tested separately as a permanent entitlement refusal.
async function withProviderKeys<T>(run: (contacted: string[]) => Promise<T>, geminiWorks = true): Promise<T> {
  const previous = { openai: process.env.OPENAI_API_KEY, gemini: process.env.GEMINI_API_KEY };
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  const contacted: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = inputUrl(input);
    contacted.push(url.includes("googleapis") ? "gemini" : "openai");
    return url.includes("googleapis") && geminiWorks
      ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "from gemini" }] } }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), { status: 429 });
  }) as typeof fetch;
  try {
    return await run(contacted);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, key] of [["OPENAI_API_KEY", previous.openai], ["GEMINI_API_KEY", previous.gemini]] as const) {
      if (key === undefined) delete process.env[name];
      else process.env[name] = key;
    }
  }
}

const question = [{ role: "user" as const, content: "public question" }];

test("fallback: a failing chosen provider hands over to another connected one and says so", async () => {
  await withProviderKeys(async (contacted) => {
    const result = await invokeAIRoutedCompletion({ preferredProvider: "openai", messages: question });
    assert.equal(result.provider, "gemini");
    assert.deepEqual(contacted, ["openai", "gemini"]);
    assert.deepEqual(result.fallback, { attempts: [{ provider: "openai", code: "rate_limited", status: 429 }] });
  });
});

test("fallback: a healthy chosen provider is answered without any fallback marker", async () => {
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "from openai" } }] }), { status: 200 })) as typeof fetch;
  try {
    const result = await invokeAIRoutedCompletion({ preferredProvider: "openai", messages: question });
    assert.equal(result.provider, "openai");
    assert.equal(result.fallback, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env.OPENAI_API_KEY;
  }
});

test("fallback: none keeps the request with the chosen provider only", async () => {
  await withProviderKeys(async (contacted) => {
    await assert.rejects(
      () => invokeAIRoutedCompletion({ preferredProvider: "openai", fallback: "none", messages: [{ role: "user", content: "private portfolio question" }] }),
      (error: unknown) => assertProviderError(error, "rate_limited").message.includes("openai: rate_limited"),
    );
    assert.deepEqual(contacted, ["openai"]);
  });
});

test("fallback: project deny and allow lists cannot be escaped through fallback", async () => {
  await withProviderKeys(async (contacted) => {
    await assert.rejects(() => invokeAIRoutedCompletion({ preferredProvider: "openai", providerPolicy: { deny: ["gemini"] }, messages: question }));
    await assert.rejects(() => invokeAIRoutedCompletion({ preferredProvider: "openai", providerPolicy: { allow: ["openai"] }, messages: question }));
    assert.deepEqual(contacted, ["openai", "openai"]);
  });
});

test("fallback: every provider failing reports each provider and code", async () => {
  await withProviderKeys(async (contacted) => {
    await assert.rejects(
      () => invokeAIRoutedCompletion({ preferredProvider: "openai", messages: question }),
      (error: unknown) => /openai: rate_limited 429; gemini: rate_limited 429/.test(assertProviderError(error, "rate_limited").message),
    );
    assert.deepEqual(contacted, ["openai", "gemini"]);
  }, false);
});

test("BYOAI Ollama requests bound output and context through native options instead of ignored max_tokens", async () => {
  const previousBase = process.env.OLLAMA_BASE_URL;
  const previousFetch = globalThis.fetch;
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input, init) => {
    if (inputUrl(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "llama3.2:3b", size: 2_000_000, digest: "a".repeat(64), details: { format: "gguf" } }] }));
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ model: "llama3.2:3b", message: { content: "ok" } }), { status: 200 });
  }) as typeof fetch;
  try {
    await invokeAIProvider({ provider: "ollama", model: "llama3.2:3b", maxTokens: 321, messages: [{ role: "user", content: "Question" }] });
    assert.equal(requestBody?.max_tokens, undefined);
    assert.equal(requestBody?.stream, false);
    assert.deepEqual(requestBody?.options, { num_predict: 321, num_ctx: 8192 });
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OLLAMA_BASE_URL", previousBase);
  }
});

test("local AI providers cannot send local-only prompts to a remote endpoint", async () => {
  const previousOllama = process.env.OLLAMA_BASE_URL;
  const previousStudio = process.env.LM_STUDIO_BASE_URL;
  const previousFetch = globalThis.fetch;
  let transmitted = 0;
  globalThis.fetch = (async () => {
    transmitted += 1;
    return new Response(JSON.stringify({ message: { content: "must not be reached" }, choices: [{ message: { content: "must not be reached" } }] }));
  }) as typeof fetch;
  try {
    for (const endpoint of ["https://remote.example", "http://192.168.1.2:11434", "http://127.0.0.1.remote.example", "http://[2001:db8::1]"]) {
      process.env.OLLAMA_BASE_URL = endpoint;
      process.env.LM_STUDIO_BASE_URL = endpoint;
      for (const provider of ["ollama", "lm_studio"] as const) {
        await assert.rejects(invokeAIRoutedCompletion({
          preferredProvider: provider, fallback: "none", providerPolicy: { localOnly: true },
          messages: [{ role: "user", content: "local-only verification input" }],
        }), (error: unknown) => assertProviderError(error, "policy_denied").provider === provider);
      }
    }
    assert.equal(transmitted, 0, "local-only data must not leave the loopback endpoint boundary");
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("OLLAMA_BASE_URL", previousOllama);
    restoreEnv("LM_STUDIO_BASE_URL", previousStudio);
  }
});

test("provider attempt ceilings stop before a connected fallback could incur another call", async () => {
  await withProviderKeys(async contacted => {
    await assert.rejects(invokeAIRoutedCompletion({ preferredProvider: "openai", maxAttempts: 1, messages: question }),
      (error: unknown) => assertProviderError(error, "rate_limited").provider === "openai");
    assert.deepEqual(contacted, ["openai"], "the otherwise healthy Gemini fallback must not receive the prompt");
    for (const maxAttempts of [0, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(invokeAIRoutedCompletion({ preferredProvider: "openai", maxAttempts, messages: question }),
        (error: unknown) => assertProviderError(error, "invalid_request").code === "invalid_request");
    }
    assert.deepEqual(contacted, ["openai"], "invalid budgets fail before any additional provider call");
  });
});
