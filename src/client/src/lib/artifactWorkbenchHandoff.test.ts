import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceArtifactWorkbenchRevision, clearArtifactWorkbenchRecovery, loadArtifactWorkbenchRecovery,
  openArtifactWorkbench, resolveArtifactPaneRequestedVersion, returnFromArtifactWorkbench,
  saveArtifactWorkbenchRecovery, ARTIFACT_WORKBENCH_RECOVERY_KEY,
} from "./artifactWorkbenchHandoff";
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
  assert.equal(returned.state.tabs[0].workspace, before.tabs[0].workspace);
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
  assert.equal(returned.state.tabs[0].workspace, before.tabs[0].workspace);
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


test("shared Artifact editor can navigate from head v4 to historical v1 and back without assuming versions rise", () => {
  const artifactId = context.artifactId;
  assert.equal(resolveArtifactPaneRequestedVersion(artifactId, 4, null), 4);
  assert.equal(resolveArtifactPaneRequestedVersion(artifactId, 4, { artifactId, version: 1 }), 1,
    "selecting an older revision must cause the actual Artifact query to load historical v1");
  assert.equal(resolveArtifactPaneRequestedVersion(artifactId, 4, { artifactId, version: 5 }), 5,
    "newly saved canonical versions remain addressable immediately");
  assert.equal(resolveArtifactPaneRequestedVersion(artifactId, 4, { artifactId: "artifact:other", version: 1 }), 4,
    "an Artifact change must not inherit another Artifact's local history selection");
  assert.equal(resolveArtifactPaneRequestedVersion(artifactId, null, null), null,
    "latest head remains an explicit nullable selection, not an invented version");
});

test("delayed historical fetch cannot replace a selected latest-head revision during Workbench return", () => {
  const loadedV3 = { requestedVersion: 3, displayedVersion: 3, loading: false };
  const latest = advanceArtifactWorkbenchRevision(loadedV3, { type: "select", version: null });
  assert.deepEqual(latest, { requestedVersion: null, displayedVersion: 3, loading: true });
  assert.equal(advanceArtifactWorkbenchRevision(latest, { type: "loaded", version: 1 }), latest);
  assert.equal(advanceArtifactWorkbenchRevision(latest, { type: "loaded", version: 2 }), latest);
  const resolved = advanceArtifactWorkbenchRevision(latest, { type: "loaded", version: 4 });
  assert.deepEqual(resolved, { requestedVersion: null, displayedVersion: 4, loading: false });
  assert.equal(advanceArtifactWorkbenchRevision(resolved, { type: "loaded", version: 3 }), resolved);
  const before = state();
  const opened = openArtifactWorkbench(before, { ...context, version: 3 }, null, null, false)!;
  assert.equal(returnFromArtifactWorkbench(opened.state, opened.handoff,
    { ...context, version: resolved.displayedVersion }, false)?.context.version, 4);
});


test("out-of-order Artifact callbacks are rejected by exact requested-version identity, including Latest", () => {
  const viewedV1 = { requestedVersion: 1, displayedVersion: 1, loading: false };
  const pendingHead = advanceArtifactWorkbenchRevision(viewedV1, { type: "select", version: null });
  assert.equal(advanceArtifactWorkbenchRevision(pendingHead,
    { type: "loaded", version: 1, requestedVersion: 1 }), pendingHead,
    "an old historical fetch cannot falsely complete the current Latest selection");
  const headV4 = advanceArtifactWorkbenchRevision(pendingHead,
    { type: "loaded", version: 4, requestedVersion: null });
  assert.deepEqual(headV4, { requestedVersion: null, displayedVersion: 4, loading: false });
  const pendingHistorical = advanceArtifactWorkbenchRevision(headV4, { type: "select", version: 2 });
  assert.equal(advanceArtifactWorkbenchRevision(pendingHistorical,
    { type: "loaded", version: 4, requestedVersion: null }), pendingHistorical);
  assert.equal(advanceArtifactWorkbenchRevision(pendingHistorical,
    { type: "loaded", version: 1, requestedVersion: 1 }), pendingHistorical);
  assert.deepEqual(advanceArtifactWorkbenchRevision(pendingHistorical,
    { type: "loaded", version: 2, requestedVersion: 2 }),
    { requestedVersion: 2, displayedVersion: 2, loading: false });
});


