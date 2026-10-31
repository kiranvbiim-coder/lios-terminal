import { resolveSaveBase } from "@/lib/artifactSaveBase";
import { resolveArtifactPaneRequestedVersion } from "@/lib/artifactWorkbenchHandoff";
import AsyncSurfaceNotice from "./AsyncSurfaceNotice";
import { ArtifactTimeline } from "./ArtifactTimeline";
import { resolveAsyncSurfaceState } from "@/lib/asyncSurfaceState";
import { Component, lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { JsonEditor } from "./ArtifactExpertView";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Download, FileBarChart, GitCompareArrows, GitFork, History, Link2, Maximize2, RefreshCw, RotateCcw, X } from "lucide-react";
import {
  compareArtifactVersions, createArtifactReference, createArtifactVersion, decideArtifactProposal, forkArtifact,
  getArtifactExportPlan, proposeArtifactChange, queryDataArtifact, setArtifactStatus, useArtifact, useArtifactProposals,
  useArtifactReferences, useArtifactVersions, useInvalidateArtifacts,
  restoreArtifactRevision,
  useOwnedArtifacts, proposeArtifactBranchMerge, type DataArtifactQueryResult,
  reviewIntegratedModelArtifactInputs, runReviewedIntegratedModelArtifactInputs,
  type ArtifactDetail, type IntegratedModelArtifactRunResult,
} from "@/lib/useArtifacts";
import type { ArtifactContent, ArtifactExportPlan, ArtifactRefreshSpec, SpreadsheetCellDiff } from "@shared/artifactContracts";
import { prepareValuationRecalculationPrompt } from "@shared/valuationRevisionPolicy";
import type { ProjectSession } from "@/lib/useProjects";
import { colIndexToLetters } from "@/lib/spreadsheetEngine";
import { artifactSheetToGrid, gridToArtifactSheet } from "@/lib/artifactSpreadsheet";
import { semanticArtifactComparisonLabel } from "@/lib/artifactSemanticComparisonSummary";
import { exportArtifactLocal } from "@/lib/artifactExport";
import { artifactExportDisclosure } from "@/lib/artifactExportDisclosure";
import { appendThesisPostmortem, refreshThesisArtifact, useInvalidateProjectIntelligence } from "@/lib/useProjectIntelligence";
import { ScenarioFormulaReview } from "./ScenarioFormulaReview";
import { createP9Workflow, useInvalidateP9Automation, useP9Workflows } from "@/lib/useP9Automation";
import ConversationTrustPanel from "./ConversationTrustPanel";
import { compareArtifactVersionMetadata, metadataDeltaLabels } from "@/lib/p4ArtifactWorkspace";
import { artifactHistoryAnchor, canRestoreArtifactHistory, exactArtifactHistoryComparison, exactArtifactHistoryDetail, sameArtifactHistoryAnchor, type ArtifactHistoryAnchor } from "@/lib/artifactHistorySafety";
import { ArtifactEngineInputReviewSession, initialEngineInputReviewState, isIntegratedModelWorkbook } from "@/lib/artifactEngineInputReview";
import { apiRequest } from "@/lib/queryClient";
import { generatedImageErrorMessage, generatedImageFileName, generatedImageFromContent, type GeneratedImageView } from "@/lib/generatedImageArtifact";
import {
  artifactReportSourceError, canonicalArtifactReportTemplates, prepareArtifactReportRequest, recommendedArtifactReportTemplate,
} from "@/lib/artifactReportChoice";
import { ArtifactProposalReview } from "./ArtifactProposalReview";
import { artifactMaintenancePrompt } from "@/lib/artifactProposalReview";
import { SpreadsheetCellSourceInspect } from "./SpreadsheetCellSourceInspect";
import { spreadsheetDraftHasChanges } from "@/lib/artifactSpreadsheetDraft";
import { checkedSpreadsheetCellRef, prepareSpreadsheetCellReview } from "@/lib/spreadsheetReviewBounds";
import { openTerminalInspector } from "@/lib/terminalInspector";
import ArtifactPortfolioMateriality from "./ArtifactPortfolioMateriality";
import BacktestArtifactView from "./BacktestArtifactView";
import PortfolioArtifactView from "./PortfolioArtifactView";
import ValuationArtifactView from "./ValuationArtifactView";
import ArtifactViewerFallback from "./ArtifactViewerFallback";
import type { ArtifactProvenanceFacts } from "./ArtifactTrustSummary";
import TerminalScreenArtifact from "./TerminalScreenArtifact";
import { clearNativeArtifactDraft, useNativeArtifactDraftOwner, useNativeArtifactDraftRecovery, useNativeDraftLifetime, type NativeArtifactDraftContext } from "@/lib/nativeArtifactDraftRecovery";
import NativeDraftRecoveryNotice from "./NativeDraftRecoveryNotice";
import { stableSerialize } from "@/lib/analyticalCore";
import { reconcileTerminalDraft } from "@/lib/terminalDraftReconciliation";
import { ReadableValue } from "@/components/ui/ReadableValue";

const UniverSpreadsheetEditor = lazy(() => import("./UniverSpreadsheetEditor"));
const ArtifactChart = lazy(() => import("./ArtifactChart"));
const RichArtifactDocumentEditor = lazy(() => import("./RichArtifactDocumentEditor"));
const OfficeArtifactReturn = lazy(() => import("./OfficeArtifactReturn"));
const ArtifactComposition = lazy(() => import("./ArtifactComposition"));
const DecisionArtifactEditor = lazy(() => import("./DecisionArtifactEditor"));
const ArtifactModelMaintenance = lazy(() => import("./ArtifactModelMaintenance"));
const ArtifactModelChangeReport = lazy(() => import("./ArtifactModelChangeReport"));
const SpreadsheetArtifactReturn = lazy(() => import("./SpreadsheetArtifactReturn"));
const ProfessionalWorkPackage = lazy(() => import("./ProfessionalWorkPackage"));
const ArtifactReviewNotes = lazy(() => import("./ArtifactReviewNotes"));

class RichDocumentBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

class ArtifactChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="alert" className="rounded border border-red-300/20 p-3 text-sm text-red-200">Chart renderer unavailable. The recorded Artifact is unchanged. Reopen or reload to retry.</p>
      : this.props.children;
  }
}
const shortHash = (value: string) => `${value.slice(0, 10)}…${value.slice(-6)}`;

