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
const navigation = fs.readFileSync(path.join(clientRoot, "components", "terminal", "AuthenticatedNavigation.tsx"), "utf8");
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
  assert.match(preview, /Universal\s*<br\s*\/>/);
  assert.match(preview, /SPECIALIST FINANCE DEPTH/);
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


test("public entry promises the approved universal Chat experience without mandatory Projects", () => {
  assert.match(preview, /Ask LiOS about any topic/);
  assert.match(preview, /CHAT \/ OPTIONAL PROJECTS/);
  assert.match(preview, /Regular Chats and Artifacts save; Projects are optional/);
  assert.match(preview, /Temporary Chat without persistence/);
  assert.match(preview, /original professional Workbench/);
  assert.match(preview, /SPECIALIST FINANCE WORKBENCH · ILLUSTRATIVE DEMO/);
  assert.ok(preview.indexOf("Universal") < preview.indexOf("<Ticker items={tickerItems} />"), "illustrative market ticker belongs after the universal entry");
  for (const inaccurate of [
    "Every analysis lives inside a Project",
    "Every claim cites its source",
    "Your keys, your cost",
    "Financial Intelligence Operating System",
  ]) assert.ok(!preview.includes(inaccurate), "outdated public promise: " + inaccurate);
});

test("public BYOAI language respects official entitlements and source restrictions", () => {
  assert.match(preview, /officially permitted account or CLI access/);
  assert.match(preview, /Nothing connected grants unlimited rights or free inference/);
  assert.match(preview, /Your access and permissions/);
  assert.match(preview, /const requireSignIn = \(\) =>/);
  assert.match(preview, /const requireRegistration = \(\) =>/);
});

test("general Chat shows the LiOS product identity instead of a forced Projects identity", () => {
  assert.match(navigation, /props\.section === "conversation" \? "LiOS"/);
  assert.doesNotMatch(navigation, /props\.section === "conversation" \? "PROJECTS"/);
});
