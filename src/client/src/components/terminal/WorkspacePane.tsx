import { useEffect, useState, type ReactNode } from "react";
import { Columns2, Focus, Maximize2, Minimize2, MoreHorizontal, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaneId, PaneState } from "@/lib/terminalTypes";
import type { TerminalDensity } from "@/lib/terminalUxPreferences";
import { resolveFusionPaneTier } from "@/lib/fusionExperience";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { getJourneyForView } from "@/lib/terminalToolGraph";
import { loadPaneAnalyticalState, subscribeAnalyticalState } from "@/lib/terminalAnalyticalState";
import PaneAnalyticalControls from "./PaneAnalyticalControls";
import PaneSemanticSummary from "./PaneSemanticSummary";
import HeroIntelligenceBar from "./HeroIntelligenceBar";
import ObjectIntelligenceFlow from "./ObjectIntelligenceFlow";

interface Props {
  paneId: PaneId;
  pane: PaneState;
  focused: boolean;
  canClose: boolean;
  compactChrome?: boolean;
  paneCount?: number;
  density?: TerminalDensity;
  onFocus: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onOpenActions?: (x: number, y: number) => void;
  /** Stages a Chat draft about this pane; the pane is focused first so the draft uses its view and symbol. */
  onAskLios?: (question: string, pane: PaneState) => void;
  children: ReactNode;
}

