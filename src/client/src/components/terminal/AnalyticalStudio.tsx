import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowRight, BrainCircuit, BriefcaseBusiness, Check, GitCompareArrows, History, Layers3,
  Network, Package, Play, Plus, RefreshCw, Save, ShieldCheck, Sparkles, Target, Trash2, X,
} from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode, WorkspaceState } from "@/lib/terminalTypes";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { buildAnalyticalStoryline } from "@/lib/terminalStoryline";
import { getWorkspaceMorphs, applyWorkspaceMorph } from "@/lib/terminalWorkspaceMorph";
import { getCrossDomainBridges } from "@/lib/terminalCrossDomainBridges";
import { getEvidenceSnapshot, subscribeEvidence, type CalculationReceipt, type EvidenceSnapshot } from "@/lib/terminalEvidence";
import { deriveTerminalDataAtmosphere } from "@/lib/terminalDataState";
import {
  captureAnalyticalSnapshot, getAnalyticalSnapshots, getChangesSincePrevious, type AnalyticalChange,
} from "@/lib/terminalChangeIntelligence";
import {
  clearComparisonSlots, compareSlots, diffCalculationReceipts, loadComparisonSlots, setComparisonSlot,
  subscribeComparison, type ComparisonSlot,
} from "@/lib/terminalComparison";
import {
  addThesisEvidence, createThesisMap, loadThesisMaps, saveThesisMap, subscribeThesisMaps, thesisCaseScore,
  type ThesisCaseId, type ThesisMap,
} from "@/lib/terminalThesisMap";
import SpatialResearchCanvas from "./SpatialResearchCanvas";
import { RecordedAnalyticalDifference } from "./AnalyticalChangeStories";
import { loadResearchTray } from "@/lib/terminalResearchTray";
import {
  createResearchPackage, loadResearchPackages, removeResearchPackage, subscribeResearchPackages, type ResearchPackage,
} from "@/lib/terminalResearchPackages";
import {
  createComposedWorkflow, loadComposedWorkflows, parseCommandSequence, removeComposedWorkflow, saveComposedWorkflow,
  subscribeComposedWorkflows, type ComposedWorkflow,
} from "@/lib/terminalCommandComposer";
import {
  captureDecisionReplay, loadDecisionReplays, removeDecisionReplay, subscribeDecisionReplays, type DecisionReplaySnapshot,
} from "@/lib/terminalDecisionReplay";
import {
  createUiActionProposal, loadUiActionLedger, recordUiActionLedger, validateUiActionProposal,
  type UiActionProposal,
} from "@/lib/terminalUiActionPreview";
import type { TerminalUxPreferences } from "@/lib/terminalUxPreferences";
import { describeSnapshotPair } from "@/lib/sprintBComparisonContext";
import { comparisonReviewKey, resolveRecordedReceiptPair } from "@/lib/sprintDComparisonGuard";

const TABS = ["flow", "compare", "thesis", "canvas", "packages", "composer", "replay", "ai-preview", "meeting"] as const;
type StudioTab = typeof TABS[number];

interface Props {
  activeView: ViewMode;
  activeSymbol?: string;
  workspace: WorkspaceState;
  isInternal: boolean;
  preferences: TerminalUxPreferences;
  onPreferencesChange: (next: TerminalUxPreferences) => void;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onApplyWorkspace: (workspace: WorkspaceState, label?: string) => void;
  onClose: () => void;
}

function fmt(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "—";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(value);
}

function StudioNav({ tab, onTab }: { tab: StudioTab; onTab: (tab: StudioTab) => void }) {
  return <nav className="flex gap-1 overflow-x-auto border-b border-border/55 px-3 py-2 scrollbar-thin">{TABS.map((item) => <button key={item} onClick={() => onTab(item)} className={`font-ui shrink-0 rounded-lg border px-2.5 py-1.5 text-[7px] font-semibold uppercase tracking-[0.1em] ${tab === item ? "border-amber-400/25 bg-amber-400/[0.055] text-amber-200" : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-white/[0.025] hover:text-foreground"}`}>{item.replace("-", " ")}</button>)}</nav>;
}

