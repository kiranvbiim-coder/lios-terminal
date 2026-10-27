import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DockviewDefaultTab,
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import WorkspacePane from "./WorkspacePane";
import ProfessionalWorkspaceGrid from "./ProfessionalWorkspaceGrid";
import type { PaneId, PaneState, WorkspaceState } from "@/lib/terminalTypes";
import { getWorkspacePane, getWorkspacePanes } from "@/lib/terminalWorkspace";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import type { TerminalDensity } from "@/lib/terminalUxPreferences";
import {
  loadDockviewLayoutState,
  requestDockviewLayoutRestore,
  saveDockviewLayoutState,
  subscribeDockviewLayoutRestore,
  resolveWorkspaceRendererState,
  type DockviewLayoutState,
} from "@/lib/dockviewWorkspaceState";

interface Props {
  /** Original Terminal tab owns geometry, not just the currently rendered pane set. */
  layoutScope: string;
  workspace: WorkspaceState;
  isMobile: boolean;
  preserveArtifactDraft?: boolean;
  maximizedPane: PaneId | null;
  onFocus: (paneId: PaneId) => void;
  onClose: (paneId: PaneId) => void;
  onToggleMaximize: (paneId: PaneId) => void;
  onOpenActions: (paneId: PaneId, pane: PaneState, x: number, y: number) => void;
  renderPane: (paneId: PaneId, pane: PaneState) => ReactNode;
  density: TerminalDensity;
}

type RuntimeContextValue = Props;
const RuntimeContext = createContext<RuntimeContextValue | null>(null);

function LiOSDockviewTab(props: IDockviewPanelHeaderProps) {
  // Dockview owns geometry only. LiOS WorkspacePane owns close semantics so
  // drag/drop lifecycle events can never delete canonical LiOS pane state.
  return <DockviewDefaultTab {...props} hideClose />;
}

function isPaneId(value: unknown): value is PaneId {
  return value === "primary" || value === "secondary" || value === "tertiary" || value === "quaternary";
}

function panelTitle(pane: PaneState): string {
  const capability = getTerminalCapability(pane.view);
  return capability.shortLabel + (capability.symbolAware && pane.symbol ? " · " + pane.symbol : "");
}

function DockviewPane({ params }: IDockviewPanelProps<{ paneId?: string }>) {
  const runtime = useContext(RuntimeContext);
  const paneId = params?.paneId;
  if (!runtime || !isPaneId(paneId)) return null;
  const pane = getWorkspacePane(runtime.workspace, paneId);
  if (!pane) return null;
  const paneCount = getWorkspacePanes(runtime.workspace).length;

  return (
    <WorkspacePane
      paneId={paneId}
      pane={pane}
      focused={runtime.workspace.focusedPane === paneId}
      canClose={paneId !== "primary"}
      compactChrome={paneCount > 1}
      paneCount={paneCount}
      density={runtime.density}
      onFocus={() => runtime.onFocus(paneId)}
      onClose={paneId !== "primary" ? () => runtime.onClose(paneId) : undefined}
      isMaximized={runtime.maximizedPane === paneId}
      onToggleMaximize={() => runtime.onToggleMaximize(paneId)}
      onOpenActions={(x, y) => runtime.onOpenActions(paneId, pane, x, y)}
    >
      {runtime.renderPane(paneId, pane)}
    </WorkspacePane>
  );
}

function addPane(api: DockviewApi, paneId: PaneId, pane: PaneState, present: Set<string>) {
  if (present.has(paneId)) return;
  const position =
    paneId === "secondary" && present.has("primary")
      ? { referencePanel: "primary", direction: "right" as const }
      : paneId === "tertiary" && present.has("secondary")
        ? { referencePanel: "secondary", direction: "below" as const }
        : paneId === "tertiary" && present.has("primary")
          ? { referencePanel: "primary", direction: "below" as const }
          : paneId === "quaternary" && present.has("primary")
            ? { referencePanel: "primary", direction: "below" as const }
            : undefined;

  api.addPanel({
    id: paneId,
    component: "liosPane",
    title: panelTitle(pane),
    params: { paneId },
    ...(position ? { position } : {}),
  });
  present.add(paneId);
}

