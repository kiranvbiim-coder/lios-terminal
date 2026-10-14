import {
  projectWorkspaceSessionStateSchema,
  type ProjectWorkspaceSessionState,
} from "@shared/projectContracts";
import { captureAnalyticalWorkspaceState, restoreAnalyticalWorkspaceState } from "./analyticalWorkspaceSnapshot";
import type { WorkspaceAudience } from "./featureRegistry";
import { activeTerminalTab, loadTerminalTabs } from "./terminalTabs";
import { getWorkspacePane } from "./terminalWorkspace";
import {
  loadTerminalLinkedContextState,
  saveTerminalLinkedContextState,
} from "./terminalLinkedContextStore";
import { getTerminalCapability } from "./terminalCatalog";
import { loadDockviewLayoutState, requestDockviewLayoutRestore } from "./dockviewWorkspaceState";
import { captureVisualEnvironmentState, restoreVisualEnvironmentState } from "./visualEnvironment";

export function captureProjectWorkspaceSessionState(
  audience: WorkspaceAudience,
  workspaceEngine: "legacy-resizable" | "dockview" = "dockview",
): ProjectWorkspaceSessionState | null {
  if (typeof window === "undefined") return null;
  const analyticalState = captureAnalyticalWorkspaceState(audience);
  if (!analyticalState) return null;

  const tabs = loadTerminalTabs(audience);
  const active = activeTerminalTab(tabs);
  const pane = getWorkspacePane(active.workspace, active.workspace.focusedPane) ?? active.workspace.primary;
  const capability = getTerminalCapability(pane.view);

  return projectWorkspaceSessionStateSchema.parse({
    version: 1,
    workspaceEngine,
    analyticalState,
    dockviewLayout: workspaceEngine === "dockview" ? loadDockviewLayoutState() : null,
    linkedContext: loadTerminalLinkedContextState(),
    focusedObject: {
      kind: "panel",
      id: active.workspace.focusedPane,
      label: capability.label,
      view: pane.view,
      symbol: capability.symbolAware ? pane.symbol : null,
      paneId: active.workspace.focusedPane,
    },
    savedViewName: null,
    visualEnvironment: captureVisualEnvironmentState(),
  });
}

export function restoreProjectWorkspaceSessionState(
  value: unknown,
  audience: WorkspaceAudience,
): boolean {
  if (typeof window === "undefined") return false;
  const parsed = projectWorkspaceSessionStateSchema.safeParse(value);
  if (!parsed.success) return false;
  const restored = restoreAnalyticalWorkspaceState(parsed.data.analyticalState, audience);
  if (!restored) return false;
  saveTerminalLinkedContextState(parsed.data.linkedContext);
  requestDockviewLayoutRestore(parsed.data.workspaceEngine === "dockview" ? parsed.data.dockviewLayout : null);
  if (parsed.data.visualEnvironment) restoreVisualEnvironmentState(parsed.data.visualEnvironment);
  window.dispatchEvent(new CustomEvent("lios:project-session-restored", {
    detail: {
      workspaceEngine: parsed.data.workspaceEngine,
      focusedObject: parsed.data.focusedObject,
    },
  }));
  return true;
}

export function subscribeProjectSessionRestore(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("lios:project-session-restored", listener);
  return () => window.removeEventListener("lios:project-session-restored", listener);
}
