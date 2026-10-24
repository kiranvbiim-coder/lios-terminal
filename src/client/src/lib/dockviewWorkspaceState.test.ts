import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCKVIEW_LAYOUT_STORAGE_KEY,
  DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY,
  LEGACY_DOCKVIEW_LAYOUT_STORAGE_KEYS,
  loadDockviewLayoutState,
  saveDockviewLayoutState,
  resolveWorkspaceRendererState,
} from "./dockviewWorkspaceState";

function withFakeWindow(run: (storage: Map<string, string>) => void) {
  const storage = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem(key: string) { return storage.get(key) ?? null; },
      setItem(key: string, value: string) { storage.set(key, value); },
      removeItem(key: string) { storage.delete(key); },
      clear() { storage.clear(); },
      key(index: number) { return [...storage.keys()][index] ?? null; },
      get length() { return storage.size; },
    },
  };

  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });

  try {
    run(storage);
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
}

test("stale Dockview v1 geometry is discarded instead of resurrecting overlapping panels", () => {
  withFakeWindow((storage) => {
    storage.set(LEGACY_DOCKVIEW_LAYOUT_STORAGE_KEYS[0], JSON.stringify({ floatingGroups: [{ id: "stale" }] }));

    assert.equal(loadDockviewLayoutState(), null);
    assert.equal(storage.has(LEGACY_DOCKVIEW_LAYOUT_STORAGE_KEYS[0]), false);
  });
});

test("current Dockview geometry persists under the v2 cache key", () => {
  withFakeWindow((storage) => {
    const layout = { grid: { root: { type: "branch" } } };
    saveDockviewLayoutState(layout);

    assert.equal(storage.has(DOCKVIEW_LAYOUT_STORAGE_KEY), true);
    assert.deepEqual(loadDockviewLayoutState(), layout);

    saveDockviewLayoutState(null);
    assert.equal(storage.has(DOCKVIEW_LAYOUT_STORAGE_KEY), false);
  });
});


test("corrupt current Dockview geometry is removed before it can be restored", () => {
  withFakeWindow((storage) => {
    storage.set(DOCKVIEW_LAYOUT_STORAGE_KEY, "{broken");
    assert.equal(loadDockviewLayoutState(), null);
    assert.equal(storage.has(DOCKVIEW_LAYOUT_STORAGE_KEY), false);
  });
});

test("Dockview geometry follows each original Terminal tab without replacing another tab", () => {
  withFakeWindow((storage) => {
    const legacy = { grid: { width: 960 } };
    const research = { grid: { width: 720 }, activeGroup: "research" };
    const portfolio = { grid: { width: 1120 }, activeGroup: "portfolio" };
    saveDockviewLayoutState(legacy);
    assert.deepEqual(loadDockviewLayoutState("new-tab"), legacy, "an upgraded tab can seed its first geometry from v2");
    saveDockviewLayoutState(research, "tab-research");
    saveDockviewLayoutState(portfolio, "tab-portfolio");
    assert.deepEqual(loadDockviewLayoutState("tab-research"), research);
    assert.deepEqual(loadDockviewLayoutState("tab-portfolio"), portfolio);
    assert.deepEqual(loadDockviewLayoutState(), legacy, "legacy callers still use the original v2 key");
    assert.ok(storage.has(DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY));
    saveDockviewLayoutState({ grid: { width: 630 } }, "tab-research");
    assert.deepEqual(loadDockviewLayoutState("tab-portfolio"), portfolio, "resizing one tab cannot resize another");
  });
});

test("clearing a scoped Dockview layout does not resurrect obsolete global geometry", () => {
  withFakeWindow(() => {
    saveDockviewLayoutState({ grid: { width: 900 } });
    saveDockviewLayoutState({ grid: { width: 680 } }, "tab-one");
    saveDockviewLayoutState(null, "tab-one");
    assert.equal(loadDockviewLayoutState("tab-one"), null);
    assert.deepEqual(loadDockviewLayoutState("tab-two"), { grid: { width: 900 } });
  });
});

test("scoped layouts reject invalid IDs and damaged caches, and do not grow without bounds", () => {
  withFakeWindow((storage) => {
    saveDockviewLayoutState({ grid: { old: true } }, "safe");
    saveDockviewLayoutState({ grid: { illegal: true } }, "__proto__!");
    assert.equal(loadDockviewLayoutState("__proto__!"), null);
    assert.deepEqual(loadDockviewLayoutState("safe"), { grid: { old: true } });
    for (let index = 0; index < 30; index++) {
      saveDockviewLayoutState({ grid: { index } }, "tab-" + index);
    }
    const saved = JSON.parse(storage.get(DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY) ?? "[]") as Array<{ scope: string }>;
    assert.equal(saved.length, 24);
    assert.equal(loadDockviewLayoutState("tab-0"), null);
    assert.deepEqual(loadDockviewLayoutState("tab-29"), { grid: { index: 29 } });
    storage.set(DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY, "{broken");
    assert.equal(loadDockviewLayoutState("tab-29"), null);
    assert.equal(storage.has(DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY), false);
  });
});

test("responsive renderer changes cannot remount an unsaved Artifact editor in either direction", () => {
  const desktop = { isMobile: false, maximizedPane: null };
  const mobile = { isMobile: true, maximizedPane: null };
  assert.equal(resolveWorkspaceRendererState(desktop, true, null, true), desktop);
  assert.equal(resolveWorkspaceRendererState(mobile, false, null, true), mobile);
  assert.deepEqual(resolveWorkspaceRendererState(desktop, true, null, false), mobile);
  assert.deepEqual(resolveWorkspaceRendererState(mobile, false, null, false), desktop);
  assert.equal(resolveWorkspaceRendererState(desktop, false, null, false), desktop);
});

test("maximized renderer identity is retained while dirty and released after save or reset", () => {
  const current = { isMobile: false, maximizedPane: "secondary" as const };
  assert.equal(resolveWorkspaceRendererState(current, true, null, true), current);
  assert.deepEqual(resolveWorkspaceRendererState(current, true, null, false), { isMobile: true, maximizedPane: null });
});
