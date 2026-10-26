import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-local-ai-onboarding-"));
const previousRoot = process.env.LIMURIA_DATA_DIR;
const previousOllama = process.env.OLLAMA_BASE_URL;
const previousStudio = process.env.LM_STUDIO_BASE_URL;
const previousOpenAi = process.env.OPENAI_API_KEY;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.OLLAMA_BASE_URL;
delete process.env.LM_STUDIO_BASE_URL;
// A fake configured cloud fallback must never be contacted by a rejected local-only request.
process.env.OPENAI_API_KEY = "local-onboarding-test-not-a-real-key";

// db.ts freezes its data root on import; these imports must follow isolated-root configuration.
const [{ initDb, closeDb, getDb }, { users, domains }, { registerEnvironmentSetupRoutes }, { registerWaveCRoutes }, { runWithRequestIdentity }, { invokeAIRoutedCompletion }, { hasVerifiedAIChatSelection }] = await Promise.all([
  import("./db"), import("@shared/schema"), import("./environmentSetupRoutes"), import("./waveCRoutes"),
  import("./requestContext"), import("./byoaiTransport"), import("./aiProviderVerification"),
]);

test("local first-user setup requires explicit listing and chat proof, preserves master-off and rejects remote or unknown models", { timeout: 120_000 }, async (t) => {
  const originalFetch = globalThis.fetch;
  await initDb();
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.LIMURIA_DATA_DIR; else process.env.LIMURIA_DATA_DIR = previousRoot;
    if (previousOllama === undefined) delete process.env.OLLAMA_BASE_URL; else process.env.OLLAMA_BASE_URL = previousOllama;
    if (previousStudio === undefined) delete process.env.LM_STUDIO_BASE_URL; else process.env.LM_STUDIO_BASE_URL = previousStudio;
    if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenAi;
  });
  const [owner] = await getDb().insert(users).values({ email: "local-setup@example.test", name: "Local setup", role: "internal_admin", passwordHash: "test-only" }).returning();
  assert.ok(owner);
  const [otherOwner] = await getDb().insert(users).values({ email: "other-local-setup@example.test", name: "Other local setup", role: "internal_admin", passwordHash: "test-only" }).returning();
  await getDb().insert(domains).values({ slug: "finance", name: "Finance", active: true }).onConflictDoNothing();

  type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
  const routes = new Map<string, Handler>();
  const capture = (method: string) => (route: string, ...handlers: Handler[]) => { routes.set(`${method} ${route}`, handlers[handlers.length - 1]!); };
  const app = { get: capture("GET"), put: capture("PUT"), post: capture("POST"), delete: capture("DELETE") };
  registerEnvironmentSetupRoutes(app as unknown as Express);
  registerWaveCRoutes(app as unknown as Express);
  const call = async (method: string, route: string, body?: unknown, params: Record<string, string> = {}, actor = owner) => {
    const handler = routes.get(`${method} ${route}`);
    assert.ok(handler, `${method} ${route} must remain an existing authenticated setup route`);
    const result: { status: number; body: unknown } = { status: 200, body: null };
    const response = { status(code: number) { result.status = code; return this; }, json(value: unknown) { result.body = value; return this; } };
    await runWithRequestIdentity({ userId: actor.id, organizationId: actor.organizationId }, () => handler(
      { user: actor, body, params } as unknown as Request,
      response as unknown as Response,
      ((error?: unknown) => { if (error) { result.status = 500; result.body = { error: String(error) }; } }) as NextFunction,
    ));
    return result;
  };
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  let failChat = false;
  let servedModelOverride: string | null | undefined;
  let studioModelKey = "qwen-local";
  let discoveryBarrier: { entered: () => void; wait: Promise<void> } | null = null;
  const pauseNextDiscovery = () => {
    const ready = Promise.withResolvers<void>();
    const wait = Promise.withResolvers<void>();
    discoveryBarrier = { entered: ready.resolve, wait: wait.promise };
    return { ready: ready.promise, release: wait.resolve };
  };
  const localModel = { name: "llama3.2:3b", size: 2_018_519_800, digest: "a".repeat(64), details: { format: "gguf" } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, "127.0.0.1", "the test cannot call a real/cloud provider");
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: url.pathname, method: init?.method ?? "GET", body });
    if ((url.pathname === "/api/tags" || url.pathname === "/api/v1/models") && discoveryBarrier) {
      const barrier = discoveryBarrier;
      discoveryBarrier = null;
      barrier.entered();
      await barrier.wait;
    }
    if (url.pathname === "/api/tags") return new Response(JSON.stringify({ models: [
      localModel,
      { ...localModel, name: "cloud-alias", remote_model: "paid-model", remote_host: "https://ollama.com" },
      { name: "unproven-model" },
      { ...localModel, name: "gpt-oss:120b-cloud" },
    ] }));
    if (url.pathname === "/api/v1/models") return new Response(JSON.stringify({ models: [
      { key: studioModelKey, type: "llm", format: "gguf", size_bytes: 2_000_000, loaded_instances: [{ id: "qwen-loaded" }] },
      { key: "qwen-unloaded", type: "llm", format: "gguf", size_bytes: 2_000_000, loaded_instances: [] },
      { key: "unproven-model", type: "llm", loaded_instances: [{ id: "unproven-model" }] },
    ] }));
    if (url.pathname === "/api/chat" || url.pathname === "/v1/chat/completions") {
      if (failChat) return new Response("Unavailable", { status: 503 });
      const servedModel = servedModelOverride === undefined
        ? url.pathname === "/api/chat" ? localModel.name : studioModelKey
        : servedModelOverride;
      const acknowledgement = String(init?.body).match(/LIOS_AI_OK_[a-f0-9]{24}/)?.[0] ?? "LIOS_AI_OK";
      return new Response(JSON.stringify({ ...(servedModel === null ? {} : { model: servedModel }), message: { content: acknowledgement }, choices: [{ message: { content: acknowledgement } }] }));
    }
    throw new Error(`Unexpected outbound path ${url.pathname}`);
  }) as typeof fetch;

  const initial = await call("GET", "/api/setup/status");
  assert.equal(initial.status, 200);
  assert.equal(calls.length, 0, "opening setup must not discover models or run inference");
  assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 409, "configured identity/proof cannot be skipped");

  for (const provider of [
    { id: "ollama", credential: "ollamaBaseUrl", endpoint: "http://127.0.0.1:11434", model: "llama3.2:3b" },
    { id: "lm_studio", credential: "lmStudioBaseUrl", endpoint: "http://127.0.0.1:1234/v1", model: "qwen-loaded" },
  ]) {
    const beforeSave = calls.length;
    assert.equal((await call("PUT", "/api/setup/credentials/:name", { value: provider.endpoint }, { name: provider.credential })).status, 200);
    const selection = { aiProviderId: provider.id, aiModelId: provider.model, complete: true };
    const saved = await call("PUT", "/api/setup/status", selection);
    assert.equal(saved.status, 200);
    assert.equal(calls.length, beforeSave, "saving endpoint or completing first setup must not spend inference or read model metadata");
    const savedBody = z.object({ setupNeeded: z.boolean() }).parse(saved.body);
    assert.equal(savedBody.setupNeeded, false, "first insert must actually retain completedAt");
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 409);
    const beforeDiscoveryInference = calls.filter((entry) => entry.method === "POST").length;

    const discovery = await call("POST", "/api/setup/ai/models", { provider: provider.id });
    assert.equal(discovery.status, 200);
    const models = z.object({ models: z.array(z.string()), excludedModels: z.array(z.object({ id: z.string() })), endpoint: z.string() }).parse(discovery.body);
    assert.deepEqual(models.models, [provider.model]);
    assert.ok(models.excludedModels.length >= 2, "cloud/unknown/unloaded entries must be excluded from local choices");
    assert.equal(calls.filter((entry) => entry.method === "POST").length, beforeDiscoveryInference, "model listing never sends inference");
    assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), false, "model listing is not chat proof");

    const badModel = await call("POST", "/api/setup/ai/test", { provider: provider.id, model: "unproven-model", endpoint: models.endpoint });
    assert.equal(badModel.status, 400);
    assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, "unproven-model"), false);
    const proof = await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model, endpoint: models.endpoint });
    assert.equal(proof.status, 200);
    const verified = z.object({ verifiedCapabilities: z.array(z.string()), model: z.string() }).parse(proof.body);
    assert.deepEqual(verified.verifiedCapabilities, ["chat"]);
    assert.equal(verified.model, provider.model);
    assert.equal(hasVerifiedAIChatSelection(owner.id + 1, provider.id, provider.model), false, "another account cannot borrow the probe");
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "ai_assist" })).status, 200);

    await call("PUT", "/api/setup/status", selection, {}, otherOwner);
    failChat = true;
    assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model }, {}, otherOwner)).status, 502);
    failChat = false;
    assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), true, "another account's failed probe and passive failure cannot erase this account's proof");

    const barrier = pauseNextDiscovery();
    const beforeRevokedInference = calls.filter(entry => entry.method === "POST").length;
    const pendingCompletion = runWithRequestIdentity({ userId: owner.id, organizationId: null }, () => invokeAIRoutedCompletion({
      preferredProvider: provider.id, preferredModel: provider.model, fallback: "none",
      messages: [{ role: "user", content: "MUST_NOT_TRANSMIT_AFTER_OFF" }],
    }));
    const deniedCompletion = assert.rejects(pendingCompletion, /authorization|AI is off/i);
    await barrier.ready;
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "off", mode: "manual" })).status, 200);
    barrier.release();
    await deniedCompletion;
    assert.equal(calls.filter(entry => entry.method === "POST").length, beforeRevokedInference, "OFF during discovery must prevent prompt transmission");

    const alternate = new URL(provider.endpoint);
    alternate.port = String(Number(alternate.port) + 1);
    for (const edits of [[provider.endpoint], [alternate.toString(), provider.endpoint]]) {
      const pendingProbeBarrier = pauseNextDiscovery();
      const pendingProbe = call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model });
      await pendingProbeBarrier.ready;
      for (const endpoint of edits) await call("PUT", "/api/setup/credentials/:name", { value: endpoint }, { name: provider.credential });
      pendingProbeBarrier.release();
      assert.equal((await pendingProbe).status, 409, "same-value and A-B-A endpoint edits invalidate in-flight proof publication");
      assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), false);
    }
    const olderProbeBarrier = pauseNextDiscovery();
    const olderProbe = call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model });
    await olderProbeBarrier.ready;
    failChat = true;
    assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model })).status, 502);
    failChat = false;
    olderProbeBarrier.release();
    assert.equal((await olderProbe).status, 409, "an older successful response cannot overwrite a newer failed probe");
    assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), false);
    assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model })).status, 200);
    const { setVaultCredential } = await import("./credentialVault");
    for (const values of [[provider.endpoint], [alternate.toString(), provider.endpoint]]) {
      for (const endpoint of values) setVaultCredential(provider.credential, endpoint);
      assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), false, "direct/admin vault writes cannot preserve proof through identical values or A-B-A");
      assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 409);
      assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model })).status, 200);
    }

    for (const observedModel of ["not-the-selected-model", null]) {
      servedModelOverride = observedModel;
      assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model })).status, 502, "missing or mismatched response identity cannot verify the requested model");
      assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), false);
    }
    servedModelOverride = undefined;
    assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model })).status, 200);
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 200);
    const beforeModelReplacement = calls.filter(entry => entry.method === "POST").length;
    if (provider.id === "ollama") localModel.digest = "b".repeat(64);
    else studioModelKey = "replacement-model-under-reused-instance";
    await runWithRequestIdentity({ userId: owner.id, organizationId: null }, () => assert.rejects(invokeAIRoutedCompletion({
      preferredProvider: provider.id, preferredModel: provider.model, fallback: "none",
      messages: [{ role: "user", content: "MUST_NOT_TRANSMIT_TO_REPLACEMENT_MODEL" }],
    }), /authorization|AI is off/i));
    assert.equal(calls.filter(entry => entry.method === "POST").length, beforeModelReplacement, "digest/key replacement under an unchanged model or instance ID requires fresh proof before transmission");
    localModel.digest = "a".repeat(64);
    studioModelKey = "qwen-local";

    assert.equal((await call("PUT", "/api/setup/status", { ...selection, aiModelId: "unproven-model" })).status, 200);
    const offAfterChange = await call("GET", "/api/wave-c/ai/state");
    const offState = z.object({ state: z.string() }).parse(offAfterChange.body);
    assert.equal(offState.state, "off");
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 409);
    await call("PUT", "/api/setup/status", selection);
    failChat = true;
    assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model })).status, 502);
    failChat = false;
    assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), false, "failed verification must revoke prior evidence");
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 409);
    assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model })).status, 200);
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 200);
    const beforeCredentialEdit = calls.length;
    assert.equal((await call("PUT", "/api/setup/credentials/:name", { value: provider.endpoint }, { name: provider.credential })).status, 200);
    assert.equal(calls.length, beforeCredentialEdit, "credential configuration cannot silently run inference");
    assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), false, "even a re-saved endpoint must not inherit old chat proof");
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 409);
    assert.equal((await call("POST", "/api/setup/ai/test", { provider: provider.id, model: provider.model })).status, 200);
    assert.equal((await call("PUT", "/api/wave-c/ai/state", { state: "on", mode: "manual" })).status, 200);
    assert.equal((await call("DELETE", "/api/setup/credentials/:name", undefined, { name: provider.credential })).status, 200);
    assert.equal(hasVerifiedAIChatSelection(owner.id, provider.id, provider.model), false);
    const revokedState = z.object({ state: z.string() }).parse((await call("GET", "/api/wave-c/ai/state")).body);
    assert.equal(revokedState.state, "off");
  }

  await call("PUT", "/api/setup/credentials/:name", { value: "http://127.0.0.1:11434" }, { name: "ollamaBaseUrl" });
  const inferenceBeforeDenied = calls.filter((entry) => entry.method === "POST").length;
  for (const model of ["cloud-alias", "gpt-oss:120b-cloud", "unproven-model", "not-installed"]) {
    await assert.rejects(invokeAIRoutedCompletion({ preferredProvider: "ollama", preferredModel: model, fallback: "configured", messages: [{ role: "user", content: "private test input" }] }), /installed local model/i);
  }
  assert.equal(calls.filter((entry) => entry.method === "POST").length, inferenceBeforeDenied, "raw transport cannot infer locality from localhost or forward denied models");
  const beforeBadEndpoint = calls.length;
  assert.notEqual((await call("PUT", "/api/setup/credentials/:name", { value: "https://remote.example.invalid" }, { name: "ollamaBaseUrl" })).status, 200);
  assert.equal(calls.length, beforeBadEndpoint, "non-loopback endpoints must fail before any network request");
  const originalPromptBodies = JSON.stringify(calls.filter((entry) => entry.method === "POST").map((entry) => entry.body));
  assert.equal(originalPromptBodies.includes("private test input"), false);
  assert.equal(originalPromptBodies.includes("LIOS_AI_OK"), true);
});
