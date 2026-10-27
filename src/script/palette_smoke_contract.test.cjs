"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { PALETTES, paletteSpecs, contrast, validateFrame } = require("./palette_smoke_contract.cjs");

test("palette smoke matrix contains 35 unique bounded source fixture views", () => {
  const specs = paletteSpecs();
  assert.equal(PALETTES.length, 5);
  assert.equal(specs.length, 35);
  assert.equal(new Set(specs.map((view) => view.name)).size, 35);
  for (const palette of PALETTES) {
    const views = specs.filter((item) => item.palette === palette);
    assert.equal(views.length, 7);
    assert.equal(views.filter((item) => item.viewport === "desktop").length, 4);
    assert.equal(views.filter((item) => item.viewport === "narrow").length, 3);
    assert.ok(views.every((item) => item.viewport === "desktop"
      ? item.width === 1440 && item.height === 900
      : item.width === 390 && item.height === 844));
    assert.ok(views.every((item) => item.viewport === "desktop" || item.smokeCase !== "workbench-real"));
  }
});

test("WCAG AA contrast math uses real six-digit colors and fails closed", () => {
  assert.equal(contrast("#ffffff", "#000000"), 21);
  assert.equal(contrast("#FFF", "#000000"), null);
  assert.equal(contrast("unknown", "#ffffff"), null);
  assert.ok(contrast("#A44527", "#FAF9F5") >= 4.5);
  assert.ok(contrast("#D97757", "#FAF9F5") < 4.5);
});

function sample(overrides = {}) {
  return {
    palette: "claude-light", theme: "light", ready: true,
    surface: "conversation", width: 1440, height: 900,
    scrollWidth: 1440, scrollHeight: 900,
    background: "#faf9f5", primary: "#141413", secondary: "#57554f",
    surfaceBackgroundHex: "#faf9f5",
    realDockMounted: false, dockWidth: null, ...overrides,
  };
}

test("same palette, correct live CSS, useful dimensions and AA text produce source-fixture success", () => {
  const spec = { palette: "claude-light", smokeCase: "conversation", width: 1440, height: 900 };
  const result = validateFrame(spec, sample());
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.primaryContrast >= 4.5);
});

test("source-fixture capture detects mismatched or visually broken themes", () => {
  const spec = { palette: "claude-light", smokeCase: "conversation", width: 1440, height: 900 };
  for (const overrides of [
    { palette: "chatgpt-dark" },
    { theme: "dark" },
    { ready: false },
    { surface: "project-home" },
    { width: 1280 },
    { primary: "#D97757" },
    { surfaceBackgroundHex: "#09090b" },
  ]) {
    const result = validateFrame(spec, sample(overrides));
    assert.equal(result.passed, false, JSON.stringify(overrides));
    assert.ok(result.failures.length > 0);
  }
});

test("responsive overflow is retained as an explicit finding rather than a fake source pass", () => {
  const spec = { palette: "claude-light", smokeCase: "conversation", width: 390, height: 844 };
  const result = validateFrame(spec, sample({ width: 390, height: 844, scrollWidth: 421, scrollHeight: 844 }));
  assert.equal(result.passed, true);
  assert.ok(result.warnings.some((warning) => /overflow/.test(warning)));
});

test("real Dockview is required only for desktop Workbench fixtures", () => {
  const spec = { palette: "claude-light", smokeCase: "workbench-real", width: 1440, height: 900 };
  assert.equal(validateFrame(spec, sample({ surface: "workbench-real" })).passed, false);
  assert.equal(validateFrame(spec, sample({
    surface: "workbench-real", realDockMounted: true, dockWidth: 1100,
  })).passed, true);
});

test("capture script reuses safe output guard and reports source-only qualification", () => {
  const file = fs.readFileSync(path.join(__dirname, "visual_smoke_palette_capture.cjs"), "utf8");
  assert.match(file, /prepareVisualSmokeOutput/);
  assert.match(file, /SOURCE_FIXTURE_ONLY__NATIVE_RELEASE_NOT_RUN/);
  assert.match(file, /sha256/);
  assert.match(file, /manifest\.json/);
  assert.match(file, /nodeIntegration: false/);
  assert.match(file, /contextIsolation: true/);
  assert.match(file, /localFixtureUrl/);
  assert.doesNotMatch(file, /rmSync|upload-artifact|secrets\.|OPENAI_API_KEY/);
});
