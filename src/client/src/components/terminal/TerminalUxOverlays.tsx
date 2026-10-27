import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnalyticalContextMenu from "./AnalyticalContextMenu";
import AnalyticalPeek from "./AnalyticalPeek";
import AnalyticalStudio from "./AnalyticalStudio";
import CognitiveCore from "./CognitiveCore";
import DecisionCenter from "./DecisionCenter";
import DecisionCheckpointCoordinator from "./DecisionCheckpointCoordinator";
import DecisionDrift from "./DecisionDrift";
import GraphExplorer from "./GraphExplorer";
import ImpactMap from "./ImpactMap";
import ImmersiveDock from "./ImmersiveDock";
import IntelligenceActionCoordinator from "./IntelligenceActionCoordinator";
import IntelligencePulse from "./IntelligencePulse";
import MiniInspector from "./MiniInspector";
import ObjectWorkbench from "./ObjectWorkbench";
import ProvenanceDrawer from "./ProvenanceDrawer";
import ResearchTray from "./ResearchTray";
import ScenarioWorkbench from "./ScenarioWorkbench";
import ShortcutOverlay from "./ShortcutOverlay";
import TerminalMacroManager from "./TerminalMacroManager";
import TerminalMissionCenter from "./TerminalMissionCenter";
import TerminalUxSettings from "./TerminalUxSettings";
import TrustLedger from "./TrustLedger";
import UniversalInspectorBridge from "./UniversalInspectorBridge";
import WorkspaceComposer from "./WorkspaceComposer";
import WorkspaceSharePreview from "./WorkspaceSharePreview";
import WaveEExperienceShell from "./WaveEExperienceShell";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ResolvedMacroStep } from "@/lib/terminalMacros";
import { recordMissionView } from "@/lib/terminalMissions";
import { subscribeTerminalPeek, type TerminalPeekRequest } from "@/lib/terminalPeek";
import { recordResearchThreadVisit } from "@/lib/terminalResearchThread";
import { incrementTerminalMetric } from "@/lib/terminalTelemetry";
import { patchTerminalUxPreferences, saveTerminalUxPreferences, type TerminalUxPreferences } from "@/lib/terminalUxPreferences";
import {
  subscribeTerminalContextMenu, subscribeTerminalUxSurface,
  type TerminalContextMenuRequest, type TerminalUxSurface,
} from "@/lib/terminalUxEvents";
import { subscribeTerminalInspector, type TerminalInspectorRequest } from "@/lib/terminalInspector";
import { getEvidenceSnapshot, subscribeEvidence, type EvidenceSnapshot } from "@/lib/terminalEvidence";
import { deriveTerminalDataAtmosphere } from "@/lib/terminalDataState";
import { captureAnalyticalSnapshot, type ComparableValue } from "@/lib/terminalChangeIntelligence";
import { rememberAnalyticalSession } from "@/lib/terminalSessionMemory";
import { subscribeWorkspaceRestore } from "@/lib/terminalWorkspaceRestore";
import { setExperienceSurface } from "@/lib/experienceShell";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import type { PaneState, ViewMode, WorkspaceState } from "@/lib/terminalTypes";
import type { ExperienceShellSurface } from "@shared/waveCContracts";

interface Props {
  experienceSurface: ExperienceShellSurface;
  activeView: ViewMode;
  activeSymbol?: string;
  workspace: WorkspaceState;
  isInternal: boolean;
  preferences: TerminalUxPreferences;
  onPreferencesChange: (preferences: TerminalUxPreferences) => void;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onApplyWorkspace?: (workspace: WorkspaceState, label?: string) => boolean | void;
}

function snapshotValuesFromEvidence(evidence: EvidenceSnapshot): Record<string, ComparableValue> {
  const latestReceipt = evidence.receipts[0];
  if (latestReceipt) {
    return {
      ...latestReceipt.inputs,
      ...latestReceipt.parameters,
      ...latestReceipt.outputs,
      "receipt.warningCount": latestReceipt.warnings.length,
      "receipt.diagnosticCount": latestReceipt.diagnostics.length,
    };
  }
  return Object.fromEntries(evidence.provenance.flatMap((item) => [
    [`source.${item.id}.freshness`, item.freshness],
    [`source.${item.id}.quality`, item.quality],
  ]));
}

