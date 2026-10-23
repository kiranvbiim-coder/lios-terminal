import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const client = new URL("../client/src/", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, client), "utf8");
const index = read("index.css");
const shell = read("terminal-shell.css");
const projectCss = read("components/terminal/project-conversation-shell.css");
const dialog = read("components/terminal/ProjectLifecycleDialog.tsx");
const center = read("components/terminal/LifecycleCenter.tsx");
const menu = read("components/terminal/ObjectActionMenu.tsx");
const menuOptions = read("lib/objectLifecycleMenu.ts");

test("WS-11 existing terminal and Chat CSS already handled local reduced motion", () => {
  assert.match(shell, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shell, /\.terminal-root\[data-reduced-motion='true'\] \*/);
  assert.match(projectCss, /@media \(prefers-reduced-motion:reduce\)/);
});

test("WS-11 covers real body-level Radix dialog/menu portal motion outside terminal root", () => {
  const patch = index.split("WS-11: Radix portals")[1] ?? "";
  assert.ok(patch.length > 500);
  assert.match(patch, /@media \(prefers-reduced-motion: reduce\)/);
  for (const target of ['[role="dialog"]', '[role="menu"]', '[data-radix-popper-content-wrapper]', '[data-state="open"]', '[data-state="closed"]']) {
    assert.ok(patch.includes(target), "Portal not included: " + target);
  }
  assert.match(patch, /body :is\(/);
  assert.match(patch, /html:focus-within[\s\S]*?scroll-behavior: auto !important/);
});

test("WS-11 prefers reduced animation duration, not disabled interaction or accessibility semantics", () => {
  const patch = index.split("WS-11: Radix portals")[1] ?? "";
  assert.match(patch, /animation-duration: 0\.01ms !important/);
  assert.match(patch, /animation-iteration-count: 1 !important/);
  assert.match(patch, /transition-duration: 0\.01ms !important/);
  assert.doesNotMatch(patch, /pointer-events: none|display: none|visibility: hidden|aria-hidden/);
});

test("WS-11 lifecycle confirmation resolves once despite dismissal and submit overlap", () => {
  assert.match(dialog, /const settled = useRef<LifecycleRequest \| null>\(null\)/);
  assert.match(dialog, /if \(!request \|\| settled\.current === request\) return/);
  assert.match(dialog, /settled\.current = request/);
  assert.match(dialog, /request\.resolve\(value\)/);
  assert.match(dialog, /onOpenChange=\{\(open\) => \{ if \(!open\) done\(null\); \}\}/);
});

test("WS-11 restores focus on close promptly, not a stale later animation frame", () => {
  assert.match(dialog, /onCloseAutoFocus=\{\(event\) => \{ const target = focus\.current; if \(target\?\.isConnected\)/);
  assert.match(dialog, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(dialog, /requestAnimationFrame/);
  assert.match(dialog, /onOpenAutoFocus=/);
  assert.match(dialog, /cancel\.current\?\.focus\(\)/);
});

test("WS-11 lifecycle actions don't label a destructive or unnamed confirmation Save name", () => {
  assert.match(dialog, /request\?\.name !== undefined \? "Save name" : "Confirm"/);
  assert.match(dialog, /aria-required="true"/);
  assert.match(dialog, /min-h-10 rounded border border-border/);
  assert.match(dialog, /focus-visible:outline-2/);
});

test("WS-11 destructive recovery serializes actions before React state can rerender", () => {
  assert.match(center, /const actionInFlight = useRef\(false\)/);
  assert.match(center, /if \(actionInFlight\.current\) return/);
  assert.match(center, /actionInFlight\.current = true/);
  assert.match(center, /setApplying\(true\)/);
  assert.match(center, /finally\s*\{[\s\S]*?actionInFlight\.current = false/);
});

test("WS-11 native Cancel does not imply a successful mutation/refresh", () => {
  const canceled = center.match(/if \(!window\.confirm\(/g) ?? [];
  assert.equal(canceled.length, 4, "Project, project permanent, Chat and Artifact permanent need cancel guards");
  const negs = center.match(/return false;/g) ?? [];
  assert.ok(negs.length >= 4);
  assert.match(center, /const changed = await work\(\)/);
  assert.match(center, /if \(changed !== false\) onInvalidate\(\)/);
});

test("WS-11 pending feedback is truthful and existing menu actions become disabled", () => {
  assert.match(center, /aria-busy=\{applying\}/);
  assert.match(center, /applying && <p role="status" aria-live="polite"/);
  assert.match(center, /disabled=\{applying\} onClick=\{\(\) => setTab\(item\)\}/);
  assert.match(center, /disabled=\{applying\} onClick=\{onClose\}/);
  const disabled = center.match(/<ObjectActionMenu disabled=\{disabledActions\}/g) ?? [];
  assert.equal(disabled.length, 3);
  assert.match(menu, /const items = getLifecycleMenuItems\(\{ kind, status, pinned, scope \}, \{ hidden, disabled \}\)/);
  assert.match(menuOptions, /disabled\?: Partial<Record<LifecycleAction, string>>/);
});

test("WS-11 records exact-viewport/browser/native unverified evidence honestly", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS11_MOTION_FOCUS_FEEDBACK_2026-10-23.md", import.meta.url), "utf8");
  assert.match(doc, /200% zoom[\s\S]{0,100}NOT_RUN/);
  assert.match(doc, /VoiceOver[\s\S]{0,100}NOT_RUN/);
  assert.match(doc, /#114/);
  assert.match(doc, /#129/);
});
