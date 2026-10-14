import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, Eye, Focus, Layers3, ScanSearch, Sparkles } from "lucide-react";
import type { PaneId, ViewMode } from "@/lib/terminalTypes";
import {
  cycleSemanticZoom,
  loadPaneAnalyticalState,
  patchPaneAnalyticalState,
  subscribeAnalyticalState,
  type AttentionLensMode,
  type PaneAnalyticalState,
} from "@/lib/terminalAnalyticalState";
import { getChangesSincePrevious, getLatestAnalyticalSnapshot } from "@/lib/terminalChangeIntelligence";
import { loadComparisonSlots, setComparisonSlot } from "@/lib/terminalComparison";
import { openTerminalInspector } from "@/lib/terminalInspector";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import { getTerminalCapability } from "@/lib/terminalCatalog";

interface Props {
  paneId: PaneId;
  view: ViewMode;
  symbol?: string;
  compact?: boolean;
}

const ATTENTION_ORDER: AttentionLensMode[] = ["off", "inputs", "outputs", "evidence", "risk"];
const ATTENTION_LABEL: Record<AttentionLensMode, string> = {
  off: "Lens off",
  inputs: "Inputs",
  outputs: "Outputs",
  evidence: "Evidence",
  risk: "Risk",
};

export default function PaneAnalyticalControls({ paneId, view, symbol, compact = false }: Props) {
  const [state, setState] = useState<PaneAnalyticalState>(() => loadPaneAnalyticalState(paneId, view, symbol));
  const [version, setVersion] = useState(0);
  const capability = getTerminalCapability(view);
  const changes = useMemo(() => getChangesSincePrevious(view, symbol), [version, view, symbol]);
  const materialChanges = changes.filter((item) => item.severity !== "info").length;

  useEffect(() => {
    setState(loadPaneAnalyticalState(paneId, view, symbol));
    return subscribeAnalyticalState(() => setState(loadPaneAnalyticalState(paneId, view, symbol)));
  }, [paneId, symbol, view]);

  useEffect(() => {
    const handler = () => setVersion((value) => value + 1);
    window.addEventListener("lios:change-intelligence", handler);
    return () => window.removeEventListener("lios:change-intelligence", handler);
  }, []);

  const patch = (next: Partial<PaneAnalyticalState>) => setState(patchPaneAnalyticalState(paneId, view, symbol, next));

  const cycleAttention = () => {
    const index = ATTENTION_ORDER.indexOf(state.attention);
    patch({ attention: ATTENTION_ORDER[(index + 1) % ATTENTION_ORDER.length] });
  };

  const addCompare = () => {
    const snapshot = getLatestAnalyticalSnapshot(view, symbol);
    if (!snapshot) {
      openTerminalUxSurface("innovation-studio");
      return;
    }
    const slots = loadComparisonSlots();
    const target = slots.find((slot) => !slot.snapshot)?.id ?? "B";
    setComparisonSlot(target, snapshot);
    patch({ compareArmed: true });
    openTerminalUxSurface("innovation-studio");
  };

  return (
    <div className="flex min-w-0 items-center gap-0.5" aria-label="Analytical lens controls" data-compact={compact ? "true" : "false"}>
      <button
        type="button"
        onClick={() => patch({ zoom: cycleSemanticZoom(state.zoom) })}
        className="lios-pane-tool"
        title={`Semantic Zoom: ${state.zoom}. Click to cycle detail → analysis → thesis.`}
      >
        <Layers3 className="h-2.5 w-2.5" />
        {!compact && <span className="hidden 2xl:inline">{state.zoom.toUpperCase()}</span>}
      </button>
      <button
        type="button"
        onClick={cycleAttention}
        className={`lios-pane-tool ${state.attention !== "off" ? "text-cyan-200" : ""}`}
        title={`Attention Lens: ${ATTENTION_LABEL[state.attention]}. Click to cycle.`}
      >
        <Focus className="h-2.5 w-2.5" />
        {!compact && <span className="hidden 2xl:inline">{state.attention === "off" ? "LENS" : ATTENTION_LABEL[state.attention].toUpperCase()}</span>}
      </button>
      {!compact && (
        <>
          <button
            type="button"
            onClick={() => openTerminalInspector({ view, symbol, label: capability.label })}
            className="lios-pane-tool"
            title="Open contextual mini-inspector"
          >
            <ScanSearch className="h-2.5 w-2.5" />
            <span className="hidden 2xl:inline">INSPECT</span>
          </button>
          <button
            type="button"
            onClick={addCompare}
            className={`lios-pane-tool ${state.compareArmed ? "text-fuchsia-200" : ""}`}
            title="Add the latest published analytical snapshot to comparison"
          >
            <ArrowDownUp className="h-2.5 w-2.5" />
            <span className="hidden 2xl:inline">COMPARE</span>
          </button>
        </>
      )}
      {materialChanges > 0 && (
        <button type="button" onClick={() => openTerminalUxSurface("innovation-studio")} className="lios-pane-tool text-amber-200" title={`${materialChanges} material changes since the previous snapshot`}>
          <Sparkles className="h-2.5 w-2.5" />
          <span>{materialChanges}</span>
        </button>
      )}
      {!compact && (
        <button type="button" onClick={() => openTerminalUxSurface("innovation-studio")} className="lios-pane-tool" title="Open V4 Analytical Studio">
          <Eye className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
