import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES,
  DEFAULT_TERMINAL_UX_PREFERENCES,
  LEGACY_TERMINAL_UX_STORAGE_KEYS,
  TERMINAL_UX_STORAGE_KEY,
  loadTerminalUxPreferences,
  normalizeTerminalUxPreferences,
  patchTerminalUxPreferences,
  saveTerminalUxPreferences,
} from "./terminalUxPreferences";

test("invalid UX preferences fall back to professional defaults", () => {
  const value = normalizeTerminalUxPreferences({ experienceMode: "unknown", density: "tiny", showTickerTape: false });
  assert.equal(value.experienceMode, "professional");
  assert.equal(value.density, "standard");
  assert.equal(value.showTickerTape, false);
});

test("legacy preferences migrate with the reference matte default", () => {
  const migrated = normalizeTerminalUxPreferences({ experienceMode: "guided", density: "compact" });
  assert.equal(migrated.experienceMode, "guided");
  assert.equal(migrated.density, "compact");
  assert.equal(migrated.comfortMode, false);
  assert.equal(migrated.adaptiveCalm, true);
  assert.equal(migrated.ambientContext, true);
  assert.equal(migrated.visualEnvironmentsEnabled, false);
  assert.equal(migrated.visualEnvironmentMotion, true);
  assert.equal(migrated.lowResourceMode, false);
  assert.equal(migrated.showImmersiveDock, false);
});

test("legacy spacious density migrates to the comfortable workstation preset", () => {
  const migrated = normalizeTerminalUxPreferences({ density: "spacious" });
  assert.equal(migrated.density, "comfortable");
});

test("all supported workstation density presets are retained", () => {
  assert.equal(normalizeTerminalUxPreferences({ density: "terminal" }).density, "terminal");
  assert.equal(normalizeTerminalUxPreferences({ density: "compact" }).density, "compact");
  assert.equal(normalizeTerminalUxPreferences({ density: "standard" }).density, "standard");
  assert.equal(normalizeTerminalUxPreferences({ density: "comfortable" }).density, "comfortable");
});

test("guided mode and focus mode can be patched without changing unrelated settings", () => {
  const next = patchTerminalUxPreferences(DEFAULT_TERMINAL_UX_PREFERENCES, { experienceMode: "guided", focusMode: true });
  assert.equal(next.experienceMode, "guided");
  assert.equal(next.focusMode, true);
  assert.equal(next.showMacroTickerTape, false);
  assert.equal(next.adaptiveCalm, true);
  assert.equal(next.ambientContext, true);
});

test("comfort mode patch does not disable Intelligent Calm ambient context or research dock", () => {
  const next = patchTerminalUxPreferences(DEFAULT_TERMINAL_UX_PREFERENCES, { comfortMode: true });
  assert.equal(next.comfortMode, true);
  assert.equal(next.adaptiveCalm, true);
  assert.equal(next.ambientContext, true);
  assert.equal(next.showImmersiveDock, false);
});

test("Intelligent Calm can be explicitly disabled without changing model-facing preferences", () => {
  const next = patchTerminalUxPreferences(DEFAULT_TERMINAL_UX_PREFERENCES, { adaptiveCalm: false });
  assert.equal(next.adaptiveCalm, false);
  assert.equal(next.experienceMode, "professional");
  assert.equal(next.density, "standard");
});


test("new retail sessions start with a calm analytical canvas", () => {
  const preferences = normalizeTerminalUxPreferences(null, DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES);
  assert.equal(preferences.experienceMode, "professional");
  assert.equal(preferences.showImmersiveDock, false);
  assert.equal(preferences.showTickerTape, false);
  assert.equal(preferences.showMacroTickerTape, false);
  assert.equal(preferences.showJourneyPrompts, false);
});

test("explicit saved chrome choices override calm retail defaults", () => {
  const preferences = normalizeTerminalUxPreferences({
    showImmersiveDock: true,
    showTickerTape: true,
    showMacroTickerTape: true,
    showJourneyPrompts: true,
  }, DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES);

  assert.equal(preferences.showImmersiveDock, true);
  assert.equal(preferences.showTickerTape, true);
  assert.equal(preferences.showMacroTickerTape, true);
  assert.equal(preferences.showJourneyPrompts, true);
});


