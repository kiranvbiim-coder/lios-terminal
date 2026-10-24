import test from "node:test";
import assert from "node:assert/strict";
import { resolveVisualCanvasPolicy } from "./visualCanvasPolicy";

test("WS-12 visual environments are opt-in, default off means solid and no preloads", () => {
  assert.deepEqual(resolveVisualCanvasPolicy({
    enabled: false, intensity: "immersive", lowResourceMode: false, softwareRendered: false,
  }), { renderScene: false, useLowResourceAsset: false, preloadScene: false });
});

test("WS-12 Focus removes full-screen scene regardless of explicit visual preference", () => {
  for (const lowResourceMode of [true, false]) {
    for (const softwareRendered of [true, false]) {
      const result = resolveVisualCanvasPolicy({
        enabled: true, intensity: "focus", lowResourceMode, softwareRendered,
      });
      assert.equal(result.renderScene, false);
      assert.equal(result.preloadScene, false);
    }
  }
});

test("WS-12 contextual and immersive visual modes reuse existing full-size assets", () => {
  for (const intensity of ["immersive", "contextual"] as const) {
    assert.deepEqual(resolveVisualCanvasPolicy({
      enabled: true, intensity, lowResourceMode: false, softwareRendered: false,
    }), { renderScene: true, useLowResourceAsset: false, preloadScene: true });
  }
});

test("WS-12 explicitly selected low-resource mode uses small assets and no speculative preload", () => {
  assert.deepEqual(resolveVisualCanvasPolicy({
    enabled: true, intensity: "contextual", lowResourceMode: true, softwareRendered: false,
  }), { renderScene: true, useLowResourceAsset: true, preloadScene: false });
});

test("WS-12 software-rendered devices automatically adopt the lower graphics budget", () => {
  assert.deepEqual(resolveVisualCanvasPolicy({
    enabled: true, intensity: "immersive", lowResourceMode: false, softwareRendered: true,
  }), { renderScene: true, useLowResourceAsset: true, preloadScene: false });
});

test("WS-12 asset policy does not require a new scene or alter permissions or source data", () => {
  const result = resolveVisualCanvasPolicy({
    enabled: true, intensity: "contextual", lowResourceMode: false, softwareRendered: true,
  });
  assert.deepEqual(Object.keys(result).sort(), ["preloadScene", "renderScene", "useLowResourceAsset"]);
});
