import test from "node:test";
import assert from "node:assert/strict";
import { resolveSpatialPresentation, SPATIAL_STACKED_MAX_WIDTH } from "./spatialPresentationPolicy";

test("Phase 2 preserves movable map on sufficiently wide Studio panes only", () => {
  const map = resolveSpatialPresentation("map", 1160);
  assert.equal(map.stacked, false);
  assert.equal(map.canMoveNodes, true);
  assert.equal(map.canMoveCompanion, true);
  assert.equal(map.showDecorativeEdges, true);
  assert.match(map.layoutHint, /Drag pin handles/);
});

test("Phase 2 narrow and high-zoom panes read as a list, with no latent drag or SVG burden", () => {
  for (const width of [320, 560, SPATIAL_STACKED_MAX_WIDTH, null, Number.NaN, Infinity]) {
    for (const mode of ["map", "timeline", "list"] as const) {
      const p = resolveSpatialPresentation(mode, width);
      assert.equal(p.stacked, true);
      assert.equal(p.canMoveNodes, false);
      assert.equal(p.canMoveCompanion, false);
      assert.equal(p.showDecorativeEdges, false);
      assert.match(p.layoutHint, /Spatial dragging is disabled/);
    }
  }
});

test("Phase 2 list is reading-only even in giant panes, and timeline never moves pins", () => {
  const list = resolveSpatialPresentation("list", 1920);
  assert.equal(list.stacked, true);
  assert.equal(list.canMoveCompanion, false);
  const timeline = resolveSpatialPresentation("timeline", 1920);
  assert.equal(timeline.stacked, false);
  assert.equal(timeline.canMoveNodes, false);
  assert.equal(timeline.canMoveCompanion, true);
  assert.equal(timeline.showDecorativeEdges, true);
});
