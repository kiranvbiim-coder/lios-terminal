import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FileText, Save } from "lucide-react";
import { createArtifact, useInvalidateArtifacts, useProjectArtifacts, type ArtifactDetail } from "@/lib/useArtifacts";
import { useProjectInsightLens, useProjectIntelligence } from "@/lib/useProjectIntelligence";
import { composeProjectBriefing, type BriefingLayout } from "@/lib/phase4Briefing";
import { stableSerialize } from "@/lib/analyticalCore";
import { captureBriefingVisual, verifyCurrentPinnedVisual, eligibleBriefingVisuals, assertSavedBriefingArtifact, type PinnedBriefingVisual } from "@/lib/phase4BriefingVisuals";

async function readP4Visual(projectId: number, artifactId: string): Promise<PinnedBriefingVisual> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
    credentials: "same-origin", cache: "no-store",
  });
  if (!response.ok) throw new Error("The selected visual is no longer accessible through P4.");
  const detail = await response.json() as ArtifactDetail;
  if (detail.artifact.id !== artifactId) throw new Error("P4 returned an unexpected Artifact.");
  return captureBriefingVisual(detail, projectId);
}

/** Source-backed, user-reviewed storyboard → actual editable/versioned P4 report. */
export function ProjectBriefingStudio({ projectId, onOpenArtifact }: {
  projectId: number;
  onOpenArtifact: (id: string, title: string) => void;
}) {
  const lens = useProjectInsightLens(projectId);
  const context = useProjectIntelligence(projectId);
  const artifactList = useProjectArtifacts(projectId);
  const invalidate = useInvalidateArtifacts();
  const [title, setTitle] = useState("Project intelligence briefing");
  const [layout, setLayout] = useState<BriefingLayout>("executive");
  const [selected, setSelected] = useState<string[]>([]);
  const [editorNote, setEditorNote] = useState("");
  const [chosenVisuals, setChosenVisuals] = useState<PinnedBriefingVisual[]>([]);
  const [visualBusy, setVisualBusy] = useState<string | null>(null);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string; version: number } | null>(null);
  const currentProject = useRef(projectId);
  // Update synchronously during Project switches, before old async P4 reads resolve.
  currentProject.current = projectId;
  const saveInFlight = useRef(false);

  useEffect(() => {
    currentProject.current = projectId;
    setTitle("Project intelligence briefing");
    setLayout("executive");
    setSelected([]);
    setEditorNote("");
    setChosenVisuals([]);
    setVisualBusy(null);
    setVisualError(null);
    setMessage(null);
    setSaved(null);
    setBusy(false);
  }, [projectId]);

  const actualLens = !lens.isError && lens.data?.projectId === projectId ? lens.data : null;
  const actualContext = !context.isError && context.data?.graph.projectId === projectId ? context.data : null;
  const draft = useMemo(() => composeProjectBriefing({
    projectId, title, layout, insightIds: selected, editorNote,
  }, actualLens, actualContext?.timeline ?? [], chosenVisuals), [projectId, title, layout, selected, editorNote, actualLens, actualContext, chosenVisuals]);
  const availableVisuals = eligibleBriefingVisuals(artifactList.data ?? [], projectId);

  const includeVisual = async (artifactId: string) => {
    if (busy || visualBusy || chosenVisuals.length >= 3 || !availableVisuals.some(item => item.id === artifactId)) return;
    setVisualBusy(artifactId);
    setVisualError(null);
    setSaved(null);
    try {
      const visual = await readP4Visual(projectId, artifactId);
      if (currentProject.current !== projectId) return;
      setChosenVisuals(current => current.length >= 3 || current.some(item => item.artifactId === artifactId)
        ? current : [...current, visual]);
    } catch (cause) {
      if (currentProject.current === projectId) setVisualError(cause instanceof Error ? cause.message : "The selected visual could not be verified.");
    } finally {
      if (currentProject.current === projectId) setVisualBusy(null);
    }
  };
  const toggle = (id: string, next: boolean) => {
    setSaved(null);
    setMessage(null);
    setSelected(current => next ? current.includes(id) || current.length >= 16 ? current : [...current, id] : current.filter(item => item !== id));
  };

  const save = async () => {
    if (!draft || busy || Boolean(visualBusy) || saveInFlight.current || lens.isFetching || context.isFetching || lens.isError || context.isError || (artifactList.isError && chosenVisuals.length > 0)) return;
    const expectedProject = projectId;
    saveInFlight.current = true;
    setBusy(true);
    setMessage(null);
    setSaved(null);
    try {
      // Refresh the actual P7 source owners as well as pinned P4 visuals.
      // React Query's cached insight/timeline is a preview, not save authorization.
      const [freshLens, freshContext] = await Promise.all([lens.refetch(), context.refetch()]);
      if (currentProject.current !== expectedProject) return;
      if (freshLens.isError || freshContext.isError ||
          freshLens.data?.projectId !== expectedProject ||
          freshContext.data?.graph.projectId !== expectedProject) {
        throw new Error("Current Project evidence could not be revalidated. The briefing was not saved.");
      }
      // Re-read every pinned P4 version immediately before the only write.
      // Denied, changed or archived sources must never fall back to an old local snapshot.
      const checked = await Promise.all(chosenVisuals.map(async visual => {
        const response = await fetch(`/api/artifacts/${encodeURIComponent(visual.artifactId)}?version=${visual.version}`, {
          credentials: "same-origin", cache: "no-store",
        });
        if (!response.ok) throw new Error("A selected visual is no longer accessible. No briefing was saved.");
        return verifyCurrentPinnedVisual(visual, await response.json() as ArtifactDetail);
      }));
      if (currentProject.current !== expectedProject) return;
      const reviewed = composeProjectBriefing({ projectId: expectedProject, title, layout, insightIds: selected, editorNote },
        freshLens.data, freshContext.data.timeline, checked);
      if (!reviewed || stableSerialize(reviewed.content) !== stableSerialize(draft.content))
        throw new Error("The briefing changed since preview. Review the current evidence before saving.");
      const result = await createArtifact(expectedProject, {
        title: title.trim().slice(0, 160),
        content: reviewed.content,
        sourceRefs: reviewed.sourceRefs,
        origin: "direct",
        dependencyRefs: reviewed.dependencyRefs,
      });
      if (currentProject.current !== expectedProject) return;
      assertSavedBriefingArtifact(result, expectedProject, reviewed.content, reviewed.dependencyRefs, reviewed.sourceRefs);
      invalidate(expectedProject, result.artifact.id);
      setSaved({ id: result.artifact.id, title: result.artifact.title, version: result.version.version });
      setMessage("Saved the verified P4 briefing. Open it to edit or export the recorded chart/table objects in native PowerPoint.");
    } catch (error) {
      if (currentProject.current === expectedProject) setMessage(error instanceof Error ? error.message : "Briefing save failed. No saved version was confirmed.");
    } finally {
      saveInFlight.current = false;
      if (currentProject.current === expectedProject) setBusy(false);
    }
  };

  return <section data-testid="project-briefing-studio" className="space-y-4" aria-label="Project Briefing Studio">
    <div className="flex items-center gap-2">
      <BookOpen aria-hidden="true" className="h-5 w-5 text-amber-200"/>
      <h2 className="font-ui text-base font-semibold text-foreground">Briefing Studio</h2>
    </div>
    <p className="font-ui text-sm text-muted-foreground">Build a reviewable storyboard from retained Project intelligence. It becomes an editable report in the existing Artifact Library.</p>
    {(lens.isPending || context.isPending) && <p role="status" className="font-ui text-sm text-muted-foreground">Reading Project records…</p>}
    {(lens.isError || context.isError) && <p role="alert" className="font-ui text-sm text-amber-200">Source retrieval is unavailable. Briefing creation requires a current Project record. <button type="button" className="underline" onClick={() => { void lens.refetch(); void context.refetch(); }}>Retry</button></p>}
    {actualLens && actualContext && <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <label className="block space-y-1 font-ui text-sm text-muted-foreground">Briefing title
          <input value={title} disabled={busy} maxLength={160} onChange={event => { setTitle(event.target.value); setSaved(null); }} className="mt-1 min-h-11 w-full rounded-lg border border-border/60 bg-background px-3 text-foreground"/>
        </label>
        <label className="block space-y-1 font-ui text-sm text-muted-foreground">Format
          <select value={layout} disabled={busy} onChange={event => { setLayout(event.target.value as BriefingLayout); setSaved(null); }}
            className="mt-1 min-h-11 w-full rounded-lg border border-border/60 bg-background px-3 text-foreground">
            <option value="executive">Executive</option><option value="research">Research + timeline</option><option value="monitoring">Monitoring</option>
          </select>
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-ui text-sm font-semibold text-foreground">Select recorded insights (maximum 16)</legend>
        <div className="max-h-64 space-y-2 overflow-auto rounded-lg border border-border/55 p-2">
          {actualLens.insights.slice(0, 100).map(item => <label key={item.id} className="flex min-h-12 items-start gap-3 rounded-lg border border-border/50 p-3 font-ui text-sm hover:border-amber-300/25">
            <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || (selected.length >= 16 && !selected.includes(item.id))}
              onChange={event => toggle(item.id, event.target.checked)} className="mt-1 h-4 w-4 accent-amber-300"/>
            <span className="min-w-0 flex-1"><span className="block text-foreground">{item.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.kind.replaceAll("_", " ")} · {item.sourceRefs.length} recorded source IDs</span>
            </span>
          </label>)}
          {actualLens.insights.length === 0 && <p className="p-3 text-sm text-muted-foreground">No saved insights to brief. Populate Project Intelligence first.</p>}
        </div>
        {actualLens.insights.length > 100 && <p className="text-xs text-muted-foreground">Showing the first 100 recorded insights; select from currently accessible records only.</p>}
      </fieldset>
      <label className="block font-ui text-sm text-muted-foreground">Editor note (optional)
        <textarea value={editorNote} disabled={busy} onChange={event => { setEditorNote(event.target.value); setSaved(null); }} maxLength={2000} rows={2}
          className="mt-1 w-full rounded-lg border border-border/60 bg-background p-3 text-foreground" placeholder="Audience and points for human review"/>
      </label>
      <section aria-label="Saved P4 visual selection" className="space-y-2 rounded-lg border border-border/55 p-3">
        <h3 className="font-ui text-sm font-semibold text-foreground">Include saved charts or tables</h3>
        <p className="font-ui text-xs text-muted-foreground">Choose up to three current P4 visuals. Each chart/table is read only when chosen and checked again before Save. No numbers are generated.</p>
        {artifactList.isLoading && <p role="status" className="text-xs">Reading Project Artifact titles…</p>}
        {artifactList.isError && <p role="alert" className="text-xs text-amber-200">
          Visual list unavailable. <button type="button" className="underline" onClick={() => void artifactList.refetch()}>Retry</button>
        </p>}
        <ul className="max-h-48 space-y-2 overflow-auto">
          {availableVisuals.map(item => {
            const pinned = chosenVisuals.find(visual => visual.artifactId === item.id);
            return <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/45 p-2 font-ui text-sm">
              <span className="min-w-0 break-words">{item.title} <span className="text-xs text-muted-foreground">· {item.kind} · v{item.headVersion}</span></span>
              {pinned
                ? <button type="button" disabled={busy || Boolean(visualBusy)}
                    onClick={() => { setChosenVisuals(current => current.filter(v => v.artifactId !== item.id)); setSaved(null); setVisualError(null); }}
                    className="min-h-10 rounded-lg border border-border/70 px-3 text-xs focus-visible:ring-2 focus-visible:ring-amber-300/70">Remove</button>
                : <button type="button" disabled={busy || Boolean(visualBusy) || chosenVisuals.length >= 3}
                    onClick={() => void includeVisual(item.id)}
                    className="min-h-10 rounded-lg border border-amber-300/35 px-3 text-xs focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-40">
                    {visualBusy === item.id ? "Checking P4…" : "Include visual"}</button>}
            </li>;
          })}
          {!artifactList.isLoading && !artifactList.isError && !availableVisuals.length &&
            <li className="text-xs text-muted-foreground">No active saved Project charts or tables available.</li>}
        </ul>
        {chosenVisuals.map(visual => <p key={visual.artifactId} className="break-all font-mono text-[11px] text-muted-foreground">
          Pinned {visual.content.kind} · v{visual.version} · SHA-256 {visual.contentHash} · {visual.sourceRefs.length} recorded source refs
        </p>)}
        {visualError && <p role="alert" className="text-xs text-amber-200">{visualError}</p>}
      </section>
      {draft && <div className="space-y-2 rounded-lg border border-border/60 bg-background/30 p-3" aria-label="Briefing preview">
        <h3 className="font-ui text-sm font-semibold text-foreground">Storyboard preview</h3>
        <p className="font-ui text-xs text-muted-foreground">{draft.included} selected insights · {chosenVisuals.length} pinned P4 visuals · {draft.dependencyRefs.length} recorded dependencies · {draft.unreferenced} insights without source IDs</p>
        <ol className="grid gap-2 sm:grid-cols-2">
          {draft.content.sections.filter(section => section.id.startsWith("briefing-section-") && !["briefing-section-intro","briefing-section-verification","briefing-section-timeline"].includes(section.id))
            .map(section => <li key={section.id} className="min-w-0 rounded-lg border border-border/55 p-3 font-ui text-sm text-foreground">{section.title}</li>)}
        </ol>
        <p className="font-ui text-xs text-amber-200">Preview is not a verified published briefing. Source IDs are not publication rights or externally verified facts.</p>
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!draft || busy || Boolean(visualBusy) || lens.isFetching || context.isFetching || (artifactList.isError && chosenVisuals.length > 0)} onClick={() => void save()}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-300/[0.08] px-4 py-2 font-ui text-sm font-semibold focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-40">
          <Save aria-hidden="true" className="h-4 w-4"/>{busy ? "Saving…" : "Save editable report"}
        </button>
        {saved && <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm text-foreground"
          onClick={() => onOpenArtifact(saved.id, saved.title)}><FileText aria-hidden="true" className="h-4 w-4"/>Open saved v{saved.version}</button>}
      </div>
      {message && <p role="status" className="font-ui text-sm text-muted-foreground">{message}</p>}
    </>}
  </section>;
}
