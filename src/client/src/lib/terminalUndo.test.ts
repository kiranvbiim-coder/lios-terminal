import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalUndoState, pushTerminalUndo, redoTerminalAction, undoTerminalAction } from "./terminalUndo";

test("undo and redo restore reversible terminal state", () => {
  let state = createTerminalUndoState<number>(5);
  state = pushTerminalUndo(state, "Change layout", 1, 2);
  const undone = undoTerminalAction(state);
  assert.ok(undone);
  assert.equal(undone.value, 1);
  const redone = redoTerminalAction(undone.state);
  assert.ok(redone);
  assert.equal(redone.value, 2);
});

test("no-op actions do not pollute undo history", () => {
  const state = pushTerminalUndo(createTerminalUndoState<number>(), "No-op", 1, 1);
  assert.equal(state.past.length, 0);
});
