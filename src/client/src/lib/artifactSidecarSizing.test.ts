import assert from "node:assert/strict";
import test from "node:test";
import {
  ARTIFACT_KEYBOARD_STEP,
  artifactSidecarBounds,
  canExpandArtifactRevision,
  clampArtifactSidecarWidth,
  keyboardArtifactSidecarWidth,
  isCurrentArtifactLoad,
} from "./artifactSidecarSizing";

test("WS-36 sidecar never steals the minimum readable Chat space", () => {
  assert.deepEqual(artifactSidecarBounds(1200), { min: 320, max: 840 });
  assert.deepEqual(artifactSidecarBounds(900), { min: 320, max: 540 });
  assert.deepEqual(artifactSidecarBounds(800), { min: 320, max: 440 });
  assert.deepEqual(artifactSidecarBounds(680), { min: 320, max: 320 });
  assert.deepEqual(artifactSidecarBounds(500), { min: 140, max: 140 });
  assert.deepEqual(artifactSidecarBounds(0), { min: 0, max: 0 });
  assert.deepEqual(artifactSidecarBounds(Number.NaN), { min: 0, max: 0 });
  for (const width of [0, 250, 600, 900, 1280, 1800]) {
    const result = artifactSidecarBounds(width);
    assert.ok(result.min >= 0 && result.min <= result.max);
    assert.ok(result.max <= width * 0.8);
  }
});

test("WS-36 pointer and keyboard sizing clamps both ends under zoom and narrow windows", () => {
  assert.equal(clampArtifactSidecarWidth(3000, 1200), 840);
  assert.equal(clampArtifactSidecarWidth(-99, 1200), 320);
  assert.equal(clampArtifactSidecarWidth(Number.NaN, 1200), 320);
  assert.equal(clampArtifactSidecarWidth(521.8, 1200), 522);
  assert.equal(keyboardArtifactSidecarWidth("ArrowLeft", 500, 900), 540);
  assert.equal(keyboardArtifactSidecarWidth("ArrowRight", 500, 900), 460);
  assert.equal(keyboardArtifactSidecarWidth("ArrowLeft", 500, 900, true), 540);
  assert.equal(keyboardArtifactSidecarWidth("ArrowRight", 500, 900, true), 420);
  assert.equal(keyboardArtifactSidecarWidth("Home", 520, 1200), 320);
  assert.equal(keyboardArtifactSidecarWidth("End", 520, 1200), 840);
  assert.equal(keyboardArtifactSidecarWidth("Tab", 500, 900), null);
  assert.equal(ARTIFACT_KEYBOARD_STEP, 40);
});

test("WS-36 exact revision and unsaved draft must both authorize Expand", () => {
  const loaded = { artifactId: "artifact:11111111-1111-4111-8111-111111111111", requestedVersion: 3, version: 3 };
  assert.equal(canExpandArtifactRevision(loaded, loaded.artifactId, 3, false), true);
  assert.equal(canExpandArtifactRevision(loaded, loaded.artifactId, 3, true), false);
  assert.equal(canExpandArtifactRevision(loaded, loaded.artifactId, 4, false), false);
  assert.equal(canExpandArtifactRevision(loaded, "artifact:22222222-2222-4222-8222-222222222222", 3, false), false);
  assert.equal(canExpandArtifactRevision(null, loaded.artifactId, 3, false), false);
  assert.equal(canExpandArtifactRevision({ ...loaded, version: 0 }, loaded.artifactId, 3, false), false);
  assert.equal(canExpandArtifactRevision({ ...loaded, version: 5 }, loaded.artifactId, 3, false), false);
  assert.equal(canExpandArtifactRevision({ ...loaded, requestedVersion: null, version: 5 }, loaded.artifactId, null, false), true);
});


test("only the exact current P4 load can notify the Chat Workbench handoff", () => {
  const a = "artifact:11111111-1111-4111-8111-111111111111";
  const b = "artifact:22222222-2222-4222-8222-222222222222";
  assert.equal(isCurrentArtifactLoad(a, 3, 3, a, 3), true);
  assert.equal(isCurrentArtifactLoad(a, null, 7, a, null), true);
  assert.equal(isCurrentArtifactLoad(a, 3, 3, a, 4), false, "late revision A cannot overwrite requested B");
  assert.equal(isCurrentArtifactLoad(a, null, 7, a, 4), false, "latest must not overwrite an explicit revision");
  assert.equal(isCurrentArtifactLoad(a, 3, 3, a, null), false, "old pinned revision is not the current latest-mode load");
  assert.equal(isCurrentArtifactLoad(b, 3, 3, a, 3), false, "another Artifact cannot take the handoff");
  assert.equal(isCurrentArtifactLoad(a, 4, 3, a, 4), false, "a mismatched server revision is never accepted");
  assert.equal(isCurrentArtifactLoad(a, null, 0, a, null), false);
  assert.equal(isCurrentArtifactLoad(a, null, Number.NaN, a, null), false);
  assert.equal(isCurrentArtifactLoad(a, null, 1.5, a, null), false);
});

