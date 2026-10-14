import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ArtifactDetail } from "@/lib/useArtifacts";
import type { ProjectSession } from "@/lib/useProjects";
import { ArtifactPane } from "./ArtifactPane";
interface Note { id: string; toVersion: number; createdByUserId: number; createdAt: string; detail: { reviewNote: { text: string; anchor: string; status: "open" | "resolved"; supersedes: string | null } }; }
export default function ArtifactReviewNotes({ detail, sessions, onAsk }: { detail: ArtifactDetail; sessions: ProjectSession[]; onAsk: (id: string, title: string, prompt?: string) => void }) {
  const id = detail.artifact.id, version = detail.version.version;
  const notes = useQuery<Note[]>({ queryKey: ["/api/artifacts", id, "review-notes"], queryFn: async () => { const response = await fetch(`/api/artifacts/${encodeURIComponent(id)}/review-notes`); if (!response.ok) throw new Error("Review notes unavailable."); return response.json(); } });
  const [text, setText] = useState(""), [anchor, setAnchor] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [output, setOutput] = useState<string | null>(null);
  const write = async (body: { text: string; anchor: string; status: string; supersedes: string | null }) => { setPending(true); setError(null); try { await apiRequest("POST", `/api/artifacts/${encodeURIComponent(id)}/review-notes`, { ...body, version, contentHash: detail.version.contentHash }); setText(""); await notes.refetch(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Review write failed."); } finally { setPending(false); } };
  if (output) return <section><button onClick={() => setOutput(null)}>Back to reviewed source</button><ArtifactPane artifactId={output} projectId={detail.artifact.projectId} sessions={sessions} onClose={() => setOutput(null)} onAsk={onAsk}/></section>;
  const current = notes.data?.filter(note => note.toVersion === version) ?? [];
  const replaced = new Set(current.map(note => note.detail.reviewNote.supersedes));
  return <details className="mb-4 rounded border border-border/50 p-3"><summary>Version-bound review / annotations</summary><p className="mt-2 text-sm text-muted-foreground">Append-only P4 history on saved v{version}. Notes and resolutions are attributed, never decision approvals; existing scoped access and Decision review authority remain unchanged.</p>
    <label>Review anchor<input aria-label="Review note anchor" value={anchor} onChange={event => setAnchor(event.target.value)} placeholder="Cell / block / section"/></label>
    <textarea aria-label="Review note text" value={text} onChange={event => setText(event.target.value)} className="block w-full rounded border border-border p-2"/>
    <button disabled={pending || !text.trim()} onClick={() => void write({ text, anchor, status: "open", supersedes: null })}>Record version-bound review note</button>
    {current.map(note => <article key={note.id} className="mt-2 rounded border border-border/50 p-2"><p>Author {note.createdByUserId} · {note.createdAt} · {note.detail.reviewNote.status}{replaced.has(note.id) ? " · superseded" : ""}</p><p>{note.detail.reviewNote.anchor}</p><p className="whitespace-pre-wrap">{note.detail.reviewNote.text}</p>{note.detail.reviewNote.status === "open" && !replaced.has(note.id) && <button disabled={pending} onClick={() => void write({ text: `Resolved: ${note.detail.reviewNote.text}`, anchor: note.detail.reviewNote.anchor, status: "resolved", supersedes: note.id })}>Record resolution</button>}</article>)}
    <button disabled={pending} onClick={async () => { setPending(true); try { const response = await apiRequest("POST", `/api/artifacts/${encodeURIComponent(id)}/review-package`, { version, contentHash: detail.version.contentHash }); const saved: ArtifactDetail = await response.json(); setOutput(saved.artifact.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Review package failed."); } finally { setPending(false); } }}>Create and open recorded review package</button>
    {notes.isError && <p role="alert">Review history could not be loaded; no state is inferred.</p>}{error && <p role="alert">{error}</p>}
  </details>;
}
