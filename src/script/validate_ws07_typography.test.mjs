import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../client/src/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8");
const styles = read("terminalStyles.ts");
const shell = read("terminal-shell.css");
const ws07 = shell.split("/* WS-07: readable hierarchy")[1] ?? "";

function extractRule(source, needle) {
  const start = source.indexOf(needle);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(start, close + 1);
}

test("WS-07 typography runs in the original single canonical shell, after feature layers", () => {
  assert.ok(ws07.length > 1500, "The WS-07 scope-specific typography layer must be present");
  assert.ok(styles.includes('import "./terminal-shell.css";'));
  assert.ok(styles.indexOf('import "./terminal-shell.css";') > styles.indexOf('import "./index.css";'));
  assert.ok(styles.indexOf('import "./visual-intelligence-canvas.css";') > styles.indexOf('import "./terminal-shell.css";'));
  assert.match(read("index.css"), /@import "@fontsource\/inter\/400\.css";/);
  assert.match(read("index.css"), /@import "@fontsource\/jetbrains-mono\/400\.css";/);
});

test("WS-07 elevates interactive Chat microtype to 12px without a second general text rule", () => {
  assert.match(ws07, /--lios-ux-control-type:\s*\.75rem/);
  assert.match(ws07, /--lios-ux-caption-type:\s*\.6875rem/);
  assert.match(ws07, /:is\(button, a, label, input, textarea, select, \[role='button'\]\):is\(/,
    "The two :is pseudo-classes must target the same control, not an inner descendant");
  for (const cls of ["text-[5px]", "text-[6px]", "text-[7px]", "text-[8px]", "text-[9px]", "text-[10px]"]) {
    assert.ok(ws07.includes('[class~="' + cls + '"]'), "Missing interactive low-font " + cls);
  }
  assert.match(ws07, /font-size:\s*max\(var\(--lios-ux-control-type\)/);
  assert.doesNotMatch(ws07, /\.terminal-root\s+\*:is\(/, "Do not resize financial chart glyphs globally");
});

test("WS-07 preserves Chat/Artifact navigation readability outside utility-tagged buttons", () => {
  assert.match(ws07, /\.lios-reference-navigation-projects :is\(/);
  assert.match(ws07, /\.lios-reference-artifact-tabs button/);
  assert.match(ws07, /\.lios-reference-titlebar button/);
  assert.match(ws07, /font-size:\s*var\(--lios-ux-control-type\)\s*!important/);
});

test("WS-07 protects Dockview keyboard controls and visible label hierarchy", () => {
  const source = read("components/terminal/WorkspacePane.tsx");
  assert.ok(source.includes("workspace-pane-"));
  assert.match(source, /lios-pane-header/);
  const dockRule = extractRule(ws07, ".terminal-root .lios-dockview-workspace.dockview-theme-dark,");
  assert.match(dockRule, /--dv-tabs-and-actions-container-font-size:\s*12px/);
  assert.match(dockRule, /--dv-tab-font-size:\s*12px/);
  assert.match(ws07, /\[data-testid\^='workspace-pane-'\] > \.lios-pane-header \.lios-pane-title/);
  assert.match(ws07, /\.lios-pane-code, \.lios-symbol/);
  assert.match(ws07, /font-size:\s*var\(--lios-ux-caption-type\)\s*!important/);
});

test("WS-07 Connection Center is a separate DOM route: scope typography without rewriting its modal", () => {
  const source = read("pages/DataConnectionCenter.tsx");
  assert.ok(source.includes('data-testid="connect-data"'), "Existing Connections marker changed");
  assert.match(ws07, /body:has\(\[data-testid='connect-data'\]\) :is\(/);
  for (const cls of ["text-[7px]", "text-[8px]", "text-[9px]", "text-[10px]"]) {
    assert.ok(ws07.includes('[class~="' + cls + '"]'), "Connection Center microtype missed: " + cls);
  }
  const rule = extractRule(ws07, "body:has([data-testid='connect-data']) :is(");
  assert.match(rule, /font-size:\s*\.75rem\s*!important/);
  assert.match(rule, /line-height:\s*1\.4/);
  assert.ok(!ws07.includes("ModalShell {"), "PR #105 owns modal semantics and implementation");
});

test("WS-07 typography doesn't change brand/semantic market colors or use fixed pixel fonts for Chat", () => {
  assert.doesNotMatch(ws07, /(?:^|[;{}])\s*(?:color|background(?:-color)?|--up|--down|--lios-brand)\s*:/m);
  assert.doesNotMatch(ws07, /font-size:\s*(?:[6-9]|10)px\s*!important/);
  assert.match(shell, /--lios-market-up:\s*#2d9cdb/);
  assert.match(shell, /--lios-market-down:\s*#d4511a/);
  assert.match(read("components/terminal/project-conversation-shell.css"), /textarea\[aria-label="Ask LiOS"\][^\n]*font-size:15px/);
});

test("WS-07 is a source gate, not a false native zoom or screen-reader result", () => {
  const evidence = new URL("../../docs/ux/LIOS_WS07_TYPOGRAPHY_AND_HIERARCHY_2026-10-23.md", import.meta.url);
  const markdown = fs.readFileSync(fileURLToPath(evidence), "utf8");
  assert.match(markdown, /200% zoom\s*\|\s*\*\*NOT_RUN\*\*/);
  assert.match(markdown, /VoiceOver.*NOT_RUN/);
  assert.match(markdown, /#125/);
  assert.match(markdown, /#105/);
});
