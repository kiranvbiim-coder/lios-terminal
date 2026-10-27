import * as React from "react";
import { useState } from "react";
import { Box, FileBarChart, FileUp, Package, Plus } from "lucide-react";
import type { ProjectResource, ProjectSession } from "@/lib/useProjects";
import {
  createArtifact,
  exportProjectArtifactPackage,
  forkArtifact,
  importProjectArtifactPackage,
  importSpreadsheetArtifact,
  setArtifactStatus,
  useInvalidateArtifacts,
  useProjectArtifacts,
  type ProjectArtifactRecord,
} from "@/lib/useArtifacts";
import type { LifecycleAction } from "@shared/objectLifecycle";
import type { ArtifactContent, ArtifactRefreshSpec } from "@shared/artifactContracts";
import { ArtifactPane } from "./ArtifactPane";
import { ObjectActionMenu } from "./ObjectActionMenu";
import { ProjectArtifactGalleryCard } from "./ProjectArtifactGalleryCard";
import { ProjectArtifactGalleryPreview } from "./ProjectArtifactGalleryPreview";
import { ProjectBriefingStudio } from "./ProjectBriefingStudio";
import { ProjectSpreadsheetImportField } from "./ProjectSpreadsheetImportField";
import { buildProjectBriefingReport, isReviewedBriefingSourceCurrent, type BriefingSource } from "@/lib/projectBriefingStoryboard";
import { verifyCurrentPinnedVisual, assertSavedBriefingArtifact, type PinnedBriefingVisual } from "@/lib/phase4BriefingVisuals";
import type { ArtifactDetail } from "@/lib/useArtifacts";

function starter(kind: ArtifactContent["kind"]): ArtifactContent {
  if (kind === "spreadsheet") return { kind, sheets: [{ id: "sheet-1", name: "Model", cells: {}, names: {}, rowCount: 60, columnCount: 15 }], activeSheetId: "sheet-1", rendererPreference: "builtin", calculationMode: "automatic" };
  if(kind==="research")return{kind,question:"",plan:{status:"draft",steps:[]},blocks:[{id:"block-1",type:"heading",text:"Research",attrs:{}},{id:"block-2",type:"paragraph",text:"",attrs:{}}],claims:[],evidence:[],sourcePolicy:{mode:"connected_sources",allowedSourceRefs:[],providerAllow:[],providerDeny:[]},contradictions:[],executionTrail:[],editorPreference:"builtin"};
  if (kind === "report") return { kind, templateId: null, blocks: [{ id: "block-1", type: "heading", text: "Report", attrs: {} }], sections: [], editorPreference: "builtin" };
  if (kind === "decision") return { kind, objective: "Decision objective", whatChanged: [], why: [], scenarios: [], constraints: [], assumptions: {}, alternatives: [], selectedAlternativeId: null, uncertainties: [], nextActions: [], implementation: [], monitoring: [], linkedRefs: { models: [], sources: [], scenarios: [], backtests: [], monitors: [] } };
  if(kind==="timeline")return{kind,events:[]};
  if (kind === "thesis") return { kind, entityRef: null, status: "draft", summary: "", expectedOutcomes: [], claims: [], catalysts: [], risks: [], invalidationConditions: [], openQuestions: [], refresh: { lastRefreshedAt: null, snapshotId: null, contradictions: [], changes: [] }, postmortems: [] };
  if (kind === "strategy") return { kind, language: "rules", source: "", parameters: {}, validation: { status: "unvalidated", errors: [] } };
  if (kind === "backtest") return { kind, strategyRef: null, status: "edited_not_run", metrics: {}, equityCurve: [], drawdown: [], trades: [], benchmark: {}, assumptions: {}, reproducibilityHash: null, pointInTimeVerified: null, warnings: [] };
  if (kind === "chart") return { kind, rendererPreference: "recharts", chartType: "line", series: [], options: {} };
  if (kind === "table") return { kind, columns: [], rows: [] };
  if (kind === "data") return { kind, columns: [], previewRows: [], rowCount: 0, columnarArtifactId: null, rendererPreference: "virtual_table" };
  if (kind === "valuation") return { kind, symbol: null, modelId: "valuation", assumptions: {}, outputs: {}, summary: {} };
  if (kind === "portfolio") return { kind, portfolioRef: null, holdings: [], summary: {}, risk: {} };
  return { kind: "screen", view: "workspace", symbol: null, state: {} };
}

