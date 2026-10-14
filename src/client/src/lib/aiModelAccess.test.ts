import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiModelAccess } from "./aiModelAccess";

test("complete provider discovery blocks a selected model that was not returned", () => {
  assert.equal(resolveAiModelAccess({
    modelId: "gemini-stale-model",
    discoveredModels: ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
    discoveryComplete: true,
  }), "blocked");
});

test("complete provider discovery verifies a selected model that was returned", () => {
  assert.equal(resolveAiModelAccess({
    modelId: "gemini-3.8-flash",
    discoveredModels: ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
    discoveryComplete: true,
  }), "verified");
});

test("partial discovery never blocks a model that is absent from the first page", () => {
  assert.equal(resolveAiModelAccess({
    modelId: "gemini-maybe-later-page",
    discoveredModels: ["gemini-first-page"],
    discoveryComplete: false,
  }), "unknown");
});

test("partial discovery can verify a model that was explicitly returned", () => {
  assert.equal(resolveAiModelAccess({
    modelId: "gemini-first-page",
    discoveredModels: ["gemini-first-page"],
    discoveryComplete: false,
  }), "verified");
});

test("no discovery result keeps curated or custom model IDs unknown rather than verified", () => {
  assert.equal(resolveAiModelAccess({ modelId: "custom-model" }), "unknown");
  assert.equal(resolveAiModelAccess({ modelId: "" }), "unknown");
});
