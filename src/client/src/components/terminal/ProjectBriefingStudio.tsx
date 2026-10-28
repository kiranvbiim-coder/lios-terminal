import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpenCheck, FileText, Layers3, Plus, Trash2, X } from "lucide-react";
import { GalleryRecordedPreviewContent, ProjectArtifactGalleryPreview } from "./ProjectArtifactGalleryPreview";
import { captureBriefingVisual, type PinnedBriefingVisual } from "@/lib/phase4BriefingVisuals";
import type { ArtifactDetail } from "@/lib/useArtifacts";
import {
  buildProjectBriefingReport, currentProjectBriefingVisuals, isReviewedBriefingSourceCurrent, MAX_BRIEFING_SOURCES, type BriefingSource,
} from "@/lib/projectBriefingStoryboard";

export function ProjectBriefingStudio({
  projectId, artifacts, onSave, onClose, onOpenSource,
}: {
  projectId: number;
  artifacts: readonly BriefingSource[];
  onSave: (sources: readonly BriefingSource[], title: string, introduction: string, visuals: readonly PinnedBriefingVisual[]) => Promise<void>;
  onClose: () => void;
  onOpenSource: (artifactId: string) => void;
}) {
  const [title, setTitle] = useState("My intelligence briefing");
  const [introduction, setIntroduction] = useState("");
  const [search, setSearch] = useState("");
  // D04: local, reversible visual focus. It does not change sources or report payloads.
  const [quietReview, setQuietReview] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [expandedVisualId, setExpandedVisualId] = useState<string | null>(null);
  const [pinnedVisuals, setPinnedVisuals] = useState<PinnedBriefingVisual[]>([]);
  const [pinningId, setPinningId] = useState<string | null>(null);
  // Preserve the version/title captured at explicit selection, not just its ID.
  const [selectedSources, setSelectedSources] = useState<BriefingSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each Project's save is isolated. An old Project's pending save must not
  // leave the new Project's Save button silently disabled after switching.
  const inFlight = useRef<{ projectId: number; token: number } | null>(null);
  const nextSaveToken = useRef(0);
  // Switching Projects invalidates all pending visual inspections and saved
  // review state. A late P4 response must not paint into the new Project.
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;
  const visualRequestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setTitle("My intelligence briefing");
    setIntroduction("");
    setSelectedSources([]);
    setPinnedVisuals([]);
    setPreviewId(null);
    setExpandedVisualId(null);
    setPinningId(null);
    setBusy(false);
    setError(null);
    setSearch("");
    setQuietReview(false);
    visualRequestRef.current?.abort();
    return () => visualRequestRef.current?.abort();
  }, [projectId]);
  // Only exact, currently active Project Artifacts appear; source contents are not fetched.
  const available = artifacts.filter(artifact => artifact.projectId === projectId && artifact.status === "active");
  // Derive current permissions/status every render: artifact lists can be refreshed in-place.
  const byId = new Map(available.map(item => [item.id, item]));
  // Also filter synchronously in render, before the Project-switch effect.
  const chosen = selectedSources.filter(source => source.projectId === projectId);
  // D06 visibility is tested against live authorized Project/Artifact identity.
  const currentVisuals = currentProjectBriefingVisuals(pinnedVisuals, chosen, byId, projectId);
  const staleSelection = chosen.some(source =>
    !isReviewedBriefingSourceCurrent(source, byId.get(source.id), projectId));
  const offered = available.filter(item =>
    item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    || item.kind.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    || item.id.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const toggle = (id: string) => {
    setError(null);
    if (chosen.some(item => item.id === id)) {
      if (expandedVisualId === id) setExpandedVisualId(null);
      if (pinningId === id) { visualRequestRef.current?.abort(); setPinningId(null); }
      setPinnedVisuals(current => current.filter(visual => visual.artifactId !== id));
    }
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
  const pinVisual = async (source: BriefingSource) => {
    if (busy || pinningId || !isReviewedBriefingSourceCurrent(source, byId.get(source.id), projectId)) return;
    if (source.kind !== "chart" && source.kind !== "table") return;
    const already = currentVisuals.some(visual => visual.artifactId === source.id);
    if (already) {
      setPinnedVisuals(current => current.filter(visual => visual.artifactId !== source.id));
      if (expandedVisualId === source.id) setExpandedVisualId(null);
      return;
    }
    if (currentVisuals.length >= 3) { setError("Choose at most three native chart/table visuals."); return; }
    setError(null);
    setPinningId(source.id);
    const controller = new AbortController();
    visualRequestRef.current?.abort();
    visualRequestRef.current = controller;
    const inspectedProject = projectId;
    try {
      // Only on explicit selection: P4 is the owner of saved figures and rights.
      const response = await fetch("/api/artifacts/" + encodeURIComponent(source.id), {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("The current saved chart/table is not accessible.");
      const detail = await response.json() as ArtifactDetail;
      if (controller.signal.aborted || activeProjectRef.current !== inspectedProject) return;
      const visual = captureBriefingVisual(detail, inspectedProject);
      if (visual.artifactId !== source.id || visual.version !== source.headVersion ||
          visual.title !== source.title || visual.content.kind !== source.kind)
        throw new Error("The selected chart/table changed; review this saved source again.");
      setPinnedVisuals(current => activeProjectRef.current !== inspectedProject
        ? current : current.some(v => v.artifactId === visual.artifactId)
          ? current : [...current, visual].slice(0, 3));
    } catch (cause) {
      if (activeProjectRef.current === inspectedProject && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Unable to review this saved visual.");
      }
    } finally {
      if (visualRequestRef.current === controller) visualRequestRef.current = null;
      if (activeProjectRef.current === inspectedProject) setPinningId(null);
    }
  };
  const save = async () => {
    if (busy || inFlight.current?.projectId === projectId || pinningId) return;
    const reviewedProject = projectId;
    let saveToken: number | null = null;
    setError(null);
    try {
      if (activeProjectRef.current !== reviewedProject) return;
      if (staleSelection) throw new Error("A selected source is no longer in this Project. Remove it and review the outline.");
      // Validation is repeated against a fresh server read by onSave.
      buildProjectBriefingReport({ projectId, title, introduction, sources: chosen, visuals: currentVisuals });
      saveToken = ++nextSaveToken.current;
      inFlight.current = { projectId: reviewedProject, token: saveToken };
      setBusy(true);
      await onSave(chosen, title, introduction, currentVisuals);
    } catch (cause) {
      if (activeProjectRef.current === reviewedProject) {
        setError(cause instanceof Error ? cause.message : "Unable to save the briefing.");
      }
    } finally {
      // A superseded Project write must not unlock a newer Project write.
      if (saveToken !== null && inFlight.current?.token === saveToken) inFlight.current = null;
      if (activeProjectRef.current === reviewedProject) setBusy(false);
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
            Original saved charts and tables can be included after explicit review. No AI claims, new imagery or external media are generated.
          </p>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close Briefing Studio"
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg border border-border/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50">
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-white/[0.015] p-3">
        <p className="font-ui text-sm text-muted-foreground">
          {quietReview ? "Focused storyboard review: source library hidden, selected frames unchanged." : "Choose sources, then switch to a calmer storyboard review."}
        </p>
        <button type="button" aria-pressed={quietReview} aria-label="Focus on selected briefing storyboard"
          onClick={() => setQuietReview(current => !current)}
          className="min-h-11 rounded-lg border border-border/70 px-4 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          {quietReview ? "Show source library" : "Focus on storyboard"}
        </button>
      </div>

      <div className={`grid gap-4 ${quietReview ? "grid-cols-1" : "xl:grid-cols-2"}`}>
        {!quietReview && <section className="min-w-0 space-y-3 rounded-xl border border-border/60 p-3" aria-label="Choose Project sources">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Saved Project sources</h3>
            <span className="text-xs text-muted-foreground">{chosen.length}/{MAX_BRIEFING_SOURCES} selected</span>
          </div>
          <label className="block">
            <span className="sr-only">Search saved Project sources for briefing</span>
            <input type="search" value={search} onChange={event => setSearch(event.target.value)}
              disabled={busy} placeholder="Find by saved title, type or Artifact ID…"
              className="min-h-11 w-full rounded-lg border border-border/70 bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" />
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
            No saved Project sources match this search in the current Project. Clear it, or create a saved Artifact first.
          </p>}
          {offered.length > 40 && <p className="text-xs text-muted-foreground">Showing 40 of {offered.length}. Narrow the search to find more.</p>}
        </section>}

        <section className="min-w-0 space-y-3 rounded-xl border border-border/60 p-3" aria-label="Review briefing storyboard">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Storyboard · review order</h3>
            <span className="text-xs text-muted-foreground">{chosen.length} frames · {currentVisuals.length}/3 verified visuals</span>
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
                      onClick={() => move(index, -1)} className="grid min-h-11 min-w-11 place-items-center rounded border border-border/70 disabled:opacity-35"><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" disabled={busy || index === chosen.length - 1} aria-label={`Move ${source.title} later`}
                      onClick={() => move(index, 1)} className="grid min-h-11 min-w-11 place-items-center rounded border border-border/70 disabled:opacity-35"><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" disabled={busy} aria-label={`Remove ${source.title} from briefing`}
                      onClick={() => toggle(source.id)} className="grid min-h-11 min-w-11 place-items-center rounded border border-border/70 text-rose-200 disabled:opacity-35"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                    {(source.kind === "chart" || source.kind === "table") && <button type="button"
                      disabled={busy || Boolean(pinningId) || (!currentVisuals.some(visual => visual.artifactId === source.id) && currentVisuals.length >= 3) ||
                        !isReviewedBriefingSourceCurrent(source, byId.get(source.id), projectId)}
                      aria-pressed={currentVisuals.some(visual => visual.artifactId === source.id)}
                      onClick={() => void pinVisual(source)}
                      className="min-h-11 rounded border border-amber-300/30 px-3 text-sm text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40">
                      {pinningId === source.id ? "Checking saved visual…" :
                        currentVisuals.some(visual => visual.artifactId === source.id) ? "Remove native visual" : "Include native visual"}
                    </button>}
                    <button type="button" disabled={busy || !isReviewedBriefingSourceCurrent(source, byId.get(source.id), projectId)}
                      aria-expanded={previewId === source.id} onClick={() => setPreviewId(current => current === source.id ? null : source.id)}
                      className="min-h-11 rounded border border-cyan-300/25 px-3 text-sm text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40">
                      {previewId === source.id ? "Hide exact preview" : "Inspect saved content"}
                    </button>
                  </div>
                </div>
              </div>
              {currentVisuals.filter(visual => visual.artifactId === source.id).map(visual =>
                <div key={visual.artifactId} className="mt-3 space-y-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.025] p-3">
                  <p role="status" className="break-words font-ui text-xs leading-5 text-amber-200">
                    Native {visual.content.kind} reviewed from saved v{visual.version} · {visual.sourceRefs.length} recorded source IDs ·
                    SHA-256 {visual.contentHash.slice(0, 16)}…
                  </p>
                  <button type="button" aria-expanded={expandedVisualId === visual.artifactId}
                    aria-label={`Inspect recorded ${visual.content.kind} visual for ${source.title}`}
                    onClick={() => setExpandedVisualId(current => current === visual.artifactId ? null : visual.artifactId)}
                    className="min-h-11 rounded-lg border border-amber-300/30 px-3 py-2 font-ui text-sm text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                    {expandedVisualId === visual.artifactId ? "Hide recorded visual" : "Preview recorded visual"}
                  </button>
                  {expandedVisualId === visual.artifactId && <div aria-label={`Recorded ${visual.content.kind} preview from saved version ${visual.version}`} className="space-y-2">
                    <GalleryRecordedPreviewContent content={visual.content} />
                    <p className="font-ui text-xs leading-5 text-muted-foreground">
                      Preview only: open the full saved Artifact for exact chart axes, source rights and evidence.
                      Report save rechecks the current authorized version.
                    </p>
                  </div>}
                </div>)}
              {previewId === source.id && isReviewedBriefingSourceCurrent(source, byId.get(source.id), projectId)
                && <ProjectArtifactGalleryPreview key={`${source.id}:${source.headVersion}`} artifact={source} onOpen={() => onOpenSource(source.id)} />}
            </li>)}
          </ol> : <p className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm leading-6 text-muted-foreground">
            Add one or more saved sources to build a briefing outline. Nothing is created until you choose Save.
          </p>}
        </section>
      </div>

      <footer className="space-y-3 border-t border-border/60 pt-4">
        <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
          <p>Each frame keeps its exact saved Artifact and version. Explicitly pinned, source-backed charts and tables become
            native editable Report visuals and Office objects after a fresh permission and version check; unpinned frames remain references. No content has been copied without review.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={busy || Boolean(pinningId) || staleSelection || !chosen.length}
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
