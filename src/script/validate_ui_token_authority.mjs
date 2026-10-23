import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../client/src/", import.meta.url));

// WS-06 contract: one imported graphite/gold shell and unchanged market
// directions. This script checks source consistency, not browser rendering.
export const approvedSurfaces = Object.freeze({
  "--lios-bg-app": "#09090b",
  "--lios-bg-shell": "#07070a",
  "--lios-bg-panel": "#111115",
  "--lios-bg-panel-2": "#0d0d10",
  "--lios-bg-elevated": "#16161c",
  "--lios-bg-selected": "#1a1507",
  "--lios-border-default": "#1f1f28",
  "--lios-border-strong": "#2e2e3a",
  "--lios-text-primary": "#ede9e0",
  "--lios-text-secondary": "#b5b0ba",
  "--lios-text-muted": "#a09ca6",
  "--lios-brand": "#d4a017",
  "--lios-brand-hover": "#e6b829",
  "--lios-market-up": "#2d9cdb",
  "--lios-market-down": "#d4511a",
  "--lios-success": "#1fcb84",
  "--lios-analytical": "#8b5cf6",
});

export function getRootTokens(css) {
  const beginning = css.indexOf(":root,");
  if (beginning < 0) return {};
  const open = css.indexOf("{", beginning);
  const close = css.indexOf("}", open);
  if (open < 0 || close < 0) return {};
  const block = css.slice(open + 1, close);
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)]
      .map((match) => [match[1], match[2].trim().toLowerCase()]),
  );
}

function rgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return null;
  return [1, 3, 5].map((pos) => parseInt(hex.slice(pos, pos + 2), 16));
}

function hslRgb(value) {
  const match = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value || "");
  if (!match) return null;
  const [, hue, saturation, lightness] = match.map(Number);
  if (![hue, saturation, lightness].every(Number.isFinite) ||
      saturation < 0 || saturation > 100 || lightness < 0 || lightness > 100) return null;
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  });
}

function sameColor(hex, hsl) {
  const a = rgb(hex);
  const b = hslRgb(hsl);
  return Boolean(a && b && a.every((channel, i) => Math.abs(channel - b[i]) <= 1));
}

function luminance(hex) {
  const channels = rgb(hex);
  if (!channels) return NaN;
  const [r, g, b] = channels.map((component) => {
    const c = component / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function findTokenAuthorityProblems({ entry, shell, legacyFilePresent = false }) {
  const problems = [];
  const imports = [...entry.matchAll(/import\s+["']\.\/([^"']+\.css)["'];?/g)].map((m) => m[1]);
  if (imports[0] !== "index.css") problems.push("Design system must start with index.css");
  if (imports.at(-2) !== "terminal-shell.css" || imports.at(-1) !== "visual-intelligence-canvas.css") {
    problems.push("Canonical terminal-shell.css must be the last palette layer, before Visual Canvas only");
  }
  if (imports.filter((name) => name === "terminal-shell.css").length !== 1) {
    problems.push("Exactly one canonical terminal-shell import required");
  }
  if (new Set(imports).size !== imports.length) problems.push("Duplicate CSS import");
  if (imports.includes("terminal-theme-lock.css") || legacyFilePresent) {
    problems.push("Retired conflicting terminal-theme-lock.css must not remain as a second palette");
  }
  const tokens = getRootTokens(shell);
  for (const [key, expected] of Object.entries(approvedSurfaces)) {
    if (tokens[key] !== expected) problems.push(key + " changed from approved graphite/gold/semantic token");
  }
  // The Tailwind/legacy HSL bridge must resolve to precisely the same colors
  // as the canonical full CSS color. Keep finance up/down colors distinct from
  // generic success/error and preserve the licensed data's sign semantics.
  for (const [hex, hsl] of [
    ["--lios-brand", "--primary"],
    ["--lios-brand", "--sidebar-primary"],
    ["--lios-market-up", "--up"],
    ["--lios-market-up", "--up-fg"],
    ["--lios-market-down", "--down"],
    ["--lios-market-down", "--down-fg"],
    ["--lios-success", "--lios-emerald"],
  ]) {
    if (!sameColor(tokens[hex], tokens[hsl])) problems.push(hex + " / " + hsl + " semantic color mismatch");
  }
  for (const [fg, bg] of [
    ["--lios-text-primary", "--lios-bg-app"],
    ["--lios-text-secondary", "--lios-bg-panel"],
    ["--lios-text-muted", "--lios-bg-shell"],
    ["--lios-brand", "--lios-bg-app"],
  ]) {
    if (!(contrastRatio(tokens[fg], tokens[bg]) >= 4.5)) {
      problems.push(fg + " lacks 4.5:1 contrast on " + bg);
    }
  }
  if (!/\.terminal-root\s*\{[\s\S]*?background:\s*var\(--lios-bg-app\)/.test(shell)) {
    problems.push("Terminal surface must inherit canonical app background");
  }
  return problems;
}

export function validateTokenAuthority() {
  const entry = fs.readFileSync(path.join(root, "terminalStyles.ts"), "utf8");
  const shell = fs.readFileSync(path.join(root, "terminal-shell.css"), "utf8");
  const problems = findTokenAuthorityProblems({
    entry, shell, legacyFilePresent: fs.existsSync(path.join(root, "terminal-theme-lock.css")),
  });
  if (problems.length) throw new Error("WS-06 token authority:\n" + problems.map((item) => "- " + item).join("\n"));
  return { status: "source-contract-pass", canonical: "terminal-shell.css", independentNativeVisualProof: "NOT_RUN" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(validateTokenAuthority(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
