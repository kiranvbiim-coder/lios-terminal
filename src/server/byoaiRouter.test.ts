import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_PROVIDERS,
  MCP_TOOL_REGISTRY,
  DEFAULT_TOOL_POLICY,
  evaluateToolPermission,
  createAttribution,
  getAvailableProviders,
  getProviderSetupOptions,
  type ToolPermissionPolicy,
} from "./byoaiRouter";

// ─── Provider Registry ────────────────────────────────────────────────────

test("BYOAI: provider ids are unique", () => {
  const ids = AI_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("BYOAI: every provider has envKey and vaultKey", () => {
  for (const p of AI_PROVIDERS) {
    assert.ok(p.envKey, `${p.id} missing envKey`);
    assert.ok(p.vaultKey, `${p.id} missing vaultKey`);
    assert.ok(p.defaultModel, `${p.id} missing defaultModel`);
    assert.ok(p.models.length > 0, `${p.id} has no models`);
  }
});

test("BYOAI: registry includes expanded cloud and compatible providers", () => {
  for (const providerId of ["mistral", "groq", "together"] as const) {
    const provider = AI_PROVIDERS.find((p) => p.id === providerId);
    assert.ok(provider, `${providerId} missing from governed BYOAI registry`);
    assert.equal(provider.allowCustomModel, true);
  }
  const xai = AI_PROVIDERS.find((p) => p.id === "xai");
  const compatible = AI_PROVIDERS.find((p) => p.id === "openai_compatible");
  assert.ok(xai);
  assert.equal(xai.defaultModel, "grok-4.6");
  assert.equal(xai.allowCustomModel, true);
  assert.ok(compatible);
  assert.equal(compatible.allowCustomModel, true);
  assert.deepEqual(compatible.requiredEnvKeys, ["OPENAI_COMPATIBLE_BASE_URL"]);
  assert.equal(compatible.modelEnvKey, "OPENAI_COMPATIBLE_MODEL");
});

test("BYOAI: Gemini defaults to a current lightweight model and omits the shut-down Gemini 2.0 option", () => {
  const gemini = AI_PROVIDERS.find((provider) => provider.id === "gemini");
  assert.ok(gemini);
  assert.equal(gemini.defaultModel, "gemini-3.5-flash-lite");
  assert.ok(gemini.models.includes("gemini-3.8-flash"));
  assert.ok(gemini.models.includes("gemini-2.5-flash"), "retain explicit legacy selection for users with existing model access");
  assert.equal(gemini.models.includes("gemini-2.0-flash"), false);
});

test("BYOAI: provider availability exposes the expanded registry without secrets", () => {
  const providers = getAvailableProviders();
  assert.deepEqual(
    providers.map((provider) => provider.id),
    ["anthropic", "gemini", "openai", "mistral", "groq", "together", "openrouter", "xai", "openai_compatible", "ollama", "lm_studio", "azure_openai"],
  );
  for (const provider of providers) {
    assert.ok("id" in provider && "available" in provider && "isLocal" in provider);
    assert.ok(!("envKey" in provider));
    assert.ok(!("vaultKey" in provider));
    assert.ok(!("credential" in provider));
  }
});

test("BYOAI: setup metadata exposes safe credential slots without secrets", () => {
  const options = getProviderSetupOptions();
  assert.deepEqual(options.map((provider) => provider.id), AI_PROVIDERS.map((provider) => provider.id));
  for (const option of options) {
    assert.ok(option.credentialName);
    assert.ok(!("envKey" in option));
    assert.ok(!("vaultKey" in option));
    assert.ok(!("credential" in option));
  }
  assert.equal(options.find((provider) => provider.id === "openai_compatible")?.requiresExternalConfig, true);
  assert.equal(options.find((provider) => provider.id === "openai")?.requiresExternalConfig, false);
  assert.equal(options.find((provider) => provider.id === "ollama")?.defaultEndpoint, "http://127.0.0.1:11434");
  assert.equal(options.find((provider) => provider.id === "lm_studio")?.defaultEndpoint, "http://127.0.0.1:1234/v1");
});

test("BYOAI: compatible endpoint requires both key and base URL", () => {
  const previousKey = process.env.OPENAI_COMPATIBLE_API_KEY;
  const previousBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;
  try {
    process.env.OPENAI_COMPATIBLE_API_KEY = "test-compatible-key";
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    assert.equal(getAvailableProviders().find((p) => p.id === "openai_compatible")?.available, false);

    process.env.OPENAI_COMPATIBLE_BASE_URL = "https://example.invalid/v1";
    assert.equal(getAvailableProviders().find((p) => p.id === "openai_compatible")?.available, true);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_COMPATIBLE_API_KEY;
    else process.env.OPENAI_COMPATIBLE_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    else process.env.OPENAI_COMPATIBLE_BASE_URL = previousBaseUrl;
  }
});


test("BYOAI: ollama is marked as local", () => {
  const ollama = AI_PROVIDERS.find((p) => p.id === "ollama");
  assert.ok(ollama);
  assert.equal(ollama.isLocal, true);
});

// ─── MCP Tool Permission ─────────────────────────────────────────────────

test("MCP: tool ids are unique", () => {
  const ids = MCP_TOOL_REGISTRY.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("MCP: read tools are allowed by default without approval", () => {
  const result = evaluateToolPermission("lios.quote");
  assert.equal(result.allowed, true);
  assert.equal(result.requiresApproval, false);
});

test("MCP: write tools require approval by default", () => {
  const result = evaluateToolPermission("lios.create_workspace");
  assert.equal(result.allowed, true);
  assert.equal(result.requiresApproval, true);
});

test("MCP: external tools require approval by default", () => {
  const result = evaluateToolPermission("lios.web_search");
  assert.equal(result.allowed, true);
  assert.equal(result.requiresApproval, true);
});

test("MCP: unknown tool is blocked", () => {
  const result = evaluateToolPermission("lios.nonexistent");
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "tool_not_registered");
});

test("MCP: explicitly blocked tool is denied", () => {
  const policy: ToolPermissionPolicy = { ...DEFAULT_TOOL_POLICY, blockedTools: ["lios.quote"] };
  const result = evaluateToolPermission("lios.quote", policy);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "tool_explicitly_blocked");
});

test("MCP: allowlist restricts to listed tools only", () => {
  const policy: ToolPermissionPolicy = { ...DEFAULT_TOOL_POLICY, allowedTools: ["lios.quote", "lios.financials"] };
  assert.equal(evaluateToolPermission("lios.quote", policy).allowed, true);
  assert.equal(evaluateToolPermission("lios.dcf", policy).allowed, false);
  assert.equal(evaluateToolPermission("lios.dcf", policy).reason, "tool_not_in_allowed_list");
});

test("MCP: blocked data access denies tool", () => {
  const policy: ToolPermissionPolicy = { ...DEFAULT_TOOL_POLICY, blockedDataAccess: ["portfolio"] };
  assert.equal(evaluateToolPermission("lios.portfolio", policy).allowed, false);
  assert.ok(evaluateToolPermission("lios.portfolio", policy).reason.includes("data_access_blocked"));
  // Tools that don't access portfolio are still allowed
  assert.equal(evaluateToolPermission("lios.quote", policy).allowed, true);
});

test("MCP: compute tools don't require approval by default", () => {
  const computeTools = MCP_TOOL_REGISTRY.filter((t) => t.category === "compute");
  for (const tool of computeTools) {
    const result = evaluateToolPermission(tool.id);
    assert.equal(result.allowed, true);
    assert.equal(result.requiresApproval, false, `${tool.id} should not require approval`);
  }
});

// ─── AI Attribution ───────────────────────────────────────────────────────

test("attribution: creates unique id and hashes prompt/output", () => {
  const attr = createAttribution({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    prompt: "Explain the DCF valuation",
    output: "A DCF valuation discounts future cash flows...",
    toolsCalled: ["lios.dcf"],
    dataAccessed: ["financial_statements", "market_data"],
  });
  assert.ok(attr.id.length > 0);
  assert.equal(attr.provider, "anthropic");
  assert.equal(attr.promptHash.length, 64);
  assert.equal(attr.outputHash.length, 64);
  assert.notEqual(attr.promptHash, attr.outputHash);
  assert.deepEqual(attr.toolsCalled, ["lios.dcf"]);
  assert.deepEqual(attr.dataAccessed, ["financial_statements", "market_data"]);
});

test("attribution: hashes are deterministic", () => {
  const a = createAttribution({ provider: "gemini", model: "gemini-2.5-flash", prompt: "test", output: "result" });
  const b = createAttribution({ provider: "gemini", model: "gemini-2.5-flash", prompt: "test", output: "result" });
  assert.equal(a.promptHash, b.promptHash);
  assert.equal(a.outputHash, b.outputHash);
  assert.notEqual(a.id, b.id); // different UUIDs
});

test("attribution: different prompts produce different hashes", () => {
  const a = createAttribution({ provider: "openai", model: "gpt-4o", prompt: "question A", output: "answer" });
  const b = createAttribution({ provider: "openai", model: "gpt-4o", prompt: "question B", output: "answer" });
  assert.notEqual(a.promptHash, b.promptHash);
  assert.equal(a.outputHash, b.outputHash); // same output
});
