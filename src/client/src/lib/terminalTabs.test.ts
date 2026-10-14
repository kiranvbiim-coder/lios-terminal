import assert from "node:assert/strict";
import test from "node:test";
import {
  activateTerminalTab,
  closeTerminalTab,
  createInitialTabsState,
  getTerminalTabLinkScopes,
  isTerminalTabsState,
  loadTerminalTabs,
  moveTerminalTab,
  openEntityTab,
  openTerminalTab,
  reopenTerminalTab,
  renameTerminalTab,
  setTerminalTabLinkGroup,
  setTerminalTabLinkScopes,
  syncLinkedTerminalTabsSymbol,
  toggleTerminalTabPin,
  updateActiveTerminalWorkspace,
  updateTerminalTab,
} from "./terminalTabs";

import type { ViewMode, WorkspaceState } from "./terminalTypes";

function withBrowserStorage<T>(entries: Record<string, string>, run: () => T): T {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map(Object.entries(entries));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { search: "" } } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    return run();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function workspace(view: ViewMode, symbol = "AAPL"): WorkspaceState {
  return { primary: { view, symbol }, secondary: null, focusedPane: "primary" };
}

test("terminal tabs preserve independent entity contexts", () => {
  const initial = createInitialTabsState();
  const aapl = openEntityTab(initial, "AAPL");
  const msft = openEntityTab(aapl, "MSFT");
  assert.equal(msft.tabs.length, 3);
  assert.equal(msft.tabs.find((tab) => tab.id === msft.activeTabId)?.entity, "MSFT");
  const revisited = openEntityTab(msft, "AAPL");
  assert.equal(revisited.tabs.length, 3);
  assert.equal(revisited.tabs.find((tab) => tab.id === revisited.activeTabId)?.entity, "AAPL");
});

test("temporary preview tabs are replaced while pinned tabs remain", () => {
  const initial = createInitialTabsState();
  const preview = openTerminalTab(initial, { title: "Preview", preview: true });
  const secondPreview = openTerminalTab(preview, { title: "Second Preview", preview: true });
  assert.equal(secondPreview.tabs.length, 2);
  assert.equal(secondPreview.tabs.some((tab) => tab.title === "Preview"), false);
  const pinned = toggleTerminalTabPin(secondPreview, secondPreview.activeTabId);
  const thirdPreview = openTerminalTab(pinned, { title: "Third Preview", preview: true });
  assert.equal(thirdPreview.tabs.length, 3);
  assert.equal(thirdPreview.tabs.some((tab) => tab.title === "Second Preview"), true);
});

test("closing and reopening a tab preserves its workspace", () => {
  const withEntity = openEntityTab(createInitialTabsState(), "NVDA");
  const closed = closeTerminalTab(withEntity, withEntity.activeTabId);
  assert.equal(closed.tabs.length, 1);
  assert.equal(closed.closedTabs[0].tab.entity, "NVDA");
  const reopened = reopenTerminalTab(closed);
  assert.equal(reopened.tabs.length, 2);
  assert.equal(reopened.tabs.find((tab) => tab.id === reopened.activeTabId)?.entity, "NVDA");
});

test("pinned tabs cannot be closed accidentally and titles can be renamed", () => {
  const initial = createInitialTabsState();
  const pinned = toggleTerminalTabPin(initial, initial.activeTabId);
  assert.equal(closeTerminalTab(pinned, pinned.activeTabId).tabs.length, 1);
  const renamed = renameTerminalTab(pinned, pinned.activeTabId, "Morning Monitor");
  assert.equal(renamed.tabs[0].title, "Morning Monitor");
});

test("tab state validation rejects missing active tabs", () => {
  const initial = createInitialTabsState();
  assert.equal(isTerminalTabsState(initial), true);
  assert.deepEqual(getTerminalTabLinkScopes(initial.tabs[0]), ["instrument"]);
  assert.equal(isTerminalTabsState({ ...initial, activeTabId: "missing" }), false);
  assert.equal(isTerminalTabsState({ tabs: [], activeTabId: "missing", closedTabs: [] }), false);
  assert.equal(activateTerminalTab(initial, "missing"), initial);
});

test("analytical entity tabs use human-readable contextual titles", () => {
  let state = createInitialTabsState();
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("financialstatements") });
  assert.equal(state.tabs.find((tab) => tab.id === state.activeTabId)?.title, "AAPL · Financials");

  state = updateActiveTerminalWorkspace(state, workspace("valuation"));
  assert.equal(state.tabs.find((tab) => tab.id === state.activeTabId)?.title, "AAPL · DCF");
});

test("custom tab names survive navigation within the analytical workspace", () => {
  let state = createInitialTabsState();
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("financialstatements") });
  const tabId = state.activeTabId;
  state = renameTerminalTab(state, tabId, "Apple Base Case");
  state = updateActiveTerminalWorkspace(state, workspace("valuation"));
  assert.equal(state.tabs.find((tab) => tab.id === tabId)?.title, "Apple Base Case");
});

test("legacy auto-generated titles migrate to human-readable titles on navigation", () => {
  let state = createInitialTabsState();
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("financialstatements") });
  const tabId = state.activeTabId;
  state = updateTerminalTab(state, tabId, { title: "AAPL · FINANCIALSTATEMENTS" });
  state = updateActiveTerminalWorkspace(state, workspace("valuation"));
  assert.equal(state.tabs.find((tab) => tab.id === tabId)?.title, "AAPL · DCF");
});

