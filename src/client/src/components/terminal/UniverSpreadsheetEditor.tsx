import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createUniver, LocaleType } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import type { FWorkbook } from "@univerjs/preset-sheets-core";
import type { IDisposable } from "@univerjs/core";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { ArtifactContent, SpreadsheetCell, SpreadsheetCellDiff } from "@shared/artifactContracts";
import { fromUniverCellData, fromUniverWorkbookSnapshot, toUniverWorkbookProjection } from "@shared/univerArtifact";
import { colIndexToLetters } from "@/lib/spreadsheetEngine";
import { spreadsheetContentComparisonKey, spreadsheetDraftHasChanges } from "@/lib/artifactSpreadsheetDraft";
import { SpreadsheetCellSourceInspect } from "./SpreadsheetCellSourceInspect";

type SpreadsheetContent = Extract<ArtifactContent, { kind: "spreadsheet" }>;
interface Props {
  content: SpreadsheetContent;
  onSave: (content: ArtifactContent) => Promise<void>;
  onDraft: (diff: SpreadsheetCellDiff) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  revisionKey?: string;
}

/** Univer owns only the editable projection. Save and review still go through the canonical P4 revision/proposal APIs. */
export default function UniverSpreadsheetEditor({ content, onSave, onDraft, onDirtyChange, disabled = false, revisionKey }: Props) {
  const id = useId();
  const container = useRef<HTMLDivElement | null>(null);
  const workbook = useRef<FWorkbook | null>(null);
  const [baseline, setBaseline] = useState(() => ({ content, revisionKey }));
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  conflictRef.current = conflict;
  const incomingContentKey = useMemo(() => spreadsheetContentComparisonKey(content), [content]);
  const baselineContentKey = useMemo(() => spreadsheetContentComparisonKey(baseline.content), [baseline.content]);
  const dirtyCallback = useRef(onDirtyChange);
  const dirty = useRef(false);
  const externallyDisabled = useRef(disabled);
  dirtyCallback.current = onDirtyChange;
  externallyDisabled.current = disabled || conflict;
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cellRef, setCellRef] = useState("B4");
  const [proposedRaw, setProposedRaw] = useState("");
  const [selected, setSelected] = useState<{ sheetId: string; sheetName: string; ref: string; cell: SpreadsheetCell } | null>(null);

  useEffect(() => {
    if (revisionKey === baseline.revisionKey && incomingContentKey === baselineContentKey) return;
    if (dirty.current) {
      let matchesLocalDraft = false;
      try {
        const current = workbook.current;
        if (current) {
          const localDraft = fromUniverWorkbookSnapshot(current.save(), baseline.content, current.getActiveSheet().getSheetId());
          matchesLocalDraft = spreadsheetContentComparisonKey(localDraft) === incomingContentKey;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The retained spreadsheet draft could not be compared with the new revision.");
      }
      if (!matchesLocalDraft) {
        conflictRef.current = true;
        setConflict(true);
        dirtyCallback.current?.(true);
        return;
      }
    }
    conflictRef.current = false;
    setConflict(false);
    setBaseline({ content, revisionKey });
  }, [content, revisionKey, baseline, incomingContentKey, baselineContentKey]);

  useEffect(() => {
    if (!container.current) return;
    const content = baseline.content;
    setReady(false);
    setError(null);
    setSelected(null);
    dirty.current = false;
    dirtyCallback.current?.(false);
    const listeners: IDisposable[] = [];
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      darkMode: true,
      locales: { [LocaleType.EN_US]: UniverPresetSheetsCoreEnUS },
      presets: [UniverSheetsCorePreset({ container: container.current, header: true, toolbar: true, disableAutoFocus: true })],
    });
    try {
      workbook.current = univerAPI.createWorkbook(toUniverWorkbookProjection(content));
      workbook.current.setActiveSheet(content.activeSheetId);
      if (content.calculationMode === "manual") univerAPI.getFormula().stopCalculation();
      const current = workbook.current;
      current.setEditable(!externallyDisabled.current);
      const inspectSelection = () => {
        const activeCell = current.getActiveCell();
        if (!activeCell) { setSelected(null); return; }
        const sheetId = activeCell.getSheetId();
        const ref = `${colIndexToLetters(activeCell.getColumn())}${activeCell.getRow() + 1}`;
        const priorSheet = content.sheets.find(sheet => sheet.id === sheetId);
        const format = activeCell.getCellStyleData()?.n?.pattern ?? null;
        setSelected({
          sheetId, sheetName: current.getActiveSheet().getSheetName(), ref,
          cell: fromUniverCellData(activeCell.getCellData(), priorSheet?.cells[ref], format),
        });
      };
      const inspectDraft = () => {
        inspectSelection();
        let nextDirty: boolean;
        try {
          const next = fromUniverWorkbookSnapshot(current.save(), content, current.getActiveSheet().getSheetId());
          nextDirty = spreadsheetDraftHasChanges(content, next);
        } catch (cause) {
          nextDirty = true; // An unserializable draft must not pass the saved-head maintenance guard.
          setError(cause instanceof Error ? cause.message : "The current spreadsheet draft could not be inspected.");
        }
        if (nextDirty !== dirty.current) {
          dirty.current = nextDirty;
          dirtyCallback.current?.(nextDirty);
        }
      };
      listeners.push(current.onSelectionChange(inspectSelection), current.onCommandExecuted(inspectDraft));
      inspectSelection();
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The spreadsheet renderer could not start.");
    }
    return () => {
      for (const listener of listeners) listener.dispose();
      workbook.current = null;
      univer.dispose();
      dirty.current = false;
      dirtyCallback.current?.(false);
    };
  }, [baseline, id]);

  useEffect(() => {
    workbook.current?.setEditable(!disabled && !saving && !conflict);
  }, [disabled, saving, ready, conflict]);

  const save = async () => {
    const current = workbook.current;
    if (!current || saving || disabled || conflict) return;
    setSaving(true);
    setError(null);
    try {
      const next = fromUniverWorkbookSnapshot(current.save(), baseline.content, current.getActiveSheet().getSheetId());
      await onSave(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The spreadsheet revision could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const propose = async () => {
    const current = workbook.current;
    if (!current || saving || disabled || conflict) return;
    const sheetId = current.getActiveSheet().getSheetId();
    const sheet = baseline.content.sheets.find((candidate) => candidate.id === sheetId);
    try {
      await onDraft({ sheetId, ref: cellRef, before: sheet?.cells[cellRef] ?? null, after: { ...sheet?.cells[cellRef], raw: proposedRaw, format: sheet?.cells[cellRef]?.format ?? null } });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The proposed change could not be created.");
    }
  };

  return <div data-testid="univer-artifact-editor">
    <p className="mb-2 font-terminal text-[12px] text-muted-foreground">SPREADSHEET · LOCAL EDITING · LIOS REVISION HISTORY</p>
    {conflict && <div role="alert" data-testid="spreadsheet-revision-conflict" className="mb-3 rounded border border-amber-300/40 p-3 text-[13px] text-amber-200">A newer saved spreadsheet revision arrived. Your local draft has been retained; editing and saving are blocked until you explicitly reload.<button type="button" disabled={disabled || saving} onClick={() => { conflictRef.current = false; setConflict(false); setBaseline({ content, revisionKey }); }} className="ml-2 underline">Reload saved spreadsheet (discard local draft)</button></div>}
    <div ref={container} className="h-[540px] min-h-[360px] overflow-hidden rounded-lg border border-border/60" aria-label="Artifact spreadsheet" />
    {selected && <SpreadsheetCellSourceInspect sheetName={selected.sheetName} cellRef={selected.ref} cell={selected.cell}/>}
    {error && <p role="alert" className="mt-2 text-[13px] text-red-300">{error}</p>}
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <button disabled={!ready || saving || disabled || conflict} onClick={() => void save()} className="rounded bg-amber-300 px-3 py-1.5 font-ui text-[13px] font-semibold text-black disabled:opacity-50">{saving ? "Saving revision…" : "Save spreadsheet revision"}</button>
      <div className="ml-auto flex gap-1">
        <input disabled={!ready || saving || disabled || conflict} aria-label="Proposed cell reference" value={cellRef} onChange={(event) => setCellRef(event.target.value.toUpperCase())} className="w-16 rounded border border-border/50 bg-black/20 px-2 py-1 font-terminal text-[13px]" />
        <input disabled={!ready || saving || disabled || conflict} aria-label="Proposed cell value" value={proposedRaw} onChange={(event) => setProposedRaw(event.target.value)} className="w-32 rounded border border-border/50 bg-black/20 px-2 py-1 font-terminal text-[13px]" />
        <button disabled={!ready || saving || disabled || conflict} onClick={() => void propose()} className="rounded border border-cyan-300/20 px-2 py-1 font-ui text-[13px] text-cyan-200">Create review diff</button>
      </div>
    </div>
  </div>;
}
