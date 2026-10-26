import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const paletteCss = read("../lios-product-palettes.css");
const polishCss = read("../lios-product-experience.css");
const typeCss = read("../lios-product-typography.css");
const styles = read("../terminalStyles.ts");
const experience = read("../components/terminal/ProjectExperienceShell.tsx");
const sidecar = read("../components/terminal/ConversationArtifactSidecar.tsx");
const navigation = read("../components/terminal/AuthenticatedNavigation.tsx");

const themes = ["chatgpt-dark", "chatgpt-light", "claude-light", "claude-dark"] as const;

function hexLuminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

function contrastRatio(a: string, b: string): number {
  const l1 = hexLuminance(a);
  const l2 = hexLuminance(b);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}

function color(css: string, theme: string, token: string): string {
  const start = css.indexOf(`html[data-lios-palette="${theme}"] {`);
  assert.ok(start >= 0, `missing palette: ${theme}`);
  const end = css.indexOf("}", start);
  const block = css.slice(start, end);
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(match, `${theme} missing ${token}`);
  return match[1];
}

test("reference themes have AA readable text, actions and links on their main surfaces", () => {
  for (const name of themes) {
    const base = color(paletteCss, name, "--lios-bg-app");
    for (const token of ["--lios-text-primary", "--lios-text-secondary"]) {
      const actual = color(paletteCss, name, token);
      assert.ok(contrastRatio(actual, base) >= 4.5, `${name} ${token} fails 4.5:1 on app`);
    }
    for (const token of ["--lios-theme-accent-text", "--lios-theme-link"]) {
      const foreground = color(polishCss, name, token);
      assert.ok(contrastRatio(foreground, base) >= 4.5, `${name} ${token} fails AA normal text on app`);
    }
    const actionBackground = color(polishCss, name, "--lios-theme-action");
    const actionForeground = color(polishCss, name, "--lios-theme-action-foreground");
    assert.ok(contrastRatio(actionForeground, actionBackground) >= 4.5, `${name} action label fails AA contrast`);
  }
});

test("Claude light accessible accent differs from decorative terracotta", () => {
  const accent = color(polishCss, "claude-light", "--lios-theme-accent-text");
  assert.notEqual(accent.toLowerCase(), "#d97757");
  assert.ok(contrastRatio(accent, color(paletteCss, "claude-light", "--lios-bg-panel")) >= 4.5);
});

test("chat skin is a final imported layer while canonical structural shell remains untouched", () => {
  const shellImport = styles.indexOf('import "./terminal-shell.css";');
  const canvasImport = styles.indexOf('import "./visual-intelligence-canvas.css";');
  const fontImport = styles.indexOf('import "./lios-product-typography.css";');
  const polishImport = styles.indexOf('import "./lios-product-experience.css";');
  assert.ok(shellImport >= 0 && shellImport < canvasImport && canvasImport < fontImport && fontImport < polishImport);
  assert.doesNotMatch(polishCss, /@import|@font-face|url\\(https?:/i);
  assert.doesNotMatch(typeCss, /@font-face|url\\(https?:/i);
  for (const name of themes) {
    assert.match(polishCss, new RegExp(`data-lios-palette="${name}"`));
  }
  assert.match(polishCss, /:not\\(\\[data-lios-palette="lios-classic"\\]\\)/);
});

test("chat, composer, markdown, palette swatches and mounted artifact retain canonical ownership", () => {
  assert.match(experience, /data-lios-message=\\{message\\.role\\}/);
  assert.match(experience, /aria-label=\\{message\\.role === "assistant"/);
  assert.match(experience, /className="lios-chat-suggestion-menu/);
  assert.match(experience, /id="lios-chat-empty-title"[^\\n]*text-foreground/);
  assert.doesNotMatch(experience, /id="lios-chat-empty-title"[^\\n]*text-white/);
  assert.match(sidecar, /lios-artifact-sidecar/);
  assert.match(sidecar, /bg-background/);
  assert.match(navigation, /data-lios-preview=\\{id\\}/);
  for (const name of ["chatgpt-dark", "chatgpt-light", "claude-light", "claude-dark", "lios-classic"]) {
    assert.match(polishCss, new RegExp(`data-lios-preview="${name}"`));
  }
  assert.match(polishCss, /prefers-reduced-motion: reduce/);
  assert.match(polishCss, /\\[data-chat-table-block\\]/);
  assert.match(polishCss, /\\[data-chat-code-block\\]/);
});

test("theme regression contract never re-creates AI routing, source catalogs or artifact stores", () => {
  assert.doesNotMatch(polishCss, /fetch\\(|localStorage|@keyframes|:root\\s*\\{/);
  assert.doesNotMatch(typeCss, /@font-face|url\\(https?:/i);
});
