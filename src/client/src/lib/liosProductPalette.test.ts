import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIOS_PALETTE, LIOS_PRODUCT_PALETTES, resolveLiosProductPalette, readLiosProductPalette, initializeLiosProductPalette, isLiosLightPalette, setLiosProductPalette, LIOS_PALETTE_STORAGE_KEY } from "./liosProductPalette";

test("palette choices have unique IDs and are parseable", () => {
  assert.equal(new Set(LIOS_PRODUCT_PALETTES.map((palette) => palette.id)).size, 5);
  for (const palette of LIOS_PRODUCT_PALETTES) {
    assert.equal(resolveLiosProductPalette(palette.id), palette.id);
  }
});
test("invalid or missing persisted value fails to a known theme", () => {
  for (const malformed of [null, undefined, "__proto__", "DARK", "", 5]) {
    assert.equal(resolveLiosProductPalette(malformed), DEFAULT_LIOS_PALETTE);
  }
});
test("light modes are not trapped in the legacy dark selector", () => {
  assert.equal(isLiosLightPalette("chatgpt-light"), true);
  assert.equal(isLiosLightPalette("claude-light"), true);
  assert.equal(isLiosLightPalette("chatgpt-dark"), false);
  assert.equal(isLiosLightPalette("claude-dark"), false);
  assert.equal(isLiosLightPalette("lios-classic"), false);
});
test("non-browser palette bootstrap has an inert fallback", () => {
  assert.equal(readLiosProductPalette(), DEFAULT_LIOS_PALETTE);
  assert.doesNotThrow(initializeLiosProductPalette);
});


function withBrowserMock(
  run: (state: { attributes: Map<string, string>; classes: Set<string>; storage: Map<string, string> }) => void,
  denyStorage = false,
): void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const storage = new Map<string, string>([["lios.fixture-other-state", "unchanged"]]);
  const root = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    classList: {
      toggle: (name: string, enabled: boolean) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
    },
  };
  const localStorage = {
    getItem: (name: string) => {
      if (denyStorage) throw Error("Storage is disabled");
      return storage.get(name) ?? null;
    },
    setItem: (name: string, value: string) => {
      if (denyStorage) throw Error("Storage is disabled");
      storage.set(name, value);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: root } });
  try {
    run({ attributes, classes, storage });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

test("each appearance sets the correct light/dark native selectors and persists only the palette preference", () => {
  withBrowserMock(({ attributes, classes, storage }) => {
    for (const palette of LIOS_PRODUCT_PALETTES) {
      setLiosProductPalette(palette.id);
      assert.equal(attributes.get("data-lios-palette"), palette.id);
      const light = isLiosLightPalette(palette.id);
      assert.equal(attributes.get("data-theme"), light ? "light" : "dark");
      assert.equal(classes.has("dark"), !light);
      assert.equal(storage.get(LIOS_PALETTE_STORAGE_KEY), palette.id);
      assert.equal(storage.get("lios.fixture-other-state"), "unchanged");
    }
  });
});

test("blocked storage cannot prevent immediate theme selection or make legacy mount reset it", () => {
  withBrowserMock(({ attributes, classes }) => {
    setLiosProductPalette("claude-light");
    assert.equal(attributes.get("data-theme"), "light");
    assert.equal(classes.has("dark"), false);
    assert.doesNotThrow(() => initializeLiosProductPalette());
    assert.equal(attributes.get("data-lios-palette"), "claude-light");
    assert.equal(readLiosProductPalette(), DEFAULT_LIOS_PALETTE);
  }, true);
});

test("invalid persisted Appearance resolves safely during boot without touching other user state", () => {
  withBrowserMock(({ attributes, storage, classes }) => {
    storage.set(LIOS_PALETTE_STORAGE_KEY, "not-a-palette");
    initializeLiosProductPalette();
    assert.equal(attributes.get("data-lios-palette"), DEFAULT_LIOS_PALETTE);
    assert.equal(attributes.get("data-theme"), "dark");
    assert.equal(classes.has("dark"), true);
    assert.equal(storage.get("lios.fixture-other-state"), "unchanged");
  });
});
