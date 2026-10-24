import test from "node:test";
import assert from "node:assert/strict";
import { advanceArtifactWorkbenchRevision, openArtifactWorkbench, returnFromArtifactWorkbench } from "./artifactWorkbenchHandoff";
import { deserializeWorkspace, isWorkspaceState, serializeWorkspace } from "./terminalWorkspace";
import { isViewVisibleToAudience } from "./featureRegistry";
import type { ArtifactWorkbenchContext } from "./terminalTypes";
import type { TerminalTab, TerminalTabsState } from "./terminalTabs";
import { createTerminalNavigationHistory, goBackInTerminalHistory, pushTerminalNavigation } from "./terminalHistory";

const context: ArtifactWorkbenchContext = {
  projectId: 17, chatId: 42, artifactId: "artifact:12345678-1234-1234-1234-123456789abc", version: 3,
};
function tab(id: string): TerminalTab {
  return {
    id, title: "Existing analysis", kind: "workspace", entity: null, groupId: null,
    pinned: false, preview: false, dirty: false, createdAt: 1, updatedAt: 1,
    workspace: {
      primary: { view: "chart", symbol: "MSFT" }, secondary: { view: "valuation", symbol: "MSFT" },
      tertiary: { view: "news", symbol: "MSFT" }, quaternary: { view: "quote", symbol: "MSFT" }, focusedPane: "secondary",
    },
  };
}
function state(): TerminalTabsState { return { tabs: [tab("original"), tab("other")], activeTabId: "original", closedTabs: [] }; }

test("Chat → registered Workbench Artifact → same Chat restores the exact prior four-pane layout", () => {
  const before = state();
  const geometry = { grid: { orientation: "HORIZONTAL", width: 1270, height: 810 }, activeGroup: "analysis" };
  const opened = openArtifactWorkbench(before, context, geometry, "tertiary", false)!;
  assert.equal(isWorkspaceState(opened.state.tabs[0].workspace), true);
  for (const audience of ["internal", "client", "trial"] as const) assert.equal(isViewVisibleToAudience("artifact", audience), true);
  assert.equal(opened.state.tabs.length, before.tabs.length);
  assert.equal(opened.state.activeTabId, before.activeTabId);
  assert.deepEqual(opened.state.tabs[0].workspace.secondary, { view: "artifact", symbol: "", artifact: context });
  assert.equal(opened.state.tabs[0].workspace.primary, before.tabs[0].workspace.primary);
  assert.equal(opened.state.tabs[0].workspace.tertiary, before.tabs[0].workspace.tertiary);
  assert.equal(opened.state.tabs[1], before.tabs[1]);
  const returned = returnFromArtifactWorkbench(opened.state, opened.handoff, context, false)!;
  assert.deepEqual(returned.context, context);
  assert.deepEqual(returned.state, before);
  assert.deepEqual(returned.state.tabs[0].workspace, before.tabs[0].workspace);
  assert.equal(opened.handoff.priorLayout, geometry);
  assert.equal(opened.handoff.priorMaximizedPane, "tertiary");
});

test("historical revision remains pinned through persistence and roundtrip, never replaced by head", () => {
  const before = state();
  const historical = { ...context, version: 1 };
  const opened = openArtifactWorkbench(before, historical, null, null, false)!;
  for (const audience of ["internal", "client", "trial"] as const) {
    const restored = deserializeWorkspace(serializeWorkspace(opened.state.tabs[0].workspace), audience)!;
    assert.equal(restored.secondary?.artifact?.version, 1);
    assert.equal(restored.secondary?.artifact?.artifactId, historical.artifactId);
    assert.deepEqual(restored.secondary?.artifact, historical);
  }
  assert.deepEqual(returnFromArtifactWorkbench(opened.state, opened.handoff, historical, false)?.context, historical);
});

test("a saved Workbench revision returns to the original Chat without undoing canonical edits or other tabs", () => {
  const before = state();
  const opened = openArtifactWorkbench(before, context, null, null, false)!;
  const saved = { ...context, version: 4 };
  const anotherTab = tab("created-during-work");
  const during = { ...opened.state, tabs: [...opened.state.tabs, anotherTab] };
  const returned = returnFromArtifactWorkbench(during, opened.handoff, saved, false)!;
  assert.deepEqual(returned.context, saved);
  assert.equal(returned.context.projectId, context.projectId);
  assert.equal(returned.context.chatId, context.chatId);
  assert.equal(returned.context.artifactId, context.artifactId);
  assert.equal(returned.state.activeTabId, before.activeTabId);
  assert.equal(returned.state.tabs[2], anotherTab);
  assert.deepEqual(returned.state.tabs[0].workspace, before.tabs[0].workspace);
});

