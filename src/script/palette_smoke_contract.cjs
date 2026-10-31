"use strict";

/**
 * Deterministic browser-owned visual fixtures, never installed-app evidence.
 * Matrix is intentionally bounded: four representative surfaces per palette
 * on desktop, and three Chat/Project surfaces on a narrow window.
 *
 * No credentials, network providers, runtime AI or screenshot writes here.
 */
const PALETTES = Object.freeze([
  "chatgpt-dark", "chatgpt-light", "studio-light", "claude-light", "claude-dark", "lios-classic",
]);
const DESKTOP_CASES = Object.freeze([
  "project-home", "conversation", "conversation-artifact", "workbench-real",
]);
const NARROW_CASES = Object.freeze([
  "project-home", "conversation", "conversation-artifact",
]);
const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  narrow: Object.freeze({ width: 390, height: 844 }),
});

function paletteSpecs() {
  return PALETTES.flatMap((palette) => [
    ...DESKTOP_CASES.map((smokeCase) => ({
      palette, smokeCase, viewport: "desktop", ...VIEWPORTS.desktop,
      name: palette + "--" + smokeCase + "--desktop",
    })),
    ...NARROW_CASES.map((smokeCase) => ({
      palette, smokeCase, viewport: "narrow", ...VIEWPORTS.narrow,
      name: palette + "--" + smokeCase + "--narrow",
    })),
  ]);
}

function luminance(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const linear = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

function validateFrame(spec, observed) {
  const failures = [], warnings = [];
  if (!PALETTES.includes(spec.palette)) failures.push("unknown expected palette");
  if (observed.palette !== spec.palette) failures.push("palette mismatch");
  const expectedMode = /-light$/.test(spec.palette) ? "light" : "dark";
  if (observed.theme !== expectedMode) failures.push("light/dark selector mismatch");
  if (observed.ready !== true) failures.push("fixture not ready");
  if (observed.surface !== spec.smokeCase) failures.push("wrong surface mounted");
  if (observed.width !== spec.width || observed.height !== spec.height) {
    failures.push("window size mismatch");
  }
  const primaryContrast = contrast(observed.primary, observed.background);
  const secondaryContrast = contrast(observed.secondary, observed.background);
  if (primaryContrast === null || primaryContrast < 4.5) failures.push("primary text contrast below 4.5:1");
  if (secondaryContrast === null || secondaryContrast < 4.5) failures.push("secondary text contrast below 4.5:1");
  if (spec.palette !== "lios-classic" && observed.surfaceBackgroundHex !== observed.background?.toLowerCase()) {
    failures.push("visual root not painted with selected palette background");
  }
  if (observed.scrollWidth > spec.width + 1 || observed.scrollHeight > spec.height + 1) {
    warnings.push("root overflow; inspect screenshot and responsive layout");
  }
  if (spec.smokeCase === "workbench-real") {
    if (!observed.realDockMounted) failures.push("real Dockview fixture missing");
    if (observed.dockWidth < 900) failures.push("Dockview too narrow on desktop fixture");
  }
  return {
    passed: failures.length === 0,
    failures,
    warnings,
    primaryContrast: primaryContrast === null ? null : Number(primaryContrast.toFixed(2)),
    secondaryContrast: secondaryContrast === null ? null : Number(secondaryContrast.toFixed(2)),
  };
}

module.exports = { PALETTES, DESKTOP_CASES, NARROW_CASES, VIEWPORTS, paletteSpecs, luminance, contrast, validateFrame };