function DocumentEditor({ content: incomingContent, revision, onSave, onDirtyChange, disabled = false, recoveryContext }: { content: Extract<ArtifactContent, {kind:"research"|"report"}>; revision: number; onSave:(content:ArtifactContent)=>Promise<void>; onDirtyChange?:(dirty:boolean)=>void; disabled?:boolean; recoveryContext?: NativeArtifactDraftContext | null }) {
  const [content, setContent] = useState(incomingContent);
  const [question, setQuestion] = useState(incomingContent.kind === "research" ? incomingContent.question : "");
  const [sourceMode, setSourceMode] = useState<"connected_sources" | "only_refs">(incomingContent.kind === "research" ? incomingContent.sourcePolicy.mode : "connected_sources");
  const [allowedRefs, setAllowedRefs] = useState(incomingContent.kind === "research" ? incomingContent.sourcePolicy.allowedSourceRefs.join("\n") : "");
  const [baseRevision, setBaseRevision] = useState(revision);
  const [baseline, setBaseline] = useState(() => stableSerialize(incomingContent));
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [builtin, setBuiltin] = useState(false);
  const [richError, setRichError] = useState<string | null>(null);
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const saveRef = useRef(onSave);
  const draftRef = useRef(content);
  const baselineRef = useRef(baseline);
  const pendingContent = useRef<string | null>(null);
  const baselineRecovery = useRef(recoveryContext ?? null);
  if (!baselineRecovery.current && revision === baseRevision) baselineRecovery.current = recoveryContext ?? null;
  const draftContent = useMemo(() => content.kind === "research" ? { ...content, question, sourcePolicy: { ...content.sourcePolicy, mode: sourceMode, allowedSourceRefs: [...new Set(allowedRefs.split(/\n+/).map(value => value.trim()).filter(Boolean))] } } : content, [content, question, sourceMode, allowedRefs]);
  draftRef.current = draftContent;
  baselineRef.current = baseline;
  const dirty = advancedDirty || stableSerialize(draftContent) !== baseline;
  const recovery = useNativeArtifactDraftRecovery(baselineRecovery.current, draftContent, dirty && !advancedDirty, draftContent, saved => {
    setContent(saved);
    if (saved.kind === "research") {
      setQuestion(saved.question); setSourceMode(saved.sourcePolicy.mode);
      setAllowedRefs(saved.sourcePolicy.allowedSourceRefs.join("\n"));
    }
    setAdvancedDirty(false);
  });
  useEffect(() => { onDirtyChange?.(dirty || saving || pending); }, [dirty, saving, pending, onDirtyChange]);
  useEffect(() => { if (dirty && notice?.startsWith("Document revision saved.")) setNotice(null); }, [dirty, notice]);
  useEffect(() => {
    const incoming = stableSerialize(incomingContent);
    if (revision === baseRevision && incoming === baselineRef.current) return;
    const transition = reconcileTerminalDraft(incomingContent, draftRef.current, baselineRef.current, pendingContent.current);
    if (transition.conflict || (advancedDirty && !transition.acknowledged)) { setConflict(true); return; }
    if (transition.replaceDraft) {
      setContent(incomingContent);
      if (incomingContent.kind === "research") {
        setQuestion(incomingContent.question); setSourceMode(incomingContent.sourcePolicy.mode);
        setAllowedRefs(incomingContent.sourcePolicy.allowedSourceRefs.join("\n"));
      }
    }
    setBaseline(transition.baseline); setBaseRevision(revision);
    baselineRecovery.current = recoveryContext ?? null;
    saveRef.current = onSave; pendingContent.current = null;
    setPending(false); setConflict(false);
  }, [incomingContent, revision, baseRevision, onSave, advancedDirty]);
  const saveDocument = async (next = draftRef.current) => {
    if (disabled || recovery.blocked || saving || pending || conflict || pendingContent.current !== null) throw new Error("Document saving is unavailable while read-only, saving, refreshing, or resolving a revision conflict.");
    setSaving(true); setNotice(null);
    const submitted = stableSerialize(next);
    pendingContent.current = submitted;
    try {
      await saveRef.current(next);
      // The canonical response can arrive before native cleanup finishes.
      // Do not overwrite a baseline/draft already reconciled by that response.
      if (pendingContent.current !== null) setBaseline(submitted);
      setPending(pendingContent.current !== null);
      setNotice("Document revision saved. Canonical revision refresh requested.");
    } catch (cause) {
      pendingContent.current = null;
      setNotice(cause instanceof Error ? cause.message : "Document revision could not be saved. Local changes are retained.");
      throw cause;
    } finally { setSaving(false); }
  };
  const reloadDocument = async () => {
    setSaving(true);
    let cleanupNotice: string | null = null;
    try { await recovery.clear(); }
    catch { cleanupNotice = "Saved revision reloaded, but encrypted checkpoint cleanup needs review."; }
    baselineRecovery.current = recoveryContext ?? null;
    setContent(incomingContent);
    if (incomingContent.kind === "research") {
      setQuestion(incomingContent.question); setSourceMode(incomingContent.sourcePolicy.mode);
      setAllowedRefs(incomingContent.sourcePolicy.allowedSourceRefs.join("\n"));
    }
    setBaseline(stableSerialize(incomingContent)); setBaseRevision(revision); saveRef.current = onSave;
    pendingContent.current = null; setConflict(false); setPending(false); setNotice(cleanupNotice);
    setRichError(null); setAdvancedDirty(false); setSaving(false);
  };
  const fallback = <div data-testid="builtin-artifact-document">
    <p role="alert" className="mb-2 text-sm text-amber-200">{richError ?? "Built-in text editor active. Recorded blocks and metadata, including unsaved rich edits, are retained."}</p>
    <div className="space-y-3">{content.blocks.map((block,index)=><label key={block.id} className="block"><span className="mb-1 block font-terminal text-[12px] text-muted-foreground">{block.type} · {block.id}</span><textarea aria-label={`Document block ${index+1}`} disabled={disabled || saving || pending || conflict} value={block.text} onChange={(event)=>{const text=event.target.value;setContent(current=>({...current,blocks:current.blocks.map((item,i)=>i===index?{...item,text}:item)}));}} className="min-h-[100px] w-full rounded-lg border border-border/50 bg-black/15 p-4 font-ui text-[14px] leading-6 text-foreground outline-none disabled:opacity-50"/></label>)}</div>
  </div>;
  return <div>
    <NativeDraftRecoveryNotice recovery={recovery} dirty={dirty}/>
    {advancedDirty && <p role="status" className="mb-2 text-sm text-amber-200">Advanced JSON edits are not included in local crash checkpoints. Save or reset them before leaving.</p>}
    {conflict && <div role="alert" data-testid="document-revision-conflict" className="mb-3 rounded border border-amber-300/40 p-3 text-sm text-amber-200">A newer canonical revision arrived. Your local draft was not overwritten. Saving is blocked until you explicitly reload.<button type="button" disabled={saving} className="ml-2 underline" onClick={() => void reloadDocument()}>Discard local changes and reload revision</button></div>}
    <fieldset disabled={disabled || advancedDirty || recovery.blocked} className="min-w-0">
    {content.kind==="research"&&<div className="mb-3 space-y-2 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.015] p-3">
      <div className="flex flex-wrap items-center gap-2"><span className="font-terminal text-[12px] text-cyan-200">RESEARCH PLAN · {content.plan.status.toUpperCase()}</span><span className="font-terminal text-[12px] text-muted-foreground">{content.plan.steps.length} STEPS · {content.evidence.length} EVIDENCE · {content.contradictions.filter((x)=>x.status==="open").length} OPEN CONTRADICTIONS · {content.executionTrail.length} TRAIL EVENTS</span></div>
      <input aria-label="Research question" disabled={saving || pending} value={question} onChange={(e)=>setQuestion(e.target.value)} placeholder="Research question" className="w-full rounded border border-border/50 bg-black/20 px-2 py-1.5 font-ui text-[14px] outline-none"/>
      <div className="grid gap-2 md:grid-cols-[180px_1fr]">
        <select aria-label="Research source policy" disabled={saving || pending} value={sourceMode} onChange={(e)=>setSourceMode(e.target.value as "connected_sources"|"only_refs")} className="rounded border border-border/50 bg-[#090909] px-2 py-1.5 font-ui text-[13px]"><option value="connected_sources">Connected sources</option><option value="only_refs">Use only these sources</option></select>
        <textarea aria-label="Allowed research source references" value={allowedRefs} onChange={(e)=>setAllowedRefs(e.target.value)} disabled={sourceMode!=="only_refs" || saving || pending} placeholder="One allowed source ref per line" className="min-h-14 rounded border border-border/50 bg-black/20 px-2 py-1.5 font-terminal text-[12px] outline-none disabled:opacity-40"/>
      </div>
      {!!content.plan.steps.length&&<div className="grid gap-1 md:grid-cols-2">{content.plan.steps.slice(0,8).map((step)=><div key={step.id} className="rounded border border-border/35 px-2 py-1.5"><span className="font-terminal text-[12px] text-amber-200">{step.status.toUpperCase()}</span><span className="ml-2 font-ui text-[13px]">{step.objective}</span></div>)}</div>}
      {!!content.evidence.length&&<div className="space-y-1">{content.evidence.slice(0,6).map((item)=><div key={item.id} className="rounded border border-border/35 px-2 py-1.5"><div className="flex gap-2"><span className="font-terminal text-[12px] text-emerald-300">{item.sourceType.toUpperCase()}</span><span className="truncate font-ui text-[13px]">{item.title}</span></div>{item.snippet&&<div className="mt-1 line-clamp-2 font-ui text-[13px] text-muted-foreground">{item.snippet}</div>}</div>)}</div>}
      {!!content.contradictions.filter((item)=>item.status==="open").length&&<div className="space-y-1">{content.contradictions.filter((item)=>item.status==="open").slice(0,5).map((item)=><div key={item.id} className="rounded border border-red-300/15 px-2 py-1.5 font-ui text-[13px] text-red-200">Contradiction · {item.summary}</div>)}</div>}
    </div>}
    <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-terminal text-[12px] text-muted-foreground">LIVE DOCUMENT · BASE V{baseRevision}</span><button type="button" disabled={disabled || saving || pending || conflict} onClick={()=>{setRichError(null);setBuiltin(current=>!current);}} className="ml-auto rounded border border-border/50 px-2 py-1 text-[13px]">{builtin ? "Open rich document editor" : "Use built-in text editor"}</button></div>
    {builtin || richError ? fallback : <RichDocumentBoundary key={baseRevision} fallback={<div><p role="alert" className="mb-2 text-sm text-amber-200">Rich renderer unavailable. Your canonical draft is retained in the built-in editor.</p>{fallback}</div>}><Suspense fallback={<div><p role="status">Loading rich editor. The built-in editor remains available.</p><button type="button" onClick={()=>setBuiltin(true)} className="underline">Use built-in text editor</button></div>}><RichArtifactDocumentEditor content={content} disabled={disabled || saving || pending || advancedDirty || recovery.blocked} onChange={setContent} onError={setRichError}/></Suspense></RichDocumentBoundary>}
    <div className="mt-2 flex flex-wrap items-center justify-end gap-2"><span role="status" aria-live="polite" data-testid="document-save-status" className="mr-auto text-sm text-muted-foreground">{notice ?? (advancedDirty ? "Unsaved advanced JSON changes · save or reset in the advanced editor" : dirty ? "Unsaved local changes" : "No unsaved document changes")}</span><button type="button" data-testid="save-document-revision" disabled={disabled || !dirty || saving || pending || conflict || advancedDirty || recovery.blocked} onClick={()=>void saveDocument().catch(()=>{})} className="rounded bg-amber-300 px-3 py-1.5 font-ui text-[13px] font-semibold text-black disabled:opacity-40">{saving ? "Saving document revision…" : pending ? "Waiting for canonical revision…" : "Save document revision"}</button></div>
    </fieldset>
    {content.kind==="research"&&<details className="mt-3 rounded-lg border border-border/40 p-2"><summary className="cursor-pointer font-terminal text-[12px] text-muted-foreground">ADVANCED RESEARCH STATE · PLAN / EVIDENCE / CONTRADICTIONS / EXECUTION TRAIL</summary><div className="mt-2"><JsonEditor key={baseRevision} content={draftContent} disabled={disabled || saving || pending || conflict || recovery.blocked} onDirtyChange={setAdvancedDirty} onSave={async next=>{if(next.kind!=="research")throw new Error("The research document kind cannot be changed here.");setContent(next);setQuestion(next.question);setSourceMode(next.sourcePolicy.mode);setAllowedRefs(next.sourcePolicy.allowedSourceRefs.join("\n"));await saveDocument(next);}}/></div></details>}
  </div>;
}
function SpreadsheetEditor(props: {content:Extract<ArtifactContent,{kind:"spreadsheet"}>;onSave:(c:ArtifactContent)=>Promise<void>;onDraft:(d:SpreadsheetCellDiff)=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void;disabled?:boolean;revisionKey?:string;recoveryContext?: NativeArtifactDraftContext | null}) {
  if (props.content.rendererPreference === "univer") return <Suspense fallback={<p role="status">Loading spreadsheet editor…</p>}><UniverSpreadsheetEditor {...props} /></Suspense>;
  return <BuiltinSpreadsheetEditor {...props}/>;
}
function BuiltinSpreadsheetEditor({content,onSave,onDraft,onDirtyChange,disabled=false,revisionKey,recoveryContext}:{content:Extract<ArtifactContent,{kind:"spreadsheet"}>;onSave:(c:ArtifactContent)=>Promise<void>;onDraft:(d:SpreadsheetCellDiff)=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void;disabled?:boolean;revisionKey?:string;recoveryContext?: NativeArtifactDraftContext | null}) {
  const [grid, setGrid] = useState(() => artifactSheetToGrid(content));
  const [draftContent, setDraftContent] = useState(content);
  const [tick, setTick] = useState(0);
  const [selectedRef, setSelectedRef] = useState("B4");
  const [ref, setRef] = useState("B4");
  const [value, setValue] = useState("");
  const baseline = useRef({ content, revisionKey, recoveryContext });
  const draft = useRef({ content: draftContent, grid });
  draft.current = { content: draftContent, grid };
  const [conflict, setConflict] = useState(false);
  const [cleanupNotice, setCleanupNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const checkpoint = gridToArtifactSheet(draftContent, grid);
  const isDirty = spreadsheetDraftHasChanges(baseline.current.content, checkpoint);
  const recovery = useNativeArtifactDraftRecovery(baseline.current.recoveryContext ?? null, checkpoint, isDirty, tick, saved => {
    setDraftContent(saved); setGrid(artifactSheetToGrid(saved)); setConflict(false);
    onDirtyChange?.(true); setTick(current => current + 1);
  });
  useEffect(() => {
    const local = gridToArtifactSheet(draft.current.content, draft.current.grid);
    const dirty = spreadsheetDraftHasChanges(baseline.current.content, local);
    const revisionChanged = baseline.current.revisionKey !== revisionKey;
    if (!revisionChanged && !spreadsheetDraftHasChanges(baseline.current.content, content)) return;
    if (dirty && spreadsheetDraftHasChanges(content, local)) {
      setConflict(true); onDirtyChange?.(true); return;
    }
    baseline.current = { content, revisionKey, recoveryContext };
    setDraftContent(content); setGrid(artifactSheetToGrid(content)); setTick(v => v + 1);
    setConflict(false); onDirtyChange?.(false);
  }, [content, revisionKey, onDirtyChange]);
  const reportDirty = () => {
    const dirty = spreadsheetDraftHasChanges(baseline.current.content, gridToArtifactSheet(draftContent, grid));
    onDirtyChange?.(dirty || conflict);
  };
  const sheet = draftContent.sheets.find(s => s.id === draftContent.activeSheetId)!;
  const selectSheet = (sheetId: string) => {
    if (disabled || conflict || sheetId === sheet.id) return;
    // Flush the active renderer into the same P4 draft before projecting another worksheet.
    const next = { ...gridToArtifactSheet(draftContent, grid), activeSheetId: sheetId };
    onDirtyChange?.(spreadsheetDraftHasChanges(baseline.current.content, next) || conflict);
    setDraftContent(next);
    setGrid(artifactSheetToGrid(next));
    setTick(v => v + 1);
  };
  const rows = Math.min(sheet.rowCount, 30), cols = Math.min(sheet.columnCount, 12);
  const selectedInBounds = checkedSpreadsheetCellRef(sheet, selectedRef) !== null;
  // Invalid and out-of-bounds user-input refs must never reach the grid
  // engine: returning an explicit unavailable inspector is safer than a crash.
  const selectedCell = selectedInBounds
    ? { ...sheet.cells[selectedRef], raw: grid.getCell(selectedRef).raw, format: grid.getFormat(selectedRef) }
    : null;
  const reviewRef = checkedSpreadsheetCellRef(sheet, ref);
  const persist = async (next: ArtifactContent) => {
    if (disabled || conflict || recovery.blocked || saving) return;
    setSaving(true); setSaveError(null);
    try { await onSave(next); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Spreadsheet revision could not be saved. Your local draft was retained."); }
    finally { setSaving(false); }
  };
  const propose = async () => {
    if (disabled || conflict || recovery.blocked || saving) return;
    setSaving(true); setSaveError(null);
    try { await onDraft(prepareSpreadsheetCellReview(baseline.current.content, sheet.id, ref, value)); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Spreadsheet review diff could not be created."); }
    finally { setSaving(false); }
  };
  return <div>
    <NativeDraftRecoveryNotice recovery={recovery} dirty={isDirty}/>
    {cleanupNotice && <p role="status" className="mb-2 text-sm text-amber-200">{cleanupNotice}</p>}
    {conflict && <p role="alert" className="mb-3 text-sm text-amber-200">A different saved revision arrived. Your local worksheet draft is retained; saving and model maintenance are blocked.<button type="button" disabled={disabled} onClick={() => void (async () => {
      try { await recovery.clear(); }
      catch { setCleanupNotice("Saved revision reloaded, but encrypted checkpoint cleanup needs review."); }
      baseline.current = { content, revisionKey, recoveryContext }; setDraftContent(content);
      setGrid(artifactSheetToGrid(content)); setConflict(false); onDirtyChange?.(false); setTick(v => v + 1);
    })()} className="ml-2 underline disabled:opacity-40">Discard local draft and reload saved revision</button></p>}
    <fieldset disabled={disabled || saving || conflict || recovery.blocked} className="min-w-0">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="font-terminal text-[12px] text-muted-foreground">SPREADSHEET · BASIC EDITOR</span>
      <label className="text-[13px] text-muted-foreground">Worksheet <select aria-label="Spreadsheet worksheet" value={sheet.id} onChange={e => selectSheet(e.target.value)} className="ml-1 rounded border border-border/50 bg-[#090909] px-2 py-1">{draftContent.sheets.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
      <button onClick={() => void persist({...gridToArtifactSheet(draftContent, grid), rendererPreference: "univer"})} className="ml-auto rounded border border-border px-3 py-1.5 font-ui text-[13px]">Open advanced spreadsheet editor</button>
    </div>
    <div className="max-h-[420px] overflow-auto rounded-lg border border-border/60" data-render-tick={tick}>
      <table className="border-collapse"><thead><tr><th className="sticky left-0 top-0 z-20 bg-[#0a0a0a]"/>{Array.from({length:cols},(_,c) => <th key={c} className="sticky top-0 border border-border/40 bg-[#0a0a0a] px-2 py-1 font-terminal text-[12px] text-muted-foreground">{colIndexToLetters(c)}</th>)}</tr></thead>
        <tbody>{Array.from({length:rows},(_,r) => <tr key={r}><th className="sticky left-0 border border-border/40 bg-[#0a0a0a] px-2 font-terminal text-[12px] text-muted-foreground">{r+1}</th>{Array.from({length:cols},(_,c) => {
          const cellRef = `${colIndexToLetters(c)}${r+1}`;
          const cell = grid.getCell(cellRef);
          return <td key={cellRef} data-sheet-id={sheet.id} data-cell-ref={cellRef} className="border border-border/35 p-0"><input aria-label={`Cell ${cellRef}`} value={cell.raw} title={cell.error ?? String(cell.value ?? "")} onFocus={() => setSelectedRef(cellRef)} onChange={e => { grid.setCell(cellRef,e.target.value); reportDirty(); setTick(v => v + 1); }} className={`h-7 min-w-[92px] bg-transparent px-1.5 font-terminal text-[13px] outline-none ${cell.error ? "text-red-300" : cell.raw.startsWith("=") ? "text-foreground" : "text-cyan-200"}`}/></td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="text-[13px] text-muted-foreground">Selected cell <input aria-label="Selected cell reference" value={selectedRef} onChange={e => setSelectedRef(e.target.value.trim().toUpperCase())} className="ml-1 w-20 rounded border border-border/50 bg-black/20 px-2 py-1 font-terminal"/></label>
      <label className="text-[13px] text-muted-foreground">Number format <input aria-label="Selected cell number format" disabled={!selectedInBounds} value={selectedCell?.format ?? ""} maxLength={200} onChange={e => { grid.setFormat(selectedRef, e.target.value || null); reportDirty(); setTick(v => v + 1); }} className="ml-1 rounded border border-border/50 bg-black/20 px-2 py-1 font-terminal disabled:opacity-40"/></label>
    </div>
    {selectedInBounds && selectedCell ? <SpreadsheetCellSourceInspect sheetName={sheet.name} cellRef={selectedRef} cell={selectedCell}/> : <p className="mt-2 text-[13px] text-muted-foreground">Select a cell reference within this worksheet to inspect its recorded source.</p>}
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <button disabled={!isDirty} onClick={() => { if (isDirty) void persist(gridToArtifactSheet(draftContent,grid)); }} className="rounded bg-amber-300 px-3 py-1.5 font-ui text-[13px] font-semibold text-black disabled:opacity-40">Save spreadsheet revision</button>
      <div className="ml-auto flex gap-1"><input aria-label="Proposed cell reference" aria-invalid={!reviewRef} value={ref} onChange={e => setRef(e.target.value.toUpperCase())} className="w-16 rounded border border-border/50 bg-black/20 px-2 py-1 font-terminal text-[13px]"/><input aria-label="Proposed cell value" value={value} onChange={e => setValue(e.target.value)} placeholder="proposed raw" className="w-32 rounded border border-border/50 bg-black/20 px-2 py-1 font-terminal text-[13px]"/><button disabled={!reviewRef} onClick={() => void propose()} className="rounded border border-cyan-300/20 px-2 py-1 font-ui text-[13px] text-cyan-200">Create review diff</button></div>
    </div>
    </fieldset>
    {saveError && <p role="alert" data-testid="spreadsheet-save-error" className="mt-2 text-[13px] text-red-300">{saveError}</p>}
    {!reviewRef && <p role="status" className="mt-1 font-ui text-[12px] text-amber-200">Enter a cell within the saved worksheet bounds to create a review diff.</p>}
  </div>;
}
/** Same canonical acknowledgement/reconciliation used by document and terminal drafts. */
function useAuthoredArtifactDraft<T extends ArtifactContent>(incoming:T,revision:number,onSave:(content:ArtifactContent)=>Promise<void>,onDirtyChange:((dirty:boolean)=>void)|undefined,additionalDirty=false) {
  const [draft,setDraft]=useState(incoming);
  const [base,setBase]=useState(incoming);
  const [baseRevision,setBaseRevision]=useState(revision);
  const [baseline,setBaseline]=useState(()=>stableSerialize(incoming));
  const [saving,setSaving]=useState(false);
  const [pending,setPending]=useState(false);
  const [conflict,setConflict]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const draftRef=useRef(draft); draftRef.current=draft;
  const submitted=useRef<string|null>(null);
  const saveRef=useRef(onSave);
  const dirty=stableSerialize(draft)!==baseline;
  const callback=useRef(onDirtyChange);callback.current=onDirtyChange;
  useEffect(()=>{callback.current?.(dirty||additionalDirty||saving||pending||conflict);},[dirty,additionalDirty,saving,pending,conflict]);
  useEffect(()=>()=>callback.current?.(false),[]);
  useEffect(()=>{
    if(revision===baseRevision&&stableSerialize(incoming)===baseline)return;
    const transition=reconcileTerminalDraft(incoming,draftRef.current,baseline,submitted.current);
    if(transition.conflict||(additionalDirty&&!transition.acknowledged)){setConflict(true);return;}
    setBase(incoming);setBaseline(transition.baseline);setBaseRevision(revision);saveRef.current=onSave;
    if(transition.replaceDraft)setDraft(incoming);
    if(transition.acknowledged){submitted.current=null;setPending(false);}
    setConflict(false);
  },[incoming,revision,baseRevision,baseline,onSave,additionalDirty]);
  const save=async(next:T=draftRef.current)=>{
    if(saving||pending||conflict||baseRevision!==revision||submitted.current!==null)throw new Error("Reload or finish the current save before saving this draft.");
    submitted.current=stableSerialize(next);setDraft(next);setSaving(true);setNotice(null);
    try{await saveRef.current(next);setPending(submitted.current!==null);}
    catch(error){submitted.current=null;setNotice(error instanceof Error?error.message:"Save failed; draft retained.");throw error;}
    finally{setSaving(false);}
  };
  const reset=()=>{setDraft(incoming);setBase(incoming);setBaseline(stableSerialize(incoming));setBaseRevision(revision);saveRef.current=onSave;submitted.current=null;setPending(false);setConflict(false);setNotice(null);};
  return{draft,setDraft,base,baseRevision,dirty,saving,pending,conflict,notice,save,reset,blocked:saving||pending||conflict||baseRevision!==revision};
}

function ThesisEditor({content,revision,onSave,onRefresh,onPostmortem,onDirtyChange,disabled=false}:{content:Extract<ArtifactContent,{kind:"thesis"}>;revision:number;onSave:(c:ArtifactContent)=>Promise<void>;onRefresh:()=>Promise<void>;onPostmortem:(input:{outcome:"validated"|"partially_validated"|"invalidated"|"closed";summary:string})=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void;disabled?:boolean}) {
  const [advancedDirty,setAdvancedDirty]=useState(false);
  const [advancedReset,setAdvancedReset]=useState(0);
  const [postmortemOpen,setPostmortemOpen]=useState(false);
  const [postmortemSummary,setPostmortemSummary]=useState("");
  const [postmortemOutcome,setPostmortemOutcome]=useState<"validated"|"partially_validated"|"invalidated"|"closed">("partially_validated");
  const editor=useAuthoredArtifactDraft(content,revision,onSave,onDirtyChange,advancedDirty||Boolean(postmortemSummary.trim()));
  const summary=editor.draft.summary;
  const setSummary=(value:string)=>editor.setDraft(current=>({...current,summary:value}));
  const statusTone=content.status==="invalidated"?"text-red-300":content.status==="active"?"text-emerald-300":"text-amber-200";
  return <div className="space-y-3">
    {(editor.conflict||editor.notice)&&<p role="alert" className="text-sm text-amber-200">{editor.notice??"A newer revision arrived. Your draft is retained; reload explicitly to discard it."}</p>}
    {(editor.dirty||advancedDirty||editor.conflict||editor.pending)&&<button type="button" disabled={editor.saving} onClick={()=>{editor.reset();setAdvancedReset(value=>value+1);setAdvancedDirty(false);setPostmortemSummary("");}} className="min-h-10 underline">Reload saved thesis</button>}
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded border border-border/50 px-2 py-1 font-terminal text-[12px] ${statusTone}`}>{content.status.toUpperCase()}</span>
      {content.entityRef&&<span className="font-terminal text-[13px] text-cyan-300">{content.entityRef}</span>}
      <span className="font-terminal text-[12px] text-muted-foreground">{content.expectedOutcomes.length} EXPECTED OUTCOMES · {content.claims.length} CLAIMS · {content.catalysts.length} CATALYSTS · {content.risks.length} RISKS</span>
      <div className="ml-auto flex gap-1">
        <button disabled={disabled||editor.blocked||editor.dirty||advancedDirty||Boolean(postmortemSummary.trim())} onClick={()=>void onRefresh()} className="rounded border border-cyan-300/20 px-2 py-1 font-ui text-[13px] text-cyan-200 disabled:opacity-40">Refresh from Project evidence</button>
        <button onClick={()=>setPostmortemOpen((v)=>!v)} className="rounded border border-fuchsia-300/20 px-2 py-1 font-ui text-[13px] text-fuchsia-200">Postmortem</button>
      </div>
    </div>
    <div>
      <div className="mb-1 font-terminal text-[12px] text-muted-foreground">THESIS SUMMARY</div>
      <textarea aria-label="Thesis summary" disabled={disabled||editor.blocked||advancedDirty} value={summary} onChange={(e)=>setSummary(e.target.value)} className="min-h-24 w-full rounded-lg border border-border/50 bg-black/15 p-3 font-ui text-[14px] leading-5 outline-none"/>
      <div className="mt-2 flex justify-end"><button disabled={disabled||editor.blocked||advancedDirty||!editor.dirty} onClick={()=>void editor.save().catch(()=>{})} className="rounded bg-amber-300 px-3 py-1.5 font-ui text-[13px] font-semibold text-black disabled:opacity-40">Save thesis revision</button></div>
    </div>
    {postmortemOpen&&<div className="rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/[0.02] p-3">
      <div className="font-terminal text-[12px] text-fuchsia-200">APPEND IMMUTABLE THESIS POSTMORTEM</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select value={postmortemOutcome} onChange={(e)=>setPostmortemOutcome(e.target.value as typeof postmortemOutcome)} className="rounded border border-border/50 bg-[#090909] px-2 py-1.5 font-ui text-[13px]">
          <option value="validated">Validated</option><option value="partially_validated">Partially validated</option><option value="invalidated">Invalidated</option><option value="closed">Closed</option>
        </select>
        <input value={postmortemSummary} onChange={(e)=>setPostmortemSummary(e.target.value)} placeholder="What happened, and what did the thesis get right or wrong?" className="min-w-[280px] flex-1 rounded border border-border/50 bg-black/20 px-2 py-1.5 font-ui text-[14px] outline-none"/>
        <button disabled={disabled||editor.blocked||editor.dirty||advancedDirty||!postmortemSummary.trim()} onClick={()=>void onPostmortem({outcome:postmortemOutcome,summary:postmortemSummary.trim()}).then(()=>{setPostmortemSummary("");setPostmortemOpen(false)})} className="rounded bg-fuchsia-300 px-3 py-1.5 font-ui text-[13px] font-semibold text-black disabled:opacity-40">Append</button>
      </div>
    </div>}
    <div className="grid gap-3 lg:grid-cols-2">
      <ThesisList title="Expected outcomes" rows={content.expectedOutcomes.map((x)=>({id:x.id,text:x.text,status:x.status,refs:x.evidenceRefs}))}/>
      <ThesisList title="Claims" rows={content.claims.map((x)=>({id:x.id,text:x.text,status:x.status,refs:[...x.evidenceRefs,...x.counterEvidenceRefs]}))}/>
      <ThesisList title="Catalysts" rows={content.catalysts.map((x)=>({id:x.id,text:x.text,status:x.status,refs:x.evidenceRefs}))}/>
      <ThesisList title="Risks" rows={content.risks.map((x)=>({id:x.id,text:x.text,status:x.status,refs:x.evidenceRefs}))}/>
      <ThesisList title="Open questions" rows={content.openQuestions.map((x)=>({id:x.id,text:x.text,status:x.status,refs:x.evidenceRefs}))}/>
    </div>
    {!!content.invalidationConditions.length&&<ThesisList title="Invalidation conditions" rows={content.invalidationConditions.map((x)=>({id:x.id,text:x.text,status:x.triggered?"TRIGGERED":"open",refs:x.evidenceRefs}))}/>}
    {(content.refresh.changes.length>0||content.refresh.contradictions.length>0)&&<div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.02] p-3">
      <div className="font-terminal text-[12px] text-amber-200">LATEST DETERMINISTIC REFRESH · {content.refresh.lastRefreshedAt?new Date(content.refresh.lastRefreshedAt).toLocaleString():"—"}</div>
      <div className="mt-2 space-y-1">{content.refresh.changes.map((x,i)=><div key={`c-${i}`} className="font-ui text-[13px] text-muted-foreground">• {x}</div>)}</div>
      <div className="mt-2 space-y-1">{content.refresh.contradictions.map((x,i)=><div key={`x-${i}`} className="font-ui text-[13px] text-red-300">• {x}</div>)}</div>
    </div>}
    {!!content.postmortems.length&&<div className="rounded-lg border border-border/50 p-3"><div className="font-terminal text-[12px] text-muted-foreground">POSTMORTEMS</div>{content.postmortems.slice().reverse().slice(0,10).map((p,i)=><div key={i} className="mt-2 border-t border-border/35 pt-2"><div className="flex gap-2"><span className="font-terminal text-[12px] text-fuchsia-300">{p.outcome.toUpperCase()}</span><span className="font-terminal text-[12px] text-muted-foreground">{new Date(p.at).toLocaleString()}</span></div><div className="mt-1 font-ui text-[14px]">{p.summary}</div></div>)}</div>}
    <details className="rounded-lg border border-border/40 p-2"><summary className="cursor-pointer font-terminal text-[12px] text-muted-foreground">ADVANCED STRUCTURED EDITOR</summary><div className="mt-2"><JsonEditor key={`${editor.baseRevision}:${advancedReset}`} content={editor.base} disabled={disabled||editor.blocked||editor.dirty} onDirtyChange={setAdvancedDirty} onSave={async next=>{if(next.kind!=="thesis")throw new Error("Thesis kind cannot change.");await editor.save(next);}}/></div></details>
  </div>;
}
function ThesisList({title,rows}:{title:string;rows:Array<{id:string;text:string;status:string;refs:string[]}>}) {
  return <div className="rounded-lg border border-border/50 p-3"><div className="font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">{title}</div><div className="mt-2 space-y-2">{rows.length?rows.map((row)=><div key={row.id} className="rounded border border-border/35 p-2"><div className="flex gap-2"><span className="font-terminal text-[12px] text-cyan-300">{row.status.toUpperCase()}</span><span className="font-ui text-[14px]">{row.text}</span></div>{row.refs.length>0&&<div className="mt-1 font-terminal text-[12px] text-muted-foreground">{row.refs.length} EVIDENCE REF{row.refs.length===1?"":"S"}</div>}</div>):<div className="font-ui text-[13px] text-muted-foreground">None yet.</div>}</div></div>;
}

function StrategyEditor({content,revision,onSave,onDirtyChange,disabled=false}:{content:Extract<ArtifactContent,{kind:"strategy"}>;revision:number;onSave:(c:ArtifactContent)=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void;disabled?:boolean}) {
  const editor=useAuthoredArtifactDraft(content,revision,onSave,onDirtyChange);
  const source=editor.draft.source;
  return <div><div className="mb-2 font-terminal text-[12px] text-muted-foreground">STRATEGY STUDIO · {content.language.toUpperCase()} · {content.validation.status.toUpperCase()}</div>
    {(editor.conflict||editor.notice)&&<p role="alert" className="text-sm text-amber-200">{editor.notice??"A newer revision arrived. Your draft is retained; reload explicitly to discard it."}</p>}
    <textarea aria-label="Strategy source" disabled={disabled||editor.blocked} value={source} onChange={event=>editor.setDraft(current=>({...current,source:event.target.value,validation:{status:"unvalidated",errors:[]}}))} className="min-h-[320px] w-full rounded-lg border border-border/50 bg-black/20 p-3 font-terminal text-[14px] leading-5 text-foreground outline-none"/>
    <div className="mt-2 flex justify-end gap-2"><button type="button" disabled={editor.saving} onClick={editor.reset} className="min-h-10 underline">Reload saved strategy</button><button disabled={disabled||editor.blocked||!editor.dirty} onClick={()=>void editor.save().catch(()=>{})} className="rounded bg-amber-300 px-3 py-1.5 font-ui text-[13px] font-semibold text-black disabled:opacity-40">Save strategy revision</button></div></div>;
}
function Body({artifactId,contentHash,content,revision,onSave,onDraft,onThesisRefresh,onThesisPostmortem,onSpreadsheetDirtyChange,spreadsheetDisabled,facts,artifactSourceRefs,onOpenExport,onAsk,owner,onNativeVersion}:{artifactId:string;contentHash:string;content:ArtifactContent;revision:number;onSave:(c:ArtifactContent)=>Promise<void>;onDraft:(d:SpreadsheetCellDiff)=>Promise<void>;onThesisRefresh:()=>Promise<void>;onThesisPostmortem:(input:{outcome:"validated"|"partially_validated"|"invalidated"|"closed";summary:string})=>Promise<void>;onSpreadsheetDirtyChange?:(dirty:boolean)=>void;spreadsheetDisabled?:boolean;facts?:ArtifactProvenanceFacts;artifactSourceRefs?:readonly string[];onOpenExport?:()=>void;onAsk:(id:string,title:string,stagedPrompt?:string)=>void;owner:{projectId:number|null;owningChatId:number|null};onNativeVersion:(version:number)=>void}) {
  const recoveryOwner = useNativeArtifactDraftOwner();
  const recoveryLifetime = useNativeDraftLifetime(`${recoveryOwner ?? ""}\0${artifactId}`);
  const [recoveryCleanupWarning, setRecoveryCleanupWarning] = useState<string | null>(null);
  const recoveryContext = recoveryOwner ? { owner: recoveryOwner, artifactId, baseVersion: revision, contentHash } : null;
  const saveWithRecovery = async (next: ArtifactContent) => {
    const lease = recoveryLifetime.current;
    await onSave(next);
    try { if (recoveryContext) await clearNativeArtifactDraft(recoveryContext, lease); }
    catch { if (lease.active) setRecoveryCleanupWarning("Revision saved. Encrypted draft cleanup failed; review the checkpoint when reopening."); }
  };
  if(content.kind==="screen" && content.state.terminal) return <TerminalScreenArtifact content={content} revision={revision} onSave={onSave} onDirtyChange={onSpreadsheetDirtyChange} disabled={spreadsheetDisabled} onAsk={onAsk} target={{artifactId,version:revision,contentHash,...owner}} onNativeVersion={onNativeVersion}/>;
  if(content.kind==="spreadsheet" || content.kind==="research" || content.kind==="report") return <>
    {recoveryCleanupWarning && <p role="status" className="mb-2 text-sm text-amber-200">{recoveryCleanupWarning}</p>}
    {content.kind==="spreadsheet"
      ? <SpreadsheetEditor content={content} recoveryContext={recoveryContext} revisionKey={`${revision}:${contentHash}`} onSave={saveWithRecovery} onDraft={onDraft} onDirtyChange={onSpreadsheetDirtyChange} disabled={spreadsheetDisabled}/>
      : <DocumentEditor content={content} recoveryContext={recoveryContext} revision={revision} onSave={saveWithRecovery} onDirtyChange={onSpreadsheetDirtyChange} disabled={spreadsheetDisabled}/>}
  </>;
  if(content.kind==="chart") return <ArtifactChartBoundary><Suspense fallback={<p role="status">Loading chart renderer…</p>}><ArtifactChart content={content} artifactSourceRefs={artifactSourceRefs} onSave={onSave}/></Suspense></ArtifactChartBoundary>;
  if(content.kind==="table") return <TableArtifactTable content={content}/>;
  if(content.kind==="timeline") return <ArtifactTimeline content={content}/>;
  if(content.kind==="backtest") return <BacktestArtifactView content={content} facts={facts} onSave={onSave} onDirtyChange={onSpreadsheetDirtyChange} disabled={spreadsheetDisabled}/>;
  if(content.kind==="thesis") return <ThesisEditor content={content} revision={revision} onSave={onSave} onRefresh={onThesisRefresh} onPostmortem={onThesisPostmortem} onDirtyChange={onSpreadsheetDirtyChange} disabled={spreadsheetDisabled}/>;
  if(content.kind==="strategy") return <StrategyEditor content={content} revision={revision} onSave={onSave} onDirtyChange={onSpreadsheetDirtyChange} disabled={spreadsheetDisabled}/>;
  if(content.kind==="decision") return <Suspense fallback={<p role="status">Loading native decision editor…</p>}><DecisionArtifactEditor artifactId={artifactId} content={content} revision={revision} contentHash={contentHash} onSave={onSave} onDirtyChange={onSpreadsheetDirtyChange}/></Suspense>;
  if(content.kind==="valuation") return <ValuationArtifactView content={content} facts={facts} onSave={onSave} onDirtyChange={onSpreadsheetDirtyChange} disabled={spreadsheetDisabled} onRequestRecalculation={(waccPct) => onAsk(artifactId, `Recalculate valuation · ${content.symbol || content.modelId}`, prepareValuationRecalculationPrompt(content, { artifactId, version: revision, contentHash }, waccPct))}/>;
  if(content.kind==="portfolio") return <PortfolioArtifactView content={content} facts={facts} onSave={onSave} onDirtyChange={onSpreadsheetDirtyChange} disabled={spreadsheetDisabled}/>;
  return <ArtifactViewerFallback kind={content.kind} content={content} onSave={onSave} onOpenExport={onOpenExport} facts={content.kind==="screen"?[{label:"Screen",value:content.view},...(content.symbol?[{label:"Symbol",value:content.symbol}]:[])]:[]}/>;
}
function FieldValue({ value, exact = false }: { value: unknown; exact?: boolean }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "object") return <details><summary className="cursor-pointer text-muted-foreground">View details</summary><ReadableValue value={value} exact={exact} className="mt-2" /></details>;
  return <span>{typeof value === "number" && !exact ? value.toLocaleString(undefined, { maximumSignificantDigits: 12 }) : String(value)}</span>;
}
const TABLE_PAGE_SIZE = 100;
type PreviewColumn = string | { key: string; label: string };

function DataPreview({ columns, rows, offset = 0, canonicalTable = false }: { columns: PreviewColumn[]; rows: Array<Record<string, unknown>>; offset?: number; canonicalTable?: boolean }) {
  const visibleRows = rows.length > TABLE_PAGE_SIZE ? rows.slice(0, TABLE_PAGE_SIZE) : rows;
  return <div className="max-h-[380px] overflow-auto rounded border border-border/50" tabIndex={0} aria-label="Recorded data table">
    <table className="w-full text-left font-ui text-[13px]"><caption className="sr-only">Recorded data, rows {visibleRows.length ? offset + 1 : 0} to {visibleRows.length ? offset + visibleRows.length : 0}</caption>
      <thead className="sticky top-0 bg-background"><tr>{columns.map((column) => <th key={typeof column === "string" ? column : column.key} scope="col" className="border-b border-border p-3 font-semibold">{typeof column === "string" ? column : column.label}</th>)}</tr></thead>
      <tbody>{visibleRows.map((row, index) => <tr key={offset + index}>{columns.map((column) => {
        const key = typeof column === "string" ? column : column.key;
        return <td key={key} tabIndex={canonicalTable ? 0 : undefined} data-table-row={canonicalTable ? offset + index : undefined} data-table-column={canonicalTable ? key : undefined} className="border-b border-border/30 p-3 align-top tabular-nums"><FieldValue value={row[key]} exact /></td>;
      })}</tr>)}</tbody>
    </table>{!rows.length && <p className="p-3 text-sm text-muted-foreground">No rows available on this page.</p>}
  </div>;
}

function TablePaging({ offset, shown, available, reported, previousOffset, nextOffset, busy = false, previewOnly = false, onPage }: {
  offset: number; shown: number; available: number; reported: number;
  previousOffset: number | null; nextOffset: number | null; busy?: boolean; previewOnly?: boolean;
  onPage: (offset: number) => void;
}) {
  return <div className="space-y-2">
    <p role="status" aria-live="polite" aria-atomic="true" data-testid="artifact-table-counts" className="font-terminal text-[12px] text-muted-foreground">
      Showing {shown ? `${offset + 1}–${offset + shown}` : "0"} · {shown} shown · {available} available · {reported} full reported rows
    </p>
    <nav aria-label="Artifact table pages" className="flex items-center gap-3">
      <button type="button" aria-label="Previous table page" disabled={busy || previousOffset === null} onClick={() => { if (previousOffset !== null) onPage(previousOffset); }} className="rounded border border-border/50 px-3 py-2 font-ui text-[13px] disabled:opacity-40">Previous</button>
      <button type="button" aria-label="Next table page" disabled={busy || nextOffset === null} onClick={() => { if (nextOffset !== null) onPage(nextOffset); }} className="rounded border border-border/50 px-3 py-2 font-ui text-[13px] disabled:opacity-40">Next</button>
      {!busy && nextOffset === null && <span className="text-sm text-muted-foreground">{previewOnly ? "End of available preview." : "End of available rows."}</span>}
    </nav>
  </div>;
}

export function TableArtifactTable({ content }: { content: Extract<ArtifactContent, { kind: "table" }> }) {
  const [offset, setOffset] = useState(0);
  const rows = content.rows.slice(offset, offset + TABLE_PAGE_SIZE);
  const available = content.rows.length;
  return <section aria-label="Table Artifact rows" data-testid="artifact-table-page" className="space-y-3">
    <TablePaging offset={offset} shown={rows.length} available={available} reported={available}
      previousOffset={offset > 0 ? Math.max(0, offset - TABLE_PAGE_SIZE) : null}
      nextOffset={offset + rows.length < available ? offset + TABLE_PAGE_SIZE : null} onPage={setOffset}/>
    <DataPreview columns={content.columns} rows={rows} offset={offset} canonicalTable/>
  </section>;
}

function DataArtifactTable({ artifactId, content }: { artifactId: string; content: Extract<ArtifactContent, { kind: "data" }> }) {
  const [previewOffset, setPreviewOffset] = useState(0);
  const [result, setResult] = useState<DataArtifactQueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; offset: number } | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => () => { request.current += 1; }, []);

  const queryPage = async (offset: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const requestId = ++request.current;
    setBusy(true);
    setFailure(null);
    try {
      const page = await queryDataArtifact(artifactId, { limit: TABLE_PAGE_SIZE, offset });
      if (requestId === request.current) setResult(page);
    } catch (cause) {
      if (requestId === request.current) setFailure({ message: cause instanceof Error ? cause.message : "Data query failed.", offset });
    } finally {
      if (requestId === request.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };

  const offset = result?.offset ?? previewOffset;
  const rows = result ? result.sample : content.previewRows.slice(offset, offset + TABLE_PAGE_SIZE);
  const shown = Math.min(rows.length, TABLE_PAGE_SIZE);
  const available = result?.availableRowCount ?? content.previewRows.length;
  const reported = result?.rowCount ?? content.rowCount;
  const previewOnly = !result || result.mode === "inline";
  const pageSize = result?.limit ?? TABLE_PAGE_SIZE;
  const previousOffset = offset > 0 ? Math.max(0, offset - pageSize) : null;
  const nextOffset = result ? result.nextOffset : offset + shown < available ? offset + TABLE_PAGE_SIZE : null;
  return <section aria-label="Data Artifact rows" data-testid="artifact-data-page" aria-busy={busy} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-terminal text-[12px] text-muted-foreground">{content.columns.length} columns · {result?.mode === "duckdb" ? "DUCKDB/PARQUET QUERY" : "INLINE PREVIEW"}</p>
      <button type="button" disabled={busy} onClick={() => void queryPage(0)} className="rounded border border-cyan-300/20 px-3 py-2 font-ui text-[13px] text-cyan-200 disabled:opacity-40">Query 100 rows</button>
    </div>
    {previewOnly && <p data-testid="artifact-preview-only" className="font-ui text-[13px] text-muted-foreground">Preview only: {available} recorded preview rows are available; unavailable source rows are not shown.{content.columnarArtifactId && !result ? " Query the linked dataset to page its available rows." : ""}</p>}
    <TablePaging offset={offset} shown={shown} available={available} reported={reported} previousOffset={previousOffset} nextOffset={nextOffset} busy={busy} previewOnly={previewOnly}
      onPage={result ? (next) => void queryPage(next) : setPreviewOffset}/>
    {busy && <p role="status" className="text-sm text-muted-foreground">Loading requested page… The rows below remain the last displayed page.</p>}
    {failure && <div role="alert" className="rounded border border-red-300/20 p-3 text-sm text-red-200"><p>{failure.message} The displayed page has not changed.</p><button type="button" disabled={busy} onClick={() => void queryPage(failure.offset)} className="mt-2 rounded border border-red-300/30 px-3 py-2 disabled:opacity-40">Retry data query</button></div>}
    <DataPreview columns={content.columns.map((column) => column.name)} rows={rows} offset={offset}/>
  </section>;
}
function IntegratedArtifactEngineInputs({ detail, onOpenOutput, blocked, onApplyingChange }: {
  detail: ArtifactDetail;
  onOpenOutput: (result: IntegratedModelArtifactRunResult) => void;
  blocked: boolean;
  onApplyingChange: (applying: boolean) => void;
}) {
  const invalidate = useInvalidateArtifacts();
  const [state, setState] = useState(initialEngineInputReviewState);
  const revision = {
    artifactId: detail.artifact.id, projectId: detail.artifact.projectId, owningChatId: detail.artifact.owningChatId,
    version: detail.version.version, headVersion: detail.artifact.headVersion, contentHash: detail.version.contentHash,
  };
  const currentRevision = useRef(revision);
  currentRevision.current = revision;
  const session = useRef<ArtifactEngineInputReviewSession | null>(null);
  useEffect(() => {
    const controller = new ArtifactEngineInputReviewSession(() => currentRevision.current, {
      review: reviewIntegratedModelArtifactInputs,
      run: runReviewedIntegratedModelArtifactInputs,
    }, setState);
    session.current = controller;
    return () => { controller.dispose(); if (session.current === controller) session.current = null; };
  }, []);
  useEffect(() => { session.current?.reconcileRevision(); }, [revision.artifactId, revision.projectId, revision.owningChatId, revision.version, revision.headVersion, revision.contentHash]);
  const outputCallback = useRef(onOpenOutput);
  outputCallback.current = onOpenOutput;
  useEffect(() => {
    if (!state.result) return;
    outputCallback.current(state.result);
    invalidate(state.result.outputArtifact.projectId, state.result.outputArtifact.id);
  }, [state.result, invalidate]);
  useEffect(() => { onApplyingChange(state.pending === "run"); return () => onApplyingChange(false); }, [state.pending, onApplyingChange]);
  const review = state.review;
  const current = revision.version === revision.headVersion;
  return <section aria-label="Governed engine inputs" data-testid="artifact-engine-inputs" aria-busy={state.pending !== null} className="mb-4 space-y-3 rounded-lg border border-emerald-300/25 p-3">
    <h3 className="font-ui text-[14px] font-semibold">Review saved engine inputs</h3>
    <p className="font-ui text-[13px] text-muted-foreground">Save spreadsheet changes first. Review reads only this saved Artifact revision against its recorded engine run and frozen dataset. Nothing runs automatically when you edit, save, or refresh.</p>
    <p className="font-ui text-[13px] text-muted-foreground">No host commands, provider requests, or automatic data fetches. Only assumptions and schedule-inputs are engine inputs; derived output sheets are not inputs. Running creates a new named engine run and the next canonical revision of this same Artifact in its existing Chat or Project.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" data-testid="artifact-review-engine-inputs" disabled={blocked || state.pending !== null || !current} onClick={() => void session.current?.review()} className="rounded border border-emerald-300/30 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40">{state.pending === "review" ? "Reviewing saved engine inputs…" : "Review engine inputs"}</button>
      {(review || state.pending === "review") && <button type="button" disabled={state.pending === "run"} onClick={() => session.current?.dismissReview()} className="rounded border border-border/50 px-3 py-2 text-sm disabled:opacity-40">Dismiss review</button>}
    </div>
    {!current && <p role="alert" className="text-sm text-amber-200">This saved version is not the current Artifact head. Reload before reviewing or running engine inputs.</p>}
    {blocked && <p role="alert" className="text-sm text-amber-200">Save pending Artifact edits and wait for the saved revision before reviewing or running.</p>}
    {review && <div data-testid="artifact-engine-input-review" data-reviewed-version={review.version} data-review-hash={review.reviewHash} className="space-y-3">
      <dl className="space-y-1 break-all font-terminal text-[12px]">
        <div><dt className="inline text-muted-foreground">Saved source revision: </dt><dd className="inline">{review.artifactId} · v{review.version}</dd></div>
        <div><dt className="inline text-muted-foreground">Artifact content hash: </dt><dd className="inline">{review.contentHash}</dd></div>
        <div><dt className="inline text-muted-foreground">Engine revision: </dt><dd className="inline">{review.engineRev}</dd></div>
        <div><dt className="inline text-muted-foreground">Source run: </dt><dd className="inline">{review.source.runId}</dd></div>
        <div><dt className="inline text-muted-foreground">Source run result hash: </dt><dd className="inline">{review.source.runResultHash}</dd></div>
        <div><dt className="inline text-muted-foreground">Frozen dataset: </dt><dd className="inline">{review.source.datasetSnapshotId}</dd></div>
        <div><dt className="inline text-muted-foreground">Dataset content hash: </dt><dd className="inline">{review.source.datasetContentHash}</dd></div>
        <div><dt className="inline text-muted-foreground">Current source policy: </dt><dd className="inline">{review.source.entitlementPolicyId} · {review.source.entitlementPolicyHash}</dd></div>
        <div><dt className="inline text-muted-foreground">Normalized input hash: </dt><dd className="inline">{review.inputHash}</dd></div>
        <div><dt className="inline text-muted-foreground">Required review hash: </dt><dd className="inline">{review.reviewHash}</dd></div>
      </dl>
      {review.changedFields.length ? <div className="overflow-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left">{review.changedFields.length} engine input changes from the recorded source run · exact values, no percentage or display rounding</caption><thead><tr><th scope="col" className="p-2">Saved cell / input</th><th scope="col" className="p-2">Before</th><th scope="col" className="p-2">After</th></tr></thead><tbody>{review.changedFields.map((field) => <tr key={`${field.sheetId}:${field.cell}:${field.path}`}><th scope="row" className="border-t border-border/40 p-2 font-normal">{field.sheetId}!{field.cell}<br/>{field.path}</th><td className="border-t border-border/40 p-2"><ReadableValue value={field.before} exact /></td><td className="border-t border-border/40 p-2"><ReadableValue value={field.after} exact /></td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No engine input changes from the recorded source run. An explicit run still creates a separate output.</p>}
      <details><summary className="cursor-pointer text-sm">Inspect all exact normalized assumptions and schedules</summary><ReadableValue value={{ assumptions: review.assumptions, schedules: review.schedules }} exact className="mt-2" /></details>
      <details><summary className="cursor-pointer text-sm">Recorded source references ({review.sourceRefs.length})</summary><ReadableValue value={review.sourceRefs} exact className="mt-2" /></details>
      <p className="text-sm text-muted-foreground">Run rechecks the saved head, source permissions, engine revision, and both captured hashes before deterministic execution. This does not authorize host execution or provider refresh.</p>
      <button type="button" data-testid="artifact-run-reviewed-inputs" disabled={blocked || state.pending !== null || !current} onClick={() => void session.current?.run()} className="rounded border border-emerald-300/40 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40">{state.pending === "run" ? "Running reviewed inputs…" : "Run reviewed inputs"}</button>
      {state.pending === "run" && <p role="status" className="text-sm text-muted-foreground">The explicit run is in flight. Leaving this inspector does not cancel server execution.</p>}
    </div>}
    {state.error && <div className="space-y-2"><p role="alert" data-testid="artifact-engine-input-error" className="break-words text-sm text-red-200">{state.error}</p><button type="button" disabled={state.pending !== null} onClick={() => invalidate(detail.artifact.projectId, detail.artifact.id)} className="rounded border border-border/50 px-3 py-2 text-sm disabled:opacity-40">Reload saved source revision</button></div>}
    {state.result && <div className="space-y-2">
      <p role="status" data-testid="artifact-engine-output-status" data-run-id={state.result.receipt.runId} data-artifact-id={state.result.outputArtifact.id} className="break-all text-sm text-emerald-200">Engine run {state.result.receipt.runId} saved on this Artifact · v{state.result.outputVersion.version}. The exact recomputed revision is selected in this workspace.</p>
    </div>}
  </section>;
}

interface ArtifactPaneProps {
  artifactId: string;
  version?: number | null;
  onVersionChange?: (version: number | null) => void;
  onDisplayedVersionChange?: (version: number, artifactId: string, requestedVersion: number | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  projectId: number | null;
  owningChatId?: number | null;
  sessions: ProjectSession[];
  onClose: () => void;
  onAsk: (id: string, title: string, stagedPrompt?: string) => void;
  onFocus?: (id: string, title: string) => void;
  onRerun?: (id: string, title: string, spec: ArtifactRefreshSpec) => void;
  /** Opens a different Artifact (for example a newly generated image) in the same surface. */
  onOpenArtifact?: (artifactId: string, version: number) => void;
}

function GeneratedImageArtifactView({ image, chatId, onOpenArtifact, onSaved }: {
  image: GeneratedImageView;
  chatId: number | null;
  onOpenArtifact?: (artifactId: string, version: number) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "status"; text: string } | null>(null);
  const created = image.createdAt && !Number.isNaN(Date.parse(image.createdAt)) ? new Date(image.createdAt).toLocaleString() : null;
  const source = [image.provider, image.model].filter(Boolean).join(" · ");
  const download = () => {
    const link = document.createElement("a");
    link.href = image.src;
    link.download = generatedImageFileName(image);
    link.click();
  };
  const createAnother = async () => {
    if (chatId === null || !image.prompt) return;
    setBusy(true); setMessage(null);
    try {
      const res = await fetch(`/api/chats/${chatId}/artifacts/generate-image`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ prompt: image.prompt }),
      });
      const body = await res.json().catch(() => null) as { artifact?: { id?: unknown; version?: unknown }; errorCode?: unknown; error?: unknown } | null;
      if (!res.ok) { setMessage({ tone: "error", text: generatedImageErrorMessage(res.status, body) }); return; }
      onSaved();
      const id = body?.artifact?.id, version = body?.artifact?.version;
      if (onOpenArtifact && typeof id === "string" && typeof version === "number") onOpenArtifact(id, version);
      else setMessage({ tone: "status", text: "A new image was saved in this Chat." });
    } catch {
      setMessage({ tone: "error", text: "The image couldn't be created. Check your connection and try again." });
    } finally { setBusy(false); }
  };
  return <figure data-testid="generated-image-artifact" className="space-y-3">
    <img src={image.src} alt={image.alt} className="max-h-[60vh] w-full rounded-lg border border-border/50 bg-black/20 object-contain"/>
    <figcaption className="space-y-1 font-ui text-[13px]">
      {image.prompt && <p className="text-foreground">{image.prompt}</p>}
      {(source || created) && <p className="text-muted-foreground">{[source, created].filter(Boolean).join(" · ")}</p>}
    </figcaption>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 font-ui text-[13px] hover:bg-white/[0.04]"><Download className="h-3.5 w-3.5" aria-hidden="true"/>Download image</button>
      {chatId !== null && image.prompt && <button type="button" onClick={() => void createAnother()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 font-ui text-[13px] hover:bg-white/[0.04] disabled:opacity-60"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true"/>{busy ? "Creating…" : "Create another"}</button>}
    </div>
    {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-red-300" : "text-sm text-muted-foreground"}>{message.text}</p>}
  </figure>;
}

function ArtifactReportRequest({ detail, artifactId, projectId, onRerun }: {
  detail: ArtifactDetail;
  artifactId: string;
  projectId: number | null;
  onRerun: NonNullable<ArtifactPaneProps["onRerun"]>;
}) {
  const catalogue = useQuery({
    queryKey: ["/api/wave-d/report-templates"],
    queryFn: async () => canonicalArtifactReportTemplates(await (await apiRequest("GET", "/api/wave-d/report-templates")).json()),
  });
  const [explicitChoice, setExplicitChoice] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = {
    artifactId: detail.artifact.id, versionArtifactId: detail.version.artifactId, projectId: detail.artifact.projectId, owningChatId: detail.artifact.owningChatId,
    version: detail.version.version, headVersion: detail.artifact.headVersion, contentHash: detail.version.contentHash,
  };
  const [captured] = useState(() => ({ ...current, artifactId, projectId }));
  const templates = catalogue.data ?? [];
  const recommendation = recommendedArtifactReportTemplate(detail.version.content.kind, templates);
  const templateId = explicitChoice ?? recommendation;
  const template = templates.find((item) => item.id === templateId);
  const sourceError = artifactReportSourceError(captured, current);
  const descriptionId = useId();
  return <section aria-label="Prepare report from Artifact" data-testid="artifact-report-request" className="mb-4 space-y-3 rounded-lg border border-cyan-300/25 p-3">
    <h3 className="font-ui text-[14px] font-semibold">Report from this Artifact</h3>
    <p id={descriptionId} className="text-sm text-muted-foreground">Choose a report structure, then prepare a request in the conversation composer for review. Nothing is sent or run automatically. The request uses My Data and deterministic execution: recorded Artifact content only, without provider fetches or recalculation. Missing report sections remain explicitly unavailable.</p>
    <p className="break-all font-terminal text-[12px] text-muted-foreground">Prepared from displayed source: {captured.artifactId} · v{captured.version} · content {shortHash(captured.contentHash)}. Save local edits first. Sending rechecks the current selected Artifact; its saved version may have changed since preparation.</p>
    {catalogue.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading report structures…</p>}
    {catalogue.isError && <div className="space-y-2"><p role="alert" className="text-sm text-red-200">Report structures could not be loaded. No request was prepared.</p><button type="button" disabled={catalogue.isFetching} onClick={() => void catalogue.refetch()} className="rounded border border-border/50 px-3 py-2 text-sm disabled:opacity-40">Retry report structures</button></div>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 font-ui text-[13px]">Report structure
        <select aria-label="Report structure" aria-describedby={descriptionId} value={templateId} disabled={catalogue.isError || !templates.length || Boolean(sourceError)} onChange={(event) => { setExplicitChoice(event.target.value); setNotice(null); setError(null); }} className="mt-1 block w-full rounded border border-border/50 bg-[#090909] px-3 py-2 text-sm disabled:opacity-40">
          <option value="">Choose a report structure</option>
          {templates.map((item) => <option key={item.id} value={item.id}>{item.name}{item.id === recommendation ? " · recommended for this Artifact" : ""}</option>)}
        </select>
      </label>
      <button type="button" data-testid="artifact-prepare-report-request" disabled={catalogue.isError || !template || Boolean(sourceError)} onClick={() => {
        setNotice(null); setError(null);
        try {
          const spec = prepareArtifactReportRequest({ templateId, templates, title: detail.artifact.title, captured, current });
          onRerun(captured.artifactId, detail.artifact.title, spec);
          setNotice(`${template!.name} request staged for review from displayed v${captured.version}. Sending rechecks the current selected Artifact and records the version actually used.`);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "The report request could not be prepared."); }
      }} className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-cyan-200 disabled:opacity-40">Prepare report request</button>
    </div>
    {template && <p className="text-sm text-muted-foreground">{template.description}</p>}
    {sourceError && <p role="alert" className="text-sm text-amber-200">{sourceError}</p>}
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    {notice && <p role="status" aria-live="polite" className="text-sm text-emerald-200">{notice}</p>}
  </section>;
}

export function ArtifactPane(props: ArtifactPaneProps) {
  const [selection, setSelection] = useState<{ artifactId: string; version: number } | null>(null);
  const controlledRevision = useRef({ artifactId: props.artifactId, version: props.version });
  if (controlledRevision.current.artifactId !== props.artifactId || controlledRevision.current.version !== props.version) {
    controlledRevision.current = { artifactId: props.artifactId, version: props.version };
    if (selection !== null) setSelection(null);
  }
  const selectedVersion = resolveArtifactPaneRequestedVersion(props.artifactId, props.version, selection);
  return <ArtifactPaneWorkspace {...props} version={selectedVersion} onVersionChange={(version) => {
    setSelection(version === null ? null : { artifactId: props.artifactId, version });
    props.onVersionChange?.(version);
  }} onEngineOutput={(result) => {
    setSelection({ artifactId: result.outputArtifact.id, version: result.outputVersion.version });
    props.onVersionChange?.(result.outputVersion.version);
  }}/>;
}

function ArtifactPaneWorkspace({
  artifactId,
  projectId,
  owningChatId,
  version,
  onVersionChange,
  onDisplayedVersionChange,
  onDirtyChange,
  sessions,
  onClose,
  onAsk,
  onFocus,
  onOpenArtifact,
  onRerun,
  onEngineOutput,
}: ArtifactPaneProps & { onEngineOutput: (result: IntegratedModelArtifactRunResult) => void }) {
  const detail=useArtifact(artifactId,version),versions=useArtifactVersions(artifactId),proposals=useArtifactProposals(artifactId),refs=useArtifactReferences(artifactId),invalidate=useInvalidateArtifacts();
  const invalidateProjectIntelligence=useInvalidateProjectIntelligence();
  const projectArtifacts=useOwnedArtifacts({ projectId, owningChatId: owningChatId ?? (detail.data?.artifact.id === artifactId ? detail.data.artifact.owningChatId : null) });
  const [mergeBranchId,setMergeBranchId]=useState("");
  const [mergeConflicts,setMergeConflicts]=useState<string[]>([]);
  const [mergePreviews,setMergePreviews]=useState<Record<string,{target:string;branch:string;truncated:boolean}>>({});
  const [mergeResolutions,setMergeResolutions]=useState<Record<string,"target"|"branch">>({});
  const [mergeNotice,setMergeNotice]=useState<string|null>(null);
  const automation=useP9Workflows(projectId),invalidateAutomation=useInvalidateP9Automation();
  const [error,setError]=useState<string|null>(null),[comparison,setComparison]=useState<{text:string;anchor:ArtifactHistoryAnchor;from:number}|null>(null),[left,setLeft]=useState<number|null>(null),[exportOpen,setExportOpen]=useState(false);
  const [restoreIntent, setRestoreIntent] = useState<{ anchor: ArtifactHistoryAnchor; targetVersion: number; targetHash: string } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyInFlight = useRef(false);
  const historyRequest = useRef(0);
  const historyCurrent = useRef<{ anchor: ArtifactHistoryAnchor; left: number | null } | null>(null);
  const [exportPlan, setExportPlan] = useState<ArtifactExportPlan | null>(null);
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ArtifactExportPlan["formats"][number] | null>(null);
  const [spreadsheetDirty, setSpreadsheetDirty] = useState(false);
  const [spreadsheetSaving, setSpreadsheetSaving] = useState(false);
  const [spreadsheetPendingRevision, setSpreadsheetPendingRevision] = useState(false);
  const [modelApplying, setModelApplying] = useState(false);
  useEffect(() => { onDirtyChange?.(spreadsheetDirty || spreadsheetSaving || spreadsheetPendingRevision || modelApplying); }, [spreadsheetDirty, spreadsheetSaving, spreadsheetPendingRevision, modelApplying, onDirtyChange]);
  const spreadsheetSaveInFlight = useRef(false);
  const exportInFlight = useRef(false);
  const mounted = useRef(false);
  const exportRevision = useRef<{ artifactId: string; version: number; contentHash: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [inspectorTab, setInspectorTab] = useState<"artifact" | "evidence" | "history">("artifact");
  const inspectorId = useId();
  useEffect(() => { setInspectorTab("artifact"); }, [artifactId]);
  const data = exactArtifactHistoryDetail(detail.data, artifactId, version, projectId, owningChatId, detail.isPlaceholderData || detail.isError);
  const exportRights = artifactExportDisclosure(data?.version.trustManifest ?? null, data?.version.sourceRefs ?? []);
  useEffect(()=>{if(data)setLeft(Math.max(1,data.artifact.headVersion-1))},[artifactId, data?.artifact.headVersion]);
  useEffect(() => { setSpreadsheetPendingRevision(false); }, [data?.version.version, data?.version.contentHash]);
  const displayedVersionCallback = useRef(onDisplayedVersionChange);
  const ownSave = useRef<{ artifactId: string; version: number } | null>(null);
  displayedVersionCallback.current = onDisplayedVersionChange;
  useEffect(() => { if (data && !detail.isPlaceholderData && (version == null || data.version.version === version)) displayedVersionCallback.current?.(data.version.version, artifactId, version ?? null); }, [artifactId, version, data?.version.version, detail.isPlaceholderData]);
  exportRevision.current = data ? { artifactId, version: data.version.version, contentHash: data.version.contentHash } : null;
  useEffect(() => {
    setExportAcknowledged(false);
    setExportPlan(null);
    if (!exportOpen || !data) { setExportLoading(false); return; }
    let active = true;
    setExportLoading(true);
    getArtifactExportPlan(artifactId, data.version.version).then((plan) => {
      if (active) setExportPlan(plan);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Export formats unavailable. Close and reopen export to retry."); })
      .finally(() => { if (active) setExportLoading(false); });
    return () => { active = false; };
  }, [artifactId, data?.version.version, data?.version.contentHash, exportOpen]);
  const run=async(fn:()=>Promise<void>)=>{setError(null);try{await fn()}catch(e){setError(e instanceof Error?e.message:"Artifact action failed.")}};
  if (!data) {
    const state = resolveAsyncSurfaceState({ hasData: false, isPending: detail.isPending, isError: detail.isError, error: detail.error });
    return <AsyncSurfaceNotice surface="artifact" state={state === "ready" ? "missing" : state} onRetry={() => void detail.refetch()} retrying={detail.isFetching} onLeave={onClose} leaveLabel="Close Artifact" />;
  }
  const anchor = artifactHistoryAnchor(data);
  historyCurrent.current = { anchor, left };
  const historicalVersions = (versions.data ?? []).filter(entry => entry.artifactId === artifactId);
  const leftRecord = historicalVersions.find(entry => entry.version === left);
  const displayedRecord = historicalVersions.find(entry => entry.version === anchor.displayedVersion);
  const hasUnsavedArtifactEdits = spreadsheetDirty || spreadsheetSaving || spreadsheetPendingRevision || modelApplying;
  const canRestore = canRestoreArtifactHistory(anchor, leftRecord, hasUnsavedArtifactEdits, historyBusy || versions.isFetching || historyInFlight.current);
  const activeRestoreIntent = restoreIntent && leftRecord
    && restoreIntent.targetVersion === left
    && restoreIntent.targetHash === leftRecord.contentHash
    && sameArtifactHistoryAnchor(restoreIntent.anchor, anchor) ? restoreIntent : null;
  const compareSelectedHistory = async () => {
    if (historyInFlight.current || !leftRecord || !displayedRecord || leftRecord.version === displayedRecord.version) return;
    if (displayedRecord.contentHash !== anchor.contentHash) {
      setError("The version catalog does not match the displayed Artifact. Refresh history before comparing.");
      return;
    }
    const captured = { ...anchor };
    const from = leftRecord;
    const to = displayedRecord;
    const requestId = ++historyRequest.current;
    historyInFlight.current = true; setHistoryBusy(true); setComparison(null); setError(null);
    try {
      const result = await compareArtifactVersions(artifactId, from.version, to.version);
      if (!mounted.current || historyRequest.current !== requestId
        || !historyCurrent.current || historyCurrent.current.left !== from.version
        || !sameArtifactHistoryAnchor(historyCurrent.current.anchor, captured)) return;
      if (!exactArtifactHistoryComparison(result, captured, from, to)) {
        throw new Error("The comparison response does not match the selected saved revisions or content hashes. Nothing was applied.");
      }
      const metadataLabels = metadataDeltaLabels(compareArtifactVersionMetadata(from, to));
      const contentSummary = result.changed
        ? `Content: ${result.topLevelChangedKeys.join(", ") || "changed"} · ${result.spreadsheetDiffs.length} cell diffs`
        : "Content unchanged";
      const semanticSummary = semanticArtifactComparisonLabel(result.semantic);
      const summary = metadataLabels.length ? `${contentSummary} · Metadata: ${metadataLabels.join(", ")}` : contentSummary;
      setComparison({ text: `Compared exact v${from.version} with v${to.version} · ${semanticSummary ? `${summary} · ${semanticSummary}` : summary}`, anchor: captured, from: from.version });
    } catch (cause) {
      if (mounted.current && historyRequest.current === requestId) setError(cause instanceof Error ? cause.message : "Exact saved Artifact comparison failed.");
    } finally {
      historyInFlight.current = false; if (mounted.current) setHistoryBusy(false);
    }
  };
  const prepareRestoreHistory = () => {
    if (!canRestore || !leftRecord) {
      setError("Open the current Artifact head, finish unsaved edits and select an earlier recorded revision before restoring.");
      return;
    }
    historyRequest.current += 1;
    setComparison(null); setError(null);
    setRestoreIntent({ anchor: { ...anchor }, targetVersion: leftRecord.version, targetHash: leftRecord.contentHash });
  };
  const confirmRestoreHistory = async () => {
    if (!activeRestoreIntent || !canRestore || !leftRecord || historyInFlight.current) return;
    const captured = activeRestoreIntent;
    const requestId = ++historyRequest.current;
    historyInFlight.current = true; setHistoryBusy(true); setRestoreIntent(null); setError(null);
    try {
      // P4 enforces optimistic concurrency against this exact head version.
      // Restoring creates a NEW immutable revision; it never edits history.
      const saved = await restoreArtifactRevision(artifactId, captured.anchor.headVersion, captured.targetVersion);
      invalidate(projectId, artifactId);
      if (saved.artifactId !== captured.anchor.artifactId || saved.version !== captured.anchor.headVersion + 1) {
        throw new Error("Restore response has an unexpected Artifact ID or revision. Refresh history to verify the saved outcome.");
      }
      if (!mounted.current || historyRequest.current !== requestId
        || !historyCurrent.current || historyCurrent.current.left !== captured.targetVersion
        || !sameArtifactHistoryAnchor(historyCurrent.current.anchor, captured.anchor)) return;
      onVersionChange?.(saved.version);
      setComparison({ text: `Restored v${captured.targetVersion} as new v${saved.version}. Original saved revisions remain unchanged.`, anchor: captured.anchor, from: captured.targetVersion });
    } catch (cause) {
      if (mounted.current && historyRequest.current === requestId) setError(cause instanceof Error ? cause.message : "Restore failed; no successful new revision was confirmed. Refresh and retry.");
    } finally {
      historyInFlight.current = false;
      if (mounted.current) setHistoryBusy(false);
    }
  };
  const changeDisplayedRevision = (next: number | null) => {
    if (hasUnsavedArtifactEdits || historyInFlight.current) {
      setError("Save or reset unsaved Artifact edits before switching revisions; your draft has not been discarded.");
      return;
    }
    historyRequest.current += 1;
    setComparison(null); setRestoreIntent(null); setError(null);
    onVersionChange?.(next);
  };
  const content=data.version.content;
  const generatedImage = generatedImageFromContent(content);
  const downloadArtifact = async (format: ArtifactExportPlan["formats"][number]) => {
    if (exportInFlight.current) return;
    if (exportRights.blocked) { setError(exportRights.note); return; }
    if (!exportAcknowledged) { setError("Review source rights and acknowledge the local export before downloading."); return; }
    exportInFlight.current = true;
    setExportingFormat(format);
    setError(null);
    const revision = { artifactId, version: data.version.version, contentHash: data.version.contentHash };
    const assertCurrentRevision = () => {
      const current = exportRevision.current;
      if (!mounted.current || !current || current.artifactId !== revision.artifactId || current.version !== revision.version || current.contentHash !== revision.contentHash) {
        throw new Error("This Artifact revision changed while exporting. Export the current revision again.");
      }
    };
    try {
      const plan = await getArtifactExportPlan(revision.artifactId, revision.version);
      assertCurrentRevision();
      if (plan.artifactId !== revision.artifactId || plan.version !== revision.version || plan.contentHash !== revision.contentHash) {
        throw new Error("This Artifact has a newer revision. Reload it before exporting.");
      }
      await exportArtifactLocal(plan, content, format, assertCurrentRevision);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Artifact export failed.");
    } finally {
      exportInFlight.current = false;
      if (mounted.current) setExportingFormat(null);
    }
  };
  const thesisMonitor=(automation.data??[]).find((workflow)=>workflow.template==="thesis_refresh"&&workflow.action.kind==="thesis_refresh"&&workflow.action.artifactId===artifactId)??null;
  const createThesisMonitor=async()=>run(async()=>{
    if (projectId === null) throw new Error("Project monitors require a Project. This Chat Artifact remains saved here.");
    await createP9Workflow(projectId,{
      schemaVersion:"1",
      name:`Monitor · ${data.artifact.title}`,
      description:"Refresh this Thesis against fresh Project evidence and contradictions.",
      template:"thesis_refresh",
      trigger:{type:"schedule",schedule:{kind:"interval",everyMinutes:60}},
      action:{kind:"thesis_refresh",artifactId},
      notificationPolicy:{enabled:true,channels:["in_app"],notifyOn:["failure","condition_met","change_detected"],minimumRelevanceScore:0.5,cooldownMinutes:60,suppressUnchanged:true},
      sourceRefs:data.version.sourceRefs,
      engineRefs:["lios.thesis.native","lios.project-intelligence"],
      artifactRefs:[artifactId],
      enabled:true,
    });
    invalidateAutomation(projectId);
  });
  const save=async(next:ArtifactContent)=>{
    if (data.version.version !== data.artifact.headVersion) throw new Error("Open the current Artifact revision before editing.");
    if (next.kind === "portfolio") {
      if (spreadsheetSaveInFlight.current || spreadsheetPendingRevision) throw new Error("Wait for the current portfolio revision to finish saving.");
      spreadsheetSaveInFlight.current = true; setSpreadsheetSaving(true);
      try {
        const saved = await createArtifactVersion(artifactId, { baseVersion: data.version.version, content: next, actorType: "user" });
        setSpreadsheetDirty(false); setSpreadsheetPendingRevision(true);
        onVersionChange?.(saved.version);
        invalidate(projectId, artifactId);
      } finally { spreadsheetSaveInFlight.current = false; setSpreadsheetSaving(false); }
      return;
    }
    if (next.kind === "spreadsheet") {
      if (spreadsheetSaveInFlight.current || modelApplying || spreadsheetPendingRevision) throw new Error("Wait for the current spreadsheet save or model update to finish.");
      spreadsheetSaveInFlight.current = true;
      setSpreadsheetSaving(true);
      setError(null);
      try {
        if (data.version.version !== data.artifact.headVersion) throw new Error("Reload the current saved spreadsheet head before saving.");
        const saved = await createArtifactVersion(artifactId, {
          baseVersion: data.version.version, content: next, actorType: "user",
          dependencyRefs: data.version.dependencyRefs, refreshSpec: data.version.refreshSpec,
        });
        if (mounted.current) setSpreadsheetPendingRevision(true);
        onVersionChange?.(saved.version);
        invalidate(projectId, artifactId);
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : "Spreadsheet revision could not be saved. Your local draft is retained.");
        throw cause;
      } finally {
        spreadsheetSaveInFlight.current = false;
        if (mounted.current) setSpreadsheetSaving(false);
      }
      return;
    }
    if(next.kind==="research" || next.kind==="report" || next.kind==="decision" || next.kind==="screen" || next.kind==="thesis" || next.kind==="strategy") {
      setError(null);
      try {
        const base = resolveSaveBase({ viewedVersion: data.version.version, headVersion: data.artifact.headVersion, ownLatestVersion: ownSave.current?.artifactId === artifactId ? ownSave.current.version : null });
        if(!base.ok) throw new Error("This Artifact is not the current revision. Reload before saving.");
        const saved = await createArtifactVersion(artifactId,{
          baseVersion:base.baseVersion,content:next,actorType:"user",
          dependencyRefs:data.version.dependencyRefs,refreshSpec:data.version.refreshSpec,
        });
        ownSave.current = { artifactId, version: saved.version };
        onVersionChange?.(saved.version);
        invalidate(projectId,artifactId);
      } catch(cause) {
        setError(cause instanceof Error?cause.message:"Artifact revision could not be saved.");
        throw cause;
      }
      return;
    }
    if(next.kind!=="chart") return run(async()=>{const saved=await createArtifactVersion(artifactId,{baseVersion:data.artifact.headVersion,content:next,actorType:"user"});onVersionChange?.(saved.version);invalidate(projectId,artifactId)});
    setError(null);
    try {
      if(data.version.version!==data.artifact.headVersion) throw new Error("This chart is not the current revision. Reload before saving.");
      const saved = await createArtifactVersion(artifactId,{baseVersion:data.version.version,content:next,actorType:"user"});
      onVersionChange?.(saved.version);
      invalidate(projectId,artifactId);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"Chart revision could not be saved.");
      throw cause;
    }
  };
  const draft=async(d:SpreadsheetCellDiff)=>run(async()=>{await proposeArtifactChange(artifactId,{baseVersion:data.artifact.headVersion,type:"spreadsheet_ai_diff",summary:`Conversation-ready draft ${d.sheetId}!${d.ref}`,diffs:[d],actorType:"conversation"});invalidate(projectId,artifactId)});
  const refreshThesis=async()=>run(async()=>{if(projectId===null)throw new Error("Project evidence refresh requires a Project.");await refreshThesisArtifact(projectId,artifactId);invalidate(projectId,artifactId);invalidateProjectIntelligence(projectId)});
  const thesisPostmortem=async(input:{outcome:"validated"|"partially_validated"|"invalidated"|"closed";summary:string})=>run(async()=>{if(projectId===null)throw new Error("Project thesis postmortems require a Project.");await appendThesisPostmortem(projectId,artifactId,input);invalidate(projectId,artifactId);invalidateProjectIntelligence(projectId)});
  return <div className="lios-artifact-frame rounded-xl border border-amber-300/15 bg-[#080808]"><div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3"><FileBarChart className="h-4 w-4 text-amber-300"/><div className="min-w-0 flex-1"><div className="truncate font-ui text-[10px] font-semibold">{data.artifact.title}</div><div className="mt-0.5 font-terminal text-[12px] text-muted-foreground">{data.artifact.kind.toUpperCase()} · V{data.version.version}</div></div><button onClick={()=>onAsk(artifactId,data.artifact.title)} className="rounded border border-cyan-300/20 px-2 py-1 font-ui text-[13px] text-cyan-200">Ask LiOS</button>{data.version.refreshSpec && !isIntegratedModelWorkbook(data) && onRerun && <button onClick={()=>onRerun(artifactId,data.artifact.title,data.version.refreshSpec!)} disabled={data.version.version!==data.artifact.headVersion} className="flex items-center gap-1 rounded border border-emerald-300/20 px-2 py-1 font-ui text-[13px] text-emerald-200 disabled:opacity-40" title={data.version.version!==data.artifact.headVersion?"Open the current revision before rerunning":"Stage the saved governed request in a fresh Project chat"}><RefreshCw className="h-3 w-3"/> Rerun</button>}{onFocus&&<button onClick={()=>onFocus(artifactId,data.artifact.title)} className="flex items-center gap-1 rounded border border-amber-300/20 px-2 py-1 font-ui text-[13px] text-amber-200" title="Open this Artifact as the active professional work object"><Maximize2 className="h-3 w-3"/> Focus</button>}<button onClick={()=>setInspectorTab("evidence")} aria-pressed={(inspectorTab==="evidence")} className="rounded border border-border/50 px-2 py-1 font-ui text-[13px] text-muted-foreground hover:text-foreground">Show Work</button>{content.kind==="thesis"&&<button disabled={Boolean(thesisMonitor)} onClick={()=>void createThesisMonitor()} className="rounded border border-emerald-300/20 px-2 py-1 font-ui text-[13px] text-emerald-200 disabled:opacity-60">{thesisMonitor?"Thesis monitored":"Monitor Thesis"}</button>}<button onClick={()=>void run(async()=>{const f=await forkArtifact(artifactId);invalidate(projectId,artifactId);invalidate(projectId,f.artifact.id)})} className="rounded border border-border/50 p-1.5 text-muted-foreground" title="Fork"><GitFork className="h-3.5 w-3.5"/></button><button onClick={()=>{
  const previous=historicalVersions.find(entry=>entry.version===anchor.headVersion-1);
  setInspectorTab("history");
  if (!previous || !canRestoreArtifactHistory(anchor, previous, hasUnsavedArtifactEdits, historyBusy || historyInFlight.current)) {
    setError("Previous saved revision is unavailable or this Artifact has unsaved edits. Refresh history before preparing undo.");
    return;
  }
  historyRequest.current += 1; setLeft(previous.version); setComparison(null); setError(null);
  setRestoreIntent({anchor:{...anchor},targetVersion:previous.version,targetHash:previous.contentHash});
}} disabled={hasUnsavedArtifactEdits || historyBusy || historyInFlight.current || data.artifact.headVersion <= 1 || data.version.version !== data.artifact.headVersion} className="rounded border border-border/50 p-1.5 text-muted-foreground disabled:opacity-30" title={data.version.version!==data.artifact.headVersion?"Open the current revision before undoing":"Review and confirm restoring the previous version as a new head"}><RotateCcw className="h-3.5 w-3.5"/></button><button onClick={()=>setExportOpen((v)=>!v)} className="rounded border border-border/50 p-1.5 text-muted-foreground" title="Export"><Download className="h-3.5 w-3.5"/></button><button onClick={()=>void run(async()=>{await setArtifactStatus(artifactId,"archived");invalidate(projectId,artifactId);onClose()})} disabled={data.version.version!==data.artifact.headVersion} className="rounded border border-border/50 p-1.5 text-muted-foreground disabled:opacity-30" title={data.version.version!==data.artifact.headVersion?"Open the current revision before archiving":"Archive"}><Archive className="h-3.5 w-3.5"/></button><button aria-label="Close artifact" onClick={onClose} className="rounded p-1.5 text-muted-foreground"><X className="h-3.5 w-3.5"/></button></div>
    <div role="tablist" aria-label="Artifact inspector" className="lios-reference-artifact-tabs">
      {(["artifact", "evidence", "history"] as const).map((tab, index, tabs) => <button key={tab} type="button" role="tab" id={`${inspectorId}-${tab}-tab`} aria-controls={`${inspectorId}-${tab}-panel`} aria-selected={inspectorTab === tab} tabIndex={inspectorTab === tab ? 0 : -1} onClick={() => setInspectorTab(tab)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); setInspectorTab(tabs[next]);
        (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
      }}>{tab}</button>)}
    </div>
    <div className="grid gap-2 border-b border-border/50 px-3 py-2 md:grid-cols-[1fr_auto_auto_auto_auto]"><div className="truncate font-terminal text-[12px] text-muted-foreground">SOURCES {data.version.sourceRefs.length} · {data.version.sourceRefs.length?"LINKED":"NONE"} · {data.version.executionReceiptIds.length} RECEIPTS</div><div className="flex items-center gap-1"><History className="h-3 w-3 text-muted-foreground"/><span className="font-terminal text-[12px] text-muted-foreground">{versions.data?.length??1} REVISIONS</span></div><div className="flex items-center gap-1"><Link2 className="h-3 w-3 text-muted-foreground"/><span className="font-terminal text-[12px] text-muted-foreground">{refs.data?.length??0} REFS</span></div><div className="font-terminal text-[12px] text-muted-foreground">{data.version.dependencyRefs.length} DEPS</div><div className="font-terminal text-[12px] text-muted-foreground">{data.version.refreshSpec?"REPLAY · "+data.version.refreshSpec.kind.toUpperCase():"NO REPLAY"}</div></div>
    {inspectorTab==="evidence"&&<div role="tabpanel" id={`${inspectorId}-evidence-panel`} aria-labelledby={`${inspectorId}-evidence-tab`} className="border-b border-border/50 bg-black/25 px-3 py-3">{data.version.trustManifest?<ConversationTrustPanel manifest={data.version.trustManifest}/>:<div className="grid gap-3 md:grid-cols-2"><div><div className="font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">Sources</div><div className="mt-1 break-words font-ui text-[13px] leading-5 text-foreground">{data.version.sourceRefs.length?data.version.sourceRefs.join(" · "):"No source references recorded for this legacy version."}</div></div><div><div className="font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">Execution</div><div className="mt-1 font-ui text-[13px] leading-5 text-foreground">Adapter {data.version.adapterId} · {data.version.executionReceiptIds.length} receipt{data.version.executionReceiptIds.length===1?"":"s"} · content {shortHash(data.version.contentHash)}</div></div></div>}{data.version.dependencyRefs.length>0&&<div className="mt-3 rounded border border-border/50 bg-black/20 p-2"><div className="font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">Dependencies</div><div className="mt-1 break-words font-ui text-[13px] leading-5 text-foreground">{data.version.dependencyRefs.join(" · ")}</div></div>}{data.version.refreshSpec&&<div className="mt-3 rounded border border-emerald-300/15 bg-emerald-300/[0.02] p-2"><div className="font-terminal text-[12px] uppercase tracking-wider text-emerald-200">Governed replay</div><div className="mt-1 font-ui text-[13px] leading-5 text-muted-foreground">{data.version.refreshSpec.capabilityIds.length?data.version.refreshSpec.capabilityIds.join(" · "):"Conversation replay"} · {data.version.refreshSpec.sourceScope} · {data.version.refreshSpec.executionMode}</div></div>}</div>}
    {exportOpen&&<section aria-label="Export artifact" className="border-b border-border/50 p-3">
      {exportLoading && <p role="status" className="text-sm text-muted-foreground">Checking export formats…</p>}
      <p role={exportRights.blocked ? "alert" : "note"} data-testid="artifact-export-rights" className={`mb-3 rounded border p-3 text-sm leading-6 ${exportRights.blocked ? "border-red-300/40 text-red-200" : "border-amber-300/30 text-amber-100"}`}>{exportRights.note}</p>
      {exportPlan && <><p className="mb-3 break-words text-sm text-muted-foreground">{exportPlan.filenameStem}-v{exportPlan.version} · {exportPlan.sourceRefs.length} recorded sources</p>
        {!exportRights.blocked && <label className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
          <input type="checkbox" data-testid="artifact-export-consent" className="mt-1 h-4 w-4 shrink-0 accent-amber-300" checked={exportAcknowledged} onChange={event => setExportAcknowledged(event.target.checked)} />
          <span>I understand this downloads a local copy. I will check source licenses, permissions and recipient rights before distributing it.</span>
        </label>}
        <div className="flex flex-wrap gap-2">{exportPlan.formats.map((format)=><button key={format} type="button" disabled={exportLoading || exportingFormat !== null || exportRights.blocked || !exportAcknowledged || exportPlan.artifactId !== artifactId || exportPlan.version !== data.version.version || exportPlan.contentHash !== data.version.contentHash} onClick={()=>void downloadArtifact(format)} className="rounded border border-border/50 px-3 py-2 font-ui text-[13px] disabled:cursor-wait disabled:opacity-50">{format.toUpperCase()}</button>)}</div>
        {exportingFormat !== null && <p role="status" className="mt-3 text-sm text-muted-foreground">Generating {exportingFormat.toUpperCase()} for the recorded revision…</p>}
        <p className="mt-3 text-sm text-muted-foreground">Exports use this recorded revision. Data exports contain the preview rows. Spreadsheet XLSX preserves all sheets, formulas, and number formats.</p>
      </>}
      {exportPlan?.formats.some(format => format === "docx" || format === "pptx") && <Suspense fallback={<p role="status">Loading Office return…</p>}><OfficeArtifactReturn key={`${artifactId}:${data.version.version}:${data.version.contentHash}`} artifactId={artifactId} version={data.version.version} contentHash={data.version.contentHash} onStaged={() => invalidate(projectId, artifactId)}/></Suspense>}
    </section>}

    <div role="tabpanel" id={`${inspectorId}-artifact-panel`} aria-labelledby={`${inspectorId}-artifact-tab`} hidden={inspectorTab!=="artifact"} className="p-4">
      {data.version.version !== data.artifact.headVersion && <p role="status" className="mb-3 text-sm">Viewing saved revision {data.version.version}; current revision is {data.artifact.headVersion}. <button type="button" className="underline" onClick={() => onVersionChange?.(null)}>Open current revision</button></p>}
      {content.kind === "portfolio" && <ArtifactPortfolioMateriality key={`${artifactId}:${data.version.version}:${data.version.contentHash}`} detail={data} blocked={spreadsheetDirty || spreadsheetSaving || spreadsheetPendingRevision || modelApplying}/>}
      <div data-artifact-id={artifactId} data-artifact-version={data.version.version} data-artifact-hash={data.version.contentHash}>
      {generatedImage ? <GeneratedImageArtifactView key={`${artifactId}:${data.version.version}`} image={generatedImage} chatId={data.artifact.owningChatId ?? owningChatId ?? null} onOpenArtifact={onOpenArtifact} onSaved={() => invalidate(projectId, artifactId)}/> : content.kind==="data" ? <DataArtifactTable key={`${artifactId}:${data.version.version}:${data.version.contentHash}`} artifactId={artifactId} content={content}/> : <fieldset disabled={data.version.version !== data.artifact.headVersion} className="min-w-0"><Body key={content.kind==="table"||content.kind==="chart" ? `${artifactId}:${data.version.version}:${data.version.contentHash}` : artifactId} artifactId={artifactId} contentHash={data.version.contentHash} content={content} revision={data.version.version} onSave={save} onDraft={draft} onThesisRefresh={refreshThesis} onThesisPostmortem={thesisPostmortem} onSpreadsheetDirtyChange={setSpreadsheetDirty} spreadsheetDisabled={data.version.version !== data.artifact.headVersion || modelApplying || spreadsheetSaving || spreadsheetPendingRevision} facts={{savedAt:data.version.createdAt,sourceCount:data.version.sourceRefs.filter(ref=>!ref.startsWith("model:")).length,receiptCount:data.version.executionReceiptIds.length}} artifactSourceRefs={data.version.sourceRefs} onOpenExport={()=>setExportOpen(true)} onAsk={onAsk} owner={{projectId:data.artifact.projectId,owningChatId:data.artifact.owningChatId ?? null}} onNativeVersion={version=>{setSpreadsheetPendingRevision(true);onVersionChange?.(version);invalidate(projectId,artifactId);}}/></fieldset>}
      </div>
      {projectId !== null && <ScenarioFormulaReview projectId={projectId} artifactId={artifactId} artifactKind={content.kind} headVersion={data.artifact.headVersion} forkedFromArtifactId={data.artifact.forkedFromArtifactId}/>}
      <details data-testid="artifact-more-actions" className="mt-4 rounded-lg border border-border/40 bg-black/10 p-3"><summary className="cursor-pointer font-ui text-[13px] text-muted-foreground">More actions · review, reports, maintenance and source inspection</summary>
      <div className="mt-3 space-y-3">
    <div className="py-2"><button type="button" onClick={() => openTerminalInspector({ view: "research", label: data.artifact.title, target: { artifactId, version: data.version.version, contentHash: data.version.contentHash } })} className="rounded border border-cyan-300/30 px-3 py-2 text-sm text-cyan-200">Inspect exact saved source</button><span className="ml-2 text-xs text-muted-foreground">Cells: focus then Alt+I, or Alt-click. Inspection reads the saved revision, never unsaved draft values.</span></div>
      <Suspense fallback={<p role="status">Loading recorded review…</p>}><ArtifactReviewNotes key={`${artifactId}:${data.version.version}`} detail={data} sessions={sessions} onAsk={onAsk}/></Suspense>
      <Suspense fallback={<p role="status">Loading professional package assembly…</p>}><ProfessionalWorkPackage key={`${artifactId}:${data.version.version}`} detail={data} sessions={sessions} blocked={spreadsheetDirty || spreadsheetSaving || spreadsheetPendingRevision || modelApplying} onAsk={onAsk}/></Suspense>
      {content.kind === "spreadsheet" && <Suspense fallback={<p role="status">Loading spreadsheet return…</p>}><SpreadsheetArtifactReturn key={`${artifactId}:${data.version.version}:${data.version.contentHash}`} artifactId={artifactId} version={data.version.version} contentHash={data.version.contentHash} blocked={spreadsheetDirty || spreadsheetSaving || spreadsheetPendingRevision || modelApplying} onStaged={() => invalidate(projectId, artifactId)}/></Suspense>}
      {projectId !== null && (content.kind === "report" || content.kind === "research") && <Suspense fallback={<p role="status">Loading composition…</p>}><ArtifactComposition key={`${artifactId}:${data.version.version}:${data.version.contentHash}`} artifactId={artifactId} projectId={projectId} version={data.version.version} content={content} onStaged={() => invalidate(projectId, artifactId)}/></Suspense>}
      {onRerun && <ArtifactReportRequest key={`${artifactId}:${projectId}:${data.version.version}:${data.artifact.headVersion}:${data.version.contentHash}`} detail={data} artifactId={artifactId} projectId={projectId} onRerun={onRerun}/>}
      <div className="mb-3 rounded border border-cyan-300/20 p-3">
        <button type="button" disabled={data.version.version !== data.artifact.headVersion} onClick={() => onAsk(artifactId, data.artifact.title, artifactMaintenancePrompt(artifactId, data.artifact.title, data.version.version, data.version.contentHash))} className="rounded border border-cyan-300/30 px-3 py-2 font-ui text-[13px] text-cyan-200 disabled:opacity-40">Ask LiOS to maintain this Artifact</button>
        <p className="mt-2 font-ui text-[12px] text-muted-foreground">Stages the exact saved identity, revision and hash in the existing conversation. Add your maintenance instruction, choose AI/agent mode, and send explicitly. Nothing is submitted or accepted automatically.</p>
      </div>
      {isIntegratedModelWorkbook(data) && <IntegratedArtifactEngineInputs key={artifactId} detail={data} onOpenOutput={onEngineOutput} blocked={spreadsheetDirty || spreadsheetSaving || spreadsheetPendingRevision} onApplyingChange={setModelApplying}/>}
      {isIntegratedModelWorkbook(data) && <Suspense fallback={<p role="status">Loading model maintenance…</p>}><ArtifactModelMaintenance key={artifactId} detail={data} blocked={spreadsheetDirty || spreadsheetSaving || spreadsheetPendingRevision} onApplyingChange={setModelApplying}/></Suspense>}
      {isIntegratedModelWorkbook(data) && <Suspense fallback={<p role="status">Loading model change report…</p>}><ArtifactModelChangeReport key={`${artifactId}:${data.version.version}`} detail={data} versions={versions.data ?? []} sessions={sessions} blocked={spreadsheetDirty || spreadsheetSaving || spreadsheetPendingRevision || modelApplying} onAsk={onAsk}/></Suspense>}
      </div>
      </details>
    </div>
    {(proposals.data??[]).some((p)=>p.status==="pending")&&<div className="space-y-2 border-t border-border/50 p-3">{(proposals.data??[]).map((p)=><ArtifactProposalReview key={p.id} proposal={p} base={p.baseVersion === data.version.version ? data.version : versions.data?.find(version => version.version === p.baseVersion)} current={data.version} headVersion={data.artifact.headVersion} onDecision={async(id,d)=>run(async()=>{await decideArtifactProposal(id,d);invalidate(projectId,artifactId)})}/>)}</div>}
    {inspectorTab==="history"&&<div className="m-3 space-y-2 rounded border border-border/50 p-3">
      <label className="block">Reconcile a branch<select aria-label="Artifact branch" value={mergeBranchId} onChange={event=>{setMergeBranchId(event.target.value);setMergeConflicts([]);setMergeResolutions({});setMergeNotice(null);}} className="ml-2 rounded border border-border bg-background p-2"><option value="">Select a direct fork</option>{(projectArtifacts.data??[]).filter(item=>item.forkedFromArtifactId===artifactId).map(item=><option key={item.id} value={item.id}>{item.title} · v{item.headVersion}</option>)}</select></label>
      {mergeConflicts.map(key=><details key={`preview:${key}`} className="rounded border border-border/40 p-2"><summary>Inspect {key} conflict</summary><div className="grid gap-2 md:grid-cols-2"><pre className="overflow-auto whitespace-pre-wrap">Current: {mergePreviews[key]?.target}</pre><pre className="overflow-auto whitespace-pre-wrap">Branch: {mergePreviews[key]?.branch}</pre></div>{mergePreviews[key]?.truncated&&<p>Preview truncated. Inspect the full branch Artifact before choosing a field.</p>}</details>)}
      {mergeConflicts.map(key=><label key={key} className="block">{key} changed on both branches<select aria-label={`Resolve ${key}`} value={mergeResolutions[key]??""} onChange={event=>{const choice=event.target.value;if(choice==="target"||choice==="branch")setMergeResolutions(current=>({...current,[key]:choice}));}} className="ml-2 rounded border border-border bg-background p-2"><option value="">Choose explicitly</option><option value="target">Keep current Artifact field</option><option value="branch">Use branch field</option></select></label>)}
      <button disabled={!mergeBranchId} onClick={()=>void run(async()=>{
        const branch=(projectArtifacts.data??[]).find(item=>item.id===mergeBranchId);
        if(!branch)throw new Error("Branch unavailable; refresh this Project.");
        const review=await proposeArtifactBranchMerge(artifactId,{branchArtifactId:branch.id,branchVersion:branch.headVersion,targetVersion:data.artifact.headVersion,resolutions:mergeResolutions});
        setMergeConflicts(review.conflicts);
        setMergePreviews(review.conflictPreviews);
        setMergeNotice(review.conflicts.length?"Resolve each conflicting field before creating the review.":review.proposal?"Merge proposed below; review and accept explicitly.":"No branch changes to apply.");
        invalidate(projectId,artifactId);
      })} className="rounded border border-cyan-300/30 px-3 py-2 disabled:opacity-30">Review branch reconciliation</button>
      {mergeNotice&&<p role="status">{mergeNotice}</p>}
    </div>}
    <div role="tabpanel" id={`${inspectorId}-history-panel`} aria-labelledby={`${inspectorId}-history-tab`} hidden={inspectorTab!=="history"} className="space-y-3 border-t border-border/50 p-3">
      <p className="font-ui text-[13px] text-muted-foreground">Saved revisions are immutable. Open any exact version for read-only inspection, compare exact version hashes, or deliberately restore an earlier version as a NEW head. The server rejects concurrent head changes.</p>
      {versions.isError && <p role="alert" className="text-sm text-red-200">Saved version history could not be loaded. Reopen this Artifact to retry.</p>}
      <div className="max-h-48 space-y-2 overflow-auto" data-testid="artifact-history-version-list">
        {historicalVersions.slice().reverse().map(savedVersion => <div key={savedVersion.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2 font-ui text-[12px]">
          <span>v{savedVersion.version} · {savedVersion.version===anchor.headVersion ? "Current head" : "Historical"} · saved {new Date(savedVersion.createdAt).toLocaleString()} · hash {shortHash(savedVersion.contentHash)}</span>
          <button type="button" disabled={hasUnsavedArtifactEdits || historyBusy || historyInFlight.current || savedVersion.version===anchor.displayedVersion}
            onClick={()=>changeDisplayedRevision(savedVersion.version)} className="min-h-9 rounded border border-border/50 px-3 py-2 disabled:opacity-40">
            {savedVersion.version===anchor.displayedVersion ? "Viewing" : `View exact v${savedVersion.version}`}
          </button>
        </div>)}
        {!historicalVersions.length && <p role="status">No authorized versions available to inspect.</p>}
      </div>
      <button type="button" disabled={hasUnsavedArtifactEdits || historyBusy || historyInFlight.current || (version==null && anchor.displayedVersion===anchor.headVersion)} onClick={()=>changeDisplayedRevision(null)}
        className="min-h-9 rounded border border-border/50 px-3 py-2 font-ui text-[13px] disabled:opacity-40">Open current head</button>
      <div className="flex flex-wrap items-end gap-2">
        <label className="font-terminal text-[12px] text-muted-foreground">COMPARE / RESTORE FROM
          <select aria-label="Historical Artifact source revision" value={left??""} onChange={(event)=>{
            historyRequest.current += 1; setComparison(null); setRestoreIntent(null); setLeft(Number(event.target.value)||null);
          }} disabled={historyBusy || historyInFlight.current || versions.isFetching}
          className="mt-1 block min-h-9 rounded border border-border/50 bg-[#090909] px-2 py-1 font-terminal text-[13px]">
            <option value="">Select revision</option>
            {historicalVersions.slice().reverse().map(entry=><option key={entry.id} value={entry.version}>v{entry.version} · {shortHash(entry.contentHash)}</option>)}
          </select>
        </label>
        <button type="button" disabled={!leftRecord || !displayedRecord || displayedRecord.contentHash!==anchor.contentHash || leftRecord.version===anchor.displayedVersion || historyBusy || historyInFlight.current || versions.isFetching}
          onClick={()=>void compareSelectedHistory()} className="flex min-h-9 items-center gap-2 rounded border border-border/50 px-3 py-2 font-ui text-[13px] disabled:opacity-40">
          <GitCompareArrows className="h-3.5 w-3.5"/> Compare with displayed v{anchor.displayedVersion}
        </button>
        <button type="button" data-testid="artifact-prepare-restore" disabled={!canRestore} onClick={prepareRestoreHistory}
          className="min-h-9 rounded border border-amber-300/30 px-3 py-2 font-ui text-[13px] text-amber-200 disabled:opacity-40">Prepare restore as new version</button>
        {sessions[0] && <button type="button" onClick={()=>void run(async()=>{await createArtifactReference(artifactId,{version:anchor.displayedVersion,targetType:"session",targetRef:sessions[0].id,label:sessions[0].name});invalidate(projectId,artifactId)})}
          className="flex min-h-9 items-center gap-2 rounded border border-border/50 px-3 py-2 font-ui text-[13px]"><Link2 className="h-3.5 w-3.5"/> Reference displayed v{anchor.displayedVersion}</button>}
      </div>
      {hasUnsavedArtifactEdits && <p role="status" className="text-sm text-amber-200">Save or reset unsaved Artifact edits before opening another revision or restoring. Your draft remains in the current editor.</p>}
      {anchor.displayedVersion!==anchor.headVersion && <p role="status" className="text-sm text-amber-200">Viewing historical v{anchor.displayedVersion} read-only. Open the current head before restoring another revision.</p>}
      {activeRestoreIntent && <section role="group" aria-label="Confirm immutable Artifact restore" data-testid="artifact-restore-confirmation" className="space-y-2 rounded border border-amber-300/30 p-3">
        <p className="font-ui text-[13px] text-amber-100">Restore exact historical v{activeRestoreIntent.targetVersion} ({shortHash(activeRestoreIntent.targetHash)}) over current head v{anchor.headVersion} ({shortHash(anchor.contentHash)}) by creating new v{anchor.headVersion+1}? Earlier versions will not be changed. Other users' concurrent changes will be rejected.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="artifact-confirm-restore" disabled={!canRestore || historyBusy || historyInFlight.current} onClick={()=>void confirmRestoreHistory()}
            className="min-h-9 rounded border border-amber-300 px-3 py-2 font-ui text-[13px] text-amber-200 disabled:opacity-40">Confirm restore as new version</button>
          <button type="button" onClick={()=>setRestoreIntent(null)} disabled={historyBusy || historyInFlight.current} className="min-h-9 rounded border border-border/50 px-3 py-2 font-ui text-[13px]">Cancel restore</button>
        </div>
      </section>}
      {comparison && sameArtifactHistoryAnchor(comparison.anchor, anchor) && comparison.from===left
        && <p role="status" data-testid="artifact-history-comparison" className="rounded border border-fuchsia-300/20 px-3 py-2 font-ui text-[13px] text-fuchsia-100">{comparison.text}</p>}
      {historyBusy && <p role="status" className="font-ui text-[12px] text-muted-foreground">Checking exact saved revisions…</p>}
    </div>
    {error&&<div role="alert" className="m-3 border border-red-300/20 px-3 py-2 text-sm text-red-200">{error}</div>}
  </div>;
}
