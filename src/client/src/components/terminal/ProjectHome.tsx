import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send } from "lucide-react";
import type { ArtifactRefreshSpec } from "@shared/artifactContracts";
import type { P6PersonalFinanceRequest } from "@shared/p6FinanceContracts";
import { trashProjectResource, trashProjectSession, updateProjectResource, updateProjectSession, useProjectChats, useProjectResources, useProjectSessions, type Project, type ProjectChat, type ProjectResource, type ProjectSession } from "@/lib/useProjects";
import { contextChangeConfirmation, findProjectHomeItems, mayEditProjectResourceContext, PROJECT_RESOURCE_CONTEXT_OPTIONS, type ProjectResourceContextMode } from "@/lib/projectHomeKnowledge";
import { projectSavedWorkReadPresentation } from "@/lib/projectSavedWorkReadPresentation";
import {
  VISUAL_ENVIRONMENTS,
  dispatchVisualContext,
  getProjectVisualEnvironmentPin,
  setProjectVisualEnvironmentPin,
  type VisualEnvironmentId,
} from "@/lib/visualEnvironment";
import { ObjectActionMenu } from "./ObjectActionMenu";
import { ProjectLedgerPanel } from "./ProjectLedgerPanel";
import { ProjectArtifactsPanel } from "./ProjectArtifactsPanel";
import { ProjectIntelligencePanel } from "./ProjectIntelligencePanel";
import { ProjectContinuityPanel } from "./ProjectContinuityPanel";
import { ProjectPersonalFinancePanel } from "./ProjectPersonalFinancePanel";
import { ProjectResumeDesk } from "./ProjectResumeDesk";
import { ProjectWatchroomDesk } from "./ProjectWatchroomDesk";
import { ProjectEvidenceBriefingStudio } from "./ProjectEvidenceBriefingStudio";
import { ProjectLifecycleDialog, type LifecycleRequest } from "./ProjectLifecycleDialog";
import { QuietAdvisoryInvite } from "./QuietAdvisoryInvite";

