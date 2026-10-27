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
  const rows = artifacts.data ?? [];
  const archivedRows = archivedArtifacts.data ?? [];

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

  const handleSpreadsheetImport = async (file: File) => {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Spreadsheet import failed.");
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
            <div className="font-ui text-[10px] font-semibold">Project Artifacts</div>
          </div>
          <div className="mt-1 font-ui text-[8px] text-muted-foreground">Persistent, versioned work products shared by chat and direct manipulation.</div>
        </div>
        <div className="flex gap-2">
          <select value={newKind} onChange={(event) => setNewKind(event.target.value as ArtifactContent["kind"])} className="rounded border border-border/60 bg-[#090909] px-2 py-1.5 font-terminal text-[7px]" aria-label="New Artifact type">
            {["spreadsheet", "research", "thesis", "report", "decision", "timeline", "strategy", "backtest", "chart", "table", "data", "valuation", "portfolio", "screen"].map((kind) => <option key={kind}>{kind}</option>)}
          </select>
          <button onClick={() => void (async () => { try { setError(null); const created = await createArtifact(projectId, { title: `New ${newKind} Artifact`, content: starter(newKind) }); invalidate(projectId); setSelected(created.artifact.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create Artifact."); } })()} className="flex items-center gap-1 rounded border border-amber-300/20 px-2.5 py-1.5 font-ui text-[7px] text-amber-200">
            <Plus className="h-3 w-3" /> New
          </button>
          <label className={`flex cursor-pointer items-center gap-1 rounded border border-cyan-300/20 px-2.5 py-1.5 font-ui text-[7px] text-cyan-200 focus-within:outline focus-within:outline-2 focus-within:outline-primary ${importingSpreadsheet ? "pointer-events-none opacity-50" : ""}`}>
            <FileUp className="h-3 w-3" /> {importingSpreadsheet ? "Importing…" : "Import spreadsheet"}
            <input
              type="file"
              accept=".xlsx,.csv,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              aria-label="Import spreadsheet"
              disabled={importingSpreadsheet}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleSpreadsheetImport(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button onClick={() => void exportProjectArtifactPackage(projectId).then((pkg) => downloadPackage(projectId, pkg)).catch((cause) => setError(cause instanceof Error ? cause.message : "Package export failed."))} className="flex items-center gap-1 rounded border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-muted-foreground">
            <Package className="h-3 w-3" /> Export package
          </button>
          <label className="cursor-pointer rounded border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-muted-foreground focus-within:outline focus-within:outline-2 focus-within:outline-primary">
            Import package
            <input type="file" accept=".json,application/json" className="sr-only" aria-label="Import Artifact package" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(JSON.parse).then((pkg) => importProjectArtifactPackage(projectId, pkg)).then((result) => { setImportSummary(`Imported ${result.importedArtifacts} Artifacts and ${result.importedSessions} Sessions`); invalidate(projectId); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Package import failed.")); event.currentTarget.value = ""; }} />
          </label>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.slice(0, 18).map((artifact) => (
          <div key={artifact.id} className="flex items-center gap-1 rounded-lg border border-border/50 p-2 hover:border-amber-300/25 hover:bg-white/[0.025]">
            <button onClick={() => setSelected(artifact.id)} className="flex min-w-0 flex-1 gap-2 p-1 text-left">
              <FileBarChart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/70" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-ui text-[9px]">{artifact.title}</span>
                <span className="mt-1 block font-terminal text-[6px] text-muted-foreground">{artifact.kind.toUpperCase()} · V{artifact.headVersion} · {artifact.origin.toUpperCase()}</span>
              </span>
            </button>
            <ObjectActionMenu kind="artifact" status={artifact.status} hidden={["rename", "compare", "export", "delete", "share"]} label={`Actions for ${artifact.title}`} onAction={(action) => void handleArtifactAction(artifact, action)} />
          </div>
        ))}
      </div>
      {!!archivedRows.length && (
        <div className="mt-4 border-t border-border/50 pt-3">
          <div className="font-terminal text-[6px] uppercase tracking-[0.18em] text-muted-foreground">Archived artifacts</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {archivedRows.slice(0, 18).map((artifact) => (
              <div key={`archived-${artifact.id}`} className="flex items-center gap-1 rounded-lg border border-border/40 p-2 text-muted-foreground">
                <button onClick={() => setSelected(artifact.id)} className="flex min-w-0 flex-1 gap-2 p-1 text-left hover:text-foreground">
                  <FileBarChart className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-ui text-[9px]">{artifact.title}</span>
                    <span className="mt-1 block font-terminal text-[6px]">ARCHIVED · {artifact.kind.toUpperCase()} · V{artifact.headVersion}</span>
                  </span>
                </button>
                <ObjectActionMenu kind="artifact" status="archived" hidden={["delete"]} label={`Actions for archived ${artifact.title}`} onAction={(action) => void handleArtifactAction(artifact, action)} />
              </div>
            ))}
          </div>
        </div>
      )}
      {!rows.length && !archivedRows.length && !artifacts.isLoading && !archivedArtifacts.isLoading && <div className="mt-3 rounded-lg border border-dashed border-border/50 px-4 py-6 font-ui text-[8px] text-muted-foreground">No persistent Artifacts yet. Keep one from chat or create one here.</div>}
      {importSummary && <div className="mt-3 rounded border border-emerald-300/20 px-2 py-1.5 font-ui text-[7px] text-emerald-200">{importSummary}</div>}
      {error && <div role="alert" className="mt-3 rounded border border-red-300/20 px-2 py-1.5 font-ui text-[7px] text-red-200">{error}</div>}
    </section>
  );
}