test("same entity can keep separate analytical tabs for different tools", () => {
  let state = createInitialTabsState();
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("financialstatements") });
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("valuation") });
  const countAfterTwoViews = state.tabs.length;
  assert.equal(countAfterTwoViews, 3);

  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("valuation") });
  assert.equal(state.tabs.length, countAfterTwoViews);
  assert.equal(state.tabs.find((tab) => tab.id === state.activeTabId)?.workspace.primary.view, "valuation");
});

test("tabs can be reordered without changing their active identity", () => {
  let state = createInitialTabsState();
  state = openEntityTab(state, "AAPL");
  const aaplId = state.activeTabId;
  state = openEntityTab(state, "MSFT");
  const msftId = state.activeTabId;
  state = moveTerminalTab(state, msftId, aaplId);
  assert.equal(state.tabs[1].id, msftId);
  assert.equal(state.activeTabId, msftId);
});

test("linked tabs synchronize instrument context while unlinked tabs stay independent", () => {
  let state = createInitialTabsState();
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("financialstatements") });
  const financialsId = state.activeTabId;
  state = setTerminalTabLinkGroup(state, financialsId, "A");

  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("valuation") });
  const valuationId = state.activeTabId;
  state = setTerminalTabLinkGroup(state, valuationId, "A");

  state = openTerminalTab(state, { kind: "entity", entity: "MSFT", workspace: workspace("peercomp", "MSFT") });
  const independentId = state.activeTabId;

  state = syncLinkedTerminalTabsSymbol(state, valuationId, "NVDA");
  const financials = state.tabs.find((tab) => tab.id === financialsId)!;
  const valuation = state.tabs.find((tab) => tab.id === valuationId)!;
  const independent = state.tabs.find((tab) => tab.id === independentId)!;
  assert.equal(financials.entity, "NVDA");
  assert.equal(financials.workspace.primary.symbol, "NVDA");
  assert.equal(financials.title, "NVDA · Financials");
  assert.equal(valuation.entity, "NVDA");
  assert.equal(valuation.title, "NVDA · DCF");
  assert.equal(independent.entity, "MSFT");
});

test("instrument broadcasts update only symbol-aware panes", () => {
  let state = createInitialTabsState();
  const mixed: WorkspaceState = {
    primary: { view: "valuation", symbol: "AAPL" },
    secondary: { view: "economics", symbol: "MACRO-CONTEXT" },
    focusedPane: "primary",
  };
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: mixed });
  const tabId = state.activeTabId;
  state = setTerminalTabLinkGroup(state, tabId, "C");
  state = syncLinkedTerminalTabsSymbol(state, tabId, "NVDA");
  const tab = state.tabs.find((candidate) => candidate.id === tabId)!;
  assert.equal(tab.workspace.primary.symbol, "NVDA");
  assert.equal(tab.workspace.secondary?.symbol, "MACRO-CONTEXT");
});

test("linked tabs can opt out of instrument broadcasts with explicit scopes", () => {
  let state = createInitialTabsState();
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("financialstatements") });
  const fixedId = state.activeTabId;
  state = setTerminalTabLinkGroup(state, fixedId, "D");
  state = setTerminalTabLinkScopes(state, fixedId, ["time"]);

  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("valuation") });
  const sourceId = state.activeTabId;
  state = setTerminalTabLinkGroup(state, sourceId, "D");
  state = syncLinkedTerminalTabsSymbol(state, sourceId, "MSFT");

  const fixed = state.tabs.find((tab) => tab.id === fixedId)!;
  assert.equal(fixed.entity, "AAPL");
  assert.equal(fixed.workspace.primary.symbol, "AAPL");
});

test("linked symbol sync preserves a custom tab title", () => {
  let state = createInitialTabsState();
  state = openTerminalTab(state, { kind: "entity", entity: "AAPL", workspace: workspace("valuation") });
  const tabId = state.activeTabId;
  state = setTerminalTabLinkGroup(state, tabId, "B");
  state = renameTerminalTab(state, tabId, "Base Case Valuation");
  state = syncLinkedTerminalTabsSymbol(state, tabId, "MSFT");
  assert.equal(state.tabs.find((tab) => tab.id === tabId)?.title, "Base Case Valuation");
  assert.equal(state.tabs.find((tab) => tab.id === tabId)?.workspace.primary.symbol, "MSFT");
});

test("persisted open and closed tabs are sanitized for the active audience", () => {
  const initial = createInitialTabsState();
  const seed = initial.tabs[0];
  const persisted = {
    tabs: [{
      ...seed,
      workspace: workspace("clientdata"),
    }],
    activeTabId: seed.id,
    closedTabs: [{
      tab: {
        ...seed,
        id: "closed-tab",
        workspace: workspace("workspaces"),
      },
      closedAt: 1,
    }],
  };

  withBrowserStorage({ "limuria-terminal-tabs-v1": JSON.stringify(persisted) }, () => {
    const restored = loadTerminalTabs("trial");
    assert.equal(restored.tabs[0].workspace.primary.view, "market");
    assert.equal(restored.closedTabs[0].tab.workspace.primary.view, "market");
    assert.deepEqual(restored.tabs[0].linkScopes, ["instrument"]);
  });
});
