import { useEffect, useReducer, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROJECT_MEMORY_NOTE_MAX_CHARS, createProjectMemoryNoteSchema, updateProjectMemoryNoteSchema,
  deleteProjectMemoryNoteSchema, projectMemoryNoteListSchema, projectMemoryNoteSchema,
  type ProjectMemoryNote, type ProjectMemoryNoteList,
} from "@shared/projectMemoryNotes";

type Editor = {
  intent: "create" | "edit" | "delete";
  note: ProjectMemoryNote | null;
  content: string;
  phase: "write" | "review";
  conflict: boolean;
  current: ProjectMemoryNote | null | undefined;
};
type EditorAction =
  | { type: "open"; intent: Editor["intent"]; note?: ProjectMemoryNote }
  | { type: "change"; content: string }
  | { type: "review" | "back" | "conflict" | "clear" }
  | { type: "current"; note: ProjectMemoryNote | null }
  | { type: "acceptCurrent" };

/** The same state transitions used by the form keep review bound to its exact draft/revision. */
export function memoryNoteEditorReducer(state: Editor | null, action: EditorAction): Editor | null {
  if (action.type === "clear") return null;
  if (action.type === "open") return {
    intent: action.intent, note: action.note ?? null, content: action.note?.content ?? "",
    phase: action.intent === "delete" ? "review" : "write", conflict: false, current: undefined,
  };
  if (!state) return state;
  switch (action.type) {
    case "change": return { ...state, content: action.content, phase: "write" };
    case "review": return createProjectMemoryNoteSchema.safeParse({ content: state.content, reviewed: true }).success && !state.conflict
      ? { ...state, phase: "review" } : state;
    case "back": return { ...state, phase: "write" };
    case "conflict": return { ...state, conflict: true, current: undefined };
    case "current": return { ...state, current: action.note };
    case "acceptCurrent": return state.conflict && state.current && state.note?.memoryKey === state.current.memoryKey
      ? { ...state, note: state.current, phase: "review", conflict: false, current: undefined } : state;
  }
}

export function memoryNoteDraftIsDirty(editor: Editor | null): boolean {
  return Boolean(editor && editor.intent !== "delete" && editor.content !== (editor.note?.content ?? ""));
}

export function reviewedMemoryNoteRequest(editor: Editor | null) {
  if (!editor || editor.phase !== "review" || editor.conflict) return null;
  if (editor.intent === "create") {
    const parsed = createProjectMemoryNoteSchema.safeParse({ content: editor.content, reviewed: true });
    return parsed.success ? { method: "POST", suffix: "", body: parsed.data } : null;
  }
  if (!editor.note) return null;
  const suffix = `/${encodeURIComponent(editor.note.memoryKey)}`;
  if (editor.intent === "delete") {
    const parsed = deleteProjectMemoryNoteSchema.safeParse({ expectedRevision: editor.note.revision, reviewed: true });
    return parsed.success ? { method: "DELETE", suffix, body: parsed.data } : null;
  }
  const parsed = updateProjectMemoryNoteSchema.safeParse({ content: editor.content, expectedRevision: editor.note.revision, reviewed: true });
  return parsed.success ? { method: "PATCH", suffix, body: parsed.data } : null;
}

export class MemoryNoteRequestError extends Error {
  constructor(readonly conflict = false) { super(conflict ? "This note changed. Your draft is retained. Load and review the current revision before trying again." : "Project notes could not be saved. Your draft is retained; refresh the notes before trying again."); }
}

export async function loadMemoryNotePage(projectId: number, after: string | null, signal: AbortSignal): Promise<ProjectMemoryNoteList> {
  try {
    const search = new URLSearchParams({ limit: "20" });
    if (after !== null) search.set("after", after);
    const response = await fetch(`/api/projects/${projectId}/memory-notes?${search}`, { credentials: "include", signal });
    if (!response.ok) throw new Error();
    return projectMemoryNoteListSchema.parse(await response.json());
  } catch {
    throw new Error("Project notes are unavailable. Try refreshing notes.");
  }
}

export async function saveReviewedMemoryNote(projectId: number, editor: Editor | null, signal: AbortSignal): Promise<void> {
  const request = reviewedMemoryNoteRequest(editor);
  if (!request || !editor) throw new MemoryNoteRequestError();
  try {
    const response = await fetch(`/api/projects/${projectId}/memory-notes${request.suffix}`, {
      method: request.method, credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body), signal,
    });
    if (!response.ok) throw new MemoryNoteRequestError(response.status === 409);
    const result = await response.json();
    if (request.method === "DELETE") {
      if (result?.deleted !== true) throw new MemoryNoteRequestError();
    } else {
      const note = projectMemoryNoteSchema.safeParse(result?.note);
      if (!note.success || note.data.content !== editor.content || (editor.note && (note.data.memoryKey !== editor.note.memoryKey || note.data.revision <= editor.note.revision))) throw new MemoryNoteRequestError();
    }
  } catch (cause) {
    throw cause instanceof MemoryNoteRequestError ? cause : new MemoryNoteRequestError();
  }
}

