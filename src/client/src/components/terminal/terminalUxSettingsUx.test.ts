import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_TERMINAL_UX_PREFERENCES, patchTerminalUxPreferences } from "../../lib/terminalUxPreferences";

const source = readFileSync(new URL("./TerminalUxSettings.tsx", import.meta.url), "utf8");

/** Source contract coverage is not a substitute for rendered keyboard/AT validation. */
test("comfort settings use accessible labelled modal and preserve simple close semantics", () => {
  assert.match(source, /import \{ Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle \} from "@\/components\/ui\/dialog"/);
  assert.match(source, /<Dialog open onOpenChange=/);
  assert.match(source, /<DialogTitle/);
  assert.match(source, /<DialogDescription/);
  assert.match(source, /h-\[min\(90dvh,860px\)\]/);
  assert.match(source, /min-h-0 flex-1.*overflow-y-auto/);
  assert.match(source, /Changes are saved automatically/);
  assert.match(source, /onClick=\{onClose\}/);
  assert.doesNotMatch(source, /onMouseDown=\{onClose\}/);
});

test("every existing saved preference remains accessible in the new layout", () => {
  const flags = [
    "comfortMode", "adaptiveCalm", "ambientContext",
    "visualEnvironmentsEnabled", "visualEnvironmentMotion", "lowResourceMode", "showImmersiveDock",
    "focusMode", "presentationMode", "showTickerTape", "showMacroTickerTape",
    "showJourneyPrompts", "reducedMotion",
  ];
  for (const flag of flags) {
    assert.ok(source.includes("checked={preferences." + flag + "}"), flag + " checkbox must remain available");
    assert.ok(source.includes("update({ " + flag), flag + " must retain save callback");
  }
  for (const choice of ["experienceMode", "density", "textScale"]) {
    assert.ok(source.includes("aria-pressed={preferences." + choice + " === "), choice + " needs announced selection");
  }
  for (const capability of ["ThemeSwitcher", "saveTerminalUxPreferences(next)", "patchTerminalUxPreferences(preferences, patch)", "onChange(next)"]) {
    assert.ok(source.includes(capability), "lost existing preference contract: " + capability);
  }
});

test("preference controls remain keyboard accessible and readable by default", () => {
  assert.match(source, /<input type="checkbox" checked=\{checked\}/);
  assert.match(source, /focus-within:outline/);
  assert.match(source, /<label className=/);
  assert.match(source, /min-h-11/);
  assert.match(source, /font-ui text-sm/);
  assert.match(source, /role="group" aria-label="Text scale"/);
  assert.match(source, /role="group" aria-label="Layout density"/);
  assert.doesNotMatch(source, /text-\[(?:6|7|8|9)px\]/);
});

test("saved UX preference switches never silently change unrelated data or authority", () => {
  const prefs = { ...DEFAULT_TERMINAL_UX_PREFERENCES, density: "terminal" as const, showTickerTape: true, textScale: "large" as const };
  const guided = patchTerminalUxPreferences(prefs, { experienceMode: "guided", density: "standard" });
  assert.equal(guided.experienceMode, "guided");
  assert.equal(guided.density, "standard");
  assert.equal(guided.textScale, "large");
  assert.equal(guided.showTickerTape, true);
  const focus = patchTerminalUxPreferences(guided, { focusMode: true, presentationMode: false });
  assert.equal(focus.focusMode, true);
  assert.equal(focus.presentationMode, false);
  assert.equal(focus.showTickerTape, true);
});
