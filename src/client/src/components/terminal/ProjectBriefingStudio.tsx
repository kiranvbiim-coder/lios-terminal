import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FileText, Save } from "lucide-react";
import { createArtifact, useInvalidateArtifacts } from "@/lib/useArtifacts";
import { useProjectInsightLens, useProjectIntelligence } from "@/lib/useProjectIntelligence";
import { composeProjectBriefing, type BriefingLayout } from "@/lib/phase4Briefing";

/** Source-backed, user-reviewed storyboard → actual editable/versioned P4 report. */
export function ProjectBriefingStudio({ projectId, onOpenArtifact }: {
  projectId: number;
  onOpenArtifact: (id: string, title: string) => void;
}) {
  const lens = useProjectInsightLens(projectId);
  const context = useProjectIntelligence(projectId);
  const invalidate = useInvalidateArtifacts();
  const [title, setTitle] = useState("Project intelligence briefing");
  const [layout, setLayout] = useState<BriefingLayout>("executive");
  const [selected, setSelected] = useState<string[]>([]);
  const [editorNote, setEditorNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string; version: number } | null>(null);
  const currentProject = useRef(projectId);
  const saveInFlight = useRef(false);

  useEffect(() => {
    currentProject.current = projectId;
    setTitle("Project intelligence briefing");
    setLayout("executive");
    setSelected([]);
    setEditorNote("");
    setMessage(null);
    setSaved(null);
    setBusy(false);
  }, [projectId]);

  const actualLens = !lens.isError && lens.data?.projectId === projectId ? lens.data : null;
  const actualContext = !context.isError && context.data?.graph.projectId === projectId ? context.data : null;
  const draft = useMemo(() => composeProjectBriefing({
    projectId, title, layout, insightIds: selected, editorNote,
  }, actualLens, actualContext?.timeline ?? []), [projectId, title, layout, selected, editorNote, actualLens, actualContext]);
  const toggle = (id: string, next: boolean) => {
    setSaved(null);
    setMessage(null);
    setSelected(current => next ? current.includes(id) || current.length >= 16 ? current : [...current, id] : current.filter(item => item !== id));
  };

  const save = async () => {
    if (!draft || busy || saveInFlight.current || lens.isFetching || context.isFetching || lens.isError || context.isError) return;
    const expectedProject = projectId;
    saveInFlight.current = true;
    setBusy(true);
    setMessage(null);
    setSaved(null);
    try {
      const result = await createArtifact(expectedProject, {
        title: title.trim().slice(0, 160),
        content: draft.content,
        origin: "direct",
        dependencyRefs: draft.dependencyRefs,
      });
      if (currentProject.current !== expectedProject) return;
      if (result.artifact.projectId !== expectedProject || result.artifact.kind !== "report" ||
        result.version.artifactId !== result.artifact.id || result.version.version < 1) {
        throw new Error("The server did not confirm an exact versioned Project report. Reopen the Library before using this result.");
      }
      invalidate(expectedProject, result.artifact.id);
      setSaved({ id: result.artifact.id, title: result.artifact.title, version: result.version.version });
      setMessage("Saved report as a versioned Project Artifact. Open it to edit, review and export using the existing Artifact tools.");
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
          <input value={title} maxLength={160} onChange={event => { setTitle(event.target.value); setSaved(null); }} className="mt-1 min-h-11 w-full rounded-lg border border-border/60 bg-background px-3 text-foreground"/>
        </label>
        <label className="block space-y-1 font-ui text-sm text-muted-foreground">Format
          <select value={layout} onChange={event => { setLayout(event.target.value as BriefingLayout); setSaved(null); }}
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
        <textarea value={editorNote} onChange={event => { setEditorNote(event.target.value); setSaved(null); }} maxLength={2000} rows={2}
          className="mt-1 w-full rounded-lg border border-border/60 bg-background p-3 text-foreground" placeholder="Audience and points for human review"/>
      </label>
      {draft && <div className="space-y-2 rounded-lg border border-border/60 bg-background/30 p-3" aria-label="Briefing preview">
        <h3 className="font-ui text-sm font-semibold text-foreground">Storyboard preview</h3>
        <p className="font-ui text-xs text-muted-foreground">{draft.included} selected observations · {draft.dependencyRefs.length} distinct source IDs · {draft.unreferenced} without attached references</p>
        <ol className="grid gap-2 sm:grid-cols-2">
          {draft.content.sections.filter(section => section.id.startsWith("briefing-section-") && !["briefing-section-intro","briefing-section-verification","briefing-section-timeline"].includes(section.id))
            .map(section => <li key={section.id} className="min-w-0 rounded-lg border border-border/55 p-3 font-ui text-sm text-foreground">{section.title}</li>)}
        </ol>
        <p className="font-ui text-xs text-amber-200">Preview is not a verified published briefing. Source IDs are not publication rights or externally verified facts.</p>
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!draft || busy || lens.isFetching || context.isFetching} onClick={() => void save()}
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