function withRecoveryStorage(testCase: (storage: Map<string, string>) => void): void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try { testCase(storage); }
  finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("desktop reload restores a Quick Chat Artifact return to the SAME original four-pane Dockview tab", () => {
  withRecoveryStorage((storage) => {
    const before = state(), quick = { ...context, projectId: null };
    const geometry = { grid: { orientation: "HORIZONTAL", width: 1250, height: 720 }, activeGroup: "analysis" };
    const opened = openArtifactWorkbench(before, quick, geometry, "tertiary", false)!;
    saveArtifactWorkbenchRecovery(" OWNER@example.com ", opened.handoff);
    assert.ok(storage.has(ARTIFACT_WORKBENCH_RECOVERY_KEY));
    // JSON roundtrip simulates the already-persisted tabs on an Electron restart.
    const reloaded = JSON.parse(JSON.stringify(opened.state)) as TerminalTabsState;
    // The user may have focused a different visible pane after expansion.
    reloaded.tabs[0].workspace.focusedPane = "primary";
    reloaded.tabs[0].workspace.secondary!.artifact!.version = 4;
    const recovered = loadArtifactWorkbenchRecovery("owner@EXAMPLE.com", reloaded, "internal");
    assert.ok(recovered);
    assert.equal(recovered.context.artifactId, quick.artifactId);
    assert.equal(recovered.context.chatId, quick.chatId);
    assert.deepEqual(recovered.priorLayout, geometry);
    assert.equal(recovered.priorMaximizedPane, "tertiary");
    const returned = returnFromArtifactWorkbench(reloaded, recovered, { ...quick, version: 4 }, false)!;
    assert.deepEqual(returned.context, { ...quick, version: 4 });
    assert.deepEqual(returned.state, before, "return restores exact prior tab, not the temporary Artifact pane");
    clearArtifactWorkbenchRecovery();
    assert.equal(storage.has(ARTIFACT_WORKBENCH_RECOVERY_KEY), false);
  });
});

test("recovered navigation never grants a second signed-in account the first account's tab", () => {
  withRecoveryStorage((storage) => {
    const opened = openArtifactWorkbench(state(), context, null, null, false)!;
    saveArtifactWorkbenchRecovery("one@example.com", opened.handoff);
    assert.equal(loadArtifactWorkbenchRecovery("two@example.com", opened.state, "internal"), null);
    assert.equal(storage.has(ARTIFACT_WORKBENCH_RECOVERY_KEY), true,
      "a different account cannot read this hint; it is not promoted to global state");
    assert.ok(loadArtifactWorkbenchRecovery("one@example.com", opened.state, "internal"));
  });
});

test("restart recovery rejects stale, unrelated, modified, and corrupt layout snapshots", () => {
  withRecoveryStorage((storage) => {
    const before = state(), opened = openArtifactWorkbench(before, context, null, null, false)!;
    saveArtifactWorkbenchRecovery("owner@example.com", opened.handoff);
    const original = storage.get(ARTIFACT_WORKBENCH_RECOVERY_KEY)!;
    assert.equal(loadArtifactWorkbenchRecovery("owner@example.com", before, "internal"), null,
      "pre-expansion tab state cannot masquerade as an active recoverable handoff");
    storage.set(ARTIFACT_WORKBENCH_RECOVERY_KEY, original);
    const otherArtifact = JSON.parse(JSON.stringify(opened.state)) as TerminalTabsState;
    otherArtifact.tabs[0].workspace.secondary!.artifact!.artifactId = "artifact:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    assert.equal(loadArtifactWorkbenchRecovery("owner@example.com", otherArtifact, "internal"), null);
    storage.set(ARTIFACT_WORKBENCH_RECOVERY_KEY, original);
    const crossChat = JSON.parse(JSON.stringify(opened.state)) as TerminalTabsState;
    crossChat.tabs[0].workspace.secondary!.artifact!.chatId = 999;
    assert.equal(loadArtifactWorkbenchRecovery("owner@example.com", crossChat, "internal"), null);
    storage.set(ARTIFACT_WORKBENCH_RECOVERY_KEY, original);
    const stale = JSON.parse(original);
    stale.capturedAt -= 8 * 24 * 60 * 60 * 1_000;
    storage.set(ARTIFACT_WORKBENCH_RECOVERY_KEY, JSON.stringify(stale));
    assert.equal(loadArtifactWorkbenchRecovery("owner@example.com", opened.state, "internal"), null);
    assert.equal(storage.has(ARTIFACT_WORKBENCH_RECOVERY_KEY), false);
    storage.set(ARTIFACT_WORKBENCH_RECOVERY_KEY, "{corrupt-json");
    assert.equal(loadArtifactWorkbenchRecovery("owner@example.com", opened.state, "internal"), null);
    assert.equal(storage.has(ARTIFACT_WORKBENCH_RECOVERY_KEY), false);
  });
});

test("restart return navigation cannot resurrect a restricted pane for a trial account", () => {
  withRecoveryStorage(() => {
    const before = state();
    const restricted = { ...before,
      tabs: before.tabs.map((entry, i) => i === 0 ? {
        ...entry,
        workspace: { ...entry.workspace, secondary: { view: "clientdata" as const, symbol: "MSFT" } },
      } : entry) };
    const opened = openArtifactWorkbench(restricted, context, null, null, false)!;
    saveArtifactWorkbenchRecovery("owner@example.com", opened.handoff);
    const recovered = loadArtifactWorkbenchRecovery("owner@example.com", opened.state, "trial");
    assert.ok(recovered);
    assert.notEqual(recovered.priorTab.workspace.secondary?.view, "clientdata");
    assert.deepEqual(returnFromArtifactWorkbench(opened.state, recovered, context, false)?.state.tabs[0].workspace,
      recovered.priorTab.workspace);
  });
});
