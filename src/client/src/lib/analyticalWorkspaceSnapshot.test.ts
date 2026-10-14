import test from "node:test";
import assert from "node:assert/strict";
import { isAnalyticalWorkspaceStateV2 } from "@shared/analyticalWorkspaceState";

const valid = {
  version: 2,
  capturedAt: "2026-09-10T10:00:00.000Z",
  activeTab: {
    title: "NVDA Investment Committee",
    kind: "entity",
    entity: "NVDA",
    groupId: "IC",
    linkGroupId: "A",
    linkScopes: ["instrument", "time"],
    pinned: true,
    workspace: {
      primary: { view: "valuation", symbol: "NVDA" },
      secondary: { view: "financialstatements", symbol: "NVDA" },
      tertiary: { view: "news", symbol: "NVDA" },
      quaternary: null,
      focusedPane: "primary",
    },
  },
  paneStates: [
    { paneId: "primary", view: "valuation", symbol: "NVDA", zoom: "detail", attention: "outputs", compareArmed: false },
    { paneId: "secondary", view: "financialstatements", symbol: "NVDA", zoom: "analysis", attention: "evidence", compareArmed: true },
    { paneId: "tertiary", view: "news", symbol: "NVDA", zoom: "detail", attention: "off", compareArmed: false },
  ],
  viewStates: [
    { paneId: "primary", view: "valuation", symbol: "NVDA", state: { section: "dcf", scenario: "base" } },
    { paneId: "secondary", view: "financialstatements", symbol: "NVDA", state: { statement: "income", period: "annual" } },
  ],
  timeContext: { enabled: true, asOfDate: "2026-06-30", mode: "as-known-on" },
} as const;

const macroTab = {
  title: "India Macro Watch",
  kind: "workspace",
  entity: null,
  groupId: "MACRO",
  linkGroupId: "B",
  linkScopes: ["time", "scenario"],
  pinned: false,
  workspace: {
    primary: { view: "economics", symbol: "" },
    secondary: { view: "ecalendar", symbol: "" },
    tertiary: null,
    quaternary: null,
    focusedPane: "secondary",
  },
} as const;

test("analytical workspace V2 accepts a reproducible shell checkpoint", () => {
  assert.equal(isAnalyticalWorkspaceStateV2(valid), true);
});

test("analytical workspace V2 accepts a complete tab strip and active-tab position", () => {
  const multiTab = {
    ...valid,
    tabs: [macroTab, valid.activeTab],
    activeTabIndex: 1,
  };
  assert.equal(isAnalyticalWorkspaceStateV2(multiTab), true);
});

test("analytical workspace V2 compares active tabs structurally rather than by property order", () => {
  const reorderedActiveTab = {
    workspace: valid.activeTab.workspace,
    pinned: valid.activeTab.pinned,
    linkScopes: valid.activeTab.linkScopes,
    linkGroupId: valid.activeTab.linkGroupId,
    groupId: valid.activeTab.groupId,
    entity: valid.activeTab.entity,
    kind: valid.activeTab.kind,
    title: valid.activeTab.title,
  };
  assert.equal(isAnalyticalWorkspaceStateV2({
    ...valid,
    activeTab: reorderedActiveTab,
    tabs: [valid.activeTab],
    activeTabIndex: 0,
  }), true);
});

test("analytical workspace V2 rejects ambiguous multi-tab checkpoints", () => {
  assert.equal(isAnalyticalWorkspaceStateV2({
    ...valid,
    tabs: [valid.activeTab, macroTab],
    activeTabIndex: 1,
  }), false, "activeTab must match the tab selected by activeTabIndex");
  assert.equal(isAnalyticalWorkspaceStateV2({
    ...valid,
    tabs: [valid.activeTab],
  }), false, "tabs require an explicit activeTabIndex");
  assert.equal(isAnalyticalWorkspaceStateV2({
    ...valid,
    activeTabIndex: 0,
  }), false, "activeTabIndex is invalid without a tab strip");
});

test("analytical workspace V2 keeps early checkpoints without explicit link scopes, pin intent, or view state compatible", () => {
  const { linkScopes: _linkScopes, pinned: _pinned, ...legacyTab } = valid.activeTab;
  const { viewStates: _viewStates, ...legacyState } = valid;
  assert.equal(isAnalyticalWorkspaceStateV2({ ...legacyState, activeTab: legacyTab }), true);
});

test("analytical workspace V2 rejects malformed or future-version payloads", () => {
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, version: 3 }), false);
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, activeTab: { ...valid.activeTab, linkGroupId: "Z" } }), false);
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, activeTab: { ...valid.activeTab, linkScopes: ["instrument", "unknown"] } }), false);
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, activeTab: { ...valid.activeTab, linkScopes: ["instrument", "instrument"] } }), false);
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, activeTab: { ...valid.activeTab, pinned: "yes" } }), false);
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, timeContext: { enabled: true, asOfDate: "06/30/2026", mode: "as-known-on" } }), false);
});

test("analytical workspace V2 rejects unsafe or oversized workstation view state", () => {
  assert.equal(isAnalyticalWorkspaceStateV2({
    ...valid,
    viewStates: [{ paneId: "primary", view: "valuation", symbol: "NVDA", state: { bad: Number.NaN } }],
  }), false);
  assert.equal(isAnalyticalWorkspaceStateV2({
    ...valid,
    viewStates: [{ paneId: "primary", view: "valuation", symbol: "NVDA", state: { huge: "X".repeat(12_500) } }],
  }), false);
});

test("analytical workspace V2 caps tab and pane-state counts", () => {
  const tooManyTabs = Array.from({ length: 13 }, () => valid.activeTab);
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, tabs: tooManyTabs, activeTabIndex: 0 }), false);
  const tooManyPaneStates = Array.from({ length: 49 }, () => valid.paneStates[0]);
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, paneStates: tooManyPaneStates }), false);
  assert.equal(isAnalyticalWorkspaceStateV2({ ...valid, activeTab: { ...valid.activeTab, title: "X".repeat(121) } }), false);
});


test("P1 analytical snapshots accept stable tab ids while keeping legacy id-less checkpoints compatible", () => {
  const stable = {
    ...valid,
    activeTab: { ...valid.activeTab, id: "project-tab-1" },
    tabs: [{ ...valid.activeTab, id: "project-tab-1" }],
    activeTabIndex: 0,
  };
  assert.equal(isAnalyticalWorkspaceStateV2(stable), true);
  assert.equal(isAnalyticalWorkspaceStateV2({
    ...stable,
    activeTab: { ...stable.activeTab, id: "" },
    tabs: [{ ...stable.activeTab, id: "" }],
  }), false, "empty stable ids must be rejected");
});
