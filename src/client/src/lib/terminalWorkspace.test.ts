import test from "node:test";
import assert from "node:assert/strict";

import {
  PRESET_LAYOUTS,
  getPersonalFinanceWorkspace,
  buildWorkspaceShareUrl,
  closeSecondaryPane,
  createInitialWorkspace,
  deserializeWorkspace,
  getSavedLayouts,
  isWorkspaceState,
  loadActiveWorkspace,
  loadLayout,
  loadWorkspaceFromUrl,
  navigateFocusedPane,
  openSecurityView,
  openSymbolInWorkspace,
  openViewInNewPane,
  serializeWorkspace,
} from "./terminalWorkspace";

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

test("openSymbolInWorkspace preserves broad primary context by opening a quote in secondary", () => {
  const workspace = createInitialWorkspace();
  const next = openSymbolInWorkspace(workspace, "MSFT");

  assert.deepEqual(next, {
    primary: { view: "market", symbol: "AAPL" },
    secondary: { view: "quote", symbol: "MSFT" },
    focusedPane: "secondary",
  });
});

test("openSecurityView opens a split pane from broad views", () => {
  const workspace = createInitialWorkspace();
  const next = openSecurityView(workspace, "NVDA", "chart");
  assert.deepEqual(next.secondary, { view: "chart", symbol: "NVDA" });
  assert.equal(next.focusedPane, "secondary");
});

test("navigateFocusedPane updates the focused pane only", () => {
  const workspace = openSecurityView(createInitialWorkspace(), "AAPL", "chart");
  const next = navigateFocusedPane(workspace, "news");
  assert.deepEqual(next.primary, { view: "market", symbol: "AAPL" });
  assert.deepEqual(next.secondary, { view: "news", symbol: "AAPL" });
  assert.equal(next.focusedPane, "secondary");
});

test("company analysis keeps the active symbol across financials, valuation, peers and risk", () => {
  let workspace = openSecurityView(createInitialWorkspace(), "MSFT", "companyfundamentals");
  for (const view of ["financialstatements", "valuation", "peercomp", "advancedrisk"] as const) {
    workspace = navigateFocusedPane(workspace, view);
    const focused = workspace.focusedPane === "primary" ? workspace.primary : workspace.secondary;
    assert.equal(focused?.symbol, "MSFT", `${view} must retain the active company`);
    assert.equal(focused?.view, view);
  }
});

test("supporting Ask LiOS pane preserves the active analytical canvas", () => {
  const analysis = {
    primary: { view: "valuation" as const, symbol: "MSFT" },
    secondary: null,
    focusedPane: "primary" as const,
  };
  const next = openViewInNewPane(analysis, "agent", "MSFT");

  assert.deepEqual(next.primary, analysis.primary);
  assert.deepEqual(next.secondary, { view: "agent", symbol: "MSFT" });
  assert.equal(next.focusedPane, "secondary");
});

test("openSymbolInWorkspace replaces the current security pane when already focused on one", () => {
  const workspace = openSecurityView(createInitialWorkspace(), "AAPL", "chart");
  const next = openSymbolInWorkspace(workspace, "TSLA");
  assert.deepEqual(next.secondary, { view: "quote", symbol: "TSLA" });
  assert.equal(next.focusedPane, "secondary");
});

test("closeSecondaryPane collapses back to a single focused primary pane", () => {
  const workspace = openSecurityView(createInitialWorkspace(), "AAPL", "news");
  const next = closeSecondaryPane(workspace);
  assert.deepEqual(next, {
    primary: { view: "market", symbol: "AAPL" },
    secondary: null,
    focusedPane: "primary",
  });
});

test("openSecurityView preserves broad primary context when a secondary pane already exists", () => {
  const workspace = {
    primary: { view: "market", symbol: "AAPL" },
    secondary: { view: "quote", symbol: "AAPL" },
    focusedPane: "primary" as const,
  };
  const next = openSecurityView(workspace, "MSFT", "news");
  assert.deepEqual(next, {
    primary: { view: "market", symbol: "AAPL" },
    secondary: { view: "news", symbol: "MSFT" },
    focusedPane: "secondary",
  });
});

test("workspace sharing round-trips a split workspace and preserves the route hash", () => {
  const workspace = openSecurityView(createInitialWorkspace(), "MSFT", "chart");
  const encoded = serializeWorkspace(workspace);
  const url = buildWorkspaceShareUrl(workspace, "http://127.0.0.1:5055/#/");
  assert.deepEqual(deserializeWorkspace(encoded), workspace);
  assert.deepEqual(loadWorkspaceFromUrl(new URL(url).search), workspace);
  assert.equal(new URL(url).hash, "#/");
});

