import { type ReactNode } from "react";
import WorkspacePane from "./WorkspacePane";
import type { PaneId, PaneState, WorkspaceState } from "@/lib/terminalTypes";
import { getWorkspacePane, getWorkspacePanes } from "@/lib/terminalWorkspace";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import type { TerminalDensity } from "@/lib/terminalUxPreferences";

interface Props {
  workspace: WorkspaceState;
  isMobile: boolean;
  maximizedPane: PaneId | null;
  onFocus: (paneId: PaneId) => void;
  onClose: (paneId: PaneId) => void;
  onToggleMaximize: (paneId: PaneId) => void;
  onOpenActions: (paneId: PaneId, pane: PaneState, x: number, y: number) => void;
  renderPane: (paneId: PaneId, pane: PaneState) => ReactNode;
  onAskLios?: (question: string, pane: PaneState) => void;
  density: TerminalDensity;
}

const PANE_CLASS = "min-h-0 min-w-0 overflow-hidden bg-[#050505]";

export default function ProfessionalWorkspaceGrid({ workspace, isMobile, maximizedPane, onFocus, onClose, onToggleMaximize, onOpenActions, onAskLios, renderPane, density }: Props) {
  const panes = getWorkspacePanes(workspace);
  const visiblePaneCount = maximizedPane ? 1 : panes.length;
  const compactChrome = visiblePaneCount > 1;

  const paneNode = (paneId: PaneId, pane: PaneState, canClose = paneId !== "primary") => (
    <WorkspacePane
      paneId={paneId}
      pane={pane}
      focused={workspace.focusedPane === paneId}
      canClose={canClose}
      compactChrome={compactChrome}
      paneCount={visiblePaneCount}
      density={density}
      onFocus={() => onFocus(paneId)}
      onClose={canClose ? () => onClose(paneId) : undefined}
      isMaximized={maximizedPane === paneId}
      onToggleMaximize={() => onToggleMaximize(paneId)}
      onOpenActions={(x, y) => onOpenActions(paneId, pane, x, y)}
      onAskLios={onAskLios}
    >
      {renderPane(paneId, pane)}
    </WorkspacePane>
  );

  if (maximizedPane) {
    const pane = getWorkspacePane(workspace, maximizedPane);
    return <div className="h-full min-h-0 min-w-0 overflow-hidden">{pane ? paneNode(maximizedPane, pane) : paneNode("primary", workspace.primary, false)}</div>;
  }

  if (panes.length <= 1) return <div className="h-full min-h-0 min-w-0 overflow-hidden">{paneNode("primary", workspace.primary, false)}</div>;

  // On narrow screens, squeezing 2–4 full analytical surfaces into the same
  // viewport makes every pane unusable. Keep all panes accessible, but show one
  // at a time behind a compact switcher so charts/tables retain a workable area.
  if (isMobile) {
    const focused = panes.find(({ id }) => id === workspace.focusedPane) ?? panes[0];
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-workspace-layout="mobile-focus">
        <nav className="lios-mobile-pane-switcher flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-[#080808] px-1.5" aria-label="Workspace panes">
          {panes.map(({ id, pane }) => {
            const capability = getTerminalCapability(pane.view);
            const active = id === focused.id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onFocus(id)}
                className={`min-w-0 shrink-0 border px-2 py-1 text-[8px] font-semibold tracking-wide ${active ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-200" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"}`}
                aria-current={active ? "page" : undefined}
                title={`${capability.label}${pane.symbol ? ` · ${pane.symbol}` : ""}`}
              >
                <span className="max-w-28 truncate">{capability.shortLabel}{pane.symbol ? ` · ${pane.symbol}` : ""}</span>
              </button>
            );
          })}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{paneNode(focused.id, focused.pane)}</div>
      </div>
    );
  }

  // DockviewWorkspaceGrid is the canonical resizable/dockable workspace. This
  // component remains a dependency-free legacy/fallback renderer so LiOS does
  // not ship a second competing resize/layout runtime.
  if (panes.length === 2) {
    const [first, second] = panes;
    return (
      <div className="grid h-full min-h-0 min-w-0 gap-px overflow-hidden bg-border" style={{ gridTemplateColumns: "minmax(0, 55fr) minmax(0, 45fr)" }} data-workspace-layout="fallback-2">
        <div className={PANE_CLASS}>{paneNode(first.id, first.pane)}</div>
        <div className={PANE_CLASS}>{paneNode(second.id, second.pane)}</div>
      </div>
    );
  }

  if (panes.length === 3) {
    const [primary, secondary, tertiary] = panes;
    return (
      <div className="grid h-full min-h-0 min-w-0 gap-px overflow-hidden bg-border" style={{ gridTemplateColumns: "minmax(0, 56fr) minmax(0, 44fr)" }} data-workspace-layout="fallback-3">
        <div className={PANE_CLASS}>{paneNode(primary.id, primary.pane)}</div>
        <div className="grid min-h-0 min-w-0 gap-px overflow-hidden bg-border" style={{ gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)" }}>
          <div className={PANE_CLASS}>{paneNode(secondary.id, secondary.pane)}</div>
          <div className={PANE_CLASS}>{paneNode(tertiary.id, tertiary.pane)}</div>
        </div>
      </div>
    );
  }

  const [primary, secondary, tertiary, quaternary] = panes;
  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden bg-border" data-workspace-layout="fallback-4">
      <div className={PANE_CLASS}>{paneNode(primary.id, primary.pane)}</div>
      <div className={PANE_CLASS}>{paneNode(secondary.id, secondary.pane)}</div>
      <div className={PANE_CLASS}>{paneNode(tertiary.id, tertiary.pane)}</div>
      <div className={PANE_CLASS}>{paneNode(quaternary.id, quaternary.pane)}</div>
    </div>
  );
}
