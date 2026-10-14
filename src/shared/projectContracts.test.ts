import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectSessionSchema,
  projectWorkspaceSessionStateSchema,
  safeWorkspaceActionSchema,
  workspaceActionNeedsConfirmation,
} from "./projectContracts";

function validAnalyticalState() {
  return {
    version: 2,
    capturedAt: "2026-09-21T10:00:00.000Z",
    activeTab: {
      id: "tab-project-1",
      title: "Project Analysis",
      kind: "entity",
      entity: "AAPL",
      groupId: null,
      linkGroupId: "A",
      linkScopes: ["instrument", "time"],
      pinned: false,
      workspace: {
        primary: { view: "valuation", symbol: "AAPL" },
        secondary: { view: "chart", symbol: "AAPL" },
        tertiary: null,
        quaternary: null,
        focusedPane: "primary",
      },
    },
    tabs: [{
      id: "tab-project-1",
      title: "Project Analysis",
      kind: "entity",
      entity: "AAPL",
      groupId: null,
      linkGroupId: "A",
      linkScopes: ["instrument", "time"],
      pinned: false,
      workspace: {
        primary: { view: "valuation", symbol: "AAPL" },
        secondary: { view: "chart", symbol: "AAPL" },
        tertiary: null,
        quaternary: null,
        focusedPane: "primary",
      },
    }],
    activeTabIndex: 0,
    paneStates: [],
    viewStates: [],
    timeContext: { enabled: false, asOfDate: null, mode: "latest" },
  };
}

function validSessionState() {
  return {
    version: 1 as const,
    workspaceEngine: "dockview" as const,
    analyticalState: validAnalyticalState(),
    dockviewLayout: { grid: { root: "primary" } },
    linkedContext: {
      contexts: {
        "tab-project-1": {
          instrument: "AAPL",
          time: { enabled: false, asOfDate: null, mode: "latest" as const },
          scenarioId: null,
          portfolioId: "portfolio-1",
          benchmarkId: "SPY",
        },
      },
      channels: {},
    },
    focusedObject: {
      kind: "panel" as const,
      id: "primary",
      label: "Valuation",
      view: "valuation",
      symbol: "AAPL",
      paneId: "primary" as const,
    },
    savedViewName: null,
    visualEnvironment: {
      projectId: "12",
      environmentId: "company-intelligence",
      intensity: "contextual",
      semanticContext: "company",
    },
  };
}

test("P1 Session contract accepts a versioned forkable analytical checkpoint", () => {
  const parsed = projectWorkspaceSessionStateSchema.parse(validSessionState());
  assert.equal(parsed.workspaceEngine, "dockview");
  assert.equal((parsed.analyticalState as any).activeTab.id, "tab-project-1");
  assert.equal(parsed.linkedContext.contexts["tab-project-1"]?.portfolioId, "portfolio-1");
  assert.equal(parsed.visualEnvironment?.environmentId, "company-intelligence");
  assert.equal(parsed.visualEnvironment?.intensity, "contextual");
});

test("P1 Session contract rejects credential-like fields anywhere in saved state", () => {
  const withSecret = validSessionState() as any;
  withSecret.dockviewLayout = {
    panels: [{ id: "research", params: { apiKey: "must-never-persist" } }],
  };
  assert.throws(
    () => projectWorkspaceSessionStateSchema.parse(withSecret),
    /must not contain credentials/i,
  );

  const nestedToken = validSessionState() as any;
  nestedToken.analyticalState.viewStates = [{
    paneId: "primary",
    view: "valuation",
    symbol: "AAPL",
    state: { provider: { accessToken: "secret" } },
  }];
  assert.throws(
    () => projectWorkspaceSessionStateSchema.parse(nestedToken),
    /must not contain credentials/i,
  );
});

test("P1 Session creation requires Project identity and validates the workspace envelope", () => {
  const parsed = createProjectSessionSchema.parse({
    projectId: 12,
    chatId: 34,
    parentSessionId: null,
    name: "Base IC Session",
    workspaceState: validSessionState(),
  });
  assert.equal(parsed.projectId, 12);
  assert.equal(parsed.chatId, 34);
});

test("safe workspace actions keep panel opens automatic but layout changes confirmable", () => {
  const open = safeWorkspaceActionSchema.parse({
    type: "open-panel",
    view: "valuation",
    symbol: "AAPL",
    placement: "secondary",
    reason: "Show the deterministic model.",
  });
  const close = safeWorkspaceActionSchema.parse({
    type: "close-panel",
    paneId: "secondary",
    reason: "Close a secondary analytical pane through canonical LiOS state.",
  });
  const layout = safeWorkspaceActionSchema.parse({
    type: "propose-layout",
    preset: "research",
    reason: "Research task benefits from multiple linked panels.",
  });
  const personalFinance = safeWorkspaceActionSchema.parse({
    type: "propose-layout",
    preset: "personal-finance",
    reason: "Personal finance planning benefits from linked advisory, portfolio, scenario and user-data panes.",
  });
  assert.equal(workspaceActionNeedsConfirmation(open), false);
  assert.equal(workspaceActionNeedsConfirmation(close), false);
  assert.equal(workspaceActionNeedsConfirmation(layout), true);
  assert.equal(workspaceActionNeedsConfirmation(personalFinance), true);
  assert.equal(personalFinance.preset, "personal-finance");
});

test("Session payload size is bounded", () => {
  const oversized = validSessionState() as any;
  oversized.dockviewLayout = { blob: "X".repeat(221_000) };
  assert.throws(
    () => projectWorkspaceSessionStateSchema.parse(oversized),
    /220KB/i,
  );
});
