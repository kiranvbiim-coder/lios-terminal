import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const search = read("client/src/components/terminal/WorkSearchDialog.tsx");
const workflow = read("client/src/components/terminal/SaveWorkflowDialog.tsx");
const dialog = read("client/src/components/ui/dialog.tsx");
const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const acceptance = read("script/validate_desktop_accessibility.ts");

test("WS-58 search exposes combobox to listbox active-option contract", () => {
  assert.match(search, /role="combobox"/);
  assert.match(search, /aria-autocomplete="list"/);
  assert.match(search, /aria-controls="lios-work-search-results"/);
  assert.match(search, /aria-expanded=\{results\.length > 0\}/);
  assert.match(search, /aria-activedescendant=\{results\[selected\]/);
  assert.match(search, /id="lios-work-search-results" role="listbox"/);
  assert.match(search, /id=\{`lios-work-search-option-\$\{index\}`\}/);
  assert.match(search, /role="option"/);
  assert.match(search, /aria-selected=\{selected === index\}/);
  assert.match(search, /onFocus=\{\(\) => setSelected\(index\)\}/);
});

test("WS-58 keyboard navigation preserves actual result, stale-query and no-result boundaries", () => {
  assert.match(search, /event\.key === "ArrowDown"[\s\S]*Math\.min\(value \+ 1, Math\.max\(0, results\.length - 1\)\)/);
  assert.match(search, /event\.key === "ArrowUp"[\s\S]*Math\.max\(0, value - 1\)/);
  assert.match(search, /event\.key === "Enter" && results\[selected\]/);
  assert.match(search, /setQuery\(event\.target\.value\);\s*setResults\(\[\]\);\s*setSelected\(0\);/);
  assert.match(search, /controller\.abort\(\)/);
  assert.match(shell, /workSearchOpenerRef\.current = document\.activeElement/);
  assert.match(shell, /returnFocusTo=\{workSearchOpenerRef\.current\}/);
  assert.match(search, /onCloseAutoFocus=\{\(event\) => \{ if \(returnFocusTo\?\.isConnected\)/);
  assert.doesNotMatch(search, /returnFocus\.current = document\.activeElement/);
  assert.match(search, /onOpenAutoFocus=\{\(event\) => \{ event\.preventDefault\(\); inputRef\.current\?\.focus\(\); \}\}/);
});

test("WS-58 search announces result count and errors without silently reusing past matches", () => {
  assert.match(search, /role="status" aria-live="polite"/);
  assert.match(search, /aria-busy=\{loading\}/);
  assert.match(search, /role=\{error \? "alert" : undefined\}/);
  assert.match(search, /aria-describedby="lios-work-search-help"/);
  assert.match(search, /focus-visible:outline-2/);
});

test("WS-58 Save Workflow has modal keyboard focus, title, description and no premature dismissal", () => {
  assert.match(workflow, /<Dialog open onOpenChange=/);
  assert.match(workflow, /<DialogContent/);
  assert.match(workflow, /<DialogTitle/);
  assert.match(workflow, /<DialogDescription id="lios-save-workflow-description"/);
  assert.match(workflow, /aria-describedby="lios-save-workflow-description"/);
  assert.match(workflow, /nameRef\.current\?\.focus\(\)/);
  assert.match(workflow, /onEscapeKeyDown=\{\(event\) => \{ if \(saving\) event\.preventDefault\(\); \}\}/);
  assert.match(workflow, /onPointerDownOutside=\{\(event\) => \{ if \(saving\) event\.preventDefault\(\); \}\}/);
  assert.match(workflow, /aria-busy=\{saving\}/);
  assert.match(workflow, /role="alert"/);
  assert.match(workflow, /disabled=\{saving\} onClick=\{onClose\}/);
  assert.doesNotMatch(workflow, /onMouseDown=\{onClose\}/);
  assert.match(dialog, /DialogPrimitive\.Content/);
});

test("WS-58 never treats source checks as real native AT evidence", () => {
  assert.match(acceptance, /externalEvidenceStillRequired:/);
  assert.match(acceptance, /"macOS VoiceOver"/);
  assert.match(acceptance, /"Windows Narrator"/);
  assert.match(acceptance, /"keyboard-only packaged app walkthrough"/);
});
