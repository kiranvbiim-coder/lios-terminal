import assert from "node:assert/strict";
import test from "node:test";
import { EXPERIENCE_SHELL_SURFACES } from "@shared/waveCContracts";
import {
  EXPERIENCE_SELECTED_FIELDS_STORAGE_KEY,
  EXPERIENCE_SURFACE_STORAGE_KEY,
  loadExperienceSurface,
  setExperienceSurface,
  subscribeExperienceSurface,
  hostedDiscoverSurface,
  isExperienceShellSurface,
  requestExperienceField,
  subscribeExperienceField,
  surfaceForView,
} from "./experienceShell";
import { PRODUCT_NAV_ORDER } from "./productNavigation";

test("compatibility surface registry remains available without owning authenticated primary navigation", () => {
  assert.deepEqual(PRODUCT_NAV_ORDER, [
    "projects",
    "pulse",
    "explore",
    "workbench",
    "signals",
    "library",
    "data",
    "settings",
  ]);
  assert.deepEqual(EXPERIENCE_SHELL_SURFACES.map((item) => item.id), [
    "projects",
    "pulse",
    "explore",
    "workbench",
    "signals",
    "library",
  ]);
});

test("experience-shell surface guards reject unknown stored surfaces", () => {
  assert.equal(isExperienceShellSurface("wave-c"), false);
  assert.equal(isExperienceShellSurface("pulse"), true);
  for (const surface of ["pulse", "explore", "signals", "library"] as const) assert.equal(hostedDiscoverSurface(surface), true, surface);
  for (const surface of ["projects", "workbench"] as const) assert.equal(hostedDiscoverSurface(surface), false, surface);
});

test("existing analytical views remain Workbench capabilities", () => {
  assert.equal(surfaceForView("valuation"), "workbench");
  assert.equal(surfaceForView("quantlab"), "workbench");
  assert.equal(surfaceForView("screener"), "explore");
  assert.equal(surfaceForView("alerts"), "signals");
  assert.equal(surfaceForView("workspaces"), "library");
  assert.equal(surfaceForView("missioncontrol"), "pulse");
});


test("global metric discovery persists and broadcasts the Explore field selection", () => {
  const storage = new Map<string, string>();
  const target = new EventTarget();
  const fakeWindow = Object.assign(target, {
    localStorage: {
      getItem(key: string) { return storage.get(key) ?? null; },
      setItem(key: string, value: string) { storage.set(key, value); },
      removeItem(key: string) { storage.delete(key); },
      clear() { storage.clear(); },
      key(index: number) { return [...storage.keys()][index] ?? null; },
      get length() { return storage.size; },
    },
  });

  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });

  try {
    let selected: string | null = null;
    const unsubscribe = subscribeExperienceField((fieldId) => { selected = fieldId; });

    requestExperienceField("metric.roic");
    requestExperienceField("metric.revenue");
    requestExperienceField("metric.roic");

    assert.equal(selected, "metric.roic");
    assert.deepEqual(
      JSON.parse(storage.get(EXPERIENCE_SELECTED_FIELDS_STORAGE_KEY) ?? "[]"),
      ["metric.revenue", "metric.roic"],
    );

    unsubscribe();
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});


test("persisted supporting surfaces reopen through the canonical Projects shell", () => {
  const storage = new Map<string, string>();
  const fakeWindow = Object.assign(new EventTarget(), {
    localStorage: {
      getItem(key: string) { return storage.get(key) ?? null; },
      setItem(key: string, value: string) { storage.set(key, value); },
      removeItem(key: string) { storage.delete(key); },
    },
  });
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    for (const surface of ["pulse", "explore", "signals", "library"] as const) {
      storage.set(EXPERIENCE_SURFACE_STORAGE_KEY, surface);
      assert.equal(loadExperienceSurface(), "projects");
    }
    storage.set(EXPERIENCE_SURFACE_STORAGE_KEY, "projects");
    assert.equal(loadExperienceSurface(), "projects");
    storage.set(EXPERIENCE_SURFACE_STORAGE_KEY, "workbench");
    assert.equal(loadExperienceSurface(), "workbench");
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("experience surface changes persist once and broadcast through one authority", () => {
  const storage = new Map<string, string>();
  let writes = 0;
  const fakeWindow = Object.assign(new EventTarget(), {
    localStorage: {
      getItem(key: string) { return storage.get(key) ?? null; },
      setItem(key: string, value: string) { writes += 1; storage.set(key, value); },
      removeItem(key: string) { storage.delete(key); },
    },
  });
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    let observed: string | null = null;
    const unsubscribe = subscribeExperienceSurface((surface) => { observed = surface; });
    setExperienceSurface("workbench");
    assert.equal(observed, "workbench");
    assert.equal(storage.get(EXPERIENCE_SURFACE_STORAGE_KEY), "workbench");
    assert.equal(writes, 1);
    unsubscribe();
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("surface navigation remains live when local storage is unavailable", () => {
  const fakeWindow = Object.assign(new EventTarget(), {
    localStorage: {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    },
  });
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    assert.equal(loadExperienceSurface(), "projects");
    let observed: string | null = null;
    const unsubscribe = subscribeExperienceSurface((surface) => { observed = surface; });
    assert.doesNotThrow(() => setExperienceSurface("workbench"));
    assert.equal(observed, "workbench");
    unsubscribe();
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});
