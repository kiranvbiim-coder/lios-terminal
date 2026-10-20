// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Save } from "lucide-react";
import type { ReactNode } from "react";
import type { ArtifactContent } from "@shared/artifactContracts";

/** Collapsed-by-default disclosure. Children mount on first open and then stay mounted (hidden when
 * collapsed) so unsaved edits and their dirty state are never lost by collapsing. */
export function ExpertViewDisclosure({ summary = "Expert view", hint = "Raw recorded data for advanced checks.", defaultOpen = false, children }: {
  summary?: string; hint?: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [opened, setOpened] = useState(defaultOpen);
  const panelId = useId();
  return <section aria-label={summary} className="rounded-lg border border-border/40 p-2">
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen(current => !current); setOpened(true); }}
      className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left font-ui text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
      <span aria-hidden="true">{open ? "▾" : "▸"}</span><span className="font-semibold">{summary}</span><span className="text-[12px]">{hint}</span>
    </button>
    <div id={panelId} hidden={!open} className="mt-2">{opened ? children : null}</div>
  </section>;
}

/** The raw JSON editor, reachable only behind the explicit Expert view disclosure. */
export function JsonEditor({ content, onSave, onDirtyChange, disabled = false }: {
  content: ArtifactContent; onSave: (content: ArtifactContent) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; disabled?: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(content, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(JSON.stringify(content, null, 2)); setError(null); }, [content]);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  // A view that goes away (e.g. another Artifact opens) must not leave the pane's dirty flag set.
  useEffect(() => () => dirtyCallback.current?.(false), []);
  return <div>
    <p className="mb-2 font-ui text-[12px] text-amber-200">You are editing the recorded Artifact data directly. Invalid or unexpected changes can make the readable views unavailable. Saving creates a new revision.</p>
    <textarea aria-label="Artifact JSON" disabled={disabled} value={text}
      onChange={event => { setText(event.target.value); onDirtyChange?.(event.target.value !== JSON.stringify(content, null, 2)); }}
      className="min-h-[280px] w-full rounded-lg border border-border/50 bg-black/20 p-3 font-terminal text-[13px] leading-5 text-foreground outline-none disabled:opacity-50" />
    <div className="mt-2 flex justify-end gap-2">
      {error && <span role="alert" className="mr-auto font-ui text-[13px] text-red-300">{error}</span>}
      <button type="button" disabled={disabled} onClick={() => { setText(JSON.stringify(content, null, 2)); onDirtyChange?.(false); }} className="rounded px-2 py-1.5 font-ui text-[13px] text-muted-foreground">Reset</button>
      <button type="button" disabled={disabled} onClick={() => void (async () => {
        try { await onSave(JSON.parse(text) as ArtifactContent); setError(null); onDirtyChange?.(false); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid Artifact JSON."); }
      })()} className="flex items-center gap-1 rounded bg-amber-300 px-2.5 py-1.5 font-ui text-[13px] font-semibold text-black disabled:opacity-40"><Save className="h-3 w-3" /> Save revision</button>
    </div>
  </div>;
}

export function ExpertJsonView({ content, onSave, onDirtyChange, disabled = false, defaultOpen = false }: {
  content: ArtifactContent; onSave: (content: ArtifactContent) => Promise<void>; onDirtyChange?: (dirty: boolean) => void; disabled?: boolean; defaultOpen?: boolean;
}) {
  return <ExpertViewDisclosure defaultOpen={defaultOpen}><JsonEditor content={content} onSave={onSave} onDirtyChange={onDirtyChange} disabled={disabled} /></ExpertViewDisclosure>;
}
