import assert from "node:assert/strict";
import test from "node:test";
import { AI_PROVIDERS } from "./byoaiRouter";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import {
  createRuntimeFoundationRegistry,
  createRuntimeFoundationSnapshot,
} from "./runtimeFoundation";
import { P11_PACK_CATALOG } from "./p11PackCatalog";

test("runtime foundation projects specialist registries without exposing credentials", () => {
  const snapshot = createRuntimeFoundationSnapshot();

  assert.equal(snapshot.generatedFrom.aiProviders, AI_PROVIDERS.length);
  assert.equal(snapshot.generatedFrom.connectors, BUILT_IN_CONNECTORS.length);
  assert.equal(snapshot.generatedFrom.runtimePacks, MANAGED_RUNTIME_MANIFEST.packs.length);

  const serialized = JSON.stringify(snapshot);
  for (const provider of AI_PROVIDERS) {
    assert.equal(serialized.includes(provider.envKey), false, `runtime snapshot leaked env key ${provider.envKey}`);
    assert.equal(serialized.includes(provider.vaultKey), false, `runtime snapshot leaked vault key ${provider.vaultKey}`);
  }
});

test("provider-neutral foundation treats Ollama as one optional AI provider", () => {
  const snapshot = createRuntimeFoundationSnapshot();
  const ai = snapshot.components.filter((component) => component.kind === "ai_provider");
  const ollama = ai.find((component) => component.id === "ai:ollama");

  assert.ok(ollama);
  assert.equal(ollama.lifecycle, "optional");
  assert.deepEqual(ollama.executionScopes, ["local_api"]);
  assert.ok(ai.some((component) => component.id === "ai:openai"));
  assert.ok(ai.some((component) => component.id === "ai:anthropic"));
  assert.ok(ai.some((component) => component.id === "ai:gemini"));
});

test("runtime foundation has unique stable component ids and no OpenBB runtime path", () => {
  const snapshot = createRuntimeFoundationSnapshot();
  const ids = snapshot.components.map((component) => component.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.some((id) => id.toLowerCase().includes("openbb")), false);
  assert.equal(BUILT_IN_CONNECTORS.some((connector) => connector.id === "openbb"), false);
  assert.equal(MANAGED_RUNTIME_MANIFEST.packs.some((pack) => pack.id === "openbb"), false);
});

test("runtime foundation registry exposes connectors, providers and runtime packs through one discovery seam", () => {
  const registry = createRuntimeFoundationRegistry();

  assert.ok(registry.list("connector").length > 0);
  assert.equal(registry.list("ai_provider").length, AI_PROVIDERS.length);
  assert.equal(registry.list("runtime_pack").length, MANAGED_RUNTIME_MANIFEST.packs.length);
});


test("runtime foundation routes only implemented P11 capabilities without a second registry", () => {
  const registry = createRuntimeFoundationRegistry();
  const routes = registry.listCapabilityRoutes();
  const expectedP11Routes = P11_PACK_CATALOG.flatMap((pack) => pack.availability
    .filter((item) => item.executionStatus !== "planned" && item.executionStatus !== "deferred")
    .map((item) => item.capability)).sort();
  const actualP11Routes = routes.map((route) => route.capability)
    .filter((capability) => P11_PACK_CATALOG.some((pack) => pack.capabilities.includes(capability)))
    .sort();

  assert.deepEqual(actualP11Routes, expectedP11Routes);
  assert.ok(routes.some((route) => route.capability === "finance.valuation.reverse_dcf"));
  assert.ok(routes.some((route) => route.capability === "portfolio.optimize.hrp"));
  assert.ok(routes.some((route) => route.capability === "pricing.derivatives.black_scholes"));
  assert.equal(routes.some((route) => route.capability === "research.project.search"), true);
  assert.equal(routes.some((route) => route.capability === "research.project.runtime"), true);
  assert.equal(routes.some((route) => route.capability === "documents.local.parse"), true);
  assert.ok(registry.list().some((component) => component.runtimePackId === "lios.finance"));
});


test("runtime foundation registry includes P12 voice adapters without a parallel runtime", () => {
  const registry = createRuntimeFoundationRegistry();
  assert.ok(registry.list().some((component) => component.id === "p12:voice-input"));
  assert.ok(registry.list().some((component) => component.id === "p12:speech-output"));
});

test("runtime foundation exposes truthful coding inventory without activating an ACP agent", async () => {
  const registry = createRuntimeFoundationRegistry();
  const coding = registry.require("coding:acp-runtime");
  assert.deepEqual(coding.descriptor.capabilities, ["coding:runtime-inventory"]);
  assert.equal("run" in coding, false);
  const health = await coding.health!();
  assert.ok(health.state === "not_installed" || health.state === "disabled");
});

test("runtime foundation distinguishes native governed coding from unverified external ACP inventory", async () => {
  const registry = createRuntimeFoundationRegistry();
  const native = registry.require("coding:lios-governed-workspace");
  assert.ok(native.descriptor.capabilities.includes("coding:inspect"));
  assert.ok(native.descriptor.capabilities.includes("coding:patch-apply"));
  assert.ok(native.descriptor.capabilities.includes("coding:checks"));
  const health = await native.health!();
  assert.equal(health.state, "disabled", "test process has no configured user-owned coding root");
  assert.match(health.detail, /LIOS_CODING_WORKSPACE_ROOT/);

  const external = registry.require("coding:acp-runtime");
  assert.deepEqual(external.descriptor.capabilities, ["coding:runtime-inventory"]);
  assert.equal(external.descriptor.capabilities.includes("coding:patch-apply"), false);
});