export default function WorkspacePane({
  paneId,
  pane,
  focused,
  canClose,
  compactChrome = false,
  paneCount = 1,
  density = "standard",
  onFocus,
  onClose,
  isMaximized = false,
  onToggleMaximize,
  onOpenActions,
  onAskLios,
  children,
}: Props) {
  const capability = getTerminalCapability(pane.view);
  const journey = getJourneyForView(pane.view);
  const operational = pane.view !== "missioncontrol";
  const [analyticalState, setAnalyticalState] = useState(() => loadPaneAnalyticalState(paneId, pane.view, pane.symbol));

  useEffect(() => {
    setAnalyticalState(loadPaneAnalyticalState(paneId, pane.view, pane.symbol));
    return subscribeAnalyticalState(() => setAnalyticalState(loadPaneAnalyticalState(paneId, pane.view, pane.symbol)));
  }, [pane.symbol, pane.view, paneId]);

  // Keep HeroIntelligenceBar mounted because it publishes scenario/evidence
  // context. Operational styling hides its chrome without disabling that
  // analytical plumbing. Mission Control may still show the full guidance UI.
  const showHeroBar = !compactChrome || focused;
  const showObjectFlow = pane.view === "entity" && pane.symbol && (!compactChrome || focused);
  const compactHeader = compactChrome || operational;
  const fusionTier = resolveFusionPaneTier(paneCount, density, isMaximized);

  return (
    <section
      className={cn(
        "lios-v4-surface h-full min-h-0 min-w-0 flex flex-col overflow-hidden border-l transition-shadow",
        focused ? "border-amber-400/25" : "border-border/50",
      )}
      onMouseDown={onFocus}
      onContextMenu={(event) => {
        if (!onOpenActions) return;
        event.preventDefault();
        onFocus();
        onOpenActions(event.clientX, event.clientY);
      }}
      data-testid={`workspace-pane-${paneId}`}
      data-focused={focused ? "true" : "false"}
      data-view={pane.view}
      data-operational={operational ? "true" : "false"}
      data-symbol={capability.symbolAware ? pane.symbol : undefined}
      data-semantic-zoom={analyticalState.zoom}
      data-attention-lens={analyticalState.attention}
      data-pane-compact={compactChrome ? "true" : "false"}
      data-pane-count={paneCount}
      data-fusion-tier={fusionTier}
      data-density={density}
      aria-label={`${capability.label}${pane.symbol ? ` for ${pane.symbol}` : ""}`}
    >
      <header className={cn("lios-pane-header flex shrink-0 items-center overflow-hidden border-b", compactHeader ? "h-7 gap-1.5 px-2" : "h-8 gap-2 px-2.5")}>
        {!operational && !compactChrome && <Columns2 className={`h-3 w-3 shrink-0 ${focused ? "text-amber-300" : "text-muted-foreground/70"}`} />}
        {!operational && !compactChrome && <span className="shrink-0 font-ui text-[8px] font-medium uppercase tracking-[0.16em] text-muted-foreground/75">{paneId}</span>}
        {!operational && !compactChrome && <span className="lios-pane-code shrink-0 rounded-md border border-amber-500/20 bg-amber-500/[0.045] px-1.5 py-0.5 text-[7px] tracking-widest text-amber-300/90">{capability.shortLabel}</span>}
        {compactChrome && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${focused ? "bg-amber-300" : "bg-muted-foreground/35"}`} aria-hidden="true" />}
        <span className="lios-pane-title min-w-0 truncate text-[10px] font-semibold text-foreground/95">{capability.label}</span>
        {capability.symbolAware && pane.symbol && (
          <span className="lios-symbol max-w-28 shrink-0 truncate border-l border-border/70 pl-2 text-[8px] font-semibold text-amber-300">{pane.symbol}</span>
        )}
        {!operational && !compactChrome && journey && (
          <span className="font-ui hidden min-w-0 truncate text-[7px] font-medium tracking-[0.08em] text-muted-foreground/65 2xl:inline">{journey.journey.label.toUpperCase()} · {journey.journey.stages[journey.stageIndex].label.toUpperCase()}</span>
        )}
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5" onMouseDown={(event) => event.stopPropagation()}>
          <PaneAnalyticalControls paneId={paneId} view={pane.view} symbol={capability.symbolAware ? pane.symbol : undefined} compact={compactHeader} />
          {onAskLios && pane.view !== "agent" && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onAskLios(`What stands out in this ${capability.label.toLowerCase()} view${capability.symbolAware && pane.symbol ? ` for ${pane.symbol}` : ""}, and what should I check next?`, pane); }}
              className="font-ui flex items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-[7px] font-medium tracking-wide text-muted-foreground/80 transition-colors hover:border-fuchsia-400/25 hover:bg-fuchsia-500/[0.04] hover:text-foreground"
              data-testid={`workspace-ask-lios-${paneId}`}
              title={`Ask LiOS about ${capability.label}${capability.symbolAware && pane.symbol ? ` for ${pane.symbol}` : ""}`}
              aria-label={`Ask LiOS about ${capability.label}${capability.symbolAware && pane.symbol ? ` for ${pane.symbol}` : ""}`}
            ><Sparkles className="h-3 w-3" /><span className="hidden xl:inline">Ask LiOS</span></button>
          )}
          {onOpenActions && (
            <button onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onOpenActions(Math.max(8, rect.right - 350), rect.bottom + 4); }} className="rounded-md border border-transparent p-1 text-muted-foreground/70 transition-colors hover:border-border hover:bg-white/[0.035] hover:text-foreground" title="Analytical actions" aria-label="Open analytical context actions"><MoreHorizontal className="h-3 w-3" /></button>
          )}
          {!focused && !compactHeader && (
            <button onClick={(event) => { event.stopPropagation(); onFocus(); }} className="font-ui flex items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-[7px] font-medium tracking-wide text-muted-foreground/70 transition-colors hover:border-amber-500/25 hover:bg-amber-500/[0.035] hover:text-foreground" data-testid={`workspace-focus-${paneId}`} title="Focus pane"><Focus className="h-2.5 w-2.5" /> <span className="hidden xl:inline">Focus</span></button>
          )}
          {onToggleMaximize && (
            <button onClick={(event) => { event.stopPropagation(); onToggleMaximize(); }} className="font-ui flex items-center gap-1 rounded-md border border-transparent p-1 text-[7px] font-medium tracking-wide text-muted-foreground/70 transition-colors hover:border-cyan-500/25 hover:bg-cyan-500/[0.035] hover:text-foreground" data-testid={`workspace-maximize-${paneId}`} title={isMaximized ? "Restore pane" : "Maximize pane"} aria-label={isMaximized ? "Restore pane" : "Maximize pane"}>{isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}<span className="hidden 2xl:inline">{isMaximized ? "Restore" : "Maximize"}</span></button>
          )}
          {canClose && onClose && (
            <button onClick={(event) => { event.stopPropagation(); onClose(); }} className="font-ui flex items-center gap-1 rounded-md border border-transparent p-1 text-[7px] font-medium tracking-wide text-muted-foreground/70 transition-colors hover:border-red-500/25 hover:bg-red-500/[0.03] hover:text-red-300" data-testid={`workspace-close-${paneId}`} title="Close pane" aria-label="Close pane"><X className="h-3 w-3" /> <span className="hidden 2xl:inline">Close</span></button>
          )}
        </div>
      </header>
      {showHeroBar && <HeroIntelligenceBar view={pane.view} symbol={capability.symbolAware ? pane.symbol : undefined} compact={compactChrome} />}
      {showObjectFlow && <ObjectIntelligenceFlow objectLabel={pane.symbol!} />}
      {analyticalState.zoom === "analysis" && <PaneSemanticSummary view={pane.view} symbol={capability.symbolAware ? pane.symbol : undefined} mode="analysis" />}
      {analyticalState.zoom === "thesis" ? (
        <PaneSemanticSummary view={pane.view} symbol={capability.symbolAware ? pane.symbol : undefined} mode="thesis" />
      ) : (
        <div className="lios-pane-content min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable]">{children}</div>
      )}
    </section>
  );
}
