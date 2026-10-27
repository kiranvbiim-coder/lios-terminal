import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Search } from "lucide-react";
import type { CommonsCandidate } from "@shared/commonsMedia";
import { safeCommonsFilePage, safeCommonsPreview } from "@shared/commonsMedia";

function vettedCandidates(value: unknown): CommonsCandidate[] {
  if (!value || typeof value !== "object") return [];
  const payload = value as { status?: unknown; results?: unknown };
  if (payload.status !== "unreviewed" || !Array.isArray(payload.results)) return [];
  return payload.results.filter((row: unknown): row is CommonsCandidate => {
    if (!row || typeof row !== "object") return false;
    const candidate = row as CommonsCandidate;
    return candidate.license === "CC0 1.0"
      && typeof candidate.fileTitle === "string" && candidate.fileTitle.startsWith("File:")
      && typeof candidate.creator === "string"
      && Boolean(safeCommonsPreview(candidate) && safeCommonsFilePage(candidate));
  }).slice(0, 8);
}

/** Preview-only Commons illustration: never a packaged LiOS asset or event photograph. */
export function CommonsContextIllustration({ candidate, compact = false, showSource = false }: {
  candidate: CommonsCandidate;
  compact?: boolean;
  showSource?: boolean;
}) {
  const preview = safeCommonsPreview(candidate);
  const page = safeCommonsFilePage(candidate);
  if (!preview) return null;
  return <figure data-testid="commons-context-illustration"
    className="min-w-0 overflow-hidden rounded-lg border border-amber-300/20 bg-amber-300/[0.025]">
    <img src={preview} alt={"Context illustration: " + candidate.fileTitle.replace(/^File:/, "").trim()}
      loading="lazy" decoding="async" referrerPolicy="no-referrer"
      className={compact ? "h-20 w-full object-cover" : "max-h-64 w-full object-cover"} />
    <figcaption className="px-2 py-2 font-ui text-xs leading-5 text-muted-foreground">
      <span className="block font-semibold text-amber-200">Illustration only · not a photograph of the news event</span>
      {!compact && <span className="block">{candidate.creator} · Wikimedia Commons · CC0 metadata (review source before reuse)</span>}
      {showSource && page && <a href={page} rel="noopener noreferrer" target="_blank" referrerPolicy="no-referrer"
        className="inline-block underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-amber-300/70">Review Commons image and license</a>}
    </figcaption>
  </figure>;
}

/** Opt-in read-only image search. It never writes to the user's installation. */
export function NewsImageDiscovery({ articleTitle, onSelect, selected, onClear }: {
  articleTitle: string;
  onSelect: (candidate: CommonsCandidate) => void;
  selected: CommonsCandidate | null;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(articleTitle.trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 100));
  const [candidates, setCandidates] = useState<CommonsCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);

  const search = async () => {
    const keywords = term.trim();
    if (loading || keywords.length < 3 || keywords.length > 100) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    setCandidates(null);
    try {
      // Search terms reach Wikimedia only after a deliberate user action.
      const response = await fetch("/api/media/commons/cc0?q=" + encodeURIComponent(keywords), {
        credentials: "same-origin",
        signal: abort.signal,
      });
      if (!response.ok) throw new Error("Commons metadata unavailable.");
      const payload: unknown = await response.json();
      if (!abort.signal.aborted) setCandidates(vettedCandidates(payload));
    } catch {
      if (!abort.signal.aborted) setError("Image discovery unavailable. The story remains readable without pictures.");
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  };

  return <section data-testid="news-image-discovery" className="my-4 rounded-xl border border-border/60 bg-background/40">
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
      <span className="inline-flex items-center gap-2 font-ui text-sm font-medium text-foreground">
        <ImageIcon className="h-4 w-4 text-amber-200" aria-hidden="true" />Context imagery
      </span>
      <div className="flex flex-wrap gap-2">
        {selected && <button type="button" onClick={onClear}
          className="min-h-10 rounded-lg border border-border px-3 py-2 font-ui text-sm focus-visible:ring-2 focus-visible:ring-amber-300/70">
          Clear illustration
        </button>}
        <button type="button" aria-expanded={open} aria-controls="news-image-discovery-options"
          onClick={() => setOpen(value => !value)}
          className="min-h-10 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm text-foreground hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-amber-300/70">
          {open ? "Close image search" : "Find context image"}
        </button>
      </div>
    </div>
    {open && <div id="news-image-discovery-options" className="space-y-3 border-t border-border/60 p-3">
      <p className="font-ui text-xs leading-5 text-muted-foreground">
        Illustrations are not evidence of the event. Search sends the terms to Wikimedia Commons only when pressed. CC0 metadata is not an independent rights review.
      </p>
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void search(); }}>
        <label htmlFor="news-image-keywords" className="sr-only">Commons image search keywords</label>
        <input id="news-image-keywords" type="search" maxLength={100} value={term}
          onChange={event => { controller.current?.abort(); setLoading(false); setTerm(event.target.value); setCandidates(null); setError(null); }}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-ui text-sm text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70"
          placeholder="Subject for context illustrations" />
        <button type="submit" disabled={loading || term.trim().length < 3}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-300/35 px-3 py-2 font-ui text-sm disabled:opacity-40">
          <Search className="h-4 w-4" aria-hidden="true" />{loading ? "Searching…" : "Search Commons"}
        </button>
      </form>
      {error && <p role="alert" className="font-ui text-sm text-amber-100">{error}</p>}
      {loading && <p role="status" className="font-ui text-sm text-muted-foreground">Reading current CC0 file metadata…</p>}
      {candidates !== null && candidates.length === 0 && <p role="status" className="font-ui text-sm text-muted-foreground">No supported CC0 files found. Try another term.</p>}
      {candidates && candidates.length > 0 && <div className="grid gap-3 sm:grid-cols-2" aria-label="Commons CC0 image candidates">
        {candidates.map(candidate => {
          const url = safeCommonsPreview(candidate);
          const page = safeCommonsFilePage(candidate);
          if (!url || !page) return null;
          const isSelected = selected?.filePage === candidate.filePage;
          return <article key={candidate.fileTitle} className="min-w-0 overflow-hidden rounded-lg border border-border/65 bg-white/[0.02]">
            <img src={url} alt={"Commons candidate: " + candidate.fileTitle.replace(/^File:/, "")}
              loading="lazy" decoding="async" referrerPolicy="no-referrer"
              className="h-36 w-full object-cover" />
            <div className="space-y-2 p-3 font-ui text-sm">
              <p className="line-clamp-2 break-words font-semibold text-foreground">{candidate.fileTitle.replace(/^File:/, "")}</p>
              <p className="break-words text-xs text-muted-foreground">{candidate.creator} · CC0 (Commons metadata)</p>
              <a href={page} rel="noopener noreferrer" referrerPolicy="no-referrer" target="_blank"
                className="inline-block text-xs text-amber-200 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-amber-300/70">
                Review image source and license
              </a>
              <button type="button" onClick={() => onSelect(candidate)} aria-pressed={isSelected}
                className="block min-h-10 w-full rounded-lg border border-border/65 px-3 py-2 text-sm font-medium text-foreground hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-amber-300/70">
                {isSelected ? "Showing in this session" : "Show as context illustration"}
              </button>
            </div>
          </article>;
        })}
      </div>}
    </div>}
  </section>;
}
