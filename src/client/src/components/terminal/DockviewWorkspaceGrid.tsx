import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  saveDockviewLayoutState,
  subscribeDockviewLayoutRestore,
  type DockviewLayoutState,
} from "@/lib/dockviewWorkspaceState";

interface Props {
  workspace: WorkspaceState;
  isMobile: boolean;
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
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;
  const suppressSyncRef = useRef(false);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const layoutSaveTimer = useRef<number | null>(null);
  const runtimeValue = useMemo<RuntimeContextValue>(() => props, [props]);
  const components = useMemo(() => ({ liosPane: DockviewPane }), []);

  const persistLayout = useCallback((api: DockviewApi) => {
    if (suppressSyncRef.current || typeof window === "undefined") return;
    if (layoutSaveTimer.current !== null) window.clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = window.setTimeout(() => {
      const layout = api.toJSON() as unknown;
      if (layout && typeof layout === "object" && !Array.isArray(layout)) {
        saveDockviewLayoutState(layout as DockviewLayoutState);
      }
    }, 120);
  }, []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    suppressSyncRef.current = true;
    try {
      const saved = loadDockviewLayoutState();
      if (saved) {
        try {
          event.api.fromJSON(saved as any);
        } catch {
          saveDockviewLayoutState(null);
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

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    syncWorkspace(api, props.workspace, suppressSyncRef);
  }, [props.workspace]);

  useEffect(() => subscribeDockviewLayoutRestore((layout) => {
    const api = apiRef.current;
    if (!api) return;
    suppressSyncRef.current = true;
    try {
      api.clear();
      if (layout) api.fromJSON(layout as any);
      syncWorkspace(api, latestPropsRef.current.workspace, suppressSyncRef);
    } catch {
      api.clear();
      saveDockviewLayoutState(null);
      syncWorkspace(api, latestPropsRef.current.workspace, suppressSyncRef);
    } finally {
      suppressSyncRef.current = false;
    }
  }), []);

  useEffect(() => () => {
    disposablesRef.current.forEach((item) => item.dispose());
    disposablesRef.current = [];
    if (layoutSaveTimer.current !== null && typeof window !== "undefined") window.clearTimeout(layoutSaveTimer.current);
  }, []);

  if (props.isMobile || props.maximizedPane) {
    return <ProfessionalWorkspaceGrid {...props} />;
  }

  return (
    <RuntimeContext.Provider value={runtimeValue}>
      <div className="lios-dockview-workspace h-full min-h-0 min-w-0 overflow-hidden bg-[#050505]" data-workspace-engine="dockview">
        <DockviewReact
          theme={themeDark}
          components={components}
          defaultTabComponent={LiOSDockviewTab}
          onReady={onReady}
          disableFloatingGroups
          floatingGroupBounds="boundedWithinViewport"
        />
      </div>
    </RuntimeContext.Provider>
  );
}
