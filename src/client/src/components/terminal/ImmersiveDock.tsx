import { useEffect, useState } from "react";
import { BookMarked, Boxes, BrainCircuit, Database, Focus, GitBranch, LayoutGrid, Pin, Radar } from "lucide-react";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { loadResearchTray, pinResearchContext, saveResearchTray, subscribeResearchTray } from "@/lib/terminalResearchTray";
import type { TerminalUxPreferences } from "@/lib/terminalUxPreferences";
import type { TerminalUxSurface } from "@/lib/terminalUxEvents";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  activeView: ViewMode;
  activeSymbol?: string;
  preferences: TerminalUxPreferences;
  isInternal?: boolean;
  onOpenSurface: (surface: TerminalUxSurface) => void;
  onToggleFocus: () => void;
}

export default function ImmersiveDock({ activeView, activeSymbol, preferences, onOpenSurface, onToggleFocus }: Props) {
  const capability = getTerminalCapability(activeView);
  const [trayCount, setTrayCount] = useState(() => loadResearchTray().length);
  const [justPinned, setJustPinned] = useState(false);
  const hasActiveObject = Boolean(activeSymbol && capability.symbolAware);

  useEffect(() => subscribeResearchTray((items) => setTrayCount(items.length)), []);

  if (preferences.presentationMode || !preferences.showImmersiveDock) return null;

  const pinCurrent = () => {
    const current = loadResearchTray();
    const next = pinResearchContext(current, { view: activeView, symbol: activeSymbol });
    saveResearchTray(next);
    setTrayCount(next.length);
    setJustPinned(true);
    window.setTimeout(() => setJustPinned(false), 900);
  };

  return (
    <nav
      className="lios-immersive-dock lios-v5-command-dock"
      aria-label="LiOS active-object analysis dock"
      data-object-context={hasActiveObject ? "true" : "false"}
    >
      <button
        className="lios-dock-context"
        onClick={() => onOpenSurface("cognitive-core")}
        title="Open active analytical context"
        aria-label={hasActiveObject ? `Open ${activeSymbol} ${capability.label} analytical context` : `Open ${capability.label} analytical context`}
      >
        {hasActiveObject ? <><span className="lios-dock-symbol">{activeSymbol}</span><span className="mx-1.5 text-muted-foreground/45">·</span></> : null}
        <span>{capability.label}</span>
      </button>

      <div className="h-5 w-px bg-border/55" aria-hidden="true" />

      <button
        className={`lios-dock-action lios-dock-expand ${preferences.focusMode ? "text-amber-200" : ""}`}
        onClick={onToggleFocus}
        title={preferences.focusMode ? "Restore terminal chrome" : "Expand analytical canvas"}
        aria-label={preferences.focusMode ? "Restore terminal chrome" : "Expand analytical canvas"}
        aria-pressed={preferences.focusMode}
      >
        <Focus className="h-3 w-3" />
        <span>{preferences.focusMode ? "RESTORE" : "EXPAND"}</span>
      </button>

      <div className="h-5 w-px bg-border/55" aria-hidden="true" />

      <button className="lios-dock-action" onClick={() => onOpenSurface("cognitive-core")} title="Lenses, scenarios, objects and outcome use cases" aria-label="Core analysis"><Boxes className="h-3 w-3 text-[hsl(38,100%,58%)]" /> <span className="hidden sm:inline">Core</span></button>
      <button className="lios-dock-action" onClick={() => onOpenSurface("intelligence-pulse")} title="What changed, what matters, and what needs attention" aria-label="Open Pulse"><Radar className="h-3 w-3 text-[hsl(38,100%,58%)]" /> <span className="hidden md:inline">Pulse</span></button>
      <button className="lios-dock-action" onClick={() => onOpenSurface("scenario-workbench")} title="Branch and explicitly apply scenarios to model assumptions" aria-label="Scenario workbench"><GitBranch className="h-3 w-3 text-[hsl(38,100%,58%)]" /> <span className="hidden xl:inline">Scenario</span></button>

      <div className="h-5 w-px bg-border/55" aria-hidden="true" />

      <button className="lios-dock-action" onClick={() => onOpenSurface("object-workbench")} title="Inspect, drag and send reusable intelligence objects" aria-label="Object workbench"><Boxes className="h-3 w-3 text-cyan-300/80" /> <span className="hidden xl:inline">Objects</span></button>

      <div className="h-5 w-px bg-border/55" aria-hidden="true" />

      <button className="lios-dock-action" onClick={() => onOpenSurface("workspace-composer")} title="Compose a multi-pane workspace from intelligence objects" aria-label="Workspace composer"><LayoutGrid className="h-3 w-3" /> <span className="hidden 2xl:inline">Compose</span></button>
      <button className={`lios-dock-action ${justPinned ? "text-amber-200" : ""}`} onClick={pinCurrent} title="Pin current analysis to Research Tray" aria-label={justPinned ? "Analysis pinned" : "Pin current analysis"}><Pin className="h-3 w-3" /> <span className="hidden lg:inline">{justPinned ? "Pinned" : "Pin"}</span></button>
      <button className="lios-dock-action" onClick={() => onOpenSurface("research-tray")} title="Open Research Tray" aria-label={`Open research tray${trayCount > 0 ? `, ${trayCount} pinned items` : ""}`}><BookMarked className="h-3 w-3 text-amber-300/85" /> <span className="hidden lg:inline">Research</span>{trayCount > 0 && <span className="lios-pane-code rounded-full border border-border/60 bg-black/20 px-1.5 py-0.5 text-[6px] text-muted-foreground">{trayCount}</span>}</button>
      <button className="lios-dock-action" onClick={() => onOpenSurface("innovation-studio")} title="Storyline, compare, thesis, canvas and replay" aria-label="Innovation studio"><BrainCircuit className="h-3 w-3 text-fuchsia-300/85" /> <span className="hidden 2xl:inline">Studio</span></button>
      <button className="lios-dock-action" onClick={() => onOpenSurface("evidence")} title="Evidence and calculation receipts" aria-label="Evidence and calculation receipts"><Database className="h-3 w-3 text-cyan-300/80" /> <span className="hidden 2xl:inline">Evidence</span></button>
    </nav>
  );
}
