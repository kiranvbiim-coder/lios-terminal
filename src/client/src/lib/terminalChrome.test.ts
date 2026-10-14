import test from "node:test";
import assert from "node:assert/strict";

import { getMarketStatus, getWorkspaceShortcutAction, shouldIgnoreCommandShortcut } from "./terminalChrome";

test("getMarketStatus respects New York daylight saving time", () => {
  const status = getMarketStatus(new Date("2026-03-17T13:31:00Z"));
  assert.equal(status.label, "MKT OPEN");
  assert.equal(status.pulse, true);
});

test("workspace shortcuts map pane controls and ignore text inputs", () => {
  assert.equal(getWorkspaceShortcutAction({ altKey: true, key: "1", target: null }), "focus-primary");
  assert.equal(getWorkspaceShortcutAction({ altKey: true, key: "2", target: null }), "focus-secondary");
  assert.equal(getWorkspaceShortcutAction({ altKey: true, key: "Enter", target: null }), "toggle-maximize");
  assert.equal(getWorkspaceShortcutAction({ altKey: true, key: "Backspace", target: null }), "close-secondary");
  assert.equal(getWorkspaceShortcutAction({ altKey: true, key: "1", target: { tagName: "INPUT" } }), null);
  assert.equal(getWorkspaceShortcutAction({ altKey: false, key: "1", target: null }), null);
});

test("getMarketStatus reports weekend closures", () => {
  const status = getMarketStatus(new Date("2026-03-15T15:00:00Z"));
  assert.equal(status.label, "WEEKEND");
  assert.equal(status.pulse, false);
});

test("shouldIgnoreCommandShortcut skips editable targets", () => {
  assert.equal(shouldIgnoreCommandShortcut({ tagName: "INPUT", isContentEditable: false }), true);
  assert.equal(shouldIgnoreCommandShortcut({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(shouldIgnoreCommandShortcut({ tagName: "DIV", isContentEditable: false }), false);
});
