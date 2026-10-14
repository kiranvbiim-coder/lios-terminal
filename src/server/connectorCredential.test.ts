import assert from "node:assert/strict";
import test from "node:test";
import { implementedKeyedConnectorsMissingCredentialProbes } from "./connectorCredentialProbes";
import { testConnectorCredential } from "./connectorService";

test("connector credential test rejects provider authentication failures", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid api key" }), { status: 401 });
  try {
    const result = await testConnectorCredential("finnhub", "duplicate-fake-key");
    assert.equal(result.state, "invalid");
    assert.match(result.detail, /rejected/i);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("connector credential test only accepts a successful provider probe", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ c: 315 }), { status: 200 });
  try {
    const result = await testConnectorCredential("finnhub", "provider-key");
    assert.equal(result.state, "healthy");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("every implemented keyed_api connector has a live credential probe", () => {
  assert.deepEqual(implementedKeyedConnectorsMissingCredentialProbes(), []);
});

test("OpenFIGI credential test uses the official keyed v3 mapping probe", async () => {
  const previousFetch = globalThis.fetch;
  let method = "";
  let header = "";
  let body = "";
  globalThis.fetch = async (_url, init) => {
    method = String(init?.method ?? "GET");
    header = new Headers(init?.headers).get("X-OPENFIGI-APIKEY") ?? "";
    body = String(init?.body ?? "");
    return new Response(JSON.stringify([{ data: [{ figi: "BBG000BLNNH6", ticker: "IBM" }] }]), { status: 200 });
  };
  try {
    const result = await testConnectorCredential("openfigi", "provider-key");
    assert.equal(result.state, "healthy");
    assert.equal(method, "POST");
    assert.equal(header, "provider-key");
    assert.match(body, /"idType":"TICKER"/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Gemini credential probe uses the supported API-key header and never places the secret in its URL", async () => {
  const previousFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedKey = "";
  globalThis.fetch = async (input, init) => {
    capturedUrl = input instanceof Request ? input.url : String(input);
    capturedKey = new Headers(init?.headers).get("x-goog-api-key") ?? "";
    return new Response(JSON.stringify({ models: [
      { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
    ] }), { status: 200 });
  };
  try {
    const result = await testConnectorCredential("gemini", "gemini-test-key");
    assert.equal(result.state, "healthy");
    assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100");
    assert.equal(capturedKey, "gemini-test-key");
    assert.equal(capturedUrl.includes("gemini-test-key"), false);
    assert.deepEqual(result.availableModels, ["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
    assert.equal(result.availableModelsComplete, true);
    assert.match(result.detail, /2 models supporting generateContent/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Gemini model discovery marks later pages incomplete without making another request", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }],
      nextPageToken: "next-page-token",
    }), { status: 200 });
  };
  try {
    const result = await testConnectorCredential("gemini", "gemini-test-key");
    assert.equal(fetchCalls, 1);
    assert.deepEqual(result.availableModels, ["gemini-3.8-flash"]);
    assert.equal(result.availableModelsComplete, false);
    assert.match(result.detail, /first page.*more pages are available/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Gemini model discovery stops at its response limit and reports suggestions as unverified", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`${JSON.stringify({ models: [{ name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] }] })}${" ".repeat(300_000)}`, { status: 200 });
  try {
    const result = await testConnectorCredential("gemini", "gemini-test-key");
    assert.equal(result.state, "healthy");
    assert.equal(result.availableModels, undefined);
    assert.equal(result.availableModelsComplete, undefined);
    assert.match(result.detail, /exceeded the safe response limit/i);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("connector credential test surfaces provider auth detail for LSE", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "invalid api key" }), { status: 401 });
  try {
    const result = await testConnectorCredential("lse", "not-a-real-key");
    assert.equal(result.state, "invalid");
    assert.match(result.detail, /invalid api key/i);
    assert.match(result.detail, /londonstrategicedge/i);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("connector credential test accepts LSE when the usage probe succeeds", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ symbol: "AAPL" }]), { status: 200 });
  try {
    const result = await testConnectorCredential("lse", "provider-key");
    assert.equal(result.state, "healthy");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("connector credential test fails closed when adapter is catalog-only", async () => {
  const result = await testConnectorCredential("intrinio", "provider-key");
  assert.equal(result.state, "unreachable");
  assert.match(result.detail, /no live adapter/i);
});
