import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backdrop = fs.readFileSync(path.join(clientRoot, "components", "terminal", "SignatureEntryBackdrop.tsx"), "utf8");
const css = fs.readFileSync(path.join(clientRoot, "signature-entry.css"), "utf8");
const preview = fs.readFileSync(path.join(clientRoot, "pages", "PublicProductPreview.tsx"), "utf8");
const login = fs.readFileSync(path.join(clientRoot, "pages", "Login.tsx"), "utf8");
const globalCss = fs.readFileSync(path.join(clientRoot, "index.css"), "utf8");

test("signature entry is cinematic but restrained", () => {
  assert.match(backdrop, /const ROTATION_MS = 28_000/);
  assert.match(backdrop, /prefers-reduced-motion: reduce/);
  assert.match(backdrop, /document\.visibilityState !== "visible"/);
  assert.match(backdrop, /const image = new Image\(\)/);
  assert.match(backdrop, /nextScene\.path/);
  assert.equal((backdrop.match(/path: "\/visual-environments\//g) ?? []).length, 4);
  assert.match(css, /opacity 1800ms/);
  assert.match(css, /lios-signature-light-drift/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("reference entry follows the supplied graphite/gold design and stays inside auth boundaries", () => {
  assert.match(preview, /lios-reference-entry/);
  assert.match(login, /lios-reference-login/);
  assert.match(preview, /Financial\s*<br\s*\/>/);
  assert.match(preview, /Intelligence/);
  assert.match(preview, /LIMURIA INTELLIGENCE/);
  assert.doesNotMatch(preview, /fetch\(/);
});

test("typography separates thought from data", () => {
  assert.match(globalCss, /\.font-ui\s*\{[\s\S]*?'Inter'/);
  assert.match(globalCss, /\.font-display\s*\{[\s\S]*?'Barlow Condensed'/);
  assert.match(globalCss, /\.font-terminal\s*\{[\s\S]*?'JetBrains Mono'/);
  assert.match(preview, /font-display/);
});

