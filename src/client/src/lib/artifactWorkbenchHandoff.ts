import type { ArtifactWorkbenchContext, PaneId } from "./terminalTypes";
import { activeTerminalTab } from "./terminalTabs";
import type { TerminalTab, TerminalTabsState } from "./terminalTabs";
import type { DockviewLayoutState } from "./dockviewWorkspaceState";

export interface ArtifactWorkbenchHandoff {
  context: ArtifactWorkbenchContext;
  priorTab: TerminalTab;
  priorLayout: DockviewLayoutState | null;
  priorMaximizedPane: PaneId | null;
}

export interface ArtifactWorkbenchRevisionSelection {
  requestedVersion: number | null;
  displayedVersion: number;
  loading: boolean;
}
type RevisionSelectionEvent =
  | { type: "select"; version: number | null }
  | { type: "loaded"; version: number }
  | { type: "context"; version: number; dirty: boolean };

/** Context is a navigation projection, never permission for a stale observation to undo a local selection. */
export function advanceArtifactWorkbenchRevision(
  current: ArtifactWorkbenchRevisionSelection, event: RevisionSelectionEvent,
): ArtifactWorkbenchRevisionSelection {
  if (event.type === "loaded") {
    if (current.requestedVersion !== null && event.version !== current.requestedVersion) return current;
    return !current.loading && current.displayedVersion === event.version ? current
      : { ...current, displayedVersion: event.version, loading: false };
  }
  if (event.type === "context" && (event.dirty || event.version === current.displayedVersion)) return current;
  return event.version === current.requestedVersion ? current
    : { ...current, requestedVersion: event.version, loading: true };
}

/** The existing navigation owner temporarily projects a P4 reference into its focused pane. */
export function openArtifactWorkbench(
  state: TerminalTabsState,
  context: ArtifactWorkbenchContext,
  priorLayout: DockviewLayoutState | null,
  priorMaximizedPane: PaneId | null,
  dirty: boolean,
): { state: TerminalTabsState; handoff: ArtifactWorkbenchHandoff } | null {
  if (dirty) return null;
  const priorTab = activeTerminalTab(state);
  const paneId = priorTab.workspace.focusedPane;
  const workspace = {
    ...priorTab.workspace,
    [paneId]: { view: "artifact" as const, symbol: "", artifact: { ...context } },
  };
  return {
    state: { ...state, tabs: state.tabs.map(tab => tab.id === priorTab.id ? { ...tab, workspace } : tab) },
    handoff: { context: { ...context }, priorTab, priorLayout, priorMaximizedPane },
  };
}

/** Return never allocates a Chat or rolls back P4 edits; only prior Terminal navigation is restored. */
export function returnFromArtifactWorkbench(
  state: TerminalTabsState,
  handoff: ArtifactWorkbenchHandoff,
  context: ArtifactWorkbenchContext,
  dirty: boolean,
): { state: TerminalTabsState; context: ArtifactWorkbenchContext } | null {
  if (dirty || context.projectId !== handoff.context.projectId || context.chatId !== handoff.context.chatId
    || context.artifactId !== handoff.context.artifactId) return null;
  const paneId = handoff.priorTab.workspace.focusedPane;
  const origin = state.tabs.find(tab => tab.id === handoff.priorTab.id);
  const currentPane = origin?.workspace[paneId];
  // The original tab/pane must still own this exact P4 handoff. Never resurrect
  // a closed tab or overwrite a pane replaced by another Workbench action.
  if (!origin || currentPane?.view !== "artifact"
    || currentPane.artifact?.projectId !== handoff.context.projectId
    || currentPane.artifact?.chatId !== handoff.context.chatId
    || currentPane.artifact?.artifactId !== handoff.context.artifactId) return null;

  // Only undo the temporary navigation projection. Other panes, entity/source
  // choices, tab metadata and analytical work changed in Dockview remain intact;
  // P4 owns the saved Artifact content, assumptions and exact returned revision.
  const workspace = {
    ...origin.workspace,
    [paneId]: handoff.priorTab.workspace[paneId],
    focusedPane: paneId,
  };
  return {
    state: {
      ...state,
      tabs: state.tabs.map(tab => tab.id === origin.id ? { ...tab, workspace } : tab),
      activeTabId: origin.id,
    },
    context: { ...context },
  };
}
