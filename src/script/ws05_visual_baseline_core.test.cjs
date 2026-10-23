"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { captureCases, captureFilename, assessSample, summarize } = require("./ws05_visual_baseline_core.cjs");

function goodSample(overrides = {}) {
  return {
    smokeCase: "conversation-artifact", rootPresent: true, ready: true,
    expectedSurfacePresent: true, screenshotNonEmpty: true,
    rootWidth: 1440, rootScrollWidth: 1440,
    cssViewportWidth: 1440, documentScrollWidth: 1440,
    primaryContentWidth: 520,
    focusTest: { attempted: true, focusedLabel: "Show Work", inViewport: true },
    ...overrides,
  };
}

test("WS05 fixture matrix includes 320/390/768/1280/1440 and 200% zoom, without duplicate snapshots", () => {
  const cases = captureCases();
  assert.equal(cases.length, 19);
  assert.equal(new Set(cases.map(captureFilename)).size, cases.length);
  for (const width of [320, 390, 768, 1280, 1440]) {
    assert.ok(cases.some((c) => c.width === width && c.smokeCase === "conversation"));
  }
  assert.ok(cases.some((c) => c.zoom === 2 && c.width === 390));
  assert.ok(cases.some((c) => c.zoom === 2 && c.width === 1440));
  assert.ok(cases.some((c) => c.smokeCase === "workbench-real"));
  assert.ok(cases.some((c) => c.smokeCase === "workbench-real-narrow"));
});

test("WS05 assessment records genuinely rendered, keyboard-accessible fixture probe", () => {
  assert.deepEqual(assessSample(goodSample()), { status: "fixture-probes-pass", gaps: [] });
});

test("WS05 rejects clipped main content even if viewport overflow is hidden", () => {
  const result = assessSample(goodSample({
    cssViewportWidth: 390, rootWidth: 390, rootScrollWidth: 390,
    documentScrollWidth: 390, primaryContentWidth: 130,
  }));
  assert.equal(result.status, "gap-observed");
  assert.match(result.gaps.join(" "), /primary content/);
});

test("WS05 detects horizontally scrolled root, inaccessible keyboard action, missing render", () => {
  const result = assessSample(goodSample({
    rootScrollWidth: 1800, screenshotNonEmpty: false,
    focusTest: { attempted: true, focusedLabel: "", inViewport: false },
  }));
  assert.equal(result.status, "gap-observed");
  assert.ok(result.gaps.some((g) => g.includes("root horizontally overflows")));
  assert.ok(result.gaps.some((g) => g.includes("Show Work")));
  assert.ok(result.gaps.some((g) => g.includes("screenshotNonEmpty")));
});

test("WS05 manifest cannot confuse fixture probes with native/real journey acceptance", () => {
  const one = goodSample();
  one.assessment = assessSample(one);
  const result = summarize([one, { assessment: { status: "capture-error" } }]);
  assert.equal(result.attempted, 2);
  assert.equal(result.fixtureProbesPass, 1);
  assert.equal(result.captureErrors, 1);
  assert.equal(result.acceptanceBoundary.authenticatedChatArtifactWorkbenchJourney, "NOT_RUN");
  assert.equal(result.acceptanceBoundary.nativeMacAndWindowsInstall, "NOT_RUN");
});

test("WS05 detects a viewport silently clamped by Electron", () => {
  const sample = goodSample({ width: 320, zoom: 1, cssViewportWidth: 500 });
  const result = assessSample(sample);
  assert.equal(result.status, "gap-observed");
  assert.ok(result.gaps.some((g) => g.includes("requested viewport width")));
});