test("platform and phase workspaces survive persisted-layout validation", () => {
  for (const view of ["crossassetfabric", "quantlab", "enginereadiness", "connectors", "environment"] as const) {
    const workspace = {
      primary: { view, symbol: "AAPL" },
      secondary: null,
      focusedPane: "primary" as const,
    };
    assert.equal(isWorkspaceState(workspace), true, `${view} must be restorable after reload`);
    assert.deepEqual(deserializeWorkspace(serializeWorkspace(workspace)), workspace);
  }
});

test("every professional preset is valid and restorable for its intended audience", () => {
  for (const [name, workspace] of Object.entries(PRESET_LAYOUTS)) {
    const audience = name === "PERSONAL FINANCE" ? "client" : "internal";
    assert.equal(isWorkspaceState(workspace), true, `${name} preset must be valid`);
    assert.deepEqual(
      deserializeWorkspace(serializeWorkspace(workspace), audience),
      workspace,
      `${name} preset must round-trip for ${audience} audience`,
    );
  }
  assert.equal(PRESET_LAYOUTS.VALUATION.primary.view, "financialstatements");
  assert.equal(PRESET_LAYOUTS.VALUATION.secondary?.view, "valuation");
  assert.equal(PRESET_LAYOUTS["EQUITY RESEARCH"].secondary?.view, "financialstatements");
  assert.equal(PRESET_LAYOUTS["PERSONAL FINANCE"].primary.view, "personalfinance");
  assert.equal(PRESET_LAYOUTS["PERSONAL FINANCE"].secondary?.view, "portfolio");
  assert.equal(PRESET_LAYOUTS["PERSONAL FINANCE"].tertiary?.view, "montecarlo");
  assert.equal(PRESET_LAYOUTS["PERSONAL FINANCE"].quaternary?.view, "economics");
  const clientPersonalFinance = getPersonalFinanceWorkspace("client");
  assert.equal(clientPersonalFinance.primary.view, "personalfinance");
  assert.equal(clientPersonalFinance.secondary?.view, "portfolio");
  assert.equal(clientPersonalFinance.tertiary?.view, "montecarlo");
  assert.equal(clientPersonalFinance.quaternary?.view, "clientdata");
  assert.deepEqual(deserializeWorkspace(serializeWorkspace(clientPersonalFinance), "client"), clientPersonalFinance);
});

test("workspace validation allows an explicit empty symbol for non-security panes", () => {
  assert.equal(isWorkspaceState({
    primary: { view: "personalfinance", symbol: "" },
    secondary: null,
    focusedPane: "primary",
  }), true);
  assert.equal(isWorkspaceState({
    primary: { view: "personalfinance", symbol: " " },
    secondary: null,
    focusedPane: "primary",
  }), false);
});

test("workspace validation rejects unknown views and a missing focused pane", () => {
  assert.equal(isWorkspaceState({
    primary: { view: "not-a-panel", symbol: "AAPL" },
    secondary: null,
    focusedPane: "primary",
  }), false);
  assert.equal(isWorkspaceState({
    primary: { view: "market", symbol: "AAPL" },
    secondary: null,
    focusedPane: "secondary",
  }), false);
  assert.equal(isWorkspaceState({
    primary: { view: "market", symbol: "AAPL" },
    focusedPane: "primary",
  }), false);
});

test("workspace deserialization rejects malformed URL state", () => {
  assert.equal(deserializeWorkspace("%7Bbroken"), null);
  assert.equal(loadWorkspaceFromUrl("?ws=%257Bbroken"), null);
});

test("client workspace deserialization replaces internal views with an explicit safe fallback", () => {
  const workspace = {
    primary: { view: "uide" as const, symbol: "AAPL" },
    secondary: { view: "market" as const, symbol: "AAPL" },
    focusedPane: "primary" as const,
  };

  const restored = deserializeWorkspace(serializeWorkspace(workspace), "client");

  assert.deepEqual(restored?.primary, { view: "market", symbol: "AAPL" });
  assert.deepEqual(restored?.secondary, workspace.secondary);
  assert.equal(restored?.focusedPane, "primary");
});

test("trial workspace deserialization replaces unported views without dropping the workspace", () => {
  const workspace = {
    primary: { view: "workspaces" as const, symbol: "AAPL" },
    secondary: null,
    focusedPane: "primary" as const,
  };

  const restored = deserializeWorkspace(serializeWorkspace(workspace), "trial");

  assert.ok(restored);
  assert.equal(restored?.primary.view, "market");
  assert.equal(restored?.primary.symbol, "AAPL");
});