function downloadPackage(projectId: number, pkg: unknown) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `lios-project-${projectId}-package.json`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function ProjectArtifactsPanel({
  projectId,
  sessions,
  onAskArtifact,
  onFocusArtifact,
  onRerunArtifact,
  initialArtifactId = null,
  initialVersion = null,
  selectedResourceId = null,
  resources = [],
}: {
  projectId: number;
  sessions: ProjectSession[];
  onAskArtifact: (id: string, title: string, prompt?: string) => void;
  onFocusArtifact?: (id: string, title: string) => void;
  onRerunArtifact?: (id: string, title: string, spec: ArtifactRefreshSpec) => void;
  initialArtifactId?: string | null;
  initialVersion?: number | null;
  selectedResourceId?: string | null;
  resources?: ProjectResource[];
}) {
  const artifacts = useProjectArtifacts(projectId);
  const archivedArtifacts = useProjectArtifacts(projectId, "archived");
  const invalidate = useInvalidateArtifacts();
  const [selected, setSelected] = useState<string | null>(initialArtifactId);
  const [versionView, setVersionView] = useState<number | null>(initialVersion);
  const [resourceOpen, setResourceOpen] = useState(Boolean(selectedResourceId));
  const [newKind, setNewKind] = useState<ArtifactContent["kind"]>("spreadsheet");
  const [error, setError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importingSpreadsheet, setImportingSpreadsheet] = useState(false);
  const [spreadsheetImportOpen, setSpreadsheetImportOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [galleryQuery, setGalleryQuery] = useState("");
  const [galleryKind, setGalleryKind] = useState<"all" | ArtifactContent["kind"]>("all");
  const [visibleGalleryCount, setVisibleGalleryCount] = useState(18);
  const [visibleArchivedCount, setVisibleArchivedCount] = useState(18);
  const [preview, setPreview] = useState<{ id: string; version: number } | null>(null);
  const rows = artifacts.data ?? [];
  const archivedRows = archivedArtifacts.data ?? [];
  const availableKinds = [...new Set(rows.map(artifact => artifact.kind))].sort();
  const filteredRows = rows.filter(artifact =>
    (galleryKind === "all" || artifact.kind === galleryKind) &&
    artifact.title.toLocaleLowerCase().includes(galleryQuery.trim().toLocaleLowerCase()),
  );
  const togglePreview = (artifact: ProjectArtifactRecord) => setPreview(current =>
    current?.id === artifact.id && current.version === artifact.headVersion
      ? null : { id: artifact.id, version: artifact.headVersion },
  );

  const handleArtifactAction = async (artifact: ProjectArtifactRecord, action: LifecycleAction) => {
    try {
      setError(null);
      if (action === "open") {
        setSelected(artifact.id);
        return;
      }
      if (action === "fork") {
        const forked = await forkArtifact(artifact.id);
        invalidate(projectId);
        setSelected(forked.artifact.id);
        return;
      }
      if (action === "archive" || action === "restore") {
        await setArtifactStatus(artifact.id, action === "archive" ? "archived" : "active");
        invalidate(projectId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update this Artifact.");
    }
  };

  const handleSaveBriefing = async (sources: readonly BriefingSource[], title: string, introduction: string, visuals: readonly PinnedBriefingVisual[]) => {
    // Recheck exact saved versions after user review; never silently substitute a
    // changed, archived, inaccessible, or cross-Project source.
    const refreshed = await artifacts.refetch();
    if (refreshed.isError || !refreshed.data) throw new Error("Saved Project sources could not be rechecked. Nothing was created.");
    for (const source of sources) {
      const current = refreshed.data.find(item => item.id === source.id && item.projectId === projectId);
      if (!isReviewedBriefingSourceCurrent(source, current, projectId)) {
        throw new Error("A selected source changed since review. Reopen the briefing and review its exact saved version.");
      }
    }
    if (visuals.length > 3 || new Set(visuals.map(visual => visual.artifactId)).size !== visuals.length)
      throw new Error("Review up to three different saved visuals.");
    const verifiedVisuals: PinnedBriefingVisual[] = [];
    for (const visual of visuals) {
      const source = sources.find(item => item.id === visual.artifactId);
      if (!source || source.headVersion !== visual.version || source.kind !== visual.content.kind)
        throw new Error("The saved visual is not an exact reviewed storyboard source.");
      // Current session/source authority comes from a fresh P4 GET, never browser pin state.
      const response = await fetch("/api/artifacts/" + encodeURIComponent(visual.artifactId), {
        credentials: "same-origin", cache: "no-store",
      });
      if (!response.ok) throw new Error("A selected visual is no longer permitted. Nothing was saved.");
      const detail = await response.json() as ArtifactDetail;
      verifiedVisuals.push(verifyCurrentPinnedVisual(visual, detail));
    }
    const draft = buildProjectBriefingReport({ projectId, sources, title, introduction, visuals: verifiedVisuals });
    const created = await createArtifact(projectId, draft);
    assertSavedBriefingArtifact(created, projectId, draft.content, draft.dependencyRefs, draft.sourceRefs);
    invalidate(projectId, created.artifact.id);
    setBriefingOpen(false);
    setVersionView(null);
    setSelected(created.artifact.id);
  };
  const handleSpreadsheetImport = async (file: File): Promise<boolean> => {
    setError(null);
    setImportSummary(null);
    setImportingSpreadsheet(true);
    try {
      const result = await importSpreadsheetArtifact(projectId, file);
      invalidate(projectId, result.artifact.id);
      const omitted = result.import.unsupportedFeatures.length
        ? ` Not imported: ${result.import.unsupportedFeatures.join(", ")}.`
        : "";
      setImportSummary(`Imported ${result.import.fileName} as a governed spreadsheet Artifact with ${result.import.sheets} sheet${result.import.sheets === 1 ? "" : "s"}.${omitted}`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Spreadsheet import failed.");
      return false;
    } finally {
      setImportingSpreadsheet(false);
    }
  };

  if (artifacts.isLoading) return <p role="status" className="mt-6 text-sm">Loading Project artifacts…</p>;
  if (artifacts.isError) return <p role="alert" className="mt-6 text-sm">Unable to load artifacts. <button onClick={() => void artifacts.refetch()}>Retry</button></p>;

  if (resourceOpen && selectedResourceId) {
    const resource = resources.find((item) => item.id === selectedResourceId && item.projectId === projectId && item.status === "active");
    return <section className="mt-4 rounded-xl border border-border/60 p-4" aria-label="Selected Project file">
      <button type="button" className="lios-section-action mb-4" onClick={() => setResourceOpen(false)}>Back to Library</button>
      {resource ? <>
        <h2 className="font-semibold">{resource.label}</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div><dt className="text-muted-foreground">Exact file ID</dt><dd className="break-all font-mono">{resource.id}</dd></div>
          <div><dt className="text-muted-foreground">Kind / context</dt><dd>{resource.kind} · {resource.contextMode}</dd></div>
          <div><dt className="text-muted-foreground">Reference</dt><dd className="break-all">{resource.resourceRef ?? "No reference recorded"}</dd></div>
          <div><dt className="text-muted-foreground">Updated</dt><dd>{resource.updatedAt}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">Project file metadata · contents are not previewed or sent to AI by opening this result.</p>
      </> : <p role="alert">This exact file is no longer available in this Project. No substitute file was opened.</p>}
    </section>;
  }

  if (selected) {
    if (selected === initialArtifactId && ![...rows, ...archivedRows].some((artifact) => artifact.id === selected && artifact.projectId === projectId)) {
      if (archivedArtifacts.isLoading) return <p role="status">Loading exact Artifact…</p>;
      if (artifacts.isError || archivedArtifacts.isError) return <section className="mt-4"><p role="alert">This Artifact's availability could not be checked. No substitute was opened.</p><button type="button" disabled={artifacts.isFetching || archivedArtifacts.isFetching} onClick={() => void Promise.all([artifacts.refetch(), archivedArtifacts.refetch()])} className="lios-section-action mt-3">Retry Artifact lookup</button><button type="button" className="lios-section-action mt-3" onClick={() => setSelected(null)}>Back to Library</button></section>;
      return <section className="mt-4"><p role="alert">This exact Artifact is no longer available in this Project. No substitute was opened.</p><button type="button" className="lios-section-action mt-3" onClick={() => setSelected(null)}>Back to Library</button></section>;
    }
    return (
      <section className="mt-4">
        <ArtifactPane
          artifactId={selected}
          version={selected === initialArtifactId ? versionView : null}
          onVersionChange={setVersionView}
          projectId={projectId}
          sessions={sessions}
          onClose={() => setSelected(null)}
          onAsk={onAskArtifact}
          onFocus={onFocusArtifact}
          onRerun={onRerunArtifact}
        />
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-border/60 bg-white/[0.015] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Box className="h-3.5 w-3.5 text-amber-300" />
            <div className="font-ui text-lg font-semibold">Intelligence Library</div>
          </div>
          <div className="mt-1 font-ui text-[8px] text-muted-foreground">Explore and preview your saved work. Every card opens the same versioned Artifact shared with Chat and Workbench.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setBriefingOpen(value => !value)}
            aria-expanded={briefingOpen} aria-controls="project-briefing-studio"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-300/30 px-3 font-ui text-sm text-cyan-200 hover:bg-cyan-300/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
            <FileBarChart className="h-4 w-4" aria-hidden="true" />
            Briefing Studio
          </button>
          <select value={newKind} onChange={(event) => setNewKind(event.target.value as ArtifactContent["kind"])} className="rounded border border-border/60 bg-[#090909] px-2 py-1.5 font-terminal text-[7px]" aria-label="New Artifact type">
            {["spreadsheet", "research", "thesis", "report", "decision", "timeline", "strategy", "backtest", "chart", "table", "data", "valuation", "portfolio", "screen"].map((kind) => <option key={kind}>{kind}</option>)}
          </select>
          <button onClick={() => void (async () => { try { setError(null); const created = await createArtifact(projectId, { title: `New ${newKind} Artifact`, content: starter(newKind) }); invalidate(projectId); setSelected(created.artifact.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create Artifact."); } })()} className="flex items-center gap-1 rounded border border-amber-300/20 px-2.5 py-1.5 font-ui text-[7px] text-amber-200">
            <Plus className="h-3 w-3" /> New
          </button>
          <button type="button" onClick={() => setSpreadsheetImportOpen(value => !value)}
            disabled={importingSpreadsheet} aria-expanded={spreadsheetImportOpen}
            aria-controls={"lios-project-spreadsheet-upload-" + projectId}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cyan-300/25 px-3 font-ui text-sm text-cyan-200 hover:bg-cyan-300/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40">
            <FileUp aria-hidden="true" className="h-4 w-4" />
            Import spreadsheet
          </button>
          <button onClick={() => void exportProjectArtifactPackage(projectId).then((pkg) => downloadPackage(projectId, pkg)).catch((cause) => setError(cause instanceof Error ? cause.message : "Package export failed."))} className="flex items-center gap-1 rounded border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-muted-foreground">
            <Package className="h-3 w-3" /> Export package
          </button>
          <label className="cursor-pointer rounded border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-muted-foreground focus-within:outline focus-within:outline-2 focus-within:outline-primary">
            Import package
            <input type="file" accept=".json,application/json" className="sr-only" aria-label="Import Artifact package" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(JSON.parse).then((pkg) => importProjectArtifactPackage(projectId, pkg)).then((result) => { setImportSummary(`Imported ${result.importedArtifacts} Artifacts and ${result.importedSessions} Sessions`); invalidate(projectId); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Package import failed.")); event.currentTarget.value = ""; }} />
          </label>
        </div>
      </div>
      {spreadsheetImportOpen && <div id={"lios-project-spreadsheet-upload-" + projectId}>
        <ProjectSpreadsheetImportField key={projectId} busy={importingSpreadsheet} onImport={handleSpreadsheetImport} />
      </div>}
      {briefingOpen && <div id="project-briefing-studio">
        <ProjectBriefingStudio key={projectId} projectId={projectId} artifacts={rows}
          onSave={handleSaveBriefing} onClose={() => setBriefingOpen(false)}
          onOpenSource={id => { setBriefingOpen(false); setVersionView(null); setSelected(id); }} />
      </div>}
      {!!rows.length && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/50 pt-4" aria-label="Find saved Artifacts">
          <div className="min-w-0 flex-1">
            <label htmlFor="lios-artifact-gallery-search" className="sr-only">Search Project Artifacts</label>
            <input
              id="lios-artifact-gallery-search"
              type="search"
              value={galleryQuery}
              onChange={event => { setGalleryQuery(event.target.value); setVisibleGalleryCount(18); }}
              placeholder="Find saved reports, charts, research…"
              className="min-h-10 w-full min-w-[175px] rounded-lg border border-border/70 bg-background/60 px-3 font-ui text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
            />
          </div>
          <label className="flex items-center gap-2 font-ui text-xs text-muted-foreground">
            <span>Type</span>
            <select
              aria-label="Filter saved Artifacts by type"
              value={galleryKind}
              onChange={event => { setGalleryKind(event.target.value as typeof galleryKind); setVisibleGalleryCount(18); }}
              className="min-h-10 rounded-lg border border-border/70 bg-background px-3 font-ui text-xs text-foreground"
            >
              <option value="all">All types</option>
              {availableKinds.map(kind => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}
            </select>
          </label>
          <span className="font-ui text-xs text-muted-foreground">{filteredRows.length} of {rows.length} saved</span>
        </div>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Saved Artifact gallery" data-testid="project-artifact-visual-gallery">
        {filteredRows.slice(0, visibleGalleryCount).map(artifact => {
          const isPreviewOpen = preview?.id === artifact.id && preview.version === artifact.headVersion;
          return <React.Fragment key={artifact.id}>
            <ProjectArtifactGalleryCard
              artifact={artifact}
              previewOpen={isPreviewOpen}
              onOpen={() => { setVersionView(null); setSelected(artifact.id); }}
              onPreview={() => togglePreview(artifact)}
              actions={<ObjectActionMenu kind="artifact" status={artifact.status} hidden={["rename", "compare", "export", "delete", "share"]} label={`Actions for ${artifact.title}`} onAction={action => void handleArtifactAction(artifact, action)} />}
            />
            {isPreviewOpen && <div className="col-span-full"><ProjectArtifactGalleryPreview artifact={artifact} onOpen={() => { setVersionView(null); setSelected(artifact.id); }} /></div>}
          </React.Fragment>;
        })}
      </div>
      {filteredRows.length > visibleGalleryCount && (
        <button type="button" onClick={() => setVisibleGalleryCount(count => count + 18)} className="mt-4 min-h-10 rounded-lg border border-border/70 px-4 font-ui text-sm text-foreground hover:bg-white/[0.04]">
          Show more saved work ({filteredRows.length - visibleGalleryCount} remaining)
        </button>
      )}
      {!!rows.length && !filteredRows.length && <p role="status" className="mt-4 text-sm text-muted-foreground">No saved Artifacts match those filters.</p>}
      {!!archivedRows.length && (
        <section aria-label="Archived Artifacts" className="mt-6 border-t border-border/50 pt-4">
          <h3 className="font-ui text-sm font-semibold text-muted-foreground">Archived work · {archivedRows.length}</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {archivedRows.slice(0, visibleArchivedCount).map(artifact => {
              const isPreviewOpen = preview?.id === artifact.id && preview.version === artifact.headVersion;
              return <React.Fragment key={artifact.id}>
                <ProjectArtifactGalleryCard
                  artifact={artifact}
                  previewOpen={isPreviewOpen}
                  onOpen={() => { setVersionView(null); setSelected(artifact.id); }}
                  onPreview={() => togglePreview(artifact)}
                  actions={<ObjectActionMenu kind="artifact" status="archived" hidden={["delete"]} label={`Actions for archived ${artifact.title}`} onAction={action => void handleArtifactAction(artifact, action)} />}
                />
                {isPreviewOpen && <div className="col-span-full"><ProjectArtifactGalleryPreview artifact={artifact} onOpen={() => { setVersionView(null); setSelected(artifact.id); }} /></div>}
              </React.Fragment>;
            })}
          </div>
          {archivedRows.length > visibleArchivedCount && <button type="button" onClick={() => setVisibleArchivedCount(count => count + 18)} className="mt-4 min-h-10 rounded-lg border border-border/70 px-4 font-ui text-sm text-foreground">Show more archived work</button>}
        </section>
      )}
      {!rows.length && !archivedRows.length && !artifacts.isLoading && !archivedArtifacts.isLoading && <div className="mt-3 rounded-lg border border-dashed border-border/50 px-4 py-6 font-ui text-[8px] text-muted-foreground">No persistent Artifacts yet. Keep one from chat or create one here.</div>}
      {importSummary && <div className="mt-3 rounded border border-emerald-300/20 px-2 py-1.5 font-ui text-[7px] text-emerald-200">{importSummary}</div>}
      {error && <div role="alert" className="mt-3 rounded border border-red-300/20 px-2 py-1.5 font-ui text-[7px] text-red-200">{error}</div>}
    </section>
  );
}

