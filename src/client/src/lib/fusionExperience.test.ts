import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSparklinePoints,
  formatCompactFinancialNumber,
  getFusionDensityProfile,
  resolveFusionPaneTier,
  toneForChange,
} from "./fusionExperience";

test("Fusion density profiles become progressively more spacious", () => {
  const terminal = getFusionDensityProfile("terminal");
  const compact = getFusionDensityProfile("compact");
  const standard = getFusionDensityProfile("standard");
  const comfortable = getFusionDensityProfile("comfortable");
  assert.ok(terminal.gap < compact.gap);
  assert.ok(compact.gap < standard.gap);
  assert.ok(standard.gap < comfortable.gap);
  assert.ok(terminal.rowHeight < comfortable.rowHeight);
});

test("Fusion pane tier preserves full detail when maximized and compresses dense grids", () => {
  assert.equal(resolveFusionPaneTier(4, "terminal"), "micro");
  assert.equal(resolveFusionPaneTier(3, "standard"), "compact");
  assert.equal(resolveFusionPaneTier(2, "comfortable"), "full");
  assert.equal(resolveFusionPaneTier(4, "terminal", true), "full");
});

test("sparkline points use finite values and fit the requested viewport", () => {
  const points = buildSparklinePoints([10, null, 30, 20], 100, 20, 2);
  assert.ok(points.length > 0);
  const pairs = points.split(" ");
  assert.equal(pairs.length, 3);
  for (const pair of pairs) {
    const [x, y] = pair.split(",").map(Number);
    assert.ok(x >= 2 && x <= 98);
    assert.ok(y >= 2 && y <= 18);
  }
});

test("compact financial formatting keeps magnitude and sign explicit", () => {
  assert.equal(formatCompactFinancialNumber(1_250_000_000, { currency: "$" }), "$1.3B");
  assert.equal(formatCompactFinancialNumber(-2_500_000, { currency: "₹" }), "-₹2.5M");
  assert.equal(formatCompactFinancialNumber(null), "—");
});

test("change tones remain deterministic", () => {
  assert.equal(toneForChange(1), "positive");
  assert.equal(toneForChange(-1), "negative");
  assert.equal(toneForChange(0), "neutral");
  assert.equal(toneForChange(null), "neutral");
});
