import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpenCheck, FileText, Layers3, Plus, Trash2, X } from "lucide-react";
import {
  buildProjectBriefingReport, MAX_BRIEFING_SOURCES, type BriefingSource,
} from "@/lib/projectBriefingStoryboard";

export function ProjectBriefingStudio({
  projectId, artifacts, onSave, onClose,
}: {
  projectId: number;
  artifacts: readonly BriefingSource[];
  onSave: (sources: readonly BriefingSource[], title: string, introduction: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("My intelligence briefing");
  const [introduction, setIntroduction] = useState("");
  const [search, setSearch] = useState("");
  // Preserve the version/title captured at explicit selection, not just its ID.
  const [selectedSources, setSelectedSources] = useState<BriefingSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // Only exact, currently active Project Artifacts appear; source contents are not fetched.
  const available = artifacts.filter(artifact => artifact.projectId === projectId && artifact.status === "active");
  const byId = useMemo(() => new Map(available.map(item => [item.id, item])), [artifacts, projectId]);
  const chosen = selectedSources;
  const staleSelection = chosen.some(source => {
    const live = byId.get(source.id);
    return !live || live.headVersion !== source.headVersion || live.title !== source.title
      || live.kind !== source.kind || live.status !== "active" || live.projectId !== source.projectId;
  });
  const offered = available.filter(item =>
    item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    || item.kind.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const toggle = (id: string) => {
    setError(null);
    setSelectedSources(current => current.some(item => item.id === id) ? current.filter(item => item.id !== id)
      : current.length < MAX_BRIEFING_SOURCES && byId.has(id) ? [...current, { ...byId.get(id)! }] : current);
  };
  const move = (index: number, direction: -1 | 1) => {
    setSelectedSources(current => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };
  const save = async () => {
    if (busy || inFlight.current) return;
    setError(null);
    try {
      if (staleSelection) throw new Error("A selected source is no longer in this Project. Remove it and review the outline.");
      // Validation is repeated against a fresh server read by onSave.
      buildProjectBriefingReport({ projectId, title, introduction, sources: chosen });
      inFlight.current = true;
      setBusy(true);
      await onSave(chosen, title, introduction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the briefing.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label="Project Briefing Studio" data-testid="project-briefing-studio"
      className="mt-5 space-y-5 rounded-2xl border border-amber-300/25 bg-background/65 p-4 font-ui sm:p-5">
      <header className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-300/30 bg-amber-300/[0.07] text-amber-200">
          <Layers3 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-foreground">Briefing Studio</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Assemble a visual outline from your existing saved Project work, review its order, then save a versioned Report.
            Source contents, chart imagery, AI claims and external media are never generated or copied automatically.
          </p>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close Briefing Studio"
          className="grid min-h-10 min-w-10 shrink-0 place-items-center rounded-lg border border-border/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block text-sm font-medium text-foreground">
          Briefing title
          <input value={title} maxLength={200} onChange={event => setTitle(event.target.value)}
            disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-amber-300" />
        </label>
        <label className="block text-sm font-medium text-foreground">
          Your introduction (optional)
          <textarea value={introduction} maxLength={2000} rows={2} onChange={event => setIntroduction(event.target.value)}
            disabled={busy} placeholder="What question will this briefing help you explore?"
            className="mt-2 w-full rounded-lg border border-border/70 bg-background p-3 text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-amber-300" />
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="min-w-0 space-y-3 rounded-xl border border-border/60 p-3" aria-label="Choose Project sources">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Saved Project sources</h3>
            <span className="text-xs text-muted-foreground">{chosen.length}/{MAX_BRIEFING_SOURCES} selected</span>
          </div>
          <label className="block">
            <span className="sr-only">Search saved Project sources for briefing</span>
            <input type="search" value={search} onChange={event => setSearch(event.target.value)}
              disabled={busy} placeholder="Find an Artifact by title or type…"
              className="min-h-10 w-full rounded-lg border border-border/70 bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" />
          </label>
          {offered.length ? <ul className="max-h-80 space-y-2 overflow-y-auto">
            {offered.slice(0, 40).map(artifact => {
              const isSelected = chosen.some(source => source.id === artifact.id);
              return <li key={artifact.id}>
                <button type="button" aria-pressed={isSelected}
                  disabled={busy || (!isSelected && chosen.length >= MAX_BRIEFING_SOURCES)}
                  onClick={() => toggle(artifact.id)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-lg border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50 ${
                    isSelected ? "border-amber-300/50 bg-amber-300/[0.07]" : "border-border/65 hover:bg-white/[0.035]"
                  }`}>
                  <FileText className="h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium">{artifact.title}</span>
                    <span className="block text-xs text-muted-foreground">{artifact.kind} · saved v{artifact.headVersion}</span>
                  </span>
                  <span className="text-xs text-amber-200">{isSelected ? "Added" : "Add"}</span>
                </button>
              </li>;
            })}
          </ul> : <p role="status" className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            No saved Project sources match. Create or keep a Project Artifact first.
          </p>}
          {offered.length > 40 && <p className="text-xs text-muted-foreground">Showing 40 of {offered.length}. Narrow the search to find more.</p>}
        </section>

        <section className="min-w-0 space-y-3 rounded-xl border border-border/60 p-3" aria-label="Review briefing storyboard">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Storyboard · review order</h3>
            <span className="text-xs text-muted-foreground">{chosen.length} frames</span>
          </div>
          {staleSelection && <p role="alert" className="rounded-lg border border-amber-300/30 p-3 text-sm text-amber-200">A selected Artifact has changed or become unavailable. Its previously reviewed version remains visible but cannot be saved. Remove and reselect it from the current library.</p>}
          {chosen.length ? <ol className="space-y-2">
            {chosen.map((source, index) => <li key={source.id} className="rounded-lg border border-border/60 bg-white/[0.02] p-3">
              <div className="flex gap-3">
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.05]">
                  <span className="text-[11px] text-cyan-200">Frame</span>
                  <span className="text-xl font-semibold tabular-nums">{index + 1}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="break-words text-sm font-semibold">{source.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{source.kind} · exact saved v{source.headVersion}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button type="button" disabled={busy || index === 0} aria-label={`Move ${source.title} earlier`}
                      onClick={() => move(index, -1)} className="grid min-h-9 min-w-9 place-items-center rounded border border-border/70 disabled:opacity-35"><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" disabled={busy || index === chosen.length - 1} aria-label={`Move ${source.title} later`}
                      onClick={() => move(index, 1)} className="grid min-h-9 min-w-9 place-items-center rounded border border-border/70 disabled:opacity-35"><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" disabled={busy} aria-label={`Remove ${source.title} from briefing`}
                      onClick={() => toggle(source.id)} className="grid min-h-9 min-w-9 place-items-center rounded border border-border/70 text-rose-200 disabled:opacity-35"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                </div>
              </div>
            </li>)}
          </ol> : <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm leading-6 text-muted-foreground">
            Add one or more saved sources to build a briefing outline. Nothing is created until you choose Save.
          </p>}
        </section>
      </div>

      <footer className="space-y-3 border-t border-border/60 pt-4">
        <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
          <p>Each frame records an Artifact identity and version, not a verified quotation or rendered chart.
            The saved Report remains editable. Use the existing Compose Project work review to attach actual chart/table/image content with permissions and source receipts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={busy || staleSelection || !chosen.length}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-300/[0.075] px-4 text-sm font-semibold text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {busy ? "Saving reviewed outline…" : "Save as Project Report"}
          </button>
          <button type="button" disabled={busy} onClick={onClose}
            className="min-h-11 rounded-lg border border-border/70 px-4 text-sm text-muted-foreground disabled:opacity-40">Cancel</button>
          {error && <p role="alert" className="w-full text-sm text-rose-200">{error}</p>}
        </div>
      </footer>
    </section>
  );
}
