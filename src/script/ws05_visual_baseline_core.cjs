"use strict";

// WS-05 is a diagnostic fixture baseline, not an installed-app journey test.
// Keep this pure module usable from Node's built-in test runner (no Electron).
const VIEWPORTS = Object.freeze([
  Object.freeze({ width: 320, height: 760 }),
  Object.freeze({ width: 390, height: 844 }),
  Object.freeze({ width: 768, height: 900 }),
  Object.freeze({ width: 1280, height: 900 }),
  Object.freeze({ width: 1440, height: 900 }),
]);
const SURFACES = Object.freeze(["conversation", "conversation-artifact", "workspace-focus"]);
const FOCUS_LABEL = "Show Work";

function captureCases() {
  const samples = [];
  for (const smokeCase of SURFACES) {
    for (const viewport of VIEWPORTS) samples.push({ smokeCase, ...viewport, zoom: 1 });
  }
  samples.push({ smokeCase: "conversation-artifact", width: 390, height: 844, zoom: 2 });
  samples.push({ smokeCase: "conversation-artifact", width: 1440, height: 900, zoom: 2 });
  samples.push({ smokeCase: "workbench-real", width: 1440, height: 900, zoom: 1 });
  samples.push({ smokeCase: "workbench-real-narrow", width: 1000, height: 900, zoom: 1 });
  return samples;
}

function captureFilename({ smokeCase, width, height, zoom }) {
  if (!/^[a-z][a-z-]*$/.test(smokeCase)) throw new Error("Invalid fixture name");
  if (![width, height, zoom].every(Number.isFinite)) throw new Error("Invalid viewport dimensions");
  return smokeCase + "-" + width + "x" + height + "-" + Math.round(zoom * 100) + "pct.png";
}

function assessSample(sample) {
  const gaps = [];
  const required = ["rootPresent", "ready", "expectedSurfacePresent", "screenshotNonEmpty"];
  for (const field of required) {
    if (sample[field] !== true) gaps.push(field + ": missing or false");
  }
  if (!Number.isFinite(sample.cssViewportWidth) || sample.cssViewportWidth <= 0) gaps.push("viewport CSS width not measured");
  if (!Number.isFinite(sample.rootWidth) || sample.rootWidth <= 0) gaps.push("root has no rendered width");
  if (sample.rootScrollWidth > sample.rootWidth + 2) gaps.push("fixture root horizontally overflows");
  if (sample.documentScrollWidth > sample.cssViewportWidth + 2) gaps.push("document horizontally overflows");
  // Overflow:hidden may mask a too-small main surface; flag it anyway.
  if (sample.smokeCase !== "workbench-real" && sample.smokeCase !== "workbench-real-narrow") {
    if (!Number.isFinite(sample.primaryContentWidth) || sample.primaryContentWidth < 240) {
      gaps.push("primary content is narrower than 240 CSS px");
    }
  }
  if (sample.smokeCase === "conversation-artifact") {
    if (sample.focusTest?.attempted !== true) gaps.push("native Tab keyboard probe not attempted");
    else if (sample.focusTest?.focusedLabel !== FOCUS_LABEL || sample.focusTest?.inViewport !== true) {
      gaps.push("Show Work not reachable and visible with native Tab");
    }
  }
  return { status: gaps.length ? "gap-observed" : "fixture-probes-pass", gaps };
}

function summarize(samples) {
  return {
    attempted: samples.length,
    fixtureProbesPass: samples.filter((sample) => sample.assessment?.status === "fixture-probes-pass").length,
    gapObserved: samples.filter((sample) => sample.assessment?.status === "gap-observed").length,
    captureErrors: samples.filter((sample) => sample.assessment?.status === "capture-error").length,
    acceptanceBoundary: {
      deterministicFixtureScreenshots: "diagnostic-only",
      authenticatedChatArtifactWorkbenchJourney: "NOT_RUN",
      keyboardOnlyInstalledApp: "NOT_RUN",
      macOSVoiceOver: "NOT_RUN",
      windowsNarrator: "NOT_RUN",
      nativeMacAndWindowsInstall: "NOT_RUN",
      realProviderAndSourceRights: "NOT_RUN",
    },
  };
}

module.exports = { VIEWPORTS, SURFACES, FOCUS_LABEL, captureCases, captureFilename, assessSample, summarize };
