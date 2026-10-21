import test from "node:test";
import assert from "node:assert/strict";
import { captureChatWorkbenchOrigin, returnToChatWorkbenchOrigin } from "./chatWorkbenchHandoff";

test("Quick Chat can enter the entire Workbench without inventing a Project or Artifact", () => {
  const origin = captureChatWorkbenchOrigin("quick", 17, 42);
  assert.deepEqual(origin, { mode: "quick", projectId: null, chatId: 42 });
  assert.deepEqual(returnToChatWorkbenchOrigin(origin, false), origin);
});

test("Project Chat and new Project preserve their exact navigation identity", () => {
  assert.deepEqual(captureChatWorkbenchOrigin("project", 17, 42), { mode: "project", projectId: 17, chatId: 42 });
  assert.deepEqual(captureChatWorkbenchOrigin("project", 17, null), { mode: "project", projectId: 17, chatId: null });
  assert.deepEqual(captureChatWorkbenchOrigin("project", null, 42), { mode: "project", projectId: null, chatId: null });
});

test("Temporary Chat never inherits the prior saved Project/Chat on entering Workbench", () => {
  assert.deepEqual(captureChatWorkbenchOrigin("temporary", 17, 42), { mode: "temporary", projectId: null, chatId: null });
});

test("Malformed IDs cannot become a saved navigation target", () => {
  for (const bad of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.equal(captureChatWorkbenchOrigin("quick", null, bad).chatId, null);
    assert.equal(captureChatWorkbenchOrigin("project", bad, 42).chatId, null);
  }
});

test("Unsaved edits block return, and return leaves the captured origin untouched", () => {
  const origin = captureChatWorkbenchOrigin("project", 7, 11);
  assert.equal(returnToChatWorkbenchOrigin(origin, true), null);
  assert.equal(returnToChatWorkbenchOrigin(null, false), null);
  const returned = returnToChatWorkbenchOrigin(origin, false)!;
  assert.notEqual(returned, origin);
  assert.deepEqual(returned, origin);
});
