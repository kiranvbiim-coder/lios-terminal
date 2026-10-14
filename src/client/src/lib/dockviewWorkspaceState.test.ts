import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCKVIEW_LAYOUT_STORAGE_KEY,
  LEGACY_DOCKVIEW_LAYOUT_STORAGE_KEYS,
  loadDockviewLayoutState,
  saveDockviewLayoutState,
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
