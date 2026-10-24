import test from "node:test";
import assert from "node:assert/strict";
import { captureChatWorkbenchOrigin, returnToChatWorkbenchOrigin } from "./chatWorkbenchHandoff";

test("artifact-free Quick navigation cannot inherit a stale Project", () => {
  const origin = captureChatWorkbenchOrigin("quick", 17, 42);
  assert.deepEqual(origin, { mode: "quick", projectId: null, chatId: 42 });
  assert.deepEqual(returnToChatWorkbenchOrigin(origin, false), origin);
});
test("Project navigation preserves its own Chat but refuses a Chat under an invalid Project", () => {
  assert.deepEqual(captureChatWorkbenchOrigin("project", 17, 42), { mode: "project", projectId: 17, chatId: 42 });
  assert.deepEqual(captureChatWorkbenchOrigin("project", null, 42), { mode: "project", projectId: null, chatId: null });
});
test("Temporary navigation remains memory-only and never inherits saved identity", () => {
  assert.deepEqual(captureChatWorkbenchOrigin("temporary", 17, 42), { mode: "temporary", projectId: null, chatId: null });
});
test("malformed saved IDs cannot become return destinations", () => {
  for (const bad of [-1, 0, NaN, Infinity, 1.5]) {
    assert.equal(captureChatWorkbenchOrigin("quick", null, bad).chatId, null);
    assert.equal(captureChatWorkbenchOrigin("project", bad, 42).chatId, null);
  }
});
test("dirty Workbench state prevents return without mutating the captured origin", () => {
  const origin = captureChatWorkbenchOrigin("project", 7, 11);
  assert.equal(returnToChatWorkbenchOrigin(origin, true), null);
  assert.equal(returnToChatWorkbenchOrigin(null, false), null);
  assert.deepEqual(returnToChatWorkbenchOrigin(origin, false), origin);
});