const buttonClass = "min-h-9 rounded border px-2 disabled:opacity-50";

export default function ProjectMemoryNotesEditor({ projectId }: { projectId: number }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState(0);
  const [editor, dispatch] = useReducer(memoryNoteEditorReducer, null);
  const [pendingSwitch, setPendingSwitch] = useState<Extract<EditorAction, { type: "open" }> | { type: "clear" } | "close" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const prefix = ["/api/projects", projectId, "memory-notes"];
  const query = useQuery({
    queryKey: [...prefix, cursors[page]], enabled: open, staleTime: 0,
    queryFn: ({ signal }) => loadMemoryNotePage(projectId, cursors[page], signal),
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
      void client.cancelQueries({ queryKey: ["/api/projects", projectId, "memory-notes"] });
    };
  }, [client, projectId]);

  function switchEditor(action: NonNullable<typeof pendingSwitch>, confirmed = false) {
    if (busyRef.current) return;
    if (!confirmed && memoryNoteDraftIsDirty(editor)) { setPendingSwitch(action); return; }
    setPendingSwitch(null); setError(""); setNotice("");
    if (action === "close") {
      setOpen(false); dispatch({ type: "clear" });
      void client.cancelQueries({ queryKey: prefix });
    } else dispatch(action);
  }
  async function invalidateContext() {
    await Promise.all([
      client.invalidateQueries({ queryKey: prefix }),
      client.invalidateQueries({ queryKey: ["/api/projects", projectId, "memory-recall-consent"], exact: true }),
      client.invalidateQueries({ queryKey: ["/api/projects", projectId], exact: true }),
      client.invalidateQueries({ queryKey: ["/api/projects", projectId, "home"], exact: true }),
    ]);
  }
  async function save() {
    if (busyRef.current || !reviewedMemoryNoteRequest(editor)) return;
    const controller = new AbortController();
    pending.current = controller; busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await saveReviewedMemoryNote(projectId, editor, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      dispatch({ type: "clear" });
      setNotice(editor?.intent === "delete" ? "Note deleted. Prior content is erased; its tombstone is retained." : "Owner note saved. Recall consent has not changed.");
      // Return to the beginning after a write; every older page remains reachable by its cursor.
      setCursors([null]); setPage(0);
      await invalidateContext();
    } catch (cause) {
      if (!alive.current || controller.signal.aborted) return;
      if (cause instanceof MemoryNoteRequestError && cause.conflict) dispatch({ type: "conflict" });
      setError(cause instanceof MemoryNoteRequestError && cause.conflict ? cause.message : "Project notes could not be saved. Your draft is retained; refresh the notes before trying again.");
    } finally {
      if (alive.current && !controller.signal.aborted) { busyRef.current = false; setBusy(false); pending.current = null; }
    }
  }
  async function loadCurrent() {
    if (busyRef.current || !editor?.note) return;
    const memoryKey = editor.note.memoryKey;
    const controller = new AbortController();
    pending.current = controller; busyRef.current = true; setBusy(true); setError("");
    try {
      let after: string | null = null;
      const visited = new Set<string>();
      let current: ProjectMemoryNote | null = null;
      do {
        const result = await loadMemoryNotePage(projectId, after, controller.signal);
        if (!alive.current || controller.signal.aborted) return;
        current = result.notes.find(note => note.memoryKey === memoryKey) ?? null;
        if (current || result.nextCursor === null) break;
        if (visited.has(result.nextCursor)) throw new Error("Repeated cursor");
        visited.add(result.nextCursor); after = result.nextCursor;
      } while (true);
      dispatch({ type: "current", note: current });
    } catch {
      if (alive.current && !controller.signal.aborted) setError("The current note could not be loaded. Your draft is retained; try again.");
    } finally {
      if (alive.current && !controller.signal.aborted) { busyRef.current = false; setBusy(false); pending.current = null; }
    }
  }
  const validDraft = editor && createProjectMemoryNoteSchema.safeParse({ content: editor.content, reviewed: true }).success;
  return <div className="space-y-2" aria-label="Explicit owner Project notes">
    <button type="button" className={buttonClass} disabled={busy} aria-expanded={open} onClick={() => open ? switchEditor("close") : setOpen(true)}>{open ? "Close owner notes" : "Manage owner notes"}</button>
    {open && <div className="space-y-3 rounded border p-2">
      <h4 className="font-semibold">Explicit owner notes</h4>
      <p className="text-muted-foreground">Write your own historical Project context, not verified facts, instructions or approval. Chat is never captured automatically. Saving a note does not enable recall or consent to send it to an AI provider; recall consent is separate above.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || Boolean(pendingSwitch)} onClick={() => switchEditor({ type: "open", intent: "create" })}>New owner note</button><button type="button" className={buttonClass} disabled={busy || query.isFetching} onClick={() => { setNotice(""); void query.refetch(); }}>Refresh notes</button></div>
      {query.isPending && <p role="status">Loading owner notes…</p>}
      {query.isError && <p role="alert">Project notes are unavailable. Try refreshing notes. Any open draft is retained.</p>}
      {query.data && <>
        {query.data.notes.length === 0 && <p>No owner notes on this page.</p>}
        <ul className="space-y-2" aria-label="Saved owner notes">{query.data.notes.map(note => <li key={note.memoryKey} className="space-y-1 rounded border p-2" data-testid="project-memory-note">
          <p className="text-muted-foreground">Revision {note.revision} · Updated {note.updatedAt}</p>
          <p className="whitespace-pre-wrap break-words" data-testid="project-memory-note-content">{note.content}</p>
          <div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy || Boolean(pendingSwitch)} onClick={() => switchEditor({ type: "open", intent: "edit", note })}>Edit note</button><button type="button" className={buttonClass} disabled={busy || Boolean(pendingSwitch)} onClick={() => switchEditor({ type: "open", intent: "delete", note })}>Delete note</button></div>
        </li>)}</ul>
        <div className="flex items-center gap-2"><button type="button" className={buttonClass} disabled={busy || query.isFetching || page === 0} onClick={() => setPage(value => value - 1)}>Previous notes</button><span>Page {page + 1}</span><button type="button" className={buttonClass} disabled={busy || query.isFetching || !query.data.nextCursor} onClick={() => { const next = query.data?.nextCursor; if (next) { setCursors(values => [...values.slice(0, page + 1), next]); setPage(value => value + 1); } }}>Next notes</button></div>
      </>}
      {pendingSwitch && <div role="alert" className="space-y-2 rounded border p-2"><p>Discard this unsaved note draft? Saved notes will not change.</p><div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => setPendingSwitch(null)}>Continue editing note</button><button type="button" className={buttonClass} onClick={() => switchEditor(pendingSwitch, true)}>Discard note draft</button></div></div>}
      {editor && <fieldset disabled={busy || Boolean(pendingSwitch)} className="min-w-0 space-y-2 rounded border p-2" data-testid="project-memory-note-editor">
        <legend>{editor.intent === "delete" ? "Confirm note deletion" : editor.intent === "edit" ? "Edit owner note" : "New owner note"}</legend>
        {editor.note && <p>Based on revision {editor.note.revision}</p>}
        {editor.intent === "delete" ? <><p>Deleting erases prior note content while retaining a tombstone. It prevents future recall of this note, but cannot unsend previous provider requests.</p><p className="whitespace-pre-wrap break-words">{editor.note?.content}</p></> : editor.phase === "write" ? <>
          <label className="block space-y-1">Owner note text<textarea aria-label="Owner note text" maxLength={PROJECT_MEMORY_NOTE_MAX_CHARS} rows={5} value={editor.content} onChange={event => dispatch({ type: "change", content: event.target.value })} className="block w-full rounded border bg-background p-2" /></label>
          <p className="text-muted-foreground">{editor.content.length} / {PROJECT_MEMORY_NOTE_MAX_CHARS} characters</p>
        </> : <><p>Review this exact text before saving{editor.note ? ` against revision ${editor.note.revision}` : ""}. This is not AI transmission consent.</p><p className="whitespace-pre-wrap break-words" data-testid="project-memory-note-preview">{editor.content}</p></>}
        {editor.conflict && <div role="alert" className="space-y-2"><p>This note changed. Your draft is retained and saving is blocked until you review the current note.</p><button type="button" className={buttonClass} onClick={() => void loadCurrent()}>Load current note for comparison</button>
          {editor.current === null && <p>The note is no longer available. Your draft is retained, but cannot overwrite or recreate that note.</p>}
          {editor.current && <><p>Current revision {editor.current.revision}</p><p className="whitespace-pre-wrap break-words" data-testid="project-memory-note-current">{editor.current.content}</p><button type="button" className={buttonClass} onClick={() => dispatch({ type: "acceptCurrent" })}>{editor.intent === "delete" ? "Review deletion of current revision" : "Review my draft against current revision"}</button></>}
        </div>}
        <div className="flex flex-wrap gap-2">
          {editor.intent !== "delete" && editor.phase === "write" && <button type="button" className={buttonClass} disabled={!validDraft || editor.conflict} onClick={() => dispatch({ type: "review" })}>Review note</button>}
          {editor.phase === "review" && <button type="button" className={buttonClass} disabled={!reviewedMemoryNoteRequest(editor)} onClick={() => void save()}>{editor.intent === "delete" ? "Delete reviewed note" : "Save reviewed note"}</button>}
          {editor.intent !== "delete" && editor.phase === "review" && <button type="button" className={buttonClass} onClick={() => dispatch({ type: "back" })}>Back to note editing</button>}
          <button type="button" className={buttonClass} onClick={() => switchEditor({ type: "clear" })}>{editor.intent === "delete" ? "Cancel note deletion" : "Cancel note"}</button>
        </div>
      </fieldset>}
      {busy && <p role="status">Updating owner notes…</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>}
  </div>;
}
