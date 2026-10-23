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
  workspaceForShare,
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


test("sharing an Artifact pane omits all private identity and revision metadata", () => {
  const secret = "artifact:123e4567-e89b-42d3-a456-426614174000";
  const workspace = {
    primary: {
      view: "artifact" as const,
      symbol: "AAPL",
      artifact: { projectId: 12345, chatId: 90001, artifactId: secret, version: 17 },
      credential: "should-not-copy",
      privateNote: "confidential-record",
    },
    secondary: { view: "chart" as const, symbol: "MSFT", extra: "hidden-input" },
    focusedPane: "primary" as const,
  };

  const share = workspaceForShare(workspace);
  assert.deepEqual(share, {
    primary: { view: "market", symbol: "AAPL" },
    secondary: { view: "chart", symbol: "MSFT" },
    focusedPane: "primary",
  });
  // The canonical saved state is not altered to make a share link.
  assert.equal(workspace.primary.artifact.artifactId, secret);
  assert.equal(workspace.primary.view, "artifact");
  const url = buildWorkspaceShareUrl(workspace, "https://lios.example.org/?access_token=TOPSECRET&invite=private#/p/123/c/90001");
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.has("access_token"), false);
  assert.equal(parsed.searchParams.has("invite"), false);
  assert.deepEqual([...parsed.searchParams.keys()], ["ws"]);
  assert.equal(parsed.hash, "#/");
  assert.equal(url.includes("TOPSECRET"), false);
  assert.equal(url.includes("confidential-record"), false);
  assert.equal(url.includes("should-not-copy"), false);
  assert.equal(url.includes("90001"), false);
  assert.deepEqual(loadWorkspaceFromUrl(parsed.search), share);
});

test("share links preserve a four-pane public layout and selected pane without leaking additional pane fields", () => {
  const workspace = {
    primary: { view: "chart" as const, symbol: "AAPL", providerKey: "UNSAFE" },
    secondary: { view: "news" as const, symbol: "MSFT" },
    tertiary: { view: "valuation" as const, symbol: "GOOG" },
    quaternary: { view: "market" as const, symbol: "NVDA" },
    focusedPane: "quaternary" as const,
    privateRootValue: "LEAK_ME",
  };
  const url = buildWorkspaceShareUrl(workspace);
  const shared = loadWorkspaceFromUrl(new URL(url).search);
  assert.deepEqual(shared, {
    primary: { view: "chart", symbol: "AAPL" },
    secondary: { view: "news", symbol: "MSFT" },
    tertiary: { view: "valuation", symbol: "GOOG" },
    quaternary: { view: "market", symbol: "NVDA" },
    focusedPane: "quaternary",
  });
  assert.equal(url.includes("LEAK_ME"), false);
  assert.equal(url.includes("UNSAFE"), false);
});

test("workspace sharing strips authentication credentials embedded in an origin URL", () => {
  const url = buildWorkspaceShareUrl(createInitialWorkspace(), "https://alice:password@lios.example.org/?session=secret#/c/secret");
  const parsed = new URL(url);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(parsed.hash, "#/");
  assert.equal(parsed.searchParams.has("session"), false);
  assert.equal(parsed.searchParams.has("ws"), true);
});