function syncWorkspace(api: DockviewApi, workspace: WorkspaceState, suppress: { current: boolean }) {
  suppress.current = true;
  try {
    const desired = getWorkspacePanes(workspace);
    const desiredIds = new Set(desired.map(({ id }) => id));

    for (const panel of [...api.panels]) {
      if (!desiredIds.has(panel.id as PaneId)) api.removePanel(panel);
    }

    const present = new Set(api.panels.map((panel) => panel.id));
    for (const { id, pane } of desired) addPane(api, id, pane, present);

    for (const { id, pane } of desired) {
      const panel = api.getPanel(id);
      if (!panel) continue;
      panel.api.updateParameters({ paneId: id });
      panel.api.setTitle(panelTitle(pane));
    }

    api.getPanel(workspace.focusedPane)?.api.setActive();
  } finally {
    suppress.current = false;
  }
}

export default function DockviewWorkspaceGrid(props: Props) {
  const apiRef = useRef<DockviewApi | null>(null);
  const [layoutNotice, setLayoutNotice] = useState("");
  useEffect(() => setLayoutNotice(""), [props.layoutScope]);
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;
  const suppressSyncRef = useRef(false);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const layoutSaveTimer = useRef<number | null>(null);
  const pendingLayout = useRef<{ layout: DockviewLayoutState; scope: string } | null>(null);
  const currentLayoutScope = useRef(props.layoutScope);
  const rendererState = useRef({ isMobile: props.isMobile, maximizedPane: props.maximizedPane });
  rendererState.current = resolveWorkspaceRendererState(rendererState.current, props.isMobile, props.maximizedPane, props.preserveArtifactDraft ?? false);
  const runtimeValue = useMemo<RuntimeContextValue>(() => props, [props]);
  const components = useMemo(() => ({ liosPane: DockviewPane }), []);

  const persistLayout = useCallback((api: DockviewApi) => {
    if (suppressSyncRef.current || typeof window === "undefined") return;
    const layout = api.toJSON() as unknown;
    if (!layout || typeof layout !== "object" || Array.isArray(layout)) return;
    const pending = { layout: layout as DockviewLayoutState, scope: currentLayoutScope.current };
    pendingLayout.current = pending;
    if (layoutSaveTimer.current !== null) window.clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = window.setTimeout(() => {
      if (pendingLayout.current === pending) {
        saveDockviewLayoutState(pending.layout, pending.scope);
        pendingLayout.current = null;
      }
      layoutSaveTimer.current = null;
    }, 120);
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    currentLayoutScope.current = latestPropsRef.current.layoutScope;
    suppressSyncRef.current = true;
    try {
      const saved = loadDockviewLayoutState(currentLayoutScope.current);
      if (saved) {
        try {
          event.api.fromJSON(saved as any);
        } catch {
          saveDockviewLayoutState(null, currentLayoutScope.current);
          event.api.clear();
        }
      }
      syncWorkspace(event.api, latestPropsRef.current.workspace, suppressSyncRef);
    } finally {
      suppressSyncRef.current = false;
    }

    disposablesRef.current.forEach((item) => item.dispose());
    disposablesRef.current = [
      event.api.onDidLayoutChange(() => persistLayout(event.api)),
      event.api.onDidActivePanelChange((change) => {
        if (suppressSyncRef.current || change.origin !== "user" || !change.panel || !isPaneId(change.panel.id)) return;
        latestPropsRef.current.onFocus(change.panel.id);
      }),
    ];
  }, [persistLayout]);

  // A tab switch retains the outgoing geometry *before* projecting the next
  // tab's semantic panes. A late debounced drag can never overwrite the new tab.
  useEffect(() => {
    if (currentLayoutScope.current === props.layoutScope) return;
    const previousScope = currentLayoutScope.current;
    const api = apiRef.current;
    if (layoutSaveTimer.current !== null && typeof window !== "undefined") {
      window.clearTimeout(layoutSaveTimer.current);
      layoutSaveTimer.current = null;
    }
    if (api) {
      try {
        const outgoing = api.toJSON() as unknown;
        if (outgoing && typeof outgoing === "object" && !Array.isArray(outgoing)) {
          saveDockviewLayoutState(outgoing as DockviewLayoutState, previousScope);
        }
      } catch {
        if (pendingLayout.current?.scope === previousScope) {
          saveDockviewLayoutState(pendingLayout.current.layout, previousScope);
        }
      }
    }
    pendingLayout.current = null;
    currentLayoutScope.current = props.layoutScope;
    if (!api) return;
    suppressSyncRef.current = true;
    try {
      api.clear();
      const layout = loadDockviewLayoutState(props.layoutScope);
      if (layout) api.fromJSON(layout as any);
      syncWorkspace(api, latestPropsRef.current.workspace, suppressSyncRef);
    } catch {
      api.clear();
      saveDockviewLayoutState(null, props.layoutScope);
      syncWorkspace(api, latestPropsRef.current.workspace, suppressSyncRef);
    } finally {
      suppressSyncRef.current = false;
    }
  }, [props.layoutScope]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    syncWorkspace(api, props.workspace, suppressSyncRef);
  }, [props.workspace]);

  useEffect(() => subscribeDockviewLayoutRestore((layout, scope) => {
    if (scope !== undefined && scope !== currentLayoutScope.current) return;
    const api = apiRef.current;
    if (!api) return;
    if (layoutSaveTimer.current !== null) { window.clearTimeout(layoutSaveTimer.current); layoutSaveTimer.current = null; }
    pendingLayout.current = null;
    suppressSyncRef.current = true;
    try {
      api.clear();
      if (layout) api.fromJSON(layout as any);
      syncWorkspace(api, latestPropsRef.current.workspace, suppressSyncRef);
    } catch {
      api.clear();
      saveDockviewLayoutState(null, currentLayoutScope.current);
      syncWorkspace(api, latestPropsRef.current.workspace, suppressSyncRef);
    } finally {
      suppressSyncRef.current = false;
    }
  }), []);

  useEffect(() => () => {
    disposablesRef.current.forEach((item) => item.dispose());
    disposablesRef.current = [];
    if (layoutSaveTimer.current !== null && typeof window !== "undefined") {
      window.clearTimeout(layoutSaveTimer.current);
      // Leaving Chat/Workbench must retain the last drag, even inside the debounce window.
      if (pendingLayout.current) {
        saveDockviewLayoutState(pendingLayout.current.layout, pendingLayout.current.scope);
        pendingLayout.current = null;
      }
    }
  }, []);

  const saveCurrentArrangement = () => {
    const api = apiRef.current;
    if (!api) { setLayoutNotice("Pane layout is not available yet."); return; }
    try {
      const layout = api.toJSON() as unknown;
      if (!layout || typeof layout !== "object" || Array.isArray(layout)) throw new Error("Invalid layout");
      saveDockviewLayoutState(layout as DockviewLayoutState, props.layoutScope);
      const saved = loadDockviewLayoutState(props.layoutScope);
      setLayoutNotice(saved && JSON.stringify(saved) === JSON.stringify(layout)
        ? "Pane arrangement saved for this workspace tab."
        : "Layout storage could not be verified. Current panes remain unchanged.");
    } catch {
      setLayoutNotice("Could not save pane arrangement. Existing workspace content is unchanged.");
    }
  };
  const restoreDefaultArrangement = () => {
    // Geometry reset can remount views: refuse it while an Artifact draft is dirty.
    if (props.preserveArtifactDraft) {
      setLayoutNotice("Save or discard your Artifact draft before resetting pane geometry.");
      return;
    }
    requestDockviewLayoutRestore(null, props.layoutScope);
    setLayoutNotice("Default pane arrangement requested for this workspace tab.");
  };

  if (rendererState.current.isMobile || rendererState.current.maximizedPane) {
    return <ProfessionalWorkspaceGrid {...props} isMobile={rendererState.current.isMobile} maximizedPane={rendererState.current.maximizedPane} />;
  }

  return (
    <RuntimeContext.Provider value={runtimeValue}>
      <div className="lios-dockview-workspace flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#050505]" data-workspace-engine="dockview">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border/55 bg-background/70 px-3 py-1">
          <span role="status" aria-live="polite" className="min-w-0 flex-1 truncate font-ui text-xs text-muted-foreground">
            {layoutNotice || "Drag pane tabs to arrange, or save this tab's geometry."}
          </span>
          <div role="group" aria-label="Workbench pane arrangement" className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveCurrentArrangement}
              className="min-h-11 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
              Save layout
            </button>
            <button type="button" onClick={restoreDefaultArrangement} disabled={Boolean(props.preserveArtifactDraft)}
              title={props.preserveArtifactDraft ? "Save or discard unsaved Artifact edits before resetting" : "Reset only this tab's pane geometry"}
              className="min-h-11 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-40">
              Default layout
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
        <DockviewReact
          theme={themeDark}
          components={components}
          defaultTabComponent={LiOSDockviewTab}
          onReady={onReady}
          disableFloatingGroups
          floatingGroupBounds="boundedWithinViewport"
        />
        </div>
      </div>
    </RuntimeContext.Provider>
  );
}
