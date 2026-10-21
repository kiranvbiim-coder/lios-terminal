import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import { initialTerminalScreenState, readTerminalScreenState, terminalExecutionTargetSchema, type TerminalScreenState, type TerminalExecutionTarget, type TerminalExecutionVersion } from "@shared/terminalArtifact";
import { TerminalArtifactStateProvider, useTerminalArtifactRenderer, useTerminalArtifactAudience, type TerminalArtifactTarget } from "@/lib/terminalArtifactState";
import { chatTerminalCapabilities } from "@/lib/chatTerminalContext";
import TickerTape from "./TickerTape";
import MacroTickerTape from "./MacroTickerTape";
import { ReadableValueTable } from "./ReadableValueTable";
import { apiRequest } from "@/lib/queryClient";
import type { ArtifactDetail } from "@/lib/useArtifacts";

type Screen = Extract<ArtifactContent, { kind: "screen" }>;
export default function TerminalScreenArtifact({ content, revision, onSave, onDirtyChange, onAsk, target, onNativeVersion, disabled = false, ephemeral = false }: {
  content: Screen; revision: number; onSave: (content: ArtifactContent) => Promise<void>; target?: TerminalArtifactTarget; onNativeVersion?: (version: number) => void;
  onDirtyChange?: (dirty: boolean) => void; onAsk?: (id: string, title: string, stagedPrompt?: string) => void; disabled?: boolean; ephemeral?: boolean;
}) {
  const render = useTerminalArtifactRenderer();
  const audience = useTerminalArtifactAudience();
  const mountedTarget = useRef({ active: true, id: target?.artifactId, version: target?.version, contentHash: target?.contentHash });
  Object.assign(mountedTarget.current, { id: target?.artifactId, version: target?.version, contentHash: target?.contentHash });
  useEffect(() => { mountedTarget.current.active = true; return () => { mountedTarget.current.active = false; }; }, []);
  const [draft, setDraft] = useState(content);
  const draftRef = useRef(draft); draftRef.current = draft;
  const [baseline, setBaseline] = useState(JSON.stringify(content));
  const [saving, setSaving] = useState(false);
  const [activeEditors, setActiveEditors] = useState<Set<string>>(() => new Set());
  const editorKeys = useRef(new Set<string>());
  const setEditing = useCallback((key: string, editing: boolean) => {
    if (editorKeys.current.has(key) === editing) return;
    if (editing) editorKeys.current.add(key); else editorKeys.current.delete(key);
    setActiveEditors(new Set(editorKeys.current));
  }, []);
  const nativePending = [...activeEditors].some(key => key.startsWith("native-quant:"));
  const [error, setError] = useState<string | null>(null);
  const savedHash = useRef<string | null>(null);
  const current = useRef(content); current.current = content;
  const saveCallback = useRef(onSave); saveCallback.current = onSave;
  const dirty = JSON.stringify(draft) !== baseline;
  const pending = useRef(false);
  const terminal = readTerminalScreenState(draft.state);
  useEffect(() => {
    const incoming = JSON.stringify(content);
    if ((savedHash.current !== null && JSON.stringify(draftRef.current) === savedHash.current) || JSON.stringify(draftRef.current) === baseline) {
      setDraft(content); setBaseline(incoming); savedHash.current = null;
    } else if (incoming !== baseline) setError("This terminal Artifact changed elsewhere. Your unsaved analytical inputs remain here; reset or reopen before saving.");
  }, [content, revision]);
  useEffect(() => { onDirtyChange?.(!ephemeral && (dirty || saving || activeEditors.size > 0)); return () => onDirtyChange?.(false); }, [dirty, saving, ephemeral, activeEditors.size, onDirtyChange]);
  const change = useCallback((update: (state: TerminalScreenState) => TerminalScreenState, view?: string) => {
    if (disabled || pending.current || [...editorKeys.current].some(key => key.startsWith("native-quant:"))) return;
    setDraft(previous => {
      const state = readTerminalScreenState(previous.state) ?? initialTerminalScreenState(previous.symbol);
      const next = update(state);
      if ((!view || previous.view === view) && JSON.stringify(next) === JSON.stringify(state)) return previous;
      return { ...previous, ...(view ? { view } : {}), symbol: next.subject.symbol, state: { ...previous.state, terminal: next } };
    });
  }, [disabled]);
  const initialize = useCallback((key: string, value: unknown) => change(state => Object.hasOwn(state.panelState, key) ? state : ({ ...state, panelState: { ...state.panelState, [key]: value } })), [change]);
  const update = useCallback((key: string, updater: (value: unknown) => unknown) => change(state => {
    const value = updater(state.panelState[key]);
    return { ...state,
      ...(key === "PortfolioStressPanel.portfolioId" ? { portfolioId: value === null ? null : String(value) } : {}),
      ...(key === "RiskReturnScatterPanel.benchmark" ? { benchmarkId: typeof value === "string" ? value : null } : {}),
      ...(key === "PortfolioStressPanel.scenario" && value && typeof value === "object" && "id" in value ? { scenarioId: String(value.id) } : {}),
      panelState: { ...state.panelState, [key]: value } };
  }), [change]);
  const setSymbol = useCallback((symbol: string) => change(state => state.subject.symbol === symbol ? state : ({ ...state, subject: { symbol } })), [change]);
  const save = useCallback(async () => {
    if (pending.current || disabled || ephemeral || !dirty || editorKeys.current.size > 0) return;
    pending.current = true; setSaving(true); setError(null);
    const snapshot = draftRef.current;
    try { savedHash.current = JSON.stringify(snapshot); await saveCallback.current(snapshot); setBaseline(JSON.stringify(snapshot)); }
    catch (cause) { savedHash.current = null; setError(cause instanceof Error ? cause.message : "Terminal Artifact could not be saved. Authored inputs remain available."); }
    finally { pending.current = false; setSaving(false); }
  }, [disabled, ephemeral, dirty, activeEditors.size]);
  useEffect(() => {
    if (ephemeral && dirty) {
      const snapshot = draftRef.current;
      savedHash.current = JSON.stringify(snapshot);
      void saveCallback.current(snapshot);
      setBaseline(JSON.stringify(snapshot));
      return;
    }
    if (!dirty || disabled || ephemeral || error || activeEditors.size > 0) return;
    const timer = window.setTimeout(() => { void save(); }, 600);
    return () => clearTimeout(timer);
  }, [draft, dirty, disabled, ephemeral, error, save, activeEditors.size]);
  const ask = useCallback((id: string, title: string, stagedPrompt?: string) => {
    if (dirty || saving || activeEditors.size > 0) { setError("Save or reset this terminal's authored inputs before asking about another Artifact."); return; }
    onAsk?.(id, title, stagedPrompt);
  }, [dirty, saving, activeEditors.size, onAsk]);
  const captureExecution = useCallback((slot: string): TerminalExecutionTarget => {
    if (disabled || pending.current || [...editorKeys.current].some(key => key.startsWith("native-quant:")) || !target || ephemeral) throw new Error("Open a current saved terminal Artifact before retaining a native run.");
    return terminalExecutionTargetSchema.parse({ artifactId: target.artifactId, baseVersion: target.version, baseHash: target.contentHash, slot, authoredState: readTerminalScreenState(draftRef.current.state) });
  }, [disabled, target, ephemeral]);
  const completeExecution = useCallback(async (version: TerminalExecutionVersion, submitted: TerminalExecutionTarget) => {
    if (!target || version.artifactId !== target.artifactId || version.artifactId !== submitted.artifactId || version.baseVersion !== submitted.baseVersion || version.version <= submitted.baseVersion) throw new Error("Native result did not return the selected canonical Artifact revision.");
    if (!mountedTarget.current.active || mountedTarget.current.id !== submitted.artifactId || mountedTarget.current.version !== submitted.baseVersion || mountedTarget.current.contentHash !== submitted.baseHash) return;
    const detail = await (await apiRequest("GET", `/api/artifacts/${encodeURIComponent(version.artifactId)}?version=${version.version}`)).json() as ArtifactDetail;
    if (!mountedTarget.current.active || mountedTarget.current.id !== submitted.artifactId || mountedTarget.current.version !== submitted.baseVersion || mountedTarget.current.contentHash !== submitted.baseHash) return;
    if (detail.artifact.id !== version.artifactId || detail.version.version !== version.version || detail.version.contentHash !== version.contentHash || detail.version.content.kind !== "screen") throw new Error("Retained native result revision could not be verified.");
    const canonical = detail.version.content;
    const unchanged = JSON.stringify(readTerminalScreenState(draftRef.current.state)) === JSON.stringify(submitted.authoredState);
    const next = unchanged ? canonical : { ...draftRef.current, state: { ...canonical.state, terminal: draftRef.current.state.terminal } };
    draftRef.current = next;
    setDraft(next); setBaseline(JSON.stringify(canonical));
    savedHash.current = unchanged ? JSON.stringify(next) : null;
    if (!unchanged) setError("Native result was retained; newer authored inputs remain unsaved against that exact result revision.");
    onNativeVersion?.(version.version);
  }, [target, onNativeVersion]);
  const executions = draft.state.terminalExecutions && typeof draft.state.terminalExecutions === "object" && !Array.isArray(draft.state.terminalExecutions) ? draft.state.terminalExecutions as Record<string, unknown> : undefined;
  const provider = useMemo(() => terminal ? ({ symbol: terminal.subject.symbol, setSymbol, sourceScope: terminal.sourceScope, readOnly: disabled || saving || nativePending, state: terminal.panelState, initialize, update, setEditing, target, executions,
    ...(target && !ephemeral ? { captureExecution, completeExecution } : {}), ...(onAsk ? { onAsk: ask } : {}) }) : null, [terminal, setSymbol, disabled, saving, nativePending, initialize, update, setEditing, target, executions, ephemeral, captureExecution, completeExecution, onAsk, ask]);
  const capability = chatTerminalCapabilities(audience).find(item => item.view === draft.view);
  const liveAllowed = terminal?.sourceScope === "auto" || terminal?.sourceScope === "web";
  if (!terminal || !provider || !render || !capability) return <p role="alert">This retained terminal view is unavailable for this account. Its recorded state is unchanged.</p>;
  return <section data-testid="terminal-screen-artifact" data-terminal-view={draft.view} className="flex min-h-[520px] flex-col gap-2">
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <strong>{capability.label}{draft.symbol ? ` · ${draft.symbol}` : ""}</strong>
      <span role="status">{ephemeral ? "Temporary · not retained" : saving ? "Saving analytical state…" : dirty ? "Unsaved analytical state" : `Saved analytical state · v${revision}`}</span>
      {!disabled && !ephemeral && <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded border p-1">Save state</button>}
      <button type="button" disabled={saving} onClick={() => { setDraft(current.current); setBaseline(JSON.stringify(current.current)); setError(null); }}>Reset local edits</button>
      <label><input type="checkbox" checked={terminal.stockTape} disabled={disabled} onChange={event => change(state => ({ ...state, stockTape: event.target.checked }))}/> Stock ticker tape</label>
      <label><input type="checkbox" checked={terminal.macroTape} disabled={disabled} onChange={event => change(state => ({ ...state, macroTape: event.target.checked }))}/> Macro ticker tape</label>
    </div>
    <p className="text-xs text-muted-foreground">Live view · market observations refresh through existing authorized terminal sources. Saved state retains authored inputs and settings, not a frozen price snapshot.</p>
    <p className="text-xs text-muted-foreground">Source scope: {terminal.sourceScope} · {terminal.subject.listingId ? `Canonical listing ${terminal.subject.listingId}` : "No canonical listing has been resolved; the explicit symbol is a navigation hint, not verified identity."}</p>
    {draft.state.recordedAnalysis !== null && typeof draft.state.recordedAnalysis === "object" && !Array.isArray(draft.state.recordedAnalysis) && <details className="border border-border p-2"><summary>Recorded analytical result · saved revision, not refreshed by the live view</summary><ReadableValueTable title="Recorded analysis" values={draft.state.recordedAnalysis as Record<string, unknown>} options={{ showExact: true }} /></details>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <TerminalArtifactStateProvider value={provider}>
      {terminal.stockTape && liveAllowed && <TickerTape onSymbol={setSymbol}/>}
      {terminal.macroTape && liveAllowed && <MacroTickerTape onSymbol={setSymbol}/>}
      <fieldset ref={element => { if (element) element.inert = disabled || saving || nativePending; }} disabled={disabled || saving || nativePending}
        onFocusCapture={event => {
          const target = event.target;
          if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(target.type) || target instanceof HTMLElement && target.isContentEditable) setEditing("focused-control", true);
        }}
        onBlurCapture={() => setEditing("focused-control", false)}
        className="min-h-[450px] min-w-0 flex-1 overflow-auto">
        {!liveAllowed && !["clientdata", "uide", "spreadsheet", "personalfinance"].includes(draft.view) ? <p role="status">This source scope does not permit this live-market panel to fetch external observations. Use an authorized owned-data or spreadsheet tool, or explicitly choose Auto/Web in Sources. No external request was substituted.</p> : capability.symbolAware && !draft.symbol ? <p role="status">Choose an explicit symbol through Chat to open this financial view.</p> : render({ view: capability.view, symbol: draft.symbol }, { onSymbol: symbol => change(state => ({ ...state, subject: { symbol } }), capability.symbolAware ? undefined : "quote"), onNav: view => {
          if (chatTerminalCapabilities(audience).some(item => item.view === view)) change(state => state, view);
          else setError("This destination is not available for this account in the terminal Artifact.");
        } })}
      </fieldset>
    </TerminalArtifactStateProvider>
  </section>;
}
