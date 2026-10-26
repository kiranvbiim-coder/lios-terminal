import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIOS_PALETTE, LIOS_PRODUCT_PALETTES, resolveLiosProductPalette, readLiosProductPalette, initializeLiosProductPalette } from "./liosProductPalette";

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
test("non-browser palette bootstrap has an inert fallback", () => {
  assert.equal(readLiosProductPalette(), DEFAULT_LIOS_PALETTE);
  assert.doesNotThrow(initializeLiosProductPalette);
});
