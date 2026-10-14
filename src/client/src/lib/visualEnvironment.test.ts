import test from "node:test";
import assert from "node:assert/strict";
import {
  VISUAL_ENVIRONMENTS,
  defaultEnvironmentForContext,
  getVisualEnvironment,
  inferVisualSemanticContext,
  inferVisualSemanticContextFromText,
  resolveVisualEnvironment,
  restoreVisualEnvironmentState,
} from "./visualEnvironment";

test("financial views resolve to stable semantic contexts", () => {
  assert.equal(inferVisualSemanticContext("valuation"), "valuation");
  assert.equal(inferVisualSemanticContext("portfolio"), "portfolio");
  assert.equal(inferVisualSemanticContext("backtesting"), "quant");
  assert.equal(inferVisualSemanticContext("research"), "research");
  assert.equal(inferVisualSemanticContext("market"), "markets");
});

test("meaningful prompts resolve the environment from the user's task", () => {
  assert.equal(inferVisualSemanticContextFromText("Build a DCF and change WACC to 9%"), "valuation");
  assert.equal(inferVisualSemanticContextFromText("Stress my portfolio for a severe drawdown"), "portfolio");
  assert.equal(inferVisualSemanticContextFromText("Run a backtest on this factor signal"), "quant");
  assert.equal(inferVisualSemanticContextFromText("Review the 10-Q and earnings transcript"), "research");
  assert.equal(inferVisualSemanticContextFromText("Help with retirement and net worth goals"), "personal-finance");
  assert.equal(inferVisualSemanticContextFromText("What is moving in markets today?"), "markets");
  assert.equal(inferVisualSemanticContextFromText("Hello", "company"), "company");
});

test("semantic contexts map to canonical LiOS environments", () => {
  assert.equal(defaultEnvironmentForContext("valuation"), "valuation");
  assert.equal(defaultEnvironmentForContext("risk"), "portfolio-risk");
  assert.equal(defaultEnvironmentForContext("research"), "research-knowledge");
  assert.equal(defaultEnvironmentForContext("general"), "neutral");
});

test("environment descriptor fallback is deterministic", () => {
  const resolved = resolveVisualEnvironment({ semanticContext: "markets", projectId: null });
  assert.equal(resolved, "markets");
  assert.equal(getVisualEnvironment(resolved).name, "Markets");
});


function withVisualStorage<T>(entries: Record<string, string>, run: (values: Map<string, string>) => T): T {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map(Object.entries(entries));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: () => true },
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    return run(values);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("automatic Project environments remain stable during the same Project without becoming pins", () => {
  withVisualStorage({
    "lios-visual-environment-runtime-v1": JSON.stringify({
      projectId: "9",
      environmentId: "company-intelligence",
      intensity: "contextual",
      semanticContext: "company",
    }),
  }, (values) => {
    assert.equal(resolveVisualEnvironment({ projectId: 9, semanticContext: "valuation" }), "company-intelligence");
    assert.equal(resolveVisualEnvironment({ projectId: 10, semanticContext: "valuation" }), "valuation");
    assert.equal(values.has("lios-visual-environment-project-pins-v1"), false);
  });
});

test("restoring visual continuity does not silently create a Project pin", () => {
  withVisualStorage({}, (values) => {
    assert.equal(restoreVisualEnvironmentState({
      projectId: "12",
      environmentId: "research-knowledge",
      intensity: "contextual",
      semanticContext: "research",
    }), true);
    assert.equal(values.has("lios-visual-environment-project-pins-v1"), false);
    const runtime = JSON.parse(values.get("lios-visual-environment-runtime-v1") || "null");
    assert.equal(runtime.environmentId, "research-knowledge");
  });
});


test("every production environment has a dedicated low-resource asset", () => {
  assert.equal(VISUAL_ENVIRONMENTS.length, 10);
  for (const environment of VISUAL_ENVIRONMENTS) {
    assert.match(environment.assetPath, /^\/visual-environments\/[^/]+\.svg$/);
    assert.match(environment.lowResourceAssetPath, /^\/visual-environments\/low-resource\/[^/]+\.svg$/);
    assert.notEqual(environment.assetPath, environment.lowResourceAssetPath);
  }
});