test("return restores only the projected pane, preserving live Workbench entity, source panels and tab metadata", () => {
  const before = state();
  const opened = openArtifactWorkbench(before, context, null, null, false)!;
  const existingTab = opened.state.tabs[0];
  const modifiedTab = {
    ...existingTab,
    entity: "NVDA",
    title: "Current NVDA analysis",
    workspace: {
      ...existingTab.workspace,
      primary: { view: "chart" as const, symbol: "NVDA" },
      tertiary: { view: "news" as const, symbol: "NVDA" },
      focusedPane: "primary" as const,
    },
  };
  const changed = { ...opened.state, tabs: [modifiedTab, opened.state.tabs[1]] };
  const returned = returnFromArtifactWorkbench(changed, opened.handoff, { ...context, version: 4 }, false)!;
  assert.equal(returned.state.tabs[0].entity, "NVDA");
  assert.equal(returned.state.tabs[0].title, "Current NVDA analysis");
  assert.deepEqual(returned.state.tabs[0].workspace.primary, modifiedTab.workspace.primary);
  assert.deepEqual(returned.state.tabs[0].workspace.tertiary, modifiedTab.workspace.tertiary);
  assert.deepEqual(returned.state.tabs[0].workspace.secondary, before.tabs[0].workspace.secondary);
  assert.equal(returned.state.tabs[0].workspace.focusedPane, "secondary");
  assert.deepEqual(returned.context, { ...context, version: 4 });
  assert.equal(returned.state.tabs[1], before.tabs[1]);
});

test("return fails closed if the origin tab or projected Artifact pane no longer exists", () => {
  const opened = openArtifactWorkbench(state(), context, null, null, false)!;
  const closedTab = { ...opened.state, tabs: [opened.state.tabs[1]], activeTabId: "other" };
  assert.equal(returnFromArtifactWorkbench(closedTab, opened.handoff, context, false), null);
  const replacedTab = {
    ...opened.state,
    tabs: opened.state.tabs.map(tab => tab.id !== "original" ? tab : {
      ...tab,
      workspace: { ...tab.workspace, secondary: { view: "chart" as const, symbol: "AAPL" } },
    }),
  };
  assert.equal(returnFromArtifactWorkbench(replacedTab, opened.handoff, context, false), null);
  const differentArtifact = {
    ...opened.state,
    tabs: opened.state.tabs.map(tab => tab.id !== "original" ? tab : {
      ...tab,
      workspace: {
        ...tab.workspace,
        secondary: { view: "artifact" as const, symbol: "", artifact: { ...context, chatId: 999 } },
      },
    }),
  };
  assert.equal(returnFromArtifactWorkbench(differentArtifact, opened.handoff, context, false), null);
});

test("unsaved drafts block both directions without mutating identity, revision, or layout", () => {
  const before = state();
  assert.equal(openArtifactWorkbench(before, context, null, null, true), null);
  assert.equal(before.tabs[0].workspace.secondary?.view, "valuation");
  const opened = openArtifactWorkbench(before, context, null, null, false)!;
  assert.equal(returnFromArtifactWorkbench(opened.state, opened.handoff, context, true), null);
  assert.deepEqual(opened.state.tabs[0].workspace.secondary?.artifact, context);
  for (const changed of [{ chatId: 43 }, { projectId: 18 }, { artifactId: "12345678-1234-1234-1234-123456789abc" }]) {
    assert.equal(returnFromArtifactWorkbench(opened.state, opened.handoff, { ...context, ...changed }, false), null);
  }
});

test("Artifact pane persistence rejects missing or invalid canonical revision context", () => {
  const opened = openArtifactWorkbench(state(), context, null, null, false)!;
  const workspace = opened.state.tabs[0].workspace;
  for (const invalid of [undefined, { ...context, version: 0 }, { ...context, version: 1.5 }, { ...context, projectId: -1 }, { ...context, chatId: 0 }, { ...context, artifactId: "not-an-artifact" }]) {
    assert.equal(isWorkspaceState({ ...workspace, secondary: { view: "artifact", symbol: "", artifact: invalid } }), false);
  }
});

