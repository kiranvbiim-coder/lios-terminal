import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_SPATIAL_CANVAS_RETURN_STATE,
  INITIAL_SPATIAL_STUDIO_TAB,
  reconcileSpatialCanvasReturnState,
} from "./spatialStudioContinuity";

test("Phase 2 Studio starts calm and saves only session-local presentation identifiers", () => {
  assert.equal(INITIAL_SPATIAL_STUDIO_TAB, "flow");
  assert.deepEqual(INITIAL_SPATIAL_CANVAS_RETURN_STATE, {
    mode: "map", kindFilter: "all", trailGroup: "", inspectedId: null, selectedConnectionKey: null, expanded: false,
  });
  assert.equal(Object.isFrozen(INITIAL_SPATIAL_CANVAS_RETURN_STATE), true);
  assert.equal(Object.keys(INITIAL_SPATIAL_CANVAS_RETURN_STATE).some(
    key => /prompt|data|content|credential|owner|project|chat|file|artifact/i.test(key),
  ), false);
});

test("Phase 2 Studio return preserves real selected pin and explicit trail after Workbench open", () => {
  const pending = {
    mode: "timeline" as const,
    kindFilter: "evidence" as const,
    trailGroup: "Diligence",
    inspectedId: "pin-3",
    selectedConnectionKey: "conn:valid",
    expanded: true,
  };
  assert.deepEqual(reconcileSpatialCanvasReturnState(pending, ["pin-2", "pin-3"], ["Diligence"], ["conn:valid"]), pending);
});

test("Phase 2 Studio return never resurrects a deleted or filtered-out pin", () => {
  const previous = {
    mode: "list" as const,
    kindFilter: "note" as const,
    trailGroup: "Diligence",
    inspectedId: "pin-old",
    selectedConnectionKey: "stale-connection",
    expanded: false,
  };
  assert.deepEqual(reconcileSpatialCanvasReturnState(previous, ["pin-new"], ["Diligence"], []), {
    ...previous, inspectedId: null, selectedConnectionKey: null,
  });
  assert.deepEqual(reconcileSpatialCanvasReturnState(previous, [], [], []), {
    ...previous, inspectedId: null, selectedConnectionKey: null, trailGroup: "",
  });
});

test("Phase 2 return state does not mutate input or guess a different group", () => {
  const previous = {
    mode: "map" as const, kindFilter: "all" as const, trailGroup: "Original",
    inspectedId: "pin-1", selectedConnectionKey: "link", expanded: true,
  };
  assert.deepEqual(reconcileSpatialCanvasReturnState(previous, ["pin-1"], ["Other"], ["link"]), {
    ...previous, trailGroup: "",
  });
  assert.equal(previous.trailGroup, "Original");
});
