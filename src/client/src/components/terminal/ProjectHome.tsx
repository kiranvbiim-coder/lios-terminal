import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send } from "lucide-react";
import type { ArtifactRefreshSpec } from "@shared/artifactContracts";
import type { P6PersonalFinanceRequest } from "@shared/p6FinanceContracts";
import { updateProjectResource, type Project, type ProjectChat, type ProjectResource, type ProjectSession } from "@/lib/useProjects";
import { contextChangeConfirmation, findProjectHomeItems, mayEditProjectResourceContext, PROJECT_RESOURCE_CONTEXT_OPTIONS, type ProjectResourceContextMode } from "@/lib/projectHomeKnowledge";
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
import { ProjectAutomationPanel } from "./ProjectAutomationPanel";
import { ProjectContinuityPanel } from "./ProjectContinuityPanel";
import { ProjectPersonalFinancePanel } from "./ProjectPersonalFinancePanel";

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
}: {
  project: Project;
  chats: ProjectChat[];
  resources: ProjectResource[];
  sessions: ProjectSession[];
  onOpenChat: (chat: ProjectChat) => void;
  onNewChat: (starterPrompt?: string) => void;
  onOpenSession: (session: ProjectSession) => void;
  onOpenWorkbench: () => void;
  onRenameProject: (name: string) => void;
  onTogglePin: () => void;
  onArchiveProject: () => void;
  onRestoreProject: () => void;
  onTrashProject: () => void;
  onAskArtifact: (id: string, title: string, prompt?: string) => void;
  onFocusArtifact: (id: string, title: string) => void;
  onRerunArtifact: (id: string, title: string, spec: ArtifactRefreshSpec) => void;
  onAnalyzePersonalFinance: (profile: P6PersonalFinanceRequest) => void;
  onOpenContext: () => void;
}) {
  const queryClient = useQueryClient();
  const [workQuery, setWorkQuery] = useState("");
  const [pendingContext, setPendingContext] = useState<{ projectId: number; resourceId: string; from: ProjectResourceContextMode; to: ProjectResourceContextMode } | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const contextSaveInFlight = useRef(false);
  const selectedProjectId = useRef(project.id);
  selectedProjectId.current = project.id;
  const found = useMemo(() => findProjectHomeItems(project.id, chats, resources, sessions, workQuery), [project.id, chats, resources, sessions, workQuery]);

  async function confirmContextUpdate() {
    const draft = pendingContext;
    if (!draft || contextSaveInFlight.current || draft.projectId !== project.id) return;
    const resource = resources.find(row => row.projectId === draft.projectId && row.id === draft.resourceId);
    if (!resource || resource.contextMode !== draft.from || !mayEditProjectResourceContext(draft.projectId, resource, draft.to)) {
      setPendingContext(null);
      setContextNotice("Resource details changed. Reopen this Project's context to review the latest saved state.");
      return;
    }
    contextSaveInFlight.current = true;
    setContextBusy(true);
    setContextNotice(null);
    try {
      const saved = await updateProjectResource(draft.projectId, draft.resourceId, { contextMode: draft.to });
      // Even if the user switches Projects while the server responds, only
      // invalidate the exact old Project's caches; never update the new view.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/projects", draft.projectId, "home"], exact: true }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", draft.projectId, "resources"], exact: true }),
      ]);
      if (selectedProjectId.current !== draft.projectId) return;
      if (saved.projectId !== draft.projectId || saved.id !== draft.resourceId || saved.contextMode !== draft.to) {
        setContextNotice("The server did not confirm this exact Project resource and mode. Reload the context before relying on the change.");
      } else {
        setContextNotice("Context mode saved for this Project resource. Source rights and retrieval permissions still apply.");
      }
      setPendingContext(null);
    } catch {
      if (selectedProjectId.current === draft.projectId) {
        setContextNotice("Resource context change was not confirmed. The saved mode remains authoritative; refresh this Project before retrying.");
      }
    } finally {
      contextSaveInFlight.current = false;
      if (selectedProjectId.current === draft.projectId) setContextBusy(false);
    }
  }

  const [editingName, setEditingName] = useState(false);
  const [projectDepthOpen, setProjectDepthOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
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
    setEnvironmentId(getProjectVisualEnvironmentPin(project.id) ?? "");
  }, [project.id, project.name]);

  return (
    <div className="lios-project-home-surface h-full overflow-y-auto px-6 py-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <div className="font-terminal text-[12px] uppercase tracking-[0.22em] text-amber-300/80">Project Home</div>
            {editingName ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && nameDraft.trim()) {
                      onRenameProject(nameDraft.trim());
                      setEditingName(false);
                    }
                    if (event.key === "Escape") setEditingName(false);
                  }}
                  className="min-w-[280px] border-b border-amber-300/40 bg-transparent font-ui text-2xl font-semibold text-foreground outline-none"
                  aria-label="Project name"
                />
                <button onClick={() => { if (nameDraft.trim()) onRenameProject(nameDraft.trim()); setEditingName(false); }} className="font-ui text-[12px] text-amber-200">Save</button>
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
            <p className="mt-2 max-w-2xl font-ui text-[14px] leading-5 text-muted-foreground">
              {project.instructions || "Keep this Project focused. Add instructions, connected resources and Sessions as the work develops."}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
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
              className="rounded-md border border-border/65 bg-[#090909]/85 px-2.5 py-2 font-ui text-[12px] text-muted-foreground outline-none hover:text-foreground"
              title="Pin a visual environment to this Project, or keep automatic context selection"
            >
              <option value="">Environment · Auto</option>
              {VISUAL_ENVIRONMENTS.map((environment) => (
                <option key={environment.id} value={environment.id}>{environment.name}</option>
              ))}
            </select>
            <button onClick={() => onNewChat()} className="rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 font-ui text-[13px] font-medium text-amber-200 hover:bg-amber-400/[0.12]">
              + New chat
            </button>
            <button onClick={onOpenContext} className="lios-section-action">Project context</button>
            <button onClick={onOpenWorkbench} className="rounded-md border border-border/70 px-3 py-2 font-ui text-[13px] text-foreground hover:bg-white/[0.04]">
              Expand workspace
            </button>
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-border/55 bg-black/20 p-4 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => onNewChat()}
            className="flex w-full items-center justify-between gap-4 rounded-xl border border-border/60 bg-[#090909]/80 px-4 py-4 text-left shadow-[0_18px_60px_rgba(0,0,0,.2)] hover:border-amber-300/25"
          >
            <span>
              <span className="block font-display text-[16px] font-semibold tracking-[-0.02em] text-foreground">Continue the work with LiOS</span>
              <span className="mt-1 block font-ui text-[14px] leading-5 text-muted-foreground">Ask naturally. LiOS brings in sources, calculations, artifacts and workspace depth only when the task benefits from them.</span>
            </span>
            <Send className="h-4 w-4 shrink-0 text-amber-300" />
          </button>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "Research a company and show what changed",
              "Build a valuation from my connected data",
              "Analyze portfolio risk and downside scenarios",
              "Explore markets and explain the important moves",
              "Plan personal finances and long-term goals",
            ].map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => onNewChat(starter)}
                className="rounded-full border border-border/55 bg-black/25 px-3 py-1.5 font-ui text-[13px] text-muted-foreground transition-colors hover:border-amber-300/25 hover:text-foreground"
              >
                {starter}
              </button>
            ))}
          </div>
        </section>


        <section aria-label="Find work within this Project" data-testid="project-scoped-discovery" className="mt-6 space-y-2 rounded-xl border border-border/55 bg-black/15 p-4">
          <label htmlFor={`project-work-search-${project.id}`} className="block font-ui text-sm font-semibold">Find this Project's chats, context and Sessions</label>
          <input id={`project-work-search-${project.id}`} type="search" value={workQuery} onChange={event => setWorkQuery(event.target.value)}
            placeholder="Search saved titles and resource kinds" className="min-h-11 w-full rounded border border-border bg-background px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
          <p role="status" className="font-ui text-xs text-muted-foreground">{found.chats.length} chats · {found.resources.length} resources · {found.sessions.length} Sessions in this Project{workQuery.trim() ? " matching your search" : ""}. Search is local to the currently loaded Project; it does not search other Projects or change source access.</p>
        </section>
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="border-t border-border/45 pt-4">
            <div className="flex items-center justify-between">
              <div className="font-ui text-[14px] font-semibold">Recent chats</div>
              <span className="font-terminal text-[11px] text-muted-foreground">{found.chats.length} MATCHING</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {found.chats.length ? found.chats.slice(0, 8).map((chat) => (
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
              <div className="font-ui text-[14px] font-semibold">Project context</div>
              <span className="font-terminal text-[11px] text-muted-foreground">{found.resources.length} MATCHING</span>
            </div>
            <div className="mt-3 space-y-2">
              {found.resources.slice(0, 6).map((resource) => (
                <div key={resource.id} className="rounded-lg border border-border/45 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-ui text-[13px] text-foreground">{resource.label}</span>
                    <span className={`font-terminal text-[11px] ${
                      resource.contextMode === "project" ? "text-emerald-300" : resource.contextMode === "excluded" ? "text-red-300" : "text-cyan-300"
                    }`}>{resource.contextMode.toUpperCase()}</span>
                  </div>
                  <div className="mt-1 font-terminal text-[11px] uppercase tracking-wider text-muted-foreground">{resource.kind}</div>
                  <button type="button" disabled={contextBusy} onClick={() => { setContextNotice(null); setPendingContext({ projectId: project.id, resourceId: resource.id, from: resource.contextMode, to: resource.contextMode === "project" ? "on_demand" : "project" }); }}
                    className="mt-2 rounded border border-border/70 px-2.5 py-1.5 font-ui text-xs text-cyan-200 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">Review context inclusion</button>
                </div>
              ))}
              {!found.resources.length && <div className="rounded-lg border border-dashed border-border/50 p-3 font-ui text-[13px] text-muted-foreground">{workQuery.trim() ? "No matching saved resources in this Project." : "No resources connected yet."}</div>}
              <p className="font-ui text-xs leading-5 text-muted-foreground">Project = eligible for automatic context; on demand = only when requested; excluded = retained but not routinely retrieved. These modes never override server data rights.</p>
              {pendingContext?.projectId === project.id && (() => {
                const resource = found.resources.find(row => row.id === pendingContext.resourceId);
                if (!resource) return <p role="alert" className="font-ui text-xs text-amber-200">The selected resource is no longer visible in this Project. Cancel and reopen its context.</p>;
                return <section aria-label="Review exact Project resource context change" data-testid="project-context-review" className="space-y-2 rounded border border-amber-300/30 p-3">
                  <label className="block font-ui text-sm">Resource inclusion mode
                    <select value={pendingContext.to} disabled={contextBusy} onChange={event => setPendingContext(current => current ? { ...current, to: event.target.value as ProjectResourceContextMode } : null)}
                      className="mt-1 min-h-11 w-full rounded border border-border bg-background px-3 py-2 text-sm">
                      {PROJECT_RESOURCE_CONTEXT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <p className="font-ui text-xs leading-5 text-muted-foreground">{contextChangeConfirmation(resource.label, pendingContext.from, pendingContext.to)}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={contextBusy || !mayEditProjectResourceContext(project.id, resource, pendingContext.to)}
                      onClick={() => void confirmContextUpdate()} className="min-h-10 rounded border border-amber-300/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-40">Save this resource's context mode</button>
                    <button type="button" disabled={contextBusy} onClick={() => setPendingContext(null)} className="min-h-10 rounded border border-border px-3 py-2 text-sm">Cancel</button>
                  </div>
                </section>;
              })()}
              {contextNotice && <p role="status" data-testid="project-context-save-status" className="font-ui text-xs text-amber-200">{contextNotice}</p>}
            </div>
          </section>
        </div>

        {!!found.sessions.length && (
          <section className="mt-8 border-t border-border/45 pt-4">
            <div className="flex items-center justify-between">
              <div className="font-ui text-[14px] font-semibold">Resume a Session</div>
              <span className="font-terminal text-[11px] text-muted-foreground">FORKABLE ANALYTICAL STATE</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {found.sessions.slice(0, 6).map((session) => (
                <button key={session.id} onClick={() => onOpenSession(session)} className="rounded-lg border border-border/50 bg-black/15 p-3 text-left hover:border-fuchsia-300/25 hover:bg-white/[0.025]">
                  <div className="font-ui text-[13px] text-foreground">{session.name}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-terminal text-[11px] text-muted-foreground">{session.parentSessionId ? "FORK" : "BASE"}</span>
                    <span className="font-terminal text-[11px] text-muted-foreground">{relativeTime(session.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8 border-t border-border/45 pt-4">
          <button
            type="button"
            onClick={() => setProjectDepthOpen((value) => !value)}
            aria-expanded={projectDepthOpen}
            className="flex w-full items-center justify-between gap-4 rounded-lg px-1 py-2 text-left text-muted-foreground hover:text-foreground"
          >
            <span>
              <span className="block font-ui text-[13px] font-semibold text-foreground">Project intelligence & saved work</span>
              <span className="mt-1 block font-ui text-[12px] text-muted-foreground">Continue work across decisions, Project context, automations, intelligence snapshots and reproducibility history.</span>
            </span>
            <span className="font-terminal text-[12px] text-amber-200">{projectDepthOpen ? "HIDE" : "SHOW"}</span>
          </button>
          {projectDepthOpen && (
            <div className="mt-3 space-y-3">
              <ProjectPersonalFinancePanel projectId={project.id} onAnalyze={onAnalyzePersonalFinance} />
              <ProjectContinuityPanel key={project.id} projectId={project.id} onFocusArtifact={onFocusArtifact} />
              <ProjectIntelligencePanel projectId={project.id} />
              <ProjectAutomationPanel projectId={project.id} />
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
      </div>
    </div>
  );
}