test("Workbench history distinguishes exact Artifact revisions instead of collapsing them as the same pane", () => {
  const first = openArtifactWorkbench(state(), { ...context, version: 1 }, null, null, false)!.state.tabs[0].workspace;
  const second = { ...first, secondary: { ...first.secondary!, artifact: { ...context, version: 3 } } };
  const history = pushTerminalNavigation(createTerminalNavigationHistory(), first, second);
  assert.equal(history.back.length, 1);
  const restored = goBackInTerminalHistory(history, second)!;
  assert.equal(restored.workspace.secondary?.artifact?.version, 1);
  assert.equal(restored.workspace.secondary?.artifact?.chatId, context.chatId);
});

test("saving v2 cannot be rolled back by stale v1 observations or a delayed navigation-context echo", () => {
  const loadedV1 = advanceArtifactWorkbenchRevision({ requestedVersion: 1, displayedVersion: 1, loading: true }, { type: "loaded", version: 1 });
  const savingV2 = advanceArtifactWorkbenchRevision(loadedV1, { type: "select", version: 2 });
  assert.equal(savingV2.requestedVersion, 2);
  assert.equal(savingV2.loading, true);
  assert.equal(advanceArtifactWorkbenchRevision(savingV2, { type: "context", version: 1, dirty: false }), savingV2);
  assert.equal(advanceArtifactWorkbenchRevision(savingV2, { type: "loaded", version: 1 }), savingV2);
  const loadedV2 = advanceArtifactWorkbenchRevision(savingV2, { type: "loaded", version: 2 });
  assert.deepEqual(loadedV2, { requestedVersion: 2, displayedVersion: 2, loading: false });
  assert.equal(advanceArtifactWorkbenchRevision(loadedV2, { type: "loaded", version: 1 }), loadedV2);
  assert.equal(advanceArtifactWorkbenchRevision(loadedV2, { type: "context", version: 2, dirty: false }), loadedV2);
  const opened = openArtifactWorkbench(state(), { ...context, version: 1 }, null, null, false)!;
  const returned = returnFromArtifactWorkbench(opened.state, opened.handoff, { ...context, version: loadedV2.displayedVersion }, false)!;
  assert.equal(returned.context.version, 2);
  assert.equal(returned.context.chatId, context.chatId);
});

test("deliberate historical selection remains supported without treating arbitrary old callbacks as navigation", () => {
  const loadedV2 = { requestedVersion: 2, displayedVersion: 2, loading: false };
  assert.equal(advanceArtifactWorkbenchRevision(loadedV2, { type: "context", version: 1, dirty: true }), loadedV2);
  const historical = advanceArtifactWorkbenchRevision(loadedV2, { type: "context", version: 1, dirty: false });
  assert.equal(historical.requestedVersion, 1);
  assert.equal(advanceArtifactWorkbenchRevision(historical, { type: "loaded", version: 2 }), historical);
  const loadedV1 = advanceArtifactWorkbenchRevision(historical, { type: "loaded", version: 1 });
  assert.deepEqual(loadedV1, { requestedVersion: 1, displayedVersion: 1, loading: false });
  const head = advanceArtifactWorkbenchRevision(loadedV1, { type: "select", version: null });
  assert.deepEqual(advanceArtifactWorkbenchRevision(head, { type: "loaded", version: 3 }), { requestedVersion: null, displayedVersion: 3, loading: false });
});

test("Quick Chat uses the same Workbench editor and returns its exact saved revision without a Project", () => {
  const quick = { ...context, projectId: null };
  const before = state();
  const opened = openArtifactWorkbench(before, quick, null, null, false)!;
  assert.equal(isWorkspaceState(opened.state.tabs[0].workspace), true);
  const restored = deserializeWorkspace(serializeWorkspace(opened.state.tabs[0].workspace))!;
  assert.deepEqual(restored.secondary?.artifact, quick);
  assert.equal(restored.secondary?.view, "artifact");
  assert.equal(openArtifactWorkbench(before, quick, null, null, true), null);
  assert.equal(returnFromArtifactWorkbench(opened.state, opened.handoff, { ...quick, version: 4 }, true), null);
  assert.equal(returnFromArtifactWorkbench(opened.state, opened.handoff, { ...quick, chatId: 43 }, false), null);
  assert.equal(returnFromArtifactWorkbench(opened.state, opened.handoff, { ...quick, projectId: 17 }, false), null);
  const returned = returnFromArtifactWorkbench(opened.state, opened.handoff, { ...quick, version: 4 }, false)!;
  assert.deepEqual(returned.context, { ...quick, version: 4 });
  assert.deepEqual(returned.state, before);
});