export default function AnalyticalStudio({ activeView, activeSymbol, workspace, isInternal, preferences, onPreferencesChange, onOpen, onApplyWorkspace, onClose }: Props) {
  const [tab, setTab] = useState<StudioTab>("flow");
  return (
    <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/72 p-3 backdrop-blur-[3px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay flex h-[min(820px,94vh)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS V4 Analytical Studio">
        <header className="flex items-start gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/[0.055]"><BrainCircuit className="h-4 w-4 text-amber-300" /></div>
          <div className="min-w-0 flex-1"><div className="font-ui text-[13px] font-semibold text-foreground">LiOS Analytical Studio</div><div className="mt-1 flex flex-wrap items-center gap-2 font-ui text-[8px] text-muted-foreground"><span>{getTerminalCapability(activeView).label}</span>{activeSymbol && <span className="lios-symbol text-amber-300">{activeSymbol}</span>}<span>· Flow, compare, thesis, canvas, packages, replay and safe UI orchestration</span></div></div>
          <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground" aria-label="Close studio"><X className="h-4 w-4" /></button>
        </header>
        <StudioNav tab={tab} onTab={setTab} />
        <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
          {tab === "flow" && <FlowTab activeView={activeView} activeSymbol={activeSymbol} workspace={workspace} onOpen={onOpen} onApplyWorkspace={onApplyWorkspace} />}
          {tab === "compare" && <CompareTab activeView={activeView} activeSymbol={activeSymbol} />}
          {tab === "thesis" && <ThesisTab activeView={activeView} activeSymbol={activeSymbol} onOpen={onOpen} />}
          {tab === "canvas" && <SpatialResearchCanvas onOpen={onOpen} />}
          {tab === "packages" && <PackagesTab activeSymbol={activeSymbol} workspace={workspace} onApplyWorkspace={onApplyWorkspace} />}
          {tab === "composer" && <ComposerTab activeSymbol={activeSymbol} onOpen={onOpen} />}
          {tab === "replay" && <ReplayTab activeSymbol={activeSymbol} workspace={workspace} onApplyWorkspace={onApplyWorkspace} />}
          {tab === "ai-preview" && <AiPreviewTab activeSymbol={activeSymbol} isInternal={isInternal} onOpen={onOpen} />}
          {tab === "meeting" && <MeetingTab preferences={preferences} onPreferencesChange={onPreferencesChange} />}
        </div>
      </section>
    </div>
  );
}

function FlowTab({ activeView, activeSymbol, workspace, onOpen, onApplyWorkspace }: { activeView: ViewMode; activeSymbol?: string; workspace: WorkspaceState; onOpen: Props["onOpen"]; onApplyWorkspace: Props["onApplyWorkspace"] }) {
  const [evidence, setEvidence] = useState<EvidenceSnapshot>(() => getEvidenceSnapshot());
  useEffect(() => subscribeEvidence(setEvidence), []);
  const storyline = useMemo(() => buildAnalyticalStoryline(activeView, activeSymbol), [activeSymbol, activeView]);
  const morphs = useMemo(() => getWorkspaceMorphs(activeView), [activeView]);
  const bridges = useMemo(() => getCrossDomainBridges(activeView), [activeView]);
  const atmosphere = useMemo(() => deriveTerminalDataAtmosphere(evidence), [evidence]);
  const changes = useMemo(() => getChangesSincePrevious(activeView, activeSymbol), [activeSymbol, activeView]);

  return <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/55 bg-white/[0.012] p-4"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-300" /><div className="font-ui text-[11px] font-semibold text-foreground">Analytical Storyline</div></div>{storyline ? <><div className="mt-4 flex gap-1.5">{storyline.stages.map((stage) => <div key={stage.label} className="min-w-0 flex-1"><div className={`h-1.5 rounded-full ${stage.state === "active" ? "bg-amber-300" : stage.state === "complete" ? "bg-cyan-300/55" : stage.state === "available" ? "bg-white/20" : "bg-white/[0.06]"}`} /><div className={`font-ui mt-2 truncate text-[7px] ${stage.state === "active" ? "text-amber-200" : "text-muted-foreground"}`}>{stage.label}</div></div>)}</div><p className="font-ui mt-3 text-[8px] text-muted-foreground">{storyline.journeyLabel} · {Math.round(storyline.progress * 100)}% path coverage. This is a map, not a wizard—jump anywhere.</p></> : <p className="font-ui mt-3 text-[8px] text-muted-foreground">This capability is intentionally outside a fixed journey. Use Tool Graph and bridges instead.</p>}</section>
      <section className="rounded-2xl border border-border/55 p-4"><div className="font-ui text-[10px] font-semibold text-foreground">Workspace Morphing</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Transform the adjacent analytical environment while preserving the anchor context.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{morphs.length ? morphs.map((morph) => <button key={morph.id} onClick={() => onApplyWorkspace(applyWorkspaceMorph(workspace, morph), morph.label)} className="group rounded-xl border border-border/55 p-3 text-left hover:border-amber-400/25 hover:bg-amber-400/[0.025]"><div className="flex items-center justify-between gap-2"><span className="font-ui text-[9px] font-semibold text-foreground">{morph.label}</span><ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-amber-300" /></div><p className="font-ui mt-1.5 text-[7px] leading-relaxed text-muted-foreground">{morph.description}</p></button>) : <div className="rounded-xl border border-dashed border-border/55 p-4 font-ui text-[8px] text-muted-foreground">No predefined morph for this surface yet. Open With / Send To remain available.</div>}</div></section>
      <section className="rounded-2xl border border-border/55 p-4"><div className="font-ui text-[10px] font-semibold text-foreground">Cross-domain Intelligence Bridges</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{bridges.map((bridge) => <button key={bridge.id} onClick={() => onOpen(bridge.to, "tab", bridge.symbolAware ? activeSymbol : undefined)} className="group rounded-xl border border-border/55 p-3 text-left hover:border-emerald-400/25 hover:bg-emerald-400/[0.025]"><div className="flex items-center justify-between"><span className="font-ui text-[9px] font-semibold text-foreground">{bridge.label}</span><span className="font-ui text-[6px] uppercase tracking-wider text-emerald-300/70">{bridge.domain}</span></div><p className="font-ui mt-1.5 text-[7px] leading-relaxed text-muted-foreground">{bridge.reason}</p></button>)}</div></section>
    </div>
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/55 p-4"><div className="flex items-center justify-between gap-2"><div className="font-ui text-[10px] font-semibold text-foreground">Data-State Atmosphere</div><span className="lios-pane-code text-[7px] text-cyan-300">{atmosphere.state.toUpperCase()}</span></div><div className="font-ui mt-2 text-[9px] text-foreground">{atmosphere.label}</div><p className="font-ui mt-1 text-[8px] leading-relaxed text-muted-foreground">{atmosphere.explanation}</p></section>
      <section className="rounded-2xl border border-border/55 p-4">
        <div className="font-ui text-sm font-semibold text-foreground">Recorded insight changes</div>
        <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">Exact differences between local analytical captures. Not live alerts, independent evidence or explanations of cause.</p>
        <div className="mt-3 space-y-2">{changes.length
          ? changes.slice(0, 6).map(change => <RecordedAnalyticalDifference key={change.key} change={change} />)
          : <p role="status" className="rounded-xl border border-dashed border-border/55 p-4 font-ui text-xs text-muted-foreground">No prior comparable capture yet. Open Compare to inspect recorded fields; missing history is not inferred.</p>}</div>
        {changes.length > 6 && <p className="mt-2 font-ui text-xs text-muted-foreground">Showing 6 of {changes.length} recorded changes. Open What Changed for additional saved contexts.</p>}
      </section>
    </div>
  </div>;
}

function ChangeRow({ change }: { change: AnalyticalChange }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-border/45 px-2.5 py-2"><div className="min-w-0"><div className="font-ui truncate text-[8px] text-foreground">{change.key}</div><div className="font-ui mt-0.5 text-[7px] text-muted-foreground">{fmt(change.before)} → {fmt(change.after)}</div></div><span className={`lios-pane-code text-[6px] ${change.severity === "critical" ? "text-red-300" : change.severity === "material" ? "text-amber-300" : "text-muted-foreground"}`}>{change.percentDelta === undefined ? change.direction.toUpperCase() : `${change.percentDelta >= 0 ? "+" : ""}${change.percentDelta.toFixed(1)}%`}</span></div>;
}

function CompareTab({ activeView, activeSymbol }: { activeView: ViewMode; activeSymbol?: string }) {
  const [slots, setSlots] = useState<ComparisonSlot[]>(() => loadComparisonSlots());
  const [evidence, setEvidence] = useState<EvidenceSnapshot>(() => getEvidenceSnapshot());
  const [receiptA, setReceiptA] = useState(0);
  const [receiptB, setReceiptB] = useState(1);
  const [reviewedPairKey, setReviewedPairKey] = useState<string | null>(null);
  const [expandedPairKey, setExpandedPairKey] = useState<string | null>(null);
  useEffect(() => subscribeComparison(setSlots), []);
  useEffect(() => subscribeEvidence(setEvidence), []);
  const snapshots = getAnalyticalSnapshots(activeView, activeSymbol);
  const leftSnapshot = slots.find(slot => slot.id === "A")?.snapshot ?? null;
  const rightSnapshot = slots.find(slot => slot.id === "B")?.snapshot ?? null;
  const context = describeSnapshotPair(leftSnapshot, rightSnapshot);
  const pairKey = comparisonReviewKey(leftSnapshot, rightSnapshot);
  const allowCrossContext = context.kind === "cross-context" && pairKey !== null && reviewedPairKey === pairKey;
  const slotChanges = context.kind === "same-context" || allowCrossContext ? compareSlots() : [];
  const showAllChanges = pairKey !== null && expandedPairKey === pairKey;
  const visibleChanges = showAllChanges ? slotChanges : slotChanges.slice(0, 12);
  const actualReceipts = resolveRecordedReceiptPair(evidence.receipts, receiptA, receiptB);
  const receiptDiff = actualReceipts ? diffCalculationReceipts(actualReceipts[0], actualReceipts[1]) : null;

  const captureNow = () => {
    const latestReceipt = evidence.receipts[0];
    const values = latestReceipt ? { ...latestReceipt.inputs, ...latestReceipt.parameters, ...latestReceipt.outputs } : { view: getTerminalCapability(activeView).label, symbol: activeSymbol ?? "" };
    const snapshot = captureAnalyticalSnapshot({ view: activeView, symbol: activeSymbol, label: `${activeSymbol ? `${activeSymbol} · ` : ""}${getTerminalCapability(activeView).label}`, values, metadata: { source: latestReceipt ? `receipt:${latestReceipt.reproducibilityId}` : "context-only" } });
    const target = slots.find((slot) => !slot.snapshot)?.id ?? "B";
    setComparisonSlot(target, snapshot);
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-ui text-[11px] font-semibold text-foreground">Comparison Mode & Model Diff</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Compare contexts, scenarios or two calculation receipts without losing the active workspace.</p></div><div className="flex gap-2"><button onClick={captureNow} className="font-ui rounded-lg border border-amber-400/25 bg-amber-400/[0.045] px-3 py-2 text-[8px] font-semibold text-amber-200">Capture current</button><button onClick={clearComparisonSlots} className="font-ui rounded-lg border border-border/60 px-3 py-2 text-[8px] text-muted-foreground hover:text-foreground">Clear A/B</button></div></div>
    <div className="grid gap-3 md:grid-cols-2">{slots.map((slot) => <div key={slot.id} className="rounded-2xl border border-border/55 p-4"><div className="flex items-center justify-between"><span className="lios-pane-code text-[9px] text-fuchsia-300">SLOT {slot.id}</span>{slot.snapshot && <button onClick={() => setComparisonSlot(slot.id, null)} className="font-ui text-[7px] text-muted-foreground hover:text-foreground">Clear</button>}</div>{slot.snapshot ? <><div className="font-ui mt-2 text-[10px] font-semibold text-foreground">{slot.snapshot.label}</div><div className="font-ui mt-1 text-[11px] text-muted-foreground">{new Date(slot.snapshot.capturedAt).toLocaleString()} · {Object.keys(slot.snapshot.values).length} fields · {slot.snapshot.metadata.source === "context-only" ? "Context only — no calculation receipt" : slot.snapshot.metadata.source?.startsWith("receipt:") ? "Recorded calculation receipt" : "Source context unspecified"}</div><div className="mt-3 grid grid-cols-2 gap-1">{Object.entries(slot.snapshot.values).slice(0, 8).map(([key, value]) => <div key={key} className="rounded-lg bg-white/[0.02] p-2"><div className="font-ui text-[6px] text-muted-foreground">{key}</div><div className="lios-number mt-1 text-[7px] text-foreground">{fmt(value)}</div></div>)}</div></> : <div className="font-ui mt-4 rounded-xl border border-dashed border-border/50 p-4 text-[8px] text-muted-foreground">Empty. Use Capture current or a pane Compare button.</div>}</div>)}</div>
    <section className="rounded-2xl border border-border/55 p-4">
      <div className="font-ui text-sm font-semibold text-foreground">A → B recorded field diff</div>
      <p role="status" className="mt-2 font-ui text-xs leading-5 text-muted-foreground">{context.message}</p>
      {context.kind === "cross-context" && <button type="button" aria-pressed={allowCrossContext}
        onClick={() => setReviewedPairKey(current => current === pairKey ? null : pairKey)}
        className="mt-2 min-h-11 rounded-lg border border-amber-300/30 px-3 font-ui text-xs text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
        {allowCrossContext ? "Hide cross-context field differences" : "Show cross-context fields with caution"}
      </button>}
      <div className="mt-3 grid gap-1.5 md:grid-cols-2">{visibleChanges.length
        ? visibleChanges.map(change => <ChangeRow key={change.key} change={change} />)
        : <p className="font-ui text-xs text-muted-foreground">{context.kind === "cross-context" && !allowCrossContext
          ? "Field differences are hidden until explicitly requested."
          : context.kind === "incomplete" ? "Fill both slots to inspect a comparison." : "No differing recorded fields."}</p>}</div>
      {slotChanges.length > 12 && <button type="button" aria-expanded={showAllChanges}
        onClick={() => setExpandedPairKey(current => current === pairKey ? null : pairKey)}
        className="mt-3 min-h-11 w-full rounded-lg border border-border/70 font-ui text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
        {showAllChanges ? "Show fewer fields" : `Show all ${slotChanges.length} changed fields`}
      </button>}
    </section>
    <section className="rounded-2xl border border-border/55 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-ui text-[10px] font-semibold text-foreground">Calculation Receipt Diff</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Git-style model comparison using published inputs, parameters, outputs and warnings.</p></div>{evidence.receipts.length >= 2 && <div className="flex gap-2"><ReceiptSelect receipts={evidence.receipts} value={receiptA} onChange={setReceiptA} label="A" /><ReceiptSelect receipts={evidence.receipts} value={receiptB} onChange={setReceiptB} label="B" /></div>}</div>{receiptDiff ? <>
      <div className="mt-3 flex flex-wrap gap-3 font-ui text-xs text-muted-foreground">
        <span>{[...receiptDiff.inputs, ...receiptDiff.parameters, ...receiptDiff.outputs].filter(item => item.changed).length} changed fields</span>
        <span>{receiptDiff.warningsAdded.length} warnings added</span>
        <span>{receiptDiff.warningsRemoved.length} warnings removed</span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3"><DiffSection title="Inputs" items={receiptDiff.inputs} /><DiffSection title="Parameters" items={receiptDiff.parameters} /><DiffSection title="Outputs" items={receiptDiff.outputs} /></div>
      {(receiptDiff.warningsAdded.length > 0 || receiptDiff.warningsRemoved.length > 0) && <div className="mt-3 rounded-lg border border-amber-300/20 p-3 font-ui text-xs text-amber-200">
        {receiptDiff.warningsAdded.map(warning => <p key={`added:${warning}`}>New warning: {warning}</p>)}
        {receiptDiff.warningsRemoved.map(warning => <p key={`removed:${warning}`}>No longer recorded: {warning}</p>)}
      </div>}
      </> : <div className="font-ui mt-3 rounded-xl border border-dashed border-border/55 p-4 text-xs text-muted-foreground">{evidence.receipts.length < 2
        ? "At least two published calculation receipts are required." : "Select two distinct, currently published receipts to compare."}</div>}</section>
    {snapshots.length > 0 && <div className="font-ui text-[7px] text-muted-foreground">{snapshots.length} stored snapshots available for {activeSymbol || "global"} {getTerminalCapability(activeView).label}.</div>}
  </div>;
}

function ReceiptSelect({ receipts, value, onChange, label }: { receipts: CalculationReceipt[]; value: number; onChange: (value: number) => void; label: string }) {
  return <label className="font-ui flex items-center gap-1 text-[7px] text-muted-foreground">{label}<select value={value} onChange={(event) => onChange(Number(event.target.value))} className="rounded-lg border border-border/60 bg-black/20 px-2 py-1.5 text-[7px] text-foreground">{receipts.map((item, index) => <option key={item.id} value={index}>{item.label} · {item.reproducibilityId}</option>)}</select></label>;
}

function DiffSection({ title, items }: { title: string; items: ReturnType<typeof diffCalculationReceipts>["inputs"] }) {
  return <div className="rounded-xl border border-border/50 p-3"><div className="font-ui text-[8px] font-semibold text-foreground">{title}</div><div className="mt-2 space-y-1">{items.map((item) => <div key={item.key} className={`grid grid-cols-[1fr_auto_auto] gap-2 rounded-md px-2 py-1.5 text-[7px] ${item.changed ? "bg-amber-400/[0.035]" : ""}`}><span className="font-ui truncate text-muted-foreground">{item.key}</span><span className="lios-number text-foreground/70">{fmt(item.before)}</span><span className={`lios-number ${item.changed ? "text-amber-200" : "text-foreground/70"}`}>→ {fmt(item.after)}</span></div>)}</div></div>;
}

function ThesisTab({ activeView, activeSymbol, onOpen }: { activeView: ViewMode; activeSymbol?: string; onOpen: Props["onOpen"] }) {
  const [maps, setMaps] = useState<ThesisMap[]>(() => loadThesisMaps());
  const [selectedId, setSelectedId] = useState<string | null>(() => loadThesisMaps()[0]?.id ?? null);
  useEffect(() => subscribeThesisMaps(setMaps), []);
  const selected = maps.find((item) => item.id === selectedId) ?? maps[0] ?? null;
  const ensure = () => {
    if (selected) return selected;
    const next = saveThesisMap(createThesisMap(activeSymbol));
    setSelectedId(next.id);
    return next;
  };
  const updateCase = (caseId: ThesisCaseId, patch: Partial<ThesisMap["cases"][ThesisCaseId]>) => {
    const current = ensure();
    saveThesisMap({ ...current, cases: { ...current.cases, [caseId]: { ...current.cases[caseId], ...patch } } });
  };
  const addCurrentEvidence = (caseId: ThesisCaseId, polarity: "supports" | "weakens") => {
    const current = ensure();
    addThesisEvidence(current, caseId, { title: `${activeSymbol ? `${activeSymbol} · ` : ""}${getTerminalCapability(activeView).label}`, view: activeView, symbol: activeSymbol, polarity, weight: 3, note: "" });
  };

  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-ui text-[11px] font-semibold text-foreground">Live Thesis Map</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Make Bull / Base / Bear explicit, attach supporting and weakening evidence, and keep probabilities normalized.</p></div><button onClick={() => { const next = saveThesisMap(createThesisMap(activeSymbol)); setSelectedId(next.id); }} className="font-ui flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2 text-[8px] font-semibold text-amber-200"><Plus className="h-3 w-3" /> New thesis</button></div>
    {maps.length > 1 && <select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} className="font-ui rounded-lg border border-border/60 bg-black/20 px-3 py-2 text-[8px] text-foreground">{maps.map((map) => <option key={map.id} value={map.id}>{map.title}</option>)}</select>}
    {selected ? <div className="grid gap-3 lg:grid-cols-3">{(["bull", "base", "bear"] as const).map((caseId) => { const scenario = selected.cases[caseId]; const score = thesisCaseScore(scenario); return <section key={caseId} className={`rounded-2xl border p-4 ${caseId === "bull" ? "border-emerald-400/20" : caseId === "bear" ? "border-red-400/20" : "border-amber-400/20"}`}><div className="flex items-center justify-between"><span className="font-ui text-[10px] font-semibold text-foreground">{scenario.title}</span><span className="lios-pane-code text-[7px] text-muted-foreground">SCORE {score.toFixed(0)}</span></div><div className="mt-3 grid grid-cols-2 gap-2"><label className="font-ui text-[7px] text-muted-foreground">Probability %<input type="number" value={scenario.probability} onChange={(event) => updateCase(caseId, { probability: Number(event.target.value) })} className="mt-1 h-8 w-full rounded-lg border border-border/60 bg-black/15 px-2 text-[8px] text-foreground" /></label><label className="font-ui text-[7px] text-muted-foreground">Target<input type="number" value={scenario.target ?? ""} onChange={(event) => updateCase(caseId, { target: event.target.value === "" ? null : Number(event.target.value) })} className="mt-1 h-8 w-full rounded-lg border border-border/60 bg-black/15 px-2 text-[8px] text-foreground" /></label></div><textarea value={scenario.narrative} onChange={(event) => updateCase(caseId, { narrative: event.target.value })} placeholder="What must be true?" className="font-ui mt-2 min-h-20 w-full resize-y rounded-lg border border-border/60 bg-black/15 p-2 text-[8px] leading-relaxed text-foreground" /><div className="mt-3 flex gap-1"><button onClick={() => addCurrentEvidence(caseId, "supports")} className="font-ui rounded-md border border-emerald-400/20 px-2 py-1 text-[7px] text-emerald-300">+ supports</button><button onClick={() => addCurrentEvidence(caseId, "weakens")} className="font-ui rounded-md border border-red-400/20 px-2 py-1 text-[7px] text-red-300">+ weakens</button></div><div className="mt-3 space-y-1">{scenario.evidence.slice(0, 8).map((item) => <button key={item.id} onClick={() => onOpen(item.view, "tab", item.symbol || undefined)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/40 px-2 py-1.5 text-left"><span className="font-ui truncate text-[7px] text-foreground">{item.title}</span><span className={`lios-pane-code text-[6px] ${item.polarity === "supports" ? "text-emerald-300" : item.polarity === "weakens" ? "text-red-300" : "text-muted-foreground"}`}>{item.polarity}</span></button>)}</div></section>; })}</div> : <div className="rounded-2xl border border-dashed border-border/55 p-8 text-center"><Target className="mx-auto h-5 w-5 text-muted-foreground/40" /><div className="font-ui mt-3 text-[10px] text-foreground">Create a thesis map to begin</div></div>}
  </div>;
}

function PackagesTab({ activeSymbol, workspace, onApplyWorkspace }: { activeSymbol?: string; workspace: WorkspaceState; onApplyWorkspace: Props["onApplyWorkspace"] }) {
  const [packages, setPackages] = useState<ResearchPackage[]>(() => loadResearchPackages());
  useEffect(() => subscribeResearchPackages(setPackages), []);
  const create = () => {
    const thesis = loadThesisMaps().find((item) => !activeSymbol || item.symbol === activeSymbol) ?? null;
    createResearchPackage({ symbol: activeSymbol, workspace, researchItems: loadResearchTray().filter((item) => !activeSymbol || !item.symbol || item.symbol === activeSymbol), thesis, description: "Workspace + pinned research + thesis captured as a durable local research object." });
  };
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><div><div className="font-ui text-[11px] font-semibold text-foreground">Research Packages</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Freeze a workspace, pinned research and thesis into one local, reopenable object.</p></div><button onClick={create} className="font-ui flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2 text-[8px] font-semibold text-amber-200"><Package className="h-3 w-3" /> Capture package</button></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{packages.map((item) => <article key={item.id} className="rounded-2xl border border-border/55 p-4"><div className="flex items-start justify-between gap-2"><div><div className="font-ui text-[10px] font-semibold text-foreground">{item.title}</div><div className="font-ui mt-1 text-[7px] text-muted-foreground">{new Date(item.updatedAt).toLocaleString()} · {item.researchItems.length} research objects</div></div><button onClick={() => removeResearchPackage(item.id)} className="text-muted-foreground hover:text-red-300"><Trash2 className="h-3 w-3" /></button></div><p className="font-ui mt-3 line-clamp-3 text-[8px] leading-relaxed text-muted-foreground">{item.description || "No description."}</p><div className="mt-3 flex gap-2"><button onClick={() => onApplyWorkspace(item.workspace, `Restore ${item.title}`)} className="font-ui rounded-lg border border-cyan-400/20 px-2.5 py-1.5 text-[7px] text-cyan-300">Restore workspace</button>{item.thesis && <span className="font-ui rounded-lg border border-border/50 px-2 py-1.5 text-[7px] text-muted-foreground">Thesis included</span>}</div></article>)}</div>{!packages.length && <div className="rounded-2xl border border-dashed border-border/55 p-8 text-center font-ui text-[8px] text-muted-foreground">No research package captured yet.</div>}</div>;
}

function ComposerTab({ activeSymbol, onOpen }: { activeSymbol?: string; onOpen: Props["onOpen"] }) {
  const [source, setSource] = useState(`${activeSymbol || "NVDA"} → FINANCIALS → DCF → PEERS → RISK`);
  const [name, setName] = useState("Research Sequence");
  const [saved, setSaved] = useState<ComposedWorkflow[]>(() => loadComposedWorkflows());
  useEffect(() => subscribeComposedWorkflows(setSaved), []);
  const steps = useMemo(() => parseCommandSequence(source, activeSymbol), [activeSymbol, source]);
  const run = (workflowSteps = steps) => workflowSteps.forEach((step, index) => onOpen(step.view, index === 0 ? "current" : step.openMode, step.symbol));
  const save = () => { const workflow = createComposedWorkflow(name, source, activeSymbol); saveComposedWorkflow(workflow); };
  return <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-2xl border border-border/55 p-4"><div className="font-ui text-[11px] font-semibold text-foreground">Command Composer</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Compose visible, inspectable analytical sequences instead of hiding automation behind a black box.</p><input value={name} onChange={(event) => setName(event.target.value)} className="font-ui mt-4 h-9 w-full rounded-lg border border-border/60 bg-black/15 px-3 text-[9px] text-foreground" /><textarea value={source} onChange={(event) => setSource(event.target.value)} className="lios-pane-code mt-2 min-h-32 w-full resize-y rounded-xl border border-border/60 bg-black/20 p-3 text-[9px] leading-relaxed text-foreground" /><div className="mt-3 space-y-1">{steps.map((step, index) => <div key={step.id} className="flex items-center gap-2 rounded-lg border border-border/45 px-2.5 py-2"><span className="lios-pane-code text-[6px] text-muted-foreground">{index + 1}</span><span className="font-ui min-w-0 flex-1 truncate text-[8px] text-foreground">{step.symbol ? `${step.symbol} · ` : ""}{step.label}</span><span className="lios-pane-code text-[6px] text-cyan-300">{step.openMode}</span></div>)}</div><div className="mt-3 flex gap-2"><button onClick={() => run()} disabled={!steps.length} className="font-ui flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2 text-[8px] font-semibold text-amber-200 disabled:opacity-40"><Play className="h-3 w-3" /> Run</button><button onClick={save} disabled={!steps.length} className="font-ui flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-[8px] text-muted-foreground disabled:opacity-40"><Save className="h-3 w-3" /> Save</button></div></section><section className="rounded-2xl border border-border/55 p-4"><div className="font-ui text-[10px] font-semibold text-foreground">Saved sequences</div><div className="mt-3 space-y-2">{saved.map((workflow) => <div key={workflow.id} className="rounded-xl border border-border/45 p-3"><div className="flex items-start justify-between gap-2"><div><div className="font-ui text-[9px] font-medium text-foreground">{workflow.name}</div><div className="font-ui mt-1 text-[7px] text-muted-foreground">{workflow.steps.length} steps</div></div><button onClick={() => removeComposedWorkflow(workflow.id)} className="text-muted-foreground hover:text-red-300"><Trash2 className="h-3 w-3" /></button></div><div className="lios-pane-code mt-2 line-clamp-2 text-[7px] text-muted-foreground">{workflow.source}</div><button onClick={() => run(workflow.steps)} className="font-ui mt-2 text-[7px] font-medium text-cyan-300">Run workflow →</button></div>)}</div></section></div>;
}

function ReplayTab({ activeSymbol, workspace, onApplyWorkspace }: { activeSymbol?: string; workspace: WorkspaceState; onApplyWorkspace: Props["onApplyWorkspace"] }) {
  const [items, setItems] = useState<DecisionReplaySnapshot[]>(() => loadDecisionReplays());
  useEffect(() => subscribeDecisionReplays(setItems), []);
  const capture = () => captureDecisionReplay({ title: `${activeSymbol ? `${activeSymbol} · ` : ""}Decision Snapshot`, symbol: activeSymbol, asOf: new Date().toISOString(), workspace, evidence: getEvidenceSnapshot(), assumptions: {}, conclusion: "", monitoringTriggers: [] });
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><div><div className="font-ui text-[11px] font-semibold text-foreground">Decision Replay</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Capture what the workspace and evidence looked like at a decision point, then restore that analytical state later.</p></div><button onClick={capture} className="font-ui flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2 text-[8px] font-semibold text-amber-200"><History className="h-3 w-3" /> Capture decision state</button></div><div className="space-y-2">{items.map((item) => <article key={item.id} className="flex items-start gap-3 rounded-2xl border border-border/55 p-4"><History className="mt-0.5 h-4 w-4 text-cyan-300/70" /><div className="min-w-0 flex-1"><div className="font-ui text-[9px] font-semibold text-foreground">{item.title}</div><div className="font-ui mt-1 text-[7px] text-muted-foreground">As known {new Date(item.asOf).toLocaleString()} · {item.evidence.provenance.length} sources · {item.evidence.receipts.length} receipts</div><div className="mt-3 flex gap-2"><button onClick={() => onApplyWorkspace(item.workspace, `Replay ${item.title}`)} className="font-ui rounded-lg border border-cyan-400/20 px-2.5 py-1.5 text-[7px] text-cyan-300">Replay workspace</button><button onClick={() => removeDecisionReplay(item.id)} className="font-ui rounded-lg border border-border/50 px-2.5 py-1.5 text-[7px] text-muted-foreground">Delete</button></div></div></article>)}</div></div>;
}

function AiPreviewTab({ activeSymbol, isInternal, onOpen }: { activeSymbol?: string; isInternal: boolean; onOpen: Props["onOpen"] }) {
  const [source, setSource] = useState(`${activeSymbol || "NVDA"} → FINANCIALS → DCF → PEERS`);
  const [proposal, setProposal] = useState<UiActionProposal | null>(null);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const steps = useMemo(() => parseCommandSequence(source, activeSymbol), [activeSymbol, source]);
  const validation = proposal ? validateUiActionProposal(proposal, isInternal) : null;
  const prepare = () => setProposal(createUiActionProposal({ title: "Workspace action preview", rationale: "Typed UI plan prepared locally. Review every action before execution.", source: "byoai", actions: steps.map((step) => ({ type: "open" as const, view: step.view, symbol: step.symbol, mode: step.openMode })) }));
  const execute = () => {
    if (!proposal || !validation?.valid) return;
    for (const action of proposal.actions) if (action.type === "open") onOpen(action.view, action.mode, action.symbol);
    recordUiActionLedger(proposal, "executed");
    setLedgerVersion((value) => value + 1);
    setProposal(null);
  };
  void ledgerVersion;
  const ledger = loadUiActionLedger().slice(0, 8);
  return <div className="grid gap-4 lg:grid-cols-[1fr_.85fr]"><section className="rounded-2xl border border-border/55 p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /><div className="font-ui text-[11px] font-semibold text-foreground">Safe BYOAI UI Action Preview</div></div><p className="font-ui mt-2 text-[8px] leading-relaxed text-muted-foreground">BYOAI may propose a plan, but LiOS converts it into typed allow-listed actions, validates audience boundaries, shows the exact preview and only executes after explicit user action.</p><textarea value={source} onChange={(event) => setSource(event.target.value)} className="lios-pane-code mt-4 min-h-28 w-full rounded-xl border border-border/60 bg-black/20 p-3 text-[9px] text-foreground" /><button onClick={prepare} disabled={!steps.length} className="font-ui mt-3 flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2 text-[8px] font-semibold text-amber-200 disabled:opacity-40"><Sparkles className="h-3 w-3" /> Prepare preview</button>{proposal && validation && <div className="mt-4 rounded-xl border border-border/55 p-3"><div className="font-ui text-[9px] font-semibold text-foreground">{proposal.title}</div><div className="mt-3 space-y-1">{validation.previewLines.map((line, index) => <div key={`${line}-${index}`} className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2 py-2"><span className="lios-pane-code text-[6px] text-muted-foreground">{index + 1}</span><span className="font-ui text-[8px] text-foreground">{line}</span></div>)}</div>{validation.errors.map((error) => <div key={error} className="font-ui mt-2 text-[7px] text-red-300">{error}</div>)}{validation.warnings.map((warning) => <div key={warning} className="font-ui mt-2 text-[7px] text-amber-300">{warning}</div>)}<div className="mt-3 flex gap-2"><button onClick={execute} disabled={!validation.valid} className="font-ui flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.04] px-3 py-2 text-[8px] font-semibold text-emerald-200 disabled:opacity-40"><Check className="h-3 w-3" /> Execute approved plan</button><button onClick={() => { recordUiActionLedger(proposal, "cancelled"); setProposal(null); }} className="font-ui rounded-lg border border-border/60 px-3 py-2 text-[8px] text-muted-foreground">Cancel</button></div></div>}</section><section className="rounded-2xl border border-border/55 p-4"><div className="font-ui text-[10px] font-semibold text-foreground">UI action ledger</div><div className="mt-3 space-y-2">{ledger.map((entry) => <div key={`${entry.proposalId}-${entry.executedAt}`} className="rounded-xl border border-border/45 p-3"><div className="flex items-center justify-between gap-2"><span className="font-ui text-[8px] text-foreground">{entry.title}</span><span className={`lios-pane-code text-[6px] ${entry.result === "executed" ? "text-emerald-300" : "text-muted-foreground"}`}>{entry.result.toUpperCase()}</span></div><div className="font-ui mt-1 text-[7px] text-muted-foreground">{entry.source.toUpperCase()} · {entry.actionCount} actions · {new Date(entry.executedAt).toLocaleString()}</div></div>)}</div></section></div>;
}

function MeetingTab({ preferences, onPreferencesChange }: { preferences: TerminalUxPreferences; onPreferencesChange: Props["onPreferencesChange"] }) {
  const enabled = preferences.presentationMode;
  return <div className="mx-auto max-w-3xl space-y-4"><section className="rounded-2xl border border-border/55 p-5"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04]"><BriefcaseBusiness className="h-4 w-4 text-cyan-300" /></div><div><div className="font-ui text-[12px] font-semibold text-foreground">Meeting Mode</div><p className="font-ui mt-1 text-[8px] text-muted-foreground">Turn the working terminal into a clean briefing canvas without destroying the underlying workspace.</p></div></div><div className="mt-5 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-border/45 p-3 font-ui text-[8px] text-muted-foreground">Hides navigation-heavy chrome and foregrounds analytical panes.</div><div className="rounded-xl border border-border/45 p-3 font-ui text-[8px] text-muted-foreground">Private notes and research remain local; sharing still uses the safe workspace preview.</div><div className="rounded-xl border border-border/45 p-3 font-ui text-[8px] text-muted-foreground">Focus remains on deterministic outputs, evidence and active context.</div><div className="rounded-xl border border-border/45 p-3 font-ui text-[8px] text-muted-foreground">Exit restores the exact working environment.</div></div><button onClick={() => onPreferencesChange({ ...preferences, presentationMode: !enabled, focusMode: false })} className={`font-ui mt-5 rounded-lg border px-4 py-2 text-[8px] font-semibold ${enabled ? "border-red-400/20 text-red-300" : "border-amber-400/25 bg-amber-400/[0.04] text-amber-200"}`}>{enabled ? "Exit Meeting Mode" : "Enter Meeting Mode"}</button></section></div>;
}
