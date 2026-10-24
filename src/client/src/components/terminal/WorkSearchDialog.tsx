import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileText, FolderKanban, MessageSquare, Search, Sparkles, X } from "lucide-react";
import { workSearchResponseSchema, type WorkSearchResult } from "@shared/workSearch";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (result: WorkSearchResult) => void | Promise<void>;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setResults([]);
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
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/work-search?q=${encodeURIComponent(normalized)}&limit=30`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search is temporarily unavailable.");
        const parsed = workSearchResponseSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setResults(parsed.results);
        setSelected(0);
      } catch (searchError) {
        if (searchError instanceof DOMException && searchError.name === "AbortError") return;
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

  useEffect(() => {
    if (!open || !results.length) return;
    document.getElementById(`lios-work-search-option-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [open, results, selected]);

  const status = useMemo(() => {
    if (query.trim().length < 2) return "Search chats, Projects, files and Artifacts.";
    if (loading) return "Searching your LiOS work…";
    if (error) return error;
    if (!results.length) return "No matching work.";
    return `${results.length} result${results.length === 1 ? "" : "s"}`;
  }, [error, loading, query, results.length]);

  if (!open) return null;

  const run = async (result: WorkSearchResult) => {
    try {
      await onSelect(result);
      onClose();
    } catch (openError) {
      setResults([]);
      setError(openError instanceof Error ? openError.message : "That item is no longer available.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl overflow-hidden rounded-2xl border border-border/70 bg-[#0b0b0b] p-0 shadow-2xl" aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <DialogTitle className="sr-only">Search LiOS</DialogTitle>
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              // A new query cannot execute a result retained from an older search.
              setQuery(event.target.value);
              setResults([]);
              setSelected(0);
              setLoading(event.target.value.trim().length >= 2);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, Math.max(0, results.length - 1))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
              if (event.key === "Enter" && results[selected]) { event.preventDefault(); void run(results[selected]); }
            }}
            className="min-w-0 flex-1 bg-transparent font-ui text-[15px] text-foreground outline-none placeholder:text-muted-foreground/55"
            placeholder="Search chats, Projects, files and Artifacts"
            aria-label="Search LiOS work"
            aria-describedby="lios-work-search-help"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls="lios-work-search-results"
            aria-expanded={results.length > 0}
            aria-activedescendant={results[selected] ? `lios-work-search-option-${selected}` : undefined}
            autoComplete="off"
          />
          {query && <button type="button" onClick={() => setQuery("")} className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.05] hover:text-foreground" aria-label="Clear search"><X className="h-4 w-4" /></button>}
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.05] hover:text-foreground" aria-label="Close search"><X className="h-4 w-4" /></button>
        </div>
        <p id="lios-work-search-help" className="sr-only">Use the up and down arrow keys to review results; press Enter to open the selected item. Tab moves through controls.</p>
        <p role="status" aria-live="polite" className="sr-only">{status}</p>
        <div className="max-h-[58vh] overflow-y-auto p-2">
          <div id="lios-work-search-results" role="listbox" aria-label="Search results" aria-busy={loading}>
          {results.map((result, index) => (
            <button
              key={result.id}
              id={`lios-work-search-option-${index}`}
              role="option"
              aria-selected={selected === index}
              type="button"
              onFocus={() => setSelected(index)}
              onMouseEnter={() => setSelected(index)}
              onClick={() => void run(result)}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2 ${selected === index ? "bg-white/[0.06]" : "hover:bg-white/[0.035]"}`}
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
          </div>
          {!results.length && <div className={`px-5 py-12 text-center font-ui text-[13px] ${error ? "text-red-300" : "text-muted-foreground"}`} role={error ? "alert" : undefined}>{status}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
