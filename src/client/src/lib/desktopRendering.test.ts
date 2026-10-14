import assert from "node:assert/strict";
import test from "node:test";
import { ambientMotionAllowed, isSoftwareRendered } from "./desktopRendering";

const on = { visualEnvironmentMotion: true, reducedMotion: false, lowResourceMode: false };

test("software-rendered desktop windows suppress ambient motion", () => {
  assert.equal(isSoftwareRendered({ renderMode: "software" }), true);
  assert.equal(isSoftwareRendered({ renderMode: "hardware" }), false);
  assert.equal(isSoftwareRendered(undefined), false);
  assert.equal(ambientMotionAllowed(on, true), false);
});

test("hardware rendering keeps ambient motion subject to the user's own preferences", () => {
  assert.equal(ambientMotionAllowed(on, false), true);
  assert.equal(ambientMotionAllowed({ ...on, visualEnvironmentMotion: false }, false), false);
  assert.equal(ambientMotionAllowed({ ...on, reducedMotion: true }, false), false);
  assert.equal(ambientMotionAllowed({ ...on, lowResourceMode: true }, false), false);
});
