import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-level UX guard only: actual focus, assistive-tech and small-screen
// behavior must still be verified in a rendered and packaged app.
const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("keyboard overlays share a focus lifecycle including Tab, Escape and return focus", () => {
  const hook = source("./useAccessibleDialog.ts");
  assert.match(hook, /initialRef\.current\?\.focus\(\)/);
  assert.match(hook, /previous\?\.isConnected/);
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /event\.key !== "Tab"/);
  assert.match(hook, /event\.shiftKey/);
  assert.match(hook, /dialog\.contains\(active\)/);
});

test("quick switcher exposes an accessible search and selected result, without changing its destinations", () => {
  const component = source("./QuickSwitcher.tsx");
  assert.match(component, /useAccessibleDialog\(onClose\)/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /role="combobox"/);
  assert.match(component, /aria-controls="lios-quick-switcher-options"/);
  assert.match(component, /aria-activedescendant=/);
  assert.match(component, /role="listbox"/);
  assert.match(component, /role="option" aria-selected=/);
  assert.match(component, /onFocus=\{\(\) => setSelected\(index\)\}/);
  assert.match(component, /aria-live="polite"/);
  for (const run of ["onActivateTab", "onOpenView", "onOpenRecent"]) {
    assert.ok(component.includes(run), "Missing existing destination handler: " + run);
  }
});

test("keyboard map is searchable and legible at narrow widths", () => {
  const component = source("./ShortcutOverlay.tsx");
  assert.match(component, /useAccessibleDialog\(onClose\)/);
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /aria-label="Search keyboard shortcuts"/);
  assert.match(component, /role="search"/);
  assert.match(component, /grid-cols-1/);
  assert.match(component, /sm:grid-cols-/);
  assert.match(component, /aria-live="polite"/);
});
