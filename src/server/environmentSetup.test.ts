import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import { updateEnvironmentSetupSchema } from "@shared/schema";
import { normalizeSetupAiProviderId, requiresInitialAiVerification, validateConnectorIds } from "./environmentSetupService";
import { PYTHON_ENGINE_PACKS, PYTHON_RUNTIME_PROFILES } from "./pythonRuntime";

test("environment setup filters unknown and duplicate connector ids", () => {
  const valid = BUILT_IN_CONNECTORS.slice(0, 2).map((connector) => connector.id);
  const result = validateConnectorIds([valid[0], "unknown", valid[0], valid[1]]);
  assert.deepEqual(result, valid);
});

test("environment setup schema enforces supported runtime profiles", () => {
  const parsed = updateEnvironmentSetupSchema.safeParse({
    selectedConnectorIds: ["sec_edgar"],
    pythonRuntimeId: "lios-managed",
    pythonPackIds: ["core"],
    complete: true,
  });
  assert.equal(parsed.success, true);
  assert.equal(updateEnvironmentSetupSchema.safeParse({ pythonRuntimeId: "arbitrary-code" }).success, false);
});

test("environment setup schema defaults to managed core runtime", () => {
  const parsed = updateEnvironmentSetupSchema.parse({});
  assert.equal(parsed.pythonRuntimeId, "lios-managed");
  assert.deepEqual(parsed.pythonPackIds, ["core"]);
  assert.equal(parsed.complete, false);
});

test("environment setup schema persists explicit AI provider and model selections", () => {
  const parsed = updateEnvironmentSetupSchema.parse({
    aiProviderId: "openai",
    aiModelId: "  gpt-4o-mini  ",
  });
  assert.equal(parsed.aiProviderId, "openai");
  assert.equal(parsed.aiModelId, "gpt-4o-mini");
});

test("environment setup canonicalizes supported AI provider aliases", () => {
  assert.equal(normalizeSetupAiProviderId("together_ai"), "together");
  assert.equal(normalizeSetupAiProviderId("google"), "gemini");
  assert.equal(normalizeSetupAiProviderId("grok"), "xai");
  assert.equal(normalizeSetupAiProviderId("xai_grok"), "xai");
  assert.equal(normalizeSetupAiProviderId("lmstudio"), "lm_studio");
  assert.equal(normalizeSetupAiProviderId(null), null);
  assert.throws(() => normalizeSetupAiProviderId("not-a-real-provider"), /Unsupported AI provider/);
});

test("first-time setup completion requires live verification only when AI is selected", () => {
  const neverCompleted = { completedAt: null };
  const alreadyCompleted = { completedAt: new Date("2026-09-24T00:00:00Z") };

  assert.equal(requiresInitialAiVerification(neverCompleted as never, {
    complete: true,
    aiProviderId: "openai",
  }), true);
  assert.equal(requiresInitialAiVerification(null, {
    complete: true,
    aiProviderId: "google",
  }), true, "provider aliases must still require verification");
  assert.equal(requiresInitialAiVerification(neverCompleted as never, {
    complete: true,
    aiProviderId: null,
  }), false, "AI remains optional");
  assert.equal(requiresInitialAiVerification(neverCompleted as never, {
    complete: false,
    aiProviderId: "openai",
  }), false, "saving an incomplete setup must not require a live call");
  assert.equal(requiresInitialAiVerification(alreadyCompleted as never, {
    complete: true,
    aiProviderId: "openai",
  }), false, "reopening a completed setup must not be blocked by a temporary provider outage");
});

test("environment setup schema accepts disabling AI without a model", () => {
  const parsed = updateEnvironmentSetupSchema.parse({
    aiProviderId: null,
    aiModelId: null,
  });
  assert.equal(parsed.aiProviderId, null);
  assert.equal(parsed.aiModelId, null);
});

test("python runtime profiles expose managed, local, external, and remote options", () => {
  const ids = PYTHON_RUNTIME_PROFILES.map((profile) => profile.id);
  assert.deepEqual(ids, ["lios-managed", "system-auto", "external-path", "remote-service"]);
  assert.equal(PYTHON_RUNTIME_PROFILES.find((profile) => profile.recommended)?.id, "lios-managed");
});

test("python engine packs identify package and engine coverage", () => {
  const ids = PYTHON_ENGINE_PACKS.map((pack) => pack.id);
  assert.ok(ids.includes("core"));
  assert.ok(ids.includes("fixed-income"));
  assert.ok(ids.includes("econometrics"));
  for (const pack of PYTHON_ENGINE_PACKS) {
    assert.ok(pack.packages.length > 0, `${pack.id} missing packages`);
    assert.ok(pack.engines.length > 0, `${pack.id} missing engines`);
  }
});

test("managed runtime manifest pins the core engine environment", async () => {
  const { MANAGED_RUNTIME_MANIFEST } = await import("./runtimeManifest");
  assert.equal(MANAGED_RUNTIME_MANIFEST.runtimeId, "lios-managed");
  assert.equal(MANAGED_RUNTIME_MANIFEST.installPolicy, "signed_allowlist_only");
  const core = MANAGED_RUNTIME_MANIFEST.packs.find((pack) => pack.id === "core");
  assert.ok(core);
  assert.ok(core.packages.some((pkg) => pkg.name === "numpy"));
  assert.ok(core.packages.some((pkg) => pkg.name === "QuantLib") === false);
  const yahooPack = MANAGED_RUNTIME_MANIFEST.packs.find((pack) => pack.id === "community-yahoo");
  assert.ok(yahooPack?.packages.some((pkg) => pkg.name === "yfinance"));
  const coreOnly = MANAGED_RUNTIME_MANIFEST.packs.find((pack) => pack.id === "core");
  assert.ok(coreOnly);
  assert.equal(coreOnly.packages.some((pkg) => pkg.name === "yfinance"), false);
});
