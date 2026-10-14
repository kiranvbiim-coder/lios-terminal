import { isAnalyticalWorkspaceStateV2, type AnalyticalSnapshotTab, type AnalyticalWorkspaceStateV2 } from "@shared/analyticalWorkspaceState";
import type { WorkspaceAudience } from "./featureRegistry";
import { TERMINAL_CAPABILITIES } from "./terminalCatalog";
import { loadPaneAnalyticalState, restorePaneAnalyticalStates } from "./terminalAnalyticalState";
import type { ViewMode, WorkspaceState } from "./terminalTypes";
import { activeTerminalTab, getTerminalTabLinkScopes, loadRememberedAnalyticalTabs, loadTerminalTabs, saveTerminalTabs, type TerminalTab, type TerminalTabsState } from "./terminalTabs";
import { loadTerminalTimeContext, saveTerminalTimeContext, type TerminalTimeContext } from "./terminalTimeTravel";
import { loadTerminalViewState, restoreTerminalViewStates } from "./terminalViewState";

import { getWorkspacePane, getWorkspacePanes, isWorkspaceState, sanitizeWorkspaceForAudience, saveActiveWorkspace } from "./terminalWorkspace";

const REMEMBERED_STATE_KEY = "lios-remembered-analytical-workspace-v2";
const RESTORE_EVENT = "lios:analytical-workspace-restored";
const MANAGEMENT_VIEWS = new Set(["workspaces", "environment"]);

function snapshotTab(tab: TerminalTab): AnalyticalSnapshotTab {
  return {
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
    entity: tab.entity,
    groupId: tab.groupId,
    linkGroupId: tab.linkGroupId ?? null,
    linkScopes: getTerminalTabLinkScopes(tab),
    pinned: tab.pinned,
    workspace: tab.workspace,
  };
}

function collectPaneState(tabsState: TerminalTabsState) {
  const paneStates = new Map<string, AnalyticalWorkspaceStateV2["paneStates"][number]>();
  const viewStates = new Map<string, NonNullable<AnalyticalWorkspaceStateV2["viewStates"]>[number]>();

  for (const tab of tabsState.tabs) {
    if (!isWorkspaceState(tab.workspace)) continue;
    for (const { id, pane } of getWorkspacePanes(tab.workspace)) {
      const analyticalState = loadPaneAnalyticalState(id, pane.view, pane.symbol);
      paneStates.set(`${id}:${pane.view}:${pane.symbol}`, {
        paneId: id,
        view: pane.view,
        symbol: pane.symbol,
        zoom: analyticalState.zoom,
        attention: analyticalState.attention,
        compareArmed: analyticalState.compareArmed,
      });

      const viewState = loadTerminalViewState(pane.view, pane.symbol);
      if (Object.keys(viewState).length) {
        // Workstation view state is keyed by view+symbol at runtime. Keep one
        // canonical snapshot entry even when multiple tabs expose that same view.
        viewStates.set(`${pane.view}:${pane.symbol}`, {
          paneId: id,
          view: pane.view,
          symbol: pane.symbol,
          state: viewState,
        });
      }
    }
  }

  return {
    paneStates: Array.from(paneStates.values()),
    viewStates: Array.from(viewStates.values()),
  };
}

function buildState(tabsState: TerminalTabsState, timeContext: TerminalTimeContext): AnalyticalWorkspaceStateV2 | null {
  const active = activeTerminalTab(tabsState);
  if (!isWorkspaceState(active.workspace)) return null;
  const tabs = tabsState.tabs.filter((tab) => isWorkspaceState(tab.workspace)).map(snapshotTab);
  if (!tabs.length) return null;
  const activeTabIndex = Math.max(0, tabsState.tabs.findIndex((tab) => tab.id === active.id));
  const safeActiveIndex = Math.min(activeTabIndex, tabs.length - 1);
  const shellState = collectPaneState(tabsState);

  return {
    version: 2,
    capturedAt: new Date().toISOString(),
    activeTab: tabs[safeActiveIndex],
    tabs,
    activeTabIndex: safeActiveIndex,
    paneStates: shellState.paneStates,
    viewStates: shellState.viewStates,
    timeContext,
  };
}

