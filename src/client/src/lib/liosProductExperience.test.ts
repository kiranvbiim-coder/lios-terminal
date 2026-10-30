import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const paletteCss = read("../lios-product-palettes.css");
const polishCss = read("../lios-product-experience.css");

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

test("Claude light accent remains readable on panel surfaces", () => {
  const accent = color(polishCss, "claude-light", "--lios-theme-accent-text");
  assert.ok(contrastRatio(accent, color(paletteCss, "claude-light", "--lios-bg-panel")) >= 4.5);
});



test("light palette status colors meet normal-text contrast on Chat and Project panels", () => {
  const statuses = [
    "--lios-theme-error-text",
    "--lios-theme-success-text",
    "--lios-theme-info-text",
    "--lios-theme-violet-text",
    "--lios-theme-fuchsia-text",
  ];
  for (const key of statuses) {
    const match = polishCss.match(new RegExp(key + ":\\s*(#[0-9a-fA-F]{6})"));
    assert.ok(match, "Missing accessible status token " + key);
    for (const theme of ["chatgpt-light", "claude-light"]) {
      for (const bg of ["--lios-bg-app", "--lios-bg-panel"]) {
        assert.ok(contrastRatio(match[1], color(paletteCss, theme, bg)) >= 4.5,
          key + " fails AA on " + theme + " " + bg);
      }
    }
  }
});