test("persisted active workspaces are sanitized for every audience", () => {
  const persisted = JSON.stringify({
    primary: { view: "clientdata", symbol: "AAPL" },
    secondary: { view: "workspaces", symbol: "AAPL" },
    focusedPane: "primary",
  });

  withBrowserStorage({ "limuria-active-workspace": persisted }, () => {
    for (const audience of ["internal", "client", "trial"] as const) {
      const restored = loadActiveWorkspace(audience);
      assert.equal(restored.primary.view, audience === "client" ? "clientdata" : "market");
      assert.equal(restored.secondary?.view, audience === "internal" ? "workspaces" : "market");
    }
  });
});

test("saved layouts are sanitized before public audiences restore them", () => {
  const persisted = JSON.stringify({
    "unsafe-layout": {
      primary: { view: "uide", symbol: "AAPL" },
      secondary: { view: "clientdata", symbol: "AAPL" },
      focusedPane: "primary",
    },
  });

  withBrowserStorage({ "limuria-saved-layouts": persisted }, () => {
    assert.equal(getSavedLayouts("client")["unsafe-layout"].primary.view, "market");
    assert.equal(loadLayout("unsafe-layout", "trial")?.secondary?.view, "market");
  });
});

test("client and trial deserialization explicitly fall back for unknown persisted views", () => {
  const encoded = serializeWorkspace({
    primary: { view: "removed-panel" as never, symbol: "AAPL" },
    secondary: null,
    focusedPane: "primary",
  });

  for (const audience of ["client", "trial"] as const) {
    const restored = deserializeWorkspace(encoded, audience);
    assert.deepEqual(restored?.primary, { view: "market", symbol: "AAPL" });
  }
});

test("internal deserialization rejects unknown persisted views", () => {
  const encoded = serializeWorkspace({
    primary: { view: "removed-panel" as never, symbol: "AAPL" },
    secondary: null,
    focusedPane: "primary",
  });

  assert.equal(deserializeWorkspace(encoded, "internal"), null);
});

test("public layout sharing excludes origin credentials, saved Artifact custody and extra fields", () => {
  const workspace = {
    primary: { view: "artifact" as const, symbol: "AAPL", artifact: { projectId: 123, chatId: 456, artifactId: "artifact:private", version: 17 }, privateNote: "PRIVATE_NOTE" },
    secondary: { view: "chart" as const, symbol: "MSFT", providerKey: "PRIVATE_KEY" },
    focusedPane: "primary" as const,
  };
  const url = new URL(buildWorkspaceShareUrl(workspace, "https://user:secret@lios.example/?access_token=PRIVATE_TOKEN#/p/123/c/456"));
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.hash, "#/");
  assert.deepEqual([...url.searchParams.keys()], ["ws"]);
  assert.deepEqual(loadWorkspaceFromUrl(url.search), { primary: { view: "market", symbol: "AAPL" }, secondary: { view: "chart", symbol: "MSFT" }, focusedPane: "primary" });
  assert.equal(workspace.primary.artifact.version, 17);
});

test("public layout links remove signed-in paths and ignore private payloads on ingress", () => {
  const workspace = createInitialWorkspace();
  const privatePane = { ...workspace.primary, view: "artifact" as const, artifact: { projectId: 42, chatId: 9, artifactId: "artifact:123e4567-e89b-42d3-a456-426614174000", version: 7 }, privateNote: "private" };
  const url = new URL(buildWorkspaceShareUrl({ ...workspace, primary: privatePane }, "https://user:password@example.test/projects/42/chat/9?token=private#/c/9"));
  assert.equal(url.pathname, "/");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.deepEqual([...url.searchParams.keys()], ["ws"]);
  const decoded = deserializeWorkspace(url.searchParams.get("ws"));
  assert.deepEqual(decoded?.primary, { view: "market", symbol: workspace.primary.symbol });
  const hostile = new URLSearchParams({ ws: serializeWorkspace({ ...workspace, primary: privatePane }) });
  assert.deepEqual(loadWorkspaceFromUrl(`?${hostile}`)?.primary, { view: "market", symbol: workspace.primary.symbol });
  assert.equal(loadWorkspaceFromUrl(`?ws=${"a".repeat(10_001)}`), null);
  assert.throws(() => buildWorkspaceShareUrl(workspace, "file:///private/user/workspace"), /not.*shareable/);
});
