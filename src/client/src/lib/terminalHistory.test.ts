import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalNavigationHistory, goBackInTerminalHistory, goForwardInTerminalHistory, pushTerminalNavigation } from "./terminalHistory";
import type { WorkspaceState } from "./terminalTypes";

function workspace(view: WorkspaceState["primary"]["view"], symbol = "AAPL"): WorkspaceState {
  return { primary: { view, symbol }, secondary: null, focusedPane: "primary" };
}

test("history records analytical navigation and clears forward state", () => {
  const start = workspace("entity");
  const financials = workspace("financialstatements");
  const dcf = workspace("valuation");
  let history = createTerminalNavigationHistory();
  history = pushTerminalNavigation(history, start, financials);
  history = pushTerminalNavigation(history, financials, dcf);
  assert.equal(history.back.length, 2);
  assert.equal(history.forward.length, 0);
});

test("back and forward preserve the full workspace snapshot", () => {
  const start = workspace("entity");
  const dcf: WorkspaceState = {
    primary: { view: "valuation", symbol: "AAPL" },
    secondary: { view: "financialstatements", symbol: "AAPL" },
    focusedPane: "secondary",
  };
  let history = pushTerminalNavigation(createTerminalNavigationHistory(), start, dcf);
  const back = goBackInTerminalHistory(history, dcf);
  assert.ok(back);
  assert.deepEqual(back.workspace, start);
  const forward = goForwardInTerminalHistory(back.history, start);
  assert.ok(forward);
  assert.deepEqual(forward.workspace, dcf);
});
