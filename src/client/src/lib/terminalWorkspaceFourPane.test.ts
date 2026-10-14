import test from "node:test";
import assert from "node:assert/strict";
import {
  addWorkspacePane, closeWorkspacePane, createInitialWorkspace, focusPane, getWorkspacePaneCount,
  getWorkspacePanes, isWorkspaceState, navigateFocusedPane, PRESET_LAYOUTS,
} from "./terminalWorkspace";

test("workspace grows to four independently focusable panes", () => {
  let workspace = createInitialWorkspace();
  workspace = addWorkspacePane(workspace, { view: "financialstatements", symbol: "AAPL" });
  workspace = addWorkspacePane(workspace, { view: "valuation", symbol: "AAPL" });
  workspace = addWorkspacePane(workspace, { view: "peercomp", symbol: "AAPL" });
  assert.equal(getWorkspacePaneCount(workspace), 4);
  assert.deepEqual(getWorkspacePanes(workspace).map((item) => item.id), ["primary", "secondary", "tertiary", "quaternary"]);
  workspace = focusPane(workspace, "tertiary");
  workspace = navigateFocusedPane(workspace, "advancedrisk");
  assert.equal(workspace.tertiary?.view, "advancedrisk");
  assert.equal(workspace.primary.view, "market");
});

test("closing one professional pane leaves the remaining workspace intact", () => {
  let workspace = PRESET_LAYOUTS.VALUATION;
  workspace = closeWorkspacePane(workspace, "tertiary");
  assert.equal(getWorkspacePaneCount(workspace), 3);
  assert.equal(workspace.secondary?.view, "valuation");
  assert.equal(workspace.quaternary?.view, "advancedrisk");
});

test("four-pane professional presets survive workspace validation", () => {
  for (const name of ["VALUATION", "EQUITY RESEARCH", "PORTFOLIO PM", "MACRO", "POLICY", "SUPPLY CHAIN", "SUSTAINABILITY"]) {
    assert.equal(isWorkspaceState(PRESET_LAYOUTS[name]), true, `${name} must be persistable`);
  }
});