function readRemembered(): AnalyticalWorkspaceStateV2 | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(REMEMBERED_STATE_KEY) || "null");
    return isAnalyticalWorkspaceStateV2(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Remember the last real analytical context before the user enters a management
 * surface such as Workspaces. This lets SNAPSHOT NOW capture the analysis that
 * led to the checkpoint rather than accidentally snapshotting the Workspaces UI.
 */
export function rememberAnalyticalWorkspaceState(tabsState: TerminalTabsState, timeContext: TerminalTimeContext): void {
  if (typeof window === "undefined") return;
  const active = activeTerminalTab(tabsState);
  const focused = getWorkspacePane(active.workspace, active.workspace.focusedPane) ?? active.workspace.primary;
  if (MANAGEMENT_VIEWS.has(focused.view)) return;
  const snapshot = buildState(tabsState, timeContext);
  if (!snapshot) return;
  try {
    sessionStorage.setItem(REMEMBERED_STATE_KEY, JSON.stringify(snapshot));
  } catch {
    // Session storage can be unavailable in privacy-restricted contexts.
  }
}

/** Capture the current analytical shell. Management surfaces resolve back to
 * the last persisted analytical tab state so checkpoints never save the
 * Workspaces/Environment UI in place of the analysis the user intended. */
export function captureAnalyticalWorkspaceState(audience: WorkspaceAudience = "internal"): AnalyticalWorkspaceStateV2 | null {
  const tabsState = loadTerminalTabs(audience);
  const active = activeTerminalTab(tabsState);
  const focused = getWorkspacePane(active.workspace, active.workspace.focusedPane) ?? active.workspace.primary;
  const timeContext = loadTerminalTimeContext();

  if (MANAGEMENT_VIEWS.has(focused.view)) {
    const rememberedState = readRemembered();
    if (rememberedState) return rememberedState;
    const rememberedTabs = loadRememberedAnalyticalTabs(audience);
    return rememberedTabs ? buildState(rememberedTabs, timeContext) : null;
  }
  return buildState(tabsState, timeContext);
}

let restoreSequence = 0;

function restoredTabId(index: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `snapshot-tab-${Date.now()}-${index}-${restoreSequence++}`;
}

function restoreTab(snapshot: AnalyticalSnapshotTab, audience: WorkspaceAudience, index: number): TerminalTab {
  const timestamp = Date.now();
  return {
    id: snapshot.id ?? restoredTabId(index),
    title: snapshot.title,
    kind: snapshot.kind,
    workspace: sanitizeWorkspaceForAudience(snapshot.workspace as WorkspaceState, audience),
    entity: snapshot.entity,
    groupId: snapshot.groupId,
    linkGroupId: snapshot.linkGroupId,
    linkScopes: snapshot.linkScopes ?? ["instrument"],
    pinned: snapshot.pinned ?? false,
    preview: false,
    dirty: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function isTerminalView(value: string): value is ViewMode {
  return TERMINAL_CAPABILITIES.some((capability) => capability.view === value);
}

function workspaceMatchesPaneState(workspaces: WorkspaceState[], paneId: AnalyticalWorkspaceStateV2["paneStates"][number]["paneId"], view: string, symbol: string): boolean {
  return workspaces.some((workspace) => {
    const pane = getWorkspacePane(workspace, paneId);
    return Boolean(pane && pane.view === view && pane.symbol === symbol);
  });
}

/**
 * Apply a saved analytical shell. New V2 checkpoints replace the whole tab strip
 * and restore the captured active tab; early V2 checkpoints keep their historical
 * behavior and only replace the currently active tab. Models/imports/scenarios
 * remain referenced records rather than duplicated snapshot payloads.
 */
export function restoreAnalyticalWorkspaceState(
  value: unknown,
  audience: WorkspaceAudience = "internal",
): boolean {
  if (typeof window === "undefined" || !isAnalyticalWorkspaceStateV2(value)) return false;
  if (!isWorkspaceState(value.activeTab.workspace)) return false;

  const current = loadTerminalTabs(audience);
  let next: TerminalTabsState;

  if (value.tabs?.length) {
    const restoredTabs = value.tabs.map((tab, index) => restoreTab(tab, audience, index));
    const activeIndex = value.activeTabIndex ?? 0;
    next = {
      tabs: restoredTabs,
      activeTabId: restoredTabs[activeIndex]?.id ?? restoredTabs[0].id,
      closedTabs: [],
    };
  } else {
    const workspace: WorkspaceState = sanitizeWorkspaceForAudience(value.activeTab.workspace as WorkspaceState, audience);
    const timestamp = Date.now();
    next = {
      ...current,
      tabs: current.tabs.map((tab) => tab.id === current.activeTabId ? {
        ...tab,
        title: value.activeTab.title,
        kind: value.activeTab.kind,
        entity: value.activeTab.entity,
        groupId: value.activeTab.groupId,
        linkGroupId: value.activeTab.linkGroupId,
        linkScopes: value.activeTab.linkScopes ?? ["instrument"],
        pinned: value.activeTab.pinned ?? tab.pinned,
        workspace,
        preview: false,
        dirty: false,
        updatedAt: timestamp,
      } : tab),
    };
  }

  const restoredWorkspaces = next.tabs.map((tab) => tab.workspace);
  const restoredActive = activeTerminalTab(next);
  saveTerminalTabs(next);
  saveActiveWorkspace(restoredActive.workspace);

  restorePaneAnalyticalStates(value.paneStates.flatMap((entry) => {
    if (!isTerminalView(entry.view) || !workspaceMatchesPaneState(restoredWorkspaces, entry.paneId, entry.view, entry.symbol)) return [];
    return [{
      paneId: entry.paneId,
      view: entry.view,
      symbol: entry.symbol,
      state: { zoom: entry.zoom, attention: entry.attention, compareArmed: entry.compareArmed },
    }];
  }));
  restoreTerminalViewStates((value.viewStates ?? []).flatMap((entry) => {
    if (!workspaceMatchesPaneState(restoredWorkspaces, entry.paneId, entry.view, entry.symbol)) return [];
    return [{ view: entry.view, symbol: entry.symbol, state: entry.state }];
  }));
  saveTerminalTimeContext(value.timeContext);
  window.dispatchEvent(new CustomEvent(RESTORE_EVENT, { detail: { version: value.version, tabCount: next.tabs.length } }));
  return true;
}

export function subscribeAnalyticalWorkspaceRestore(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(RESTORE_EVENT, handler);
  return () => window.removeEventListener(RESTORE_EVENT, handler);
}