export function relativeTime(value: string): string {
  const ms = Math.max(0, Date.now() - new Date(value).getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function ProjectHome({
  project,
  chats,
  resources,
  sessions,
  onOpenChat,
  onNewChat,
  onOpenSession,
  onOpenWorkbench,
  onRenameProject,
  onTogglePin,
  onArchiveProject,
  onRestoreProject,
  onTrashProject,
  onAskArtifact,
  onFocusArtifact,
  onRerunArtifact,
  onAnalyzePersonalFinance,
  onOpenContext,
  showQuietAdvisoryInvite,
  onExploreAdvisory,
  onDismissAdvisory,
}: {
  project: Project;
  chats: ProjectChat[];
  resources: ProjectResource[];
  sessions: ProjectSession[];
  onOpenChat: (chat: ProjectChat) => void;
  onNewChat: (starterPrompt?: string) => void;
  onOpenSession: (session: ProjectSession) => void;
  onOpenWorkbench: () => void;
  onRenameProject: (name: string) => Promise<void>;
  onTogglePin: () => void;
  onArchiveProject: () => void;
  onRestoreProject: () => void;
  onTrashProject: () => void;
  onAskArtifact: (id: string, title: string, prompt?: string) => void;
  onFocusArtifact: (id: string, title: string) => void;
  onRerunArtifact: (id: string, title: string, spec: ArtifactRefreshSpec) => void;
  onAnalyzePersonalFinance: (profile: P6PersonalFinanceRequest) => void;
  onOpenContext: () => void;
  showQuietAdvisoryInvite: boolean;
  onExploreAdvisory: () => void;
  onDismissAdvisory: () => void;
}) {
  const queryClient = useQueryClient();
  const chatsQuery = useProjectChats(project.id);
  const resourcesQuery = useProjectResources(project.id);
  const sessionsQuery = useProjectSessions(project.id);
  const projectChats = chatsQuery.data ?? chats;
  const projectResources = resourcesQuery.data ?? resources;
  const projectSessions = sessionsQuery.data ?? sessions;
  const [visibleWorkCount, setVisibleWorkCount] = useState(12);
  const collectionsPending = chatsQuery.isPending || resourcesQuery.isPending || sessionsQuery.isPending;
  const collectionsFailed = chatsQuery.isError || resourcesQuery.isError || sessionsQuery.isError;
  const collectionsFetching = chatsQuery.isFetching || resourcesQuery.isFetching || sessionsQuery.isFetching;
  const savedWorkRead = projectSavedWorkReadPresentation({
    chatsFailed: chatsQuery.isError,
    resourcesFailed: resourcesQuery.isError,
    sessionsFailed: sessionsQuery.isError,
    pending: collectionsPending,
    fetching: collectionsFetching,
  });
  const [workQuery, setWorkQuery] = useState("");
  const [pendingContext, setPendingContext] = useState<{ projectId: number; resourceId: string; from: ProjectResourceContextMode; to: ProjectResourceContextMode } | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const contextSaveInFlight = useRef(false);
  const selectedProjectId = useRef(project.id);
  selectedProjectId.current = project.id;
  const found = useMemo(() => findProjectHomeItems(project.id, projectChats, projectResources, projectSessions, workQuery), [project.id, projectChats, projectResources, projectSessions, workQuery]);
  useEffect(() => { setVisibleWorkCount(12); }, [project.id, workQuery]);

  async function confirmContextUpdate() {
    const draft = pendingContext;
    if (!draft || contextSaveInFlight.current || draft.projectId !== project.id || !savedWorkRead.resourcesWritable) return;
    const resource = projectResources.find(row => row.projectId === draft.projectId && row.id === draft.resourceId);
    if (!resource || resource.contextMode !== draft.from || !mayEditProjectResourceContext(draft.projectId, resource, draft.to)) {
      setPendingContext(null);
      setContextNotice("Resource details changed. Reopen this Project's context to review the latest saved state.");
      return;
    }
    contextSaveInFlight.current = true;
    setContextBusy(true);
    setContextNotice(null);
    try {
      const saved = await updateProjectResource(draft.projectId, draft.resourceId, { contextMode: draft.to, expectedUpdatedAt: resource.updatedAt });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/projects", draft.projectId, "home"], exact: true }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", draft.projectId, "resources"], exact: true }),
      ]);
      if (selectedProjectId.current !== draft.projectId) return;
      setContextNotice(saved.projectId === draft.projectId && saved.id === draft.resourceId && saved.contextMode === draft.to
        ? "Context mode saved for this Project resource. Source rights and retrieval permissions still apply."
        : "The server did not confirm this exact Project resource and mode. Reload before relying on the change.");
      setPendingContext(null);
    } catch {
      if (selectedProjectId.current === draft.projectId) setContextNotice("Resource context change was not confirmed. Refresh this Project before retrying.");
    } finally {
      contextSaveInFlight.current = false;
      if (selectedProjectId.current === draft.projectId) setContextBusy(false);
    }
  }

  const [editingName, setEditingName] = useState(false);
  const [projectDepthOpen, setProjectDepthOpen] = useState(false);
  const [watchroomsOpen, setWatchroomsOpen] = useState(false);
  const [continuityOpen, setContinuityOpen] = useState(false);
  const [investigationOpen, setInvestigationOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const renameInFlight = useRef(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const saveName = async () => {
    const next = nameDraft.trim();
    const originalProject = project.id;
    if (!next || renameInFlight.current) return;
    renameInFlight.current = true;
    setRenameBusy(true);
    setRenameError(null);
    try {
      await onRenameProject(next);
      if (selectedProjectId.current === originalProject) setEditingName(false);
    } catch (cause) {
      if (selectedProjectId.current === originalProject) setRenameError(cause instanceof Error ? cause.message : "Project rename was not confirmed. Your draft is retained.");
    } finally {
      renameInFlight.current = false;
      if (selectedProjectId.current === originalProject) setRenameBusy(false);
    }
  };
  const [environmentId, setEnvironmentId] = useState<VisualEnvironmentId | "">(
    () => getProjectVisualEnvironmentPin(project.id) ?? "",
  );
  useEffect(() => {
    setNameDraft(project.name);
    setWorkQuery("");
    setPendingContext(null);
    setContextNotice(null);
    setContextBusy(false);
    setEditingName(false);
    setProjectDepthOpen(false);
    setWatchroomsOpen(false);
    setContinuityOpen(false);
    setInvestigationOpen(false);
    setBriefingOpen(false);
    setEnvironmentId(getProjectVisualEnvironmentPin(project.id) ?? "");
    setRenameBusy(false);
    setRenameError(null);
  }, [project.id]);
  useEffect(() => { if (!editingName && !renameInFlight.current) setNameDraft(project.name); }, [project.name, editingName]);

  return (
    <div className="lios-project-home-surface h-full overflow-y-auto px-6 py-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            {editingName ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  disabled={renameBusy}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter") { event.preventDefault(); void saveName(); }
                    if (event.key === "Escape" && !renameInFlight.current) setEditingName(false);
                  }}
                  className="min-w-0 max-w-full flex-1 border-b border-amber-300/40 bg-transparent font-ui text-2xl font-semibold text-foreground outline-none"
                  aria-label="Project name"
                />
                <button type="button" disabled={renameBusy || !nameDraft.trim()} onClick={() => void saveName()} className="min-h-10 font-ui text-sm text-amber-200">{renameBusy ? "Saving…" : "Save"}</button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <h1 className="font-ui text-2xl font-semibold text-foreground">{project.name}</h1>
                <ObjectActionMenu
                  kind="project"
                  status={project.status}
                  pinned={project.pinned}
                  hidden={["share"]}
                  onAction={(action) => {
                    if (action === "rename") setEditingName(true);
                    if (action === "pin" || action === "unpin") onTogglePin();
                    if (action === "archive") onArchiveProject();
                    if (action === "restore") onRestoreProject();
                    if (action === "delete") onTrashProject();
                  }}
                />
              </div>
            )}
            {renameError && <p role="alert" className="mt-2 text-sm text-red-200">{renameError}</p>}
            {project.instructions && <p className="mt-2 max-w-2xl font-ui text-[14px] leading-5 text-muted-foreground">{project.instructions}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <details className="lios-project-options relative rounded-md border border-border/60" data-testid="project-options">
              <summary className="min-h-10 cursor-pointer select-none px-3 py-2 font-ui text-[13px] text-muted-foreground hover:text-foreground">Project options</summary>
              <div className="absolute right-0 z-20 mt-2 flex w-[min(280px,calc(100vw-40px))] flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-lg">
            <label className="sr-only" htmlFor={`project-environment-${project.id}`}>Project visual environment</label>
            <select
              id={`project-environment-${project.id}`}
              value={environmentId}
              onChange={(event) => {
                const next = event.target.value as VisualEnvironmentId | "";
                setEnvironmentId(next);
                setProjectVisualEnvironmentPin(project.id, next || null);
                dispatchVisualContext({
                  projectId: String(project.id),
                  projectName: project.name,
                  intensity: "immersive",
                  semanticContext: "general",
                });
              }}
              className="rounded-md border border-border/65 bg-card px-2.5 py-2 font-ui text-[12px] text-muted-foreground outline-none hover:text-foreground"
              title="Pin a visual environment to this Project, or keep automatic context selection"
            >
              <option value="">Environment · Auto</option>
              {VISUAL_ENVIRONMENTS.map((environment) => (
                <option key={environment.id} value={environment.id}>{environment.name}</option>
              ))}
            </select>
                <button onClick={onOpenContext} className="lios-section-action text-left">Project context</button>
              </div>
            </details>
            <button onClick={onOpenWorkbench} className="rounded-md border border-border/70 px-3 py-2 font-ui text-[13px] text-foreground hover:bg-white/[0.04]">
              Expand workspace
            </button>
          </div>
        </div>

        <section className="mt-6">
          <button
            type="button"
            onClick={() => onNewChat()}
            className="flex w-full items-center justify-between gap-4 rounded-xl border border-border/60 bg-card px-4 py-4 text-left shadow-[0_18px_60px_rgba(0,0,0,.2)] hover:border-amber-300/25"
          >
            <span>
              <span className="block font-display text-[16px] font-semibold tracking-[-0.02em] text-foreground">Start a conversation</span>
            </span>
            <Send className="h-4 w-4 shrink-0 text-amber-300" />
          </button>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "Research a company and show what changed",
              "Build a valuation from my connected data",
              "Analyze portfolio risk and downside scenarios",
            ].map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => onNewChat(starter)}
                className="rounded-full border border-border/55 bg-card px-3 py-1.5 font-ui text-[13px] text-muted-foreground transition-colors hover:border-amber-300/25 hover:text-foreground"
              >
                {starter}
              </button>
            ))}
          </div>
        </section>

        <ProjectResumeDesk key={project.id} projectId={project.id} chats={projectChats} sessions={projectSessions}
          onOpenChat={onOpenChat} onOpenSession={onOpenSession} onFocusArtifact={onFocusArtifact}
          onInspectContinuity={() => setContinuityOpen(true)}
          onOpenWatchrooms={() => setWatchroomsOpen(true)} />

        <section className="mt-5 rounded-xl border border-border/60 bg-white/[0.015] p-3" data-testid="project-watchrooms-entry">
          <button type="button" aria-expanded={watchroomsOpen}
            aria-controls={`project-watchrooms-${project.id}`}
            onClick={() => setWatchroomsOpen(value => !value)}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-2 text-left font-ui text-sm font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">
            <span>Watchrooms</span><span className="text-sm font-normal text-muted-foreground">{watchroomsOpen ? "Hide" : "Open"}</span>
          </button>
          {watchroomsOpen && <div id={`project-watchrooms-${project.id}`} className="border-t border-border/55 px-2 pb-2 pt-4">
            <ProjectWatchroomDesk key={project.id} projectId={project.id} />
          </div>}
        </section>

        <section className="mt-3 rounded-xl border border-border/60 bg-white/[0.015] p-3" data-testid="project-continuity-entry">
          <button type="button" aria-expanded={continuityOpen}
            aria-controls={`project-continuity-${project.id}`}
            onClick={() => setContinuityOpen(value => !value)}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-2 text-left font-ui text-sm font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">
            <span>Project history</span><span className="text-sm font-normal text-muted-foreground">{continuityOpen ? "Hide" : "Open"}</span>
          </button>
          {continuityOpen && <div id={`project-continuity-${project.id}`} className="border-t border-border/55 px-1 pb-1 pt-3">
            <ProjectContinuityPanel key={project.id} projectId={project.id} onFocusArtifact={onFocusArtifact} />
          </div>}
        </section>

        <section className="mt-3 rounded-xl border border-border/60 bg-white/[0.015] p-3" data-testid="project-investigation-entry">
          <button type="button" aria-expanded={investigationOpen}
            aria-controls={`project-investigation-${project.id}`}
            onClick={() => setInvestigationOpen(value => !value)}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-2 text-left font-ui text-sm font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">
            <span>Investigation</span><span className="text-sm font-normal text-muted-foreground">{investigationOpen ? "Hide" : "Open"}</span>
          </button>
          {investigationOpen && <div id={`project-investigation-${project.id}`} className="border-t border-border/55 px-1 pb-1 pt-3">
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Investigation workspace">
              <button type="button" aria-pressed={!briefingOpen} onClick={() => setBriefingOpen(false)}
                className={`min-h-10 rounded-lg border px-3 py-2 font-ui text-sm focus-visible:ring-2 focus-visible:ring-amber-300/70 ${!briefingOpen ? "border-amber-300/35 text-foreground" : "border-border/55 text-muted-foreground"}`}>Research</button>
              <button type="button" aria-pressed={briefingOpen} onClick={() => setBriefingOpen(true)}
                className={`min-h-10 rounded-lg border px-3 py-2 font-ui text-sm focus-visible:ring-2 focus-visible:ring-amber-300/70 ${briefingOpen ? "border-amber-300/35 text-foreground" : "border-border/55 text-muted-foreground"}`}>Briefing Studio</button>
            </div>
            {briefingOpen
              ? <ProjectEvidenceBriefingStudio key={project.id} projectId={project.id} onOpenArtifact={onFocusArtifact} />
              : <ProjectIntelligencePanel key={project.id} projectId={project.id} onInvestigate={prompt => onNewChat(prompt)} />}
          </div>}
        </section>
        {collectionsFailed && <div role="alert" className="mt-5 space-y-2 rounded-lg border border-amber-300/30 p-3 font-ui text-sm text-amber-100">
          <p>{savedWorkRead.label} Resource changes are disabled until the exact saved Project records are verified.</p>
          <button type="button" disabled={!savedWorkRead.retryAvailable} aria-busy={collectionsFetching}
            className="min-h-11 rounded-lg border border-border px-3 py-2 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
            onClick={() => { void chatsQuery.refetch(); void resourcesQuery.refetch(); void sessionsQuery.refetch(); }}>
            {collectionsFetching ? "Retrying saved-work read…" : "Retry saved-work read"}
          </button>
        </div>}
        <details className="mt-6 rounded-xl border border-border/55" data-testid="project-saved-work">
          <summary className="cursor-pointer select-none px-4 py-3 font-ui text-[14px] font-semibold text-foreground">Saved work</summary>
          <div className="px-4 pb-4">
            <section aria-label="Find work within this Project" className="space-y-2 rounded-lg border border-border/55 p-4">
          <label htmlFor={`project-work-search-${project.id}`} className="block font-ui text-sm font-semibold">Search saved work</label>
          <input id={`project-work-search-${project.id}`} type="search" value={workQuery} onChange={event => setWorkQuery(event.target.value)}
            placeholder="Search chats, resources and sessions" className="min-h-11 w-full rounded border border-border bg-background px-3 py-2 text-sm" />
          <p role="status" className="font-ui text-xs text-muted-foreground">{found.chats.length} chats · {found.resources.length} resources · {found.sessions.length} sessions{savedWorkRead.countQualifier}</p>
        </section>
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="border-t border-border/45 pt-4">
            <div className="flex items-center justify-between">
              <div className="font-ui text-[14px] font-semibold">Recent chats</div>
              <span className="font-terminal text-[11px] text-muted-foreground">{found.chats.length} MATCHING</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {found.chats.length ? found.chats.slice(0, visibleWorkCount).map((chat) => (
                <button key={chat.id} onClick={() => onOpenChat(chat)} className="flex w-full items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 text-left hover:border-amber-300/25 hover:bg-white/[0.025]">
                  <MessageSquare className="h-3.5 w-3.5 text-amber-300/80" />
                  <span className="min-w-0 flex-1 truncate font-ui text-[13px] text-foreground">{chat.title}</span>
                  <span className="font-terminal text-[11px] text-muted-foreground">{relativeTime(chat.lastActivityAt)}</span>
                </button>
              )) : (
                <button onClick={() => onNewChat()} className="w-full rounded-lg border border-dashed border-border/60 px-4 py-8 font-ui text-[13px] text-muted-foreground hover:border-amber-300/30 hover:text-foreground">
                  {workQuery.trim() ? "No matching chats. Start a new conversation in this Project" : "Start the first conversation in this Project"}
                </button>
              )}
            </div>
          </section>

          <section className="border-t border-border/45 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-ui text-[14px] font-semibold">Project memory &amp; context</div>
              <span className="font-terminal text-[11px] text-muted-foreground">{found.resources.length} MATCHING</span>
            </div>
            <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">Eligible Project resources can support conversations. Saved chats and memories remain separate.</p>
            <div className="mt-3 space-y-2">
              {found.resources.slice(0, visibleWorkCount).map((resource) => (
                <div key={resource.id} className="rounded-lg border border-border/45 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-ui text-[13px] text-foreground">{resource.label}</span>
                    <span className={`font-terminal text-[11px] ${
                      resource.contextMode === "project" ? "text-emerald-300" : resource.contextMode === "excluded" ? "text-red-300" : "text-cyan-300"
                    }`}>{resource.contextMode.toUpperCase()}</span>
                  </div>
                  <div className="mt-1 font-terminal text-[11px] uppercase tracking-wider text-muted-foreground">{resource.kind}</div>
                  <button type="button" disabled={contextBusy || !savedWorkRead.resourcesWritable} onClick={() => {
                    setContextNotice(null);
                    setPendingContext({ projectId: project.id, resourceId: resource.id, from: resource.contextMode, to: resource.contextMode });
                  }} className="mt-2 min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">Review context inclusion</button>
                  <ProjectWorkActions key={resource.id} kind="source" label={resource.label} disabled={contextBusy || !savedWorkRead.resourcesWritable}
                    rename={async label => {
                      const saved = await updateProjectResource(project.id, resource.id, { label });
                      if (saved.id !== resource.id || saved.projectId !== project.id || saved.label !== label) throw new Error("The exact resource name was not confirmed.");
                    }}
                    archive={async () => { await updateProjectResource(project.id, resource.id, { archived: true }); }}
                    trash={async () => { await trashProjectResource(project.id, resource.id); }}
                    onChanged={() => { void queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] }); }} />
                </div>
              ))}
              {!found.resources.length && <div className="rounded-lg border border-dashed border-border/50 p-3 font-ui text-sm text-muted-foreground">{resourcesQuery.isError ? "Resource records could not be verified. Retry before relying on an empty result." : workQuery.trim() ? "No matching saved resources in this Project." : "No resources connected yet."}</div>}
              <p className="font-ui text-xs text-muted-foreground">Automatic, on demand or excluded. Source permissions still apply.</p>
              {pendingContext?.projectId === project.id && (() => {
                const resource = projectResources.find(row => row.projectId === project.id && row.status === "active" && row.id === pendingContext.resourceId);
                if (!resource) return <p role="alert">The selected resource is no longer active. Reopen this Project's context.</p>;
                return <section aria-label="Review exact Project resource context change" className="space-y-2 rounded border border-amber-300/30 p-3">
                  <label className="block text-sm">Resource inclusion mode
                    <select value={pendingContext.to} disabled={contextBusy} onChange={event => setPendingContext(current => current ? { ...current, to: event.target.value as ProjectResourceContextMode } : null)} className="mt-1 min-h-11 w-full rounded border border-border bg-background px-3 py-2">
                      {PROJECT_RESOURCE_CONTEXT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <p className="text-xs">{contextChangeConfirmation(resource.label, pendingContext.from, pendingContext.to)}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={contextBusy || !savedWorkRead.resourcesWritable || !mayEditProjectResourceContext(project.id, resource, pendingContext.to)} onClick={() => void confirmContextUpdate()} className="min-h-10 rounded border border-amber-300/40 px-3 py-2 text-sm">Save this resource's context mode</button>
                    <button type="button" disabled={contextBusy} onClick={() => setPendingContext(null)} className="min-h-10 rounded border border-border px-3 py-2 text-sm">Cancel</button>
                  </div>
                </section>;
              })()}
              {contextNotice && <p role="status" className="text-xs text-amber-200">{contextNotice}</p>}
            </div>
          </section>
        </div>

        {!!found.sessions.length && (
          <section className="mt-8 border-t border-border/45 pt-4">
            <div className="flex items-center justify-between">
              <div className="font-ui text-[14px] font-semibold">Resume a Session</div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {found.sessions.slice(0, visibleWorkCount).map((session) => (
                <div key={session.id} className="rounded-lg border border-border/50 bg-card p-3">
                <button type="button" onClick={() => onOpenSession(session)} className="w-full text-left hover:text-fuchsia-200">
                  <div className="font-ui text-[13px] text-foreground">{session.name}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-terminal text-[11px] text-muted-foreground">{session.parentSessionId ? "FORK" : "BASE"}</span>
                    <span className="font-terminal text-[11px] text-muted-foreground">{relativeTime(session.updatedAt)}</span>
                  </div>
                </button>
                <ProjectWorkActions key={session.id} kind="session" label={session.name} disabled={false}
                  rename={async name => {
                    const saved = await updateProjectSession(session.id, { name });
                    if (saved.id !== session.id || saved.projectId !== project.id || saved.name !== name) throw new Error("The exact Session name was not confirmed.");
                  }}
                  archive={async () => { await updateProjectSession(session.id, { status: "archived" }); }}
                  trash={async () => { await trashProjectSession(session.id); }}
                  onChanged={() => { void queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] }); }} />
                </div>
              ))}
            </div>
          </section>
        )}
        {Math.max(found.chats.length, found.resources.length, found.sessions.length) > visibleWorkCount
          && <button type="button" onClick={() => setVisibleWorkCount(count => count + 40)} className="mt-4 min-h-11 rounded border border-border px-4 py-2 text-sm">Show more matching Project work</button>}

          </div>
        </details>

        <section className="mt-8 border-t border-border/45 pt-4">
          <button
            type="button"
            onClick={() => setProjectDepthOpen((value) => !value)}
            aria-expanded={projectDepthOpen}
            className="flex w-full items-center justify-between gap-4 rounded-lg px-1 py-2 text-left text-muted-foreground hover:text-foreground"
          >
            <span>
              <span className="block font-ui text-[13px] font-semibold text-foreground">Advanced tools</span>
            </span>
            <span className="font-terminal text-[12px] text-amber-200">{projectDepthOpen ? "Hide" : "Show"}</span>
          </button>
          {projectDepthOpen && (
            <div className="mt-3 space-y-3">
              <ProjectPersonalFinancePanel projectId={project.id} onAnalyze={onAnalyzePersonalFinance} />

              <ProjectArtifactsPanel
                projectId={project.id}
                sessions={sessions}
                onAskArtifact={onAskArtifact}
                onFocusArtifact={onFocusArtifact}
                onRerunArtifact={onRerunArtifact}
              />
              <ProjectLedgerPanel projectId={project.id} sessions={sessions} />
            </div>
          )}
        </section>
        {showQuietAdvisoryInvite && !editingName && !renameBusy && !pendingContext && !contextBusy && (
          <QuietAdvisoryInvite onExplore={onExploreAdvisory} onDismiss={onDismissAdvisory} />
        )}
      </div>
    </div>
  );
}

