import assert from "node:assert/strict";
import test from "node:test";
import { resolveSaveBase } from "./artifactSaveBase";

test("a second autosave builds on this pane's own newer revision while the cached head lags", () => {
  assert.deepEqual(resolveSaveBase({ viewedVersion: 1, headVersion: 1, ownLatestVersion: 2 }), { ok: true, baseVersion: 2 });
});

test("with no newer own save the viewed revision must be the current head", () => {
  assert.deepEqual(resolveSaveBase({ viewedVersion: 3, headVersion: 3, ownLatestVersion: null }), { ok: true, baseVersion: 3 });
  assert.deepEqual(resolveSaveBase({ viewedVersion: 1, headVersion: 3, ownLatestVersion: null }), { ok: false }, "a historical revision is never saved over the head");
  assert.deepEqual(resolveSaveBase({ viewedVersion: 2, headVersion: 3, ownLatestVersion: 2 }), { ok: false }, "an own save that is not newer than the view does not unlock a stale base");
});
