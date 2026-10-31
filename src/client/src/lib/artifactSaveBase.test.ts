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

test("saves for one Artifact run in order, and a failure does not block the next", async () => {
  const { runSerializedSave } = await import("./artifactSaveBase");
  const order: string[] = [];
  const first = runSerializedSave("artifact:serial", async () => { await new Promise((resolve) => setTimeout(resolve, 20)); order.push("first"); return 1; });
  const failing = runSerializedSave("artifact:serial", async () => { order.push("second"); throw new Error("boom"); });
  const third = runSerializedSave("artifact:serial", async () => { order.push("third"); return 3; });
  assert.equal(await first, 1);
  await assert.rejects(failing, /boom/);
  assert.equal(await third, 3);
  assert.deepEqual(order, ["first", "second", "third"]);
});

test("the newest own save wins and different Artifacts do not share state", async () => {
  const { latestOwnSave, recordOwnSave } = await import("./artifactSaveBase");
  recordOwnSave("artifact:a", 2, "x");
  recordOwnSave("artifact:a", 1, "stale");
  assert.deepEqual(latestOwnSave("artifact:a"), { version: 2, contentKey: "x" });
  assert.equal(latestOwnSave("artifact:b"), null);
});
