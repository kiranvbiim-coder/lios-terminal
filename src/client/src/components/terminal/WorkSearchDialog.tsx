import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileText, FolderKanban, MessageSquare, Search, Sparkles, X } from "lucide-react";
import { workSearchResponseSchema, type WorkSearchResult } from "@shared/workSearch";
import { shouldCloseSearchAfterNavigation } from "@/lib/workSearchNavigationPolicy";
import { WORK_SEARCH_FILTERS, clampWorkSearchSelection, countWorkSearchKind, filterWorkSearchResults, workSearchEmptyMessage, type WorkSearchFilter } from "@/lib/workSearchFilters";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (result: WorkSearchResult) => boolean | Promise<boolean>;
}

const KIND_LABEL: Record<WorkSearchResult["kind"], string> = {
  project: "Project",
  chat: "Chat",
  artifact: "Artifact",
  file: "File",
};

function ResultIcon({ kind }: { kind: WorkSearchResult["kind"] }) {
  if (kind === "project") return <FolderKanban className="h-4 w-4" />;
  if (kind === "chat") return <MessageSquare className="h-4 w-4" />;
  if (kind === "artifact") return <Sparkles className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

export default function WorkSearchDialog({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<WorkSearchFilter>("all");
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const listId = useId();
  const keyboardHelpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setResults([]);
    setFilter("all");
    setError(null);
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/work-search?q=${encodeURIComponent(normalized)}&limit=30`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search is temporarily unavailable.");
        const parsed = workSearchResponseSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setResults(parsed.results);
        setSelected(0);
      } catch (searchError) {
        if (controller.signal.aborted || (searchError instanceof DOMException && searchError.name === "AbortError")) return;
        setResults([]);
        setError(searchError instanceof Error ? searchError.message : "Search is temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const visibleResults = useMemo(() => filterWorkSearchResults(results, filter), [results, filter]);
  useEffect(() => {
    setSelected((index) => clampWorkSearchSelection(index, visibleResults.length));
  }, [visibleResults.length]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-item-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [open, listId, selected, visibleResults]);

  const status = useMemo(() => {
    if (query.trim().length < 2) return workSearchEmptyMessage(query, filter, results.length);
    if (loading) return "Searching your LiOS work…";
    if (error) return error;
    if (!visibleResults.length) return workSearchEmptyMessage(query, filter, results.length);
    return `${visibleResults.length} of ${results.length} returned matches shown.`;
  }, [error, filter, loading, query, results.length, visibleResults.length]);

  if (!open) return null;

  const run = async (result: WorkSearchResult) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    try {
      const opened = await onSelect(result);
      if (shouldCloseSearchAfterNavigation(opened)) onClose();
      else inputRef.current?.focus();
    } catch (openError) {
      // Keep the already-authorized results so the user can retry or pick another.
      setError("This saved item could not be opened with your current access. Check the selection and retry.");
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl overflow-y-auto rounded-2xl border border-border/70 bg-[#0b0b0b] p-0 shadow-2xl" aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }} onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus({ preventScroll: true }); } }}>
        <DialogTitle className="sr-only">Search LiOS</DialogTitle>
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3 pr-14">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setResults([]); setSelected(0); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, Math.max(0, visibleResults.length - 1))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
              if (event.key === "Enter" && !event.nativeEvent.isComposing && !loading && !opening && visibleResults[selected]) { event.preventDefault(); void run(visibleResults[selected]); }
              if (event.key === "Escape") onClose();
            }}
            className="min-w-0 flex-1 bg-transparent font-ui text-[15px] text-foreground outline-none placeholder:text-muted-foreground/55"
            placeholder="Search chats, Projects, files and Artifacts"
            aria-label="Search LiOS work"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={!loading && visibleResults.length > 0}
            aria-controls={listId}
            aria-describedby={keyboardHelpId}
            aria-keyshortcuts="ArrowDown ArrowUp Enter Escape"
            aria-activedescendant={!loading && visibleResults[selected] ? `${listId}-item-${selected}` : undefined}
            autoComplete="off"
          />
          {query && <button type="button" onClick={() => { setQuery(""); setResults([]); setSelected(0); inputRef.current?.focus(); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.05] hover:text-foreground" aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </div>
        <p id={keyboardHelpId} className="sr-only">Use the up and down arrows to select, Enter to open, or Escape to close. Canceling a draft switch keeps this search open.</p>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 px-3 py-2" role="group" aria-label="Filter returned results by type">
          {WORK_SEARCH_FILTERS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={filter === entry.value}
              onClick={() => { setFilter(entry.value); setSelected(0); inputRef.current?.focus(); }}
              className={`min-h-9 rounded-lg border px-3 py-1.5 font-ui text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${filter === entry.value ? "border-cyan-300/50 bg-cyan-300/[0.1] text-cyan-100" : "border-border/55 text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"}`}
            >
              {entry.label} <span aria-hidden="true">({countWorkSearchKind(results, entry.value)})</span>
            </button>
          ))}
        </div>
        <p role={error && !visibleResults.length ? "alert" : "status"} aria-live="polite" className="px-4 py-2 font-ui text-[12px] text-muted-foreground">{status}{!loading && !error && results.length === 30 ? " Filters apply to these 30 returned matches; refine your search for different results." : ""}</p>
        {error && visibleResults.length > 0 && <p role="alert" className="mx-3 mb-2 rounded-md border border-red-400/30 p-2 font-ui text-[12px] text-red-200">{error}</p>}
        <div id={listId} role="listbox" aria-label="Matching LiOS work" aria-busy={loading || opening} className="max-h-[52vh] overflow-y-auto p-2">
          {!loading && visibleResults.map((result, index) => (
            <button
              key={`${result.kind}:${result.id}`}
              id={`${listId}-item-${index}`}
              role="option"
              aria-selected={selected === index}
              type="button"
              tabIndex={-1}
              disabled={opening}
              onMouseEnter={() => setSelected(index)}
              onClick={() => void run(result)}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${selected === index ? "bg-white/[0.06]" : "hover:bg-white/[0.035]"}`}
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground"><ResultIcon kind={result.kind} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <strong className="truncate font-ui text-[13px] font-semibold text-foreground">{result.title}</strong>
                  <small className="shrink-0 font-ui text-[10px] text-muted-foreground">{KIND_LABEL[result.kind]}</small>
                </span>
                {result.snippet && <span className="mt-1 block line-clamp-2 font-ui text-[12px] leading-5 text-muted-foreground">{result.snippet}</span>}
              </span>
            </button>
          ))}
          {!loading && !visibleResults.length && <div className="px-5 py-8 text-center font-ui text-[13px] text-muted-foreground">{workSearchEmptyMessage(query, filter, results.length)}</div>}
          {loading && <div className="px-5 py-8 text-center font-ui text-[13px] text-muted-foreground">Searching…</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}