import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../client/src/", import.meta.url);
const get = (p) => fs.readFileSync(new URL(p, root), "utf8");
const conversationCss = get("components/terminal/project-conversation-shell.css");
const shellCss = get("terminal-shell.css");
const projectShell = get("components/terminal/ProjectExperienceShell.tsx");
const sidecar = get("components/terminal/ConversationArtifactSidecar.tsx");
const pane = get("components/terminal/WorkspacePane.tsx");
const mobileGrid = get("components/terminal/ProfessionalWorkspaceGrid.tsx");
const dock = get("components/terminal/DockviewWorkspaceGrid.tsx");

const has = (text, pattern, message) => assert.match(text, pattern, message);
const sliceFrom = (text, marker) => {
  const index = text.indexOf(marker);
  assert.ok(index >= 0, "Missing responsive rule: " + marker);
  return text.slice(index);
};

test("WS-08 uses remaining conversation width, not only browser mobile breakpoints", () => {
  has(conversationCss, /\.lios-project-chat-surface\s*\{\s*container-type:\s*inline-size;\s*container-name:\s*conversation/);
  has(projectShell, /className="lios-project-chat-surface flex h-full min-h-0 min-w-0"/);
  has(conversationCss, /@container conversation \(max-width: 899px\)/);
  has(conversationCss, /@container conversation \(max-width: 560px\)/);
  has(conversationCss, /@container conversation \(max-width: 420px\)/);
  has(conversationCss, /@container conversation \(min-width: 900px\)/);
});

test("WS-08 narrow screen keeps saved Artifact mounted but not occupying narrow Chat width", () => {
  const rule = sliceFrom(conversationCss, "@container conversation (max-width: 899px)");
  has(rule, /\.lios-artifact-sidecar\s*\{\s*display:\s*none\s*!important/);
  has(sidecar, /focus\s*\?\s*"flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto/);
  has(sidecar, /:\s*"lios-artifact-sidecar block min-h-0/);
  assert.equal((projectShell.match(/<ConversationArtifactSidecar/g) ?? []).length, 1,
    "Do not add duplicate Artifact runtimes");
  has(projectShell, /onClick=\{\(\) => setArtifactFocusMode\(true\)\}/);
  has(sidecar, /onClick=\{onExitFocus\}/);
  has(projectShell, /if \(artifactDraftDirtyRef\.current\)/);
});

test("WS-08 large containers retain useful adjustable Chat+Artifact space without fixed 348px", () => {
  const rule = sliceFrom(conversationCss, "@container conversation (min-width: 900px)");
  has(rule, /\.lios-artifact-sidecar\s*\{/);
  has(rule, /width:\s*clamp\(20rem,\s*36%,\s*28rem\)\s*!important/);
  has(rule, /max-width:\s*45%/);
  assert.ok(!rule.includes("width:348px"), "Do not add another rigid Artifact width");
});

test("WS-08 long Chat titles and header controls can wrap without being clipped", () => {
  const rule = sliceFrom(conversationCss, "@container conversation (max-width: 560px)");
  has(rule, /\.lios-conversation-header[\s\S]*?flex-wrap:\s*wrap\s*!important/);
  has(rule, /height:\s*auto\s*!important/);
  has(rule, /\.lios-conversation-header > div:first-child[\s\S]*?flex:\s*1 0 100%/);
  has(rule, /\.lios-conversation-header > button[\s\S]*?overflow-wrap:\s*anywhere/);
  has(projectShell, /Open artifact/);
  has(projectShell, /Move to Project/);
});

test("WS-08 Sources, Tools, Voice and Send do not lose access when composer narrows", () => {
  const rule = sliceFrom(conversationCss, "@container conversation (max-width: 420px)");
  has(rule, /\.lios-conversation-composer-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  has(rule, /row-gap:\s*6px/);
  has(rule, /\.lios-conversation-composer-actions > \.flex-1\s*\{[\s\S]*?min-width:\s*0/);
  for (const item of ['aria-label="Ask LiOS"', 'aria-label="Tools"', 'aria-label="Send"', "<ChatSourcesControl"]) {
    assert.ok(projectShell.includes(item), "Original composer action disappeared: " + item);
  }
  has(projectShell, /aria-label=\{voiceInputAvailable/);
});

test("WS-08 original Dockview responds to pane width, not a global terminal size", () => {
  const rule = sliceFrom(shellCss, "/* WS-08 — Workbench chrome");
  has(rule, /\[data-testid\^='workspace-pane-'\]\s*\{\s*container-type:\s*inline-size;\s*container-name:\s*lios-workspace-chrome/);
  has(rule, /@container lios-workspace-chrome \(max-width: 480px\)/);
  has(rule, /\.lios-pane-header\s*\{[\s\S]*?overflow-x:\s*auto\s*!important/);
  has(rule, /scroll-padding-inline:\s*8px/);
  has(pane, /className=\{cn\("lios-pane-header flex shrink-0 items-center overflow-hidden border-b"/);
  for (const label of ['aria-label="Close pane"', 'aria-label="Open analytical context actions"']) {
    assert.ok(pane.includes(label), "No narrow-layout eviction or hidden panel action: " + label);
  }
  has(pane, /aria-label=\{isMaximized \? "Restore pane" : "Maximize pane"\}/);
});

test("WS-08 mobile pane switcher keeps all panes and keyboard selection", () => {
  const rule = sliceFrom(shellCss, "/* The existing mobile/focused fallback");
  has(rule, /\.lios-mobile-pane-switcher\s*\{[\s\S]*?scroll-padding-inline:\s*8px/);
  has(rule, /\.lios-mobile-pane-switcher button:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--lios-brand\)/);
  has(mobileGrid, /data-workspace-layout="mobile-focus"/);
  has(mobileGrid, /panes\.map\(\(\{ id, pane \}\) =>/);
  has(mobileGrid, /aria-current=\{active \? "page" : undefined\}/);
  has(dock, /if \(rendererState\.current\.isMobile \|\| rendererState\.current\.maximizedPane\)/);
  has(dock, /saveDockviewLayoutState\(pendingLayout\.current\)/);
});

test("WS-08 is only a source contract; real screenshot/zoom/native proof stays NOT_RUN", () => {
  const document = fs.readFileSync(new URL("../../docs/ux/LIOS_WS08_RESPONSIVE_SHELL_DENSITY_2026-10-23.md", import.meta.url), "utf8");
  has(document, /320\s*\/\s*390\s*\/\s*768\s*\/\s*1280\s*\/\s*1440/);
  has(document, /200% zoom:[^\n]*NOT_RUN/);
  has(document, /VoiceOver\/Narrator:[^\n]*NOT_RUN/);
  has(document, /#126/);
  has(document, /#107/);
  assert.ok(!shellCss.includes("WS-08 remove-pane-on-resize"));
});
