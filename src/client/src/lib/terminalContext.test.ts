import assert from "node:assert/strict";
import test from "node:test";
import { projectTerminalContext, projectWorkspaceContext } from "./terminalContext";
import type { WorkspaceState } from "./terminalTypes";

test("terminal context projects symbol-aware views into entity context", () => {
  const context = projectTerminalContext({
    view: "valuation",
    symbol: " nvda ",
    timeContext: { enabled: false, asOfDate: null, mode: "latest" },
  });

  assert.equal(context.entity?.symbol, "NVDA");
  assert.equal(context.viewId, "valuation");
  assert.ok(context.workspaceId);
  assert.equal(context.time.mode, "latest");
  assert.equal(context.revision, 0);
});

test("terminal context does not leak placeholder tickers into non-symbol-aware views", () => {
  const context = projectTerminalContext({
    view: "macrodashboard",
    symbol: "AAPL",
    timeContext: { enabled: false, asOfDate: null, mode: "latest" },
  });

  assert.equal(context.entity, null);
  assert.equal(context.viewId, "macrodashboard");
});

test("terminal context preserves explicit portfolio scenario benchmark and point-in-time scopes", () => {
  const context = projectTerminalContext({
    view: "advancedrisk",
    symbol: "msft",
    portfolioId: "portfolio-42",
    scenarioId: "bear-case",
    benchmarkId: "spx",
    region: "US",
    timeContext: { enabled: true, asOfDate: "2026-09-01", mode: "as-known-on" },
  });

  assert.equal(context.entity?.symbol, "MSFT");
  assert.equal(context.portfolioId, "portfolio-42");
  assert.equal(context.scenarioId, "bear-case");
  assert.equal(context.benchmarkId, "spx");
  assert.equal(context.region, "US");
  assert.deepEqual(context.time, { mode: "as-known-on", asOfDate: "2026-09-01" });
});

test("focused pane defines shared workspace context without rewriting other panes", () => {
  const workspace: WorkspaceState = {
    primary: { view: "chart", symbol: "AAPL" },
    secondary: { view: "valuation", symbol: "MSFT" },
    tertiary: { view: "news", symbol: "NVDA" },
    focusedPane: "secondary",
  };
  const focused = projectWorkspaceContext(
    workspace,
    { enabled: false, asOfDate: null, mode: "latest" },
  );
  assert.equal(focused.viewId, "valuation");
  assert.equal(focused.entity?.symbol, "MSFT");

  const primary = projectWorkspaceContext(
    { ...workspace, focusedPane: "primary" },
    { enabled: false, asOfDate: null, mode: "latest" },
    focused,
  );
  assert.equal(primary.viewId, "chart");
  assert.equal(primary.entity?.symbol, "AAPL");
  assert.equal(primary.revision, focused.revision + 1);
  assert.deepEqual(workspace.tertiary, { view: "news", symbol: "NVDA" });
});

test("terminal projection revision advances only when projected context changes", () => {
  const first = projectTerminalContext({
    view: "valuation",
    symbol: "AAPL",
    timeContext: { enabled: false, asOfDate: null, mode: "latest" },
  });
  const duplicate = projectTerminalContext({
    view: "valuation",
    symbol: " aapl ",
    timeContext: { enabled: false, asOfDate: null, mode: "latest" },
  }, first);
  assert.equal(duplicate.revision, first.revision);

  const next = projectTerminalContext({
    view: "valuation",
    symbol: "MSFT",
    timeContext: { enabled: false, asOfDate: null, mode: "latest" },
  }, duplicate);
  assert.equal(next.revision, first.revision + 1);
});