export default function TerminalUxOverlays({ experienceSurface, activeView, activeSymbol, workspace, isInternal, preferences, onPreferencesChange, onOpen, onApplyWorkspace }: Props) {
  const [surface, setSurface] = useState<TerminalUxSurface | null>(null);
  const [researchOpened, setResearchOpened] = useState(false);
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuRequest | null>(null);
  const [peek, setPeek] = useState<TerminalPeekRequest | null>(null);
  const [inspector, setInspector] = useState<TerminalInspectorRequest | null>(null);
  const [evidence, setEvidence] = useState<EvidenceSnapshot>(() => getEvidenceSnapshot());
  const atmosphere = useMemo(() => deriveTerminalDataAtmosphere(evidence), [evidence]);
  const lastSessionFingerprint = useRef("");

  const openSurface = useCallback((next: TerminalUxSurface | null) => {
    if (next === "research-tray") setResearchOpened(true);
    setSurface(next);
    setContextMenu(null);
    setPeek(null);
    setInspector(null);
  }, []);

  const openContextMenu = useCallback((request: TerminalContextMenuRequest | null) => {
    setSurface(null);
    setPeek(null);
    setInspector(null);
    setContextMenu(request);
  }, []);

  const openPeek = useCallback((request: TerminalPeekRequest | null) => {
    setSurface(null);
    setContextMenu(null);
    setInspector(null);
    setPeek(request);
  }, []);

  const openInspector = useCallback((request: TerminalInspectorRequest | null) => {
    setSurface(null);
    setContextMenu(null);
    setPeek(null);
    setInspector(request);
  }, []);

  useEffect(() => subscribeTerminalUxSurface((next) => {
    if (next === "wave-c-shell" || next === "intelligence-pulse") {
      setExperienceSurface("pulse");
      openSurface(null);
      return;
    }
    if (next === "workbench") {
      setExperienceSurface("workbench");
      openSurface(null);
      return;
    }
    openSurface(next);
  }), [openSurface]);
  useEffect(() => subscribeTerminalContextMenu(openContextMenu), [openContextMenu]);
  useEffect(() => subscribeTerminalPeek(openPeek, () => openPeek(null)), [openPeek]);
  useEffect(() => subscribeTerminalInspector(openInspector), [openInspector]);
  useEffect(() => subscribeEvidence(setEvidence), []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".terminal-root");
    if (!root) return;
    root.dataset.dataState = atmosphere.state;
    return () => {
      if (root.dataset.dataState === atmosphere.state) delete root.dataset.dataState;
    };
  }, [atmosphere.state]);

  useEffect(() => {
    const changed = recordMissionView(activeView);
    if (changed.some((progress) => progress.completedAt)) incrementTerminalMetric("completedMissions");
    recordResearchThreadVisit(activeView, activeSymbol);
  }, [activeSymbol, activeView]);

  useEffect(() => {
    if (!evidence.receipts.length && !evidence.provenance.length) return;
    const capability = getTerminalCapability(activeView);
    const latestReceipt = evidence.receipts[0];
    captureAnalyticalSnapshot({
      view: activeView,
      symbol: capability.symbolAware ? activeSymbol : undefined,
      label: `${capability.symbolAware && activeSymbol ? `${activeSymbol} · ` : ""}${capability.label}`,
      values: snapshotValuesFromEvidence(evidence),
      metadata: {
        source: latestReceipt ? `calculation:${latestReceipt.reproducibilityId}` : "published-provenance",
        providerCount: String(evidence.provenance.length),
        receiptCount: String(evidence.receipts.length),
        dataState: atmosphere.state,
      },
    });
  }, [activeSymbol, activeView, atmosphere.state, evidence]);

  useEffect(() => {
    const capability = getTerminalCapability(activeView);
    const fingerprint = `${activeView}|${activeSymbol ?? ""}|${JSON.stringify(workspace)}`;
    if (lastSessionFingerprint.current === fingerprint) return;
    lastSessionFingerprint.current = fingerprint;
    rememberAnalyticalSession({
      title: `${capability.symbolAware && activeSymbol ? `${activeSymbol} · ` : ""}${capability.label}`,
      symbol: capability.symbolAware ? activeSymbol : undefined,
      view: activeView,
      workspace,
    });
  }, [activeSymbol, activeView, workspace]);

  const updatePreferences = (patch: Partial<TerminalUxPreferences>) => {
    const next = patchTerminalUxPreferences(preferences, patch);
    saveTerminalUxPreferences(next);
    onPreferencesChange(next);
  };

  const applyWorkspaceFallback = (nextWorkspace: WorkspaceState, label?: string) => {
    if (onApplyWorkspace) {
      return onApplyWorkspace(nextWorkspace, label);
    }
    const panes: PaneState[] = [nextWorkspace.primary, nextWorkspace.secondary, nextWorkspace.tertiary ?? null, nextWorkspace.quaternary ?? null].filter(Boolean) as PaneState[];
    panes.forEach((pane, index) => {
      const mode: AnalyticalOpenMode = index === 0 ? "current" : index === 2 ? "split-below" : "split-right";
      onOpen(pane.view, mode, pane.symbol || undefined);
    });
    return true;
  };

  useEffect(() => subscribeWorkspaceRestore((request) => applyWorkspaceFallback(request.workspace, request.label)), [onApplyWorkspace, onOpen]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = Boolean(target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT");
      const modifier = event.metaKey || event.ctrlKey;
      // Radix dialogs own Escape and editing keys; capture must not bypass draft review.
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return;

      if (event.key === "Escape" && (surface || contextMenu || peek || inspector)) {
        event.preventDefault();
        openSurface(null);
        return;
      }
      if (!editable && event.key === "?" && !modifier) { event.preventDefault(); openSurface("shortcuts"); return; }
      if (!modifier || !event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "g") { event.preventDefault(); openSurface("cognitive-core"); return; }
      if (key === "u" || key === "v") { event.preventDefault(); setExperienceSurface("pulse"); openSurface(null); return; }
      if (key === "k") { event.preventDefault(); openSurface("impact-map"); return; }
      if (key === "t") { event.preventDefault(); openSurface("trust-ledger"); return; }
      if (key === "j") { event.preventDefault(); openSurface("decision-drift"); return; }
      if (key === "d") { event.preventDefault(); openSurface("decision-center"); return; }
      if (key === "s") { event.preventDefault(); openSurface("scenario-workbench"); return; }
      if (key === "b") { event.preventDefault(); openSurface("object-workbench"); return; }
      if (key === "x") { event.preventDefault(); openSurface("graph-explorer"); return; }
      if (key === "w") { event.preventDefault(); openSurface("workspace-composer"); return; }
      if (key === "i") { event.preventDefault(); openSurface("innovation-studio"); return; }
      if (key === "r") { event.preventDefault(); openSurface("research-tray"); return; }
      if (key === "m") { event.preventDefault(); openSurface("macros"); return; }
      if (key === "e") { event.preventDefault(); openSurface("evidence"); return; }
      if (key === "n") { event.preventDefault(); setExperienceSurface("library"); openSurface(null); return; }
      if (key === "o") { event.preventDefault(); openSurface("missions"); return; }
      if (key === "c") { event.preventDefault(); updatePreferences({ comfortMode: !preferences.comfortMode }); return; }
      if (event.key === "," || event.key === "<") { event.preventDefault(); openSurface("settings"); return; }
      if (key === "f") { event.preventDefault(); updatePreferences({ focusMode: !preferences.focusMode, presentationMode: false }); return; }
      if (key === "p") { event.preventDefault(); updatePreferences({ presentationMode: !preferences.presentationMode, focusMode: false }); }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [contextMenu, inspector, openSurface, peek, preferences, surface]);

  const runMacroStep = (step: ResolvedMacroStep) => onOpen(step.view, step.openMode, step.symbol);

  return (
    <>
      <DecisionCheckpointCoordinator />
      <UniversalInspectorBridge />
      <IntelligenceActionCoordinator onOpen={onOpen} />
      {experienceSurface === "workbench" && !surface && !contextMenu && !peek && !inspector && (
        <ImmersiveDock activeView={activeView} activeSymbol={activeSymbol} preferences={preferences} isInternal={isInternal} onOpenSurface={openSurface} onToggleFocus={() => updatePreferences({ focusMode: !preferences.focusMode, presentationMode: false })} />
      )}
      {peek && !surface && !contextMenu && !inspector && <AnalyticalPeek request={peek} isInternal={isInternal} onOpen={onOpen} onClose={() => setPeek(null)} />}
      {inspector && !surface && !contextMenu && <MiniInspector request={inspector} onOpen={onOpen} onClose={() => setInspector(null)} />}
      {surface === "cognitive-core" && <CognitiveCore activeView={activeView} activeSymbol={activeSymbol} onOpen={onOpen} onClose={() => setSurface(null)} />}
      {surface === "intelligence-pulse" && <IntelligencePulse onOpen={onOpen} onClose={() => setSurface(null)} />}
      {surface === "impact-map" && <ImpactMap onOpen={onOpen} onClose={() => setSurface(null)} />}
      {surface === "trust-ledger" && <TrustLedger onClose={() => setSurface(null)} />}
      {surface === "decision-drift" && <DecisionDrift onClose={() => setSurface(null)} />}
      {surface === "decision-center" && <DecisionCenter activeView={activeView} activeSymbol={activeSymbol} onClose={() => setSurface(null)} />}
      {surface === "scenario-workbench" && <ScenarioWorkbench activeView={activeView} activeSymbol={activeSymbol} onClose={() => setSurface(null)} />}
      {surface === "object-workbench" && <ObjectWorkbench onClose={() => setSurface(null)} />}
      {surface === "graph-explorer" && <GraphExplorer activeSymbol={activeSymbol} onClose={() => setSurface(null)} />}
      {surface === "workspace-composer" && <WorkspaceComposer workspace={workspace} onApplyWorkspace={applyWorkspaceFallback} onClose={() => setSurface(null)} />}
      {surface === "innovation-studio" && <AnalyticalStudio activeView={activeView} activeSymbol={activeSymbol} workspace={workspace} isInternal={isInternal} preferences={preferences} onPreferencesChange={onPreferencesChange} onOpen={onOpen} onApplyWorkspace={applyWorkspaceFallback} onClose={() => setSurface(null)} />}
      {researchOpened && <div hidden={surface !== "research-tray"} style={surface !== "research-tray" ? { display: "none" } : undefined}>
        <ResearchTray activeView={activeView} activeSymbol={activeSymbol} onOpen={onOpen} onClose={() => setSurface(null)} />
      </div>}
      {surface === "shortcuts" && <ShortcutOverlay onClose={() => setSurface(null)} />}
      {surface === "macros" && <TerminalMacroManager activeSymbol={activeSymbol} isInternal={isInternal} onRunStep={runMacroStep} onClose={() => setSurface(null)} />}
      {surface === "missions" && <TerminalMissionCenter isInternal={isInternal} onOpenView={(view) => onOpen(view, "current", activeSymbol)} onClose={() => setSurface(null)} />}
      {surface === "evidence" && <ProvenanceDrawer onClose={() => setSurface(null)} />}
      {surface === "settings" && <TerminalUxSettings preferences={preferences} onChange={onPreferencesChange} onClose={() => setSurface(null)} />}
      {surface === "share" && <WorkspaceSharePreview workspace={workspace} onClose={() => setSurface(null)} />}
      {surface === "wave-e-shell" && isInternal && <WaveEExperienceShell activeView={activeView} activeSymbol={activeSymbol} onOpen={onOpen} onClose={() => setSurface(null)} />}
      {contextMenu && <AnalyticalContextMenu x={contextMenu.x} y={contextMenu.y} view={contextMenu.view} symbol={contextMenu.symbol} isInternal={isInternal} onOpen={onOpen} onEvidence={() => openSurface("evidence")} onClose={() => setContextMenu(null)} />}
    </>
  );
}