function ProjectWorkActions({ kind, label, disabled, rename, archive, trash, onChanged }: {
  kind: "source" | "session"; label: string; disabled: boolean;
  rename: (name: string) => Promise<void>; archive: () => Promise<void>; trash: () => Promise<void>; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [trashRequest, setTrashRequest] = useState<LifecycleRequest | null>(null);
  const run = async (operation: () => Promise<void>) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try { await operation(); setEditing(false); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Saved-work change was not confirmed. Your input is retained."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="mt-2">
    {editing ? <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (draft.trim()) void run(() => rename(draft.trim())); }}>
      <label className="min-w-0 flex-1 text-xs">Name for {label}
        <input autoFocus value={draft} disabled={busy} maxLength={kind === "source" ? 240 : 200} onChange={event => setDraft(event.target.value)}
          className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2 text-sm" />
      </label>
      <button type="submit" disabled={busy || disabled || !draft.trim()} className="min-h-10 rounded border border-border px-3 text-sm">{busy ? "Saving…" : "Save name"}</button>
      <button type="button" disabled={busy} onClick={() => setEditing(false)} className="min-h-10 px-3 text-sm">Cancel</button>
    </form> : <ObjectActionMenu kind={kind} status="active" hidden={["share", "fork", "compare"]}
      disabled={busy || disabled ? { rename: "Wait for the pending change", archive: "Wait for the pending change", delete: "Wait for the pending change" } : undefined}
      label={`Actions for ${label}`} onAction={(action, trigger) => {
        if (action === "rename") { setDraft(label); setError(null); setEditing(true); }
        if (action === "archive") void run(archive);
        if (action === "delete") setTrashRequest({
          title: kind === "source" ? "Move resource to Trash?" : "Move Session to Trash?",
          detail: `“${label}” will leave active Project work and Project context. Restore it from Trash & archive before using it again.`,
          confirmLabel: "Move to Trash",
          returnFocus: trigger ?? null,
          resolve: value => { if (value) void run(trash); },
        });
      }} />}
    <ProjectLifecycleDialog request={trashRequest} onClose={() => setTrashRequest(null)} />
    {error && <p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}
  </div>;
}
