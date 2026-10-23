import test from "node:test";
import assert from "node:assert/strict";
import {
  dispatchVisualContext,
  getProjectVisualEnvironmentPin,
  loadVisualEnvironmentRuntimeState,
  resolveVisualEnvironment,
  restoreVisualEnvironmentState,
  setProjectVisualEnvironmentPin,
} from "./visualEnvironment";

/** Simulate private/locked-down webviews without changing the project's real storage contract. */
function withStorageDenied(run: () => void): void {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const window = { dispatchEvent: (_event: Event) => true };
  const denied = {
    getItem: (_key: string): string | null => { throw new Error("SecurityError"); },
    setItem: (_key: string, _value: string): void => { throw new Error("QuotaExceededError"); },
    removeItem: (_key: string): void => { throw new Error("SecurityError"); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: denied });
  try { run(); }
  finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("WS-12 denied storage cannot crash setting a named Project visual pin", () => {
  withStorageDenied(() => {
    setProjectVisualEnvironmentPin("ws12-pinned", "portfolio-risk");
    assert.equal(getProjectVisualEnvironmentPin("ws12-pinned"), "portfolio-risk");
    assert.equal(resolveVisualEnvironment({ projectId: "ws12-pinned", semanticContext: "markets" }), "portfolio-risk");
  });
});

test("WS-12 runtime context is held in-session if persistence is unavailable", () => {
  withStorageDenied(() => {
    dispatchVisualContext({
      projectId: "ws12-runtime",
      intensity: "contextual",
      semanticContext: "research",
    });
    const state = loadVisualEnvironmentRuntimeState();
    assert.equal(state?.projectId, "ws12-runtime");
    assert.equal(state?.environmentId, "research-knowledge");
    assert.equal(state?.intensity, "contextual");
  });
});

test("WS-12 an explicitly restored visual choice works in-session without disk access", () => {
  withStorageDenied(() => {
    assert.equal(restoreVisualEnvironmentState({
      projectId: "ws12-restored",
      environmentId: "company-intelligence",
      intensity: "immersive",
      semanticContext: "company",
    }), true);
    assert.equal(resolveVisualEnvironment({ projectId: "ws12-restored", semanticContext: "valuation" }), "company-intelligence");
  });
});

test("WS-12 unpin clears the same Project runtime even when storage removes are blocked", () => {
  withStorageDenied(() => {
    setProjectVisualEnvironmentPin("ws12-cleared", "markets");
    dispatchVisualContext({ projectId: "ws12-cleared", intensity: "contextual", semanticContext: "markets" });
    assert.equal(getProjectVisualEnvironmentPin("ws12-cleared"), "markets");
    setProjectVisualEnvironmentPin("ws12-cleared", null);
    assert.equal(getProjectVisualEnvironmentPin("ws12-cleared"), null);
    assert.equal(loadVisualEnvironmentRuntimeState(), null);
    assert.equal(resolveVisualEnvironment({ projectId: "ws12-cleared", semanticContext: "research" }), "research-knowledge");
  });
});

test("WS-12 invalid restored choices cannot enter runtime even when storage is denied", () => {
  withStorageDenied(() => {
    assert.equal(restoreVisualEnvironmentState({
      projectId: "ws12-invalid",
      environmentId: "not-a-real-environment",
      intensity: "immersive",
      semanticContext: "general",
    }), false);
  });
});