test("visual environment preferences remain presentation-only and independently configurable", () => {
  const next = patchTerminalUxPreferences(DEFAULT_TERMINAL_UX_PREFERENCES, {
    visualEnvironmentsEnabled: false,
    visualEnvironmentMotion: false,
    lowResourceMode: true,
  });
  assert.equal(next.visualEnvironmentsEnabled, false);
  assert.equal(next.visualEnvironmentMotion, false);
  assert.equal(next.lowResourceMode, true);
  assert.equal(next.density, "standard");
  assert.equal(next.focusMode, false);
});


test("legacy v1 shell preferences are migrated once with clutter-heavy chrome reset", () => {
  const storage = new Map<string, string>([
    [LEGACY_TERMINAL_UX_STORAGE_KEYS[0], JSON.stringify({
      density: "compact",
      reducedMotion: true,
      showImmersiveDock: true,
      showTickerTape: true,
      showMacroTickerTape: true,
      showJourneyPrompts: true,
      focusMode: true,
    })],
  ]);
  const fakeWindow = Object.assign(new EventTarget(), {
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
  const previousLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fakeWindow.localStorage });

  try {
    const migrated = loadTerminalUxPreferences();
    assert.equal(migrated.density, "compact");
    assert.equal(migrated.reducedMotion, true);
    assert.equal(migrated.focusMode, false);
    assert.equal(migrated.showImmersiveDock, false);
    assert.equal(migrated.showTickerTape, false);
    assert.equal(migrated.showMacroTickerTape, false);
    assert.equal(migrated.showJourneyPrompts, false);
    assert.equal(storage.has(LEGACY_TERMINAL_UX_STORAGE_KEYS[0]), false);
    assert.equal(storage.has(TERMINAL_UX_STORAGE_KEY), true);
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    if (previousLocalStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousLocalStorage });
  }
});


test("normalization respects nonstandard caller defaults when fields are absent", () => {
  const customDefaults = {
    ...DEFAULT_TERMINAL_UX_PREFERENCES,
    density: "compact" as const,
    focusMode: true,
    presentationMode: true,
    comfortMode: true,
    adaptiveCalm: false,
    ambientContext: false,
    lowResourceMode: true,
    reducedMotion: true,
    textScale: "large" as const,
    contextRailAutoOpen: true,
    proactivePulseEnabled: true,
  };
  const value = normalizeTerminalUxPreferences({}, customDefaults);
  assert.equal(value.density, "compact");
  assert.equal(value.focusMode, true);
  assert.equal(value.presentationMode, true);
  assert.equal(value.comfortMode, true);
  assert.equal(value.adaptiveCalm, false);
  assert.equal(value.ambientContext, false);
  assert.equal(value.lowResourceMode, true);
  assert.equal(value.reducedMotion, true);
  assert.equal(value.textScale, "large");
  assert.equal(value.contextRailAutoOpen, true);
  assert.equal(value.proactivePulseEnabled, true);
});

test("corrupt v2 preference storage is discarded instead of pinning a broken shell state", () => {
  const storage = new Map<string, string>([[TERMINAL_UX_STORAGE_KEY, "{broken"]]);
  const fakeWindow = Object.assign(new EventTarget(), {
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
    const value = loadTerminalUxPreferences();
    assert.deepEqual(value, DEFAULT_TERMINAL_UX_PREFERENCES);
    assert.equal(storage.has(TERMINAL_UX_STORAGE_KEY), false);
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("preference persistence failures do not break the current UI session", () => {
  const fakeWindow = Object.assign(new EventTarget(), {
    localStorage: {
      getItem() { return null; },
      setItem() { throw new Error("blocked"); },
      removeItem() {},
    },
  });
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    assert.doesNotThrow(() => saveTerminalUxPreferences(DEFAULT_TERMINAL_UX_PREFERENCES));
  } finally {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});


test("explicit saved visual-environment choice survives the matte reference default", () => {
  assert.equal(normalizeTerminalUxPreferences({ visualEnvironmentsEnabled: true }).visualEnvironmentsEnabled, true);
});
