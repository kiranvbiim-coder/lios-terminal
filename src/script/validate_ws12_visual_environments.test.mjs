import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const client = new URL("../client/src/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, client), "utf8");
const assets = fileURLToPath(new URL("../client/public/visual-environments/", import.meta.url));
const registry = read("lib/visualEnvironment.ts");
const canvas = read("components/terminal/VisualCanvas.tsx");
const css = read("visual-intelligence-canvas.css");
const policy = read("lib/visualCanvasPolicy.ts");
const prefs = read("lib/terminalUxPreferences.ts");
const settings = read("components/terminal/TerminalUxSettings.tsx");
const entry = read("terminalStyles.ts");
const terminal = read("pages/Terminal.tsx");

test("WS-12 retains exactly 10 canonical local SVG families with dedicated light variants", () => {
  const primary = fs.readdirSync(assets).filter(name => name.endsWith(".svg")).sort();
  const lightweight = fs.readdirSync(path.join(assets, "low-resource")).filter(name => name.endsWith(".svg")).sort();
  assert.equal(primary.length, 10);
  assert.deepEqual(primary, lightweight);
  assert.match(registry, /export const VISUAL_ENVIRONMENT_IDS = \[/);
  for (const name of primary) {
    assert.ok(registry.includes('"/visual-environments/' + name + '"'), "Original asset absent from registry: " + name);
    assert.ok(registry.includes('"/visual-environments/low-resource/' + name + '"'), "Low-resource asset absent from registry: " + name);
    assert.ok(fs.statSync(path.join(assets, name)).size > 0);
    assert.ok(fs.statSync(path.join(assets, "low-resource", name)).size > 0);
  }
  assert.doesNotMatch(registry, /https?:\/\/[^"\n]+\.svg/);
});

test("WS-12 environments stay optional and do not create a second shell renderer", () => {
  assert.match(prefs, /visualEnvironmentsEnabled: false/);
  assert.match(settings, /label="Contextual visual environments"/);
  assert.match(settings, /label="Low-resource visual mode"/);
  assert.match(terminal, /<VisualCanvas/);
  assert.match(entry, /import "\.\/visual-intelligence-canvas\.css"/);
  assert.equal((entry.match(/visual-intelligence-canvas\.css/g) ?? []).length, 1);
  assert.match(canvas, /aria-hidden="true"/);
  assert.match(css, /pointer-events: none/);
});

test("WS-12 Focus, presentations, and dense workbench remain matte solid", () => {
  assert.match(canvas, /if \(focusMode \|\| presentationMode \|\| surface === "workbench"\) return "focus"/);
  assert.match(canvas, /const policy = resolveVisualCanvasPolicy/);
  assert.match(policy, /input\.enabled && input\.intensity !== "focus"/);
  assert.match(canvas, /if \(!policy\.renderScene\)/);
  assert.match(canvas, /lios-visual-canvas--solid/);
  assert.match(canvas, /data-render-policy="solid"/);
  assert.match(css, /\.lios-visual-canvas--solid/);
  assert.match(css, /\.lios-visual-canvas\[data-intensity="focus"\]/);
});

test("WS-12 GPU/CPU budget respects software renderer without overriding user visual choice", () => {
  assert.match(canvas, /const softwareRendered = isSoftwareRendered\(\)/);
  assert.match(canvas, /const motionEnabled = ambientMotionAllowed\(preferences, softwareRendered\)/);
  assert.match(policy, /input\.lowResourceMode \|\| input\.softwareRendered/);
  assert.match(policy, /preloadScene: renderScene && !useLowResourceAsset/);
  assert.match(canvas, /policy\.useLowResourceAsset \? environment\.lowResourceAssetPath : environment\.assetPath/);
  assert.match(canvas, /if \(!policy\.preloadScene \|\| typeof Image === "undefined"\) return/);
  assert.match(css, /data-render-policy="low-resource"/);
  assert.match(css, /backdrop-filter: none !important/);
});

test("WS-12 existing motion, intensity, and dense chart safeguards remain unchanged", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\[data-reduced-motion="true"\]/);
  assert.match(css, /\[data-intensity="immersive"\]/);
  assert.match(css, /\[data-intensity="contextual"\]/);
  assert.match(css, /\[data-intensity="focus"\]/);
  assert.match(css, /Structural rails remain intentionally matte/);
  assert.match(css, /dense Artifact\/model surfaces stay opaque/);
});

test("WS-12 saved pins still outrank inference and only presentation state persists", () => {
  assert.match(registry, /const pinned = getProjectVisualEnvironmentPin/);
  assert.match(registry, /if \(pinned\) return pinned/);
  assert.match(registry, /const PROJECT_PIN_STORAGE_KEY/);
  assert.match(registry, /const RUNTIME_STORAGE_KEY/);
  assert.match(registry, /volatileProjectPins/);
  assert.match(registry, /volatileRuntimeOverride/);
  assert.match(registry, /storeRuntimeState\(runtime\)/);
  assert.match(registry, /storeRuntimeState\(restored\)/);
  assert.match(registry, /storeRuntimeState\(null\)/);
  assert.doesNotMatch(registry, /apiRequest\(|useArtifact\(|providerCredential/);
});

test("WS-12 denied local storage cannot abort Project pin/context events", () => {
  assert.match(registry, /catch \{\s*volatileProjectPins\.set\(key, environmentId\)/);
  assert.match(registry, /catch \{\s*volatileRuntimeOverride = \{ state \}/);
  assert.match(registry, /const parsed: unknown = JSON\.parse/);
  assert.match(registry, /typeof parsed === "object" && !Array\.isArray\(parsed\)/);
  assert.match(registry, /window\.dispatchEvent\(new CustomEvent\(VISUAL_CONTEXT_EVENT/);
  assert.match(registry, /window\.dispatchEvent\(new CustomEvent\(VISUAL_ENVIRONMENT_CHANGED_EVENT/);
});

test("WS-12 native/visual acceptance remains explicitly NOT_RUN, not inferred from CSS", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS12_OPTIONAL_VISUAL_ENVIRONMENTS_2026-10-23.md", import.meta.url), "utf8");
  assert.match(doc, /200% zoom[\s\S]{0,90}NOT_RUN/);
  assert.match(doc, /native macOS\/Windows[\s\S]{0,90}NOT_RUN/);
  assert.match(doc, /#125/);
  assert.match(doc, /#131/);
  assert.match(doc, /#108/);
});
