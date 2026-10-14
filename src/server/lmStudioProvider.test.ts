import test from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDERS, getAvailableProviders } from "./byoaiRouter";
import { invokeAIProvider } from "./byoaiTransport";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("BYOAI: LM Studio is a first-class local provider", () => {
  const provider = AI_PROVIDERS.find((item) => item.id === "lm_studio");
  assert.ok(provider);
  assert.equal(provider.isLocal, true);
  assert.equal(provider.allowCustomModel, true);
  assert.equal(provider.modelEnvKey, "LM_STUDIO_MODEL");
});

test("BYOAI: LM Studio availability follows local base URL configuration", () => {
  const previous = process.env.LM_STUDIO_BASE_URL;
  try {
    delete process.env.LM_STUDIO_BASE_URL;
    assert.equal(getAvailableProviders().find((item) => item.id === "lm_studio")?.available, false);

    process.env.LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
    assert.equal(getAvailableProviders().find((item) => item.id === "lm_studio")?.available, true);
  } finally {
    if (previous === undefined) delete process.env.LM_STUDIO_BASE_URL;
    else process.env.LM_STUDIO_BASE_URL = previous;
  }
});

test("BYOAI: LM Studio uses the local OpenAI-compatible endpoint without auth", async () => {
  const previousBaseUrl = process.env.LM_STUDIO_BASE_URL;
  const previousModel = process.env.LM_STUDIO_MODEL;
  const previousFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedAuthorization: string | null = null;
  let capturedModel = "";

  process.env.LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";
  process.env.LM_STUDIO_MODEL = "qwen3-local";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = inputUrl(input);
    capturedAuthorization = new Headers(init?.headers).get("authorization");
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    capturedModel = body.model ?? "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "local answer" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await invokeAIProvider({
      provider: "lm_studio",
      messages: [{ role: "user", content: "Explain the model result." }],
    });

    assert.equal(capturedUrl, "http://127.0.0.1:1234/v1/chat/completions");
    assert.equal(capturedAuthorization, null);
    assert.equal(capturedModel, "qwen3-local");
    assert.equal(result.provider, "lm_studio");
    assert.equal(result.model, "qwen3-local");
    assert.equal(result.text, "local answer");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.LM_STUDIO_BASE_URL;
    else process.env.LM_STUDIO_BASE_URL = previousBaseUrl;
    if (previousModel === undefined) delete process.env.LM_STUDIO_MODEL;
    else process.env.LM_STUDIO_MODEL = previousModel;
  }
});
