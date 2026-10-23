import assert from "node:assert/strict";
import test from "node:test";
import { activeObjectPromptForChatMode, selectionActionsForChatMode } from "./chatSelectionActions";
test("general selection actions do not silently create Project finance or monitoring instructions", () => {
  for (const mode of ["quick", "temporary"] as const) {
    const actions = selectionActionsForChatMode(mode);
    assert.equal(actions.some(action => action.id === "model" || action.id === "alert"), false);
    for (const action of actions) {
      assert.ok(action.prompt("owned text").includes("owned text"));
      assert.doesNotMatch(action.prompt("owned text"), /current Project|financial implications/);
    }
    assert.doesNotMatch(activeObjectPromptForChatMode(mode, "owned text", undefined, "research"), /Project/);
  }
  assert.ok(selectionActionsForChatMode("project").some(action => action.id === "model"));
  assert.match(activeObjectPromptForChatMode("project", "owned text", undefined, "research"), /Project/);
});
