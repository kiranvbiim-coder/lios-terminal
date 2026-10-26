import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, FolderKanban, Layers, MessageSquare, Package } from "lucide-react";
import { ObjectActionMenu } from "./ObjectActionMenu";
import {
  getProjectDependencySummary,
  permanentlyDeleteProject,
  permanentlyDeleteProjectChat,
  permanentlyDeleteProjectResource,
  permanentlyDeleteProjectSession,
  restoreTrashedProject,
  restoreTrashedProjectChat,
  restoreTrashedProjectResource,
  restoreTrashedProjectSession,
  trashProject,
  trashProjectChat,
  trashProjectResource,
  trashProjectSession,
  updateProject,
  updateProjectChat,
  updateProjectResource,
  updateProjectSession,
  useAllProjectChats,
  useProjectResources,
  useProjectSessions,
  useProjects,
  useQuickChats,
  type Project,
  type ProjectChat,
  type ProjectResource,
  type ProjectSession,
} from "@/lib/useProjects";
import {
  permanentlyDeleteArtifact,
  restoreTrashedArtifact,
  setArtifactStatus,
  trashArtifact,
  useAllArtifacts,
  type ProjectArtifactRecord,
} from "@/lib/useArtifacts";
import type { LifecycleAction, LifecycleStatus } from "@shared/objectLifecycle";

interface Props {
  onClose: () => void;
  onNotice: (message: string | null) => void;
  onInvalidate: () => void;
}

type CenterTab = "archived" | "trash";

function lifecycleStatus(trashedAt: string | null | undefined, status: "active" | "archived"): LifecycleStatus {
  return trashedAt ? "trashed" : status;
}

function actionLabel(tab: CenterTab): string {
  return tab === "trash" ? "Trash" : "Archived";
}

export function LifecycleCenter({ onClose, onNotice, onInvalidate }: Props) {
  const [tab, setTab] = useState<CenterTab>("trash");
  const actionInFlight = useRef(false);
  const [applying, setApplying] = useState(false);
  const disabledActions: Partial<Record<LifecycleAction, string>> | undefined = applying
    ? { restore: "Wait for the current change to finish", delete: "Wait for the current change to finish", delete_permanently: "Wait for the current change to finish" }
    : undefined;
  const archivedProjectsQuery = useProjects("archived");
  const trashedProjectsQuery = useProjects("trash");
  const archivedChatsQuery = useAllProjectChats("archived");
  const trashedChatsQuery = useAllProjectChats("trash");
  const archivedQuickChatsQuery = useQuickChats("archived");
  const trashedQuickChatsQuery = useQuickChats("trash");
  const trashedArtifactsQuery = useAllArtifacts("trash");
  const archivedArtifactsQuery = useAllArtifacts("archived");
  const activeProjectsQuery = useProjects("active");
  const activeProjects = activeProjectsQuery.data ?? [];
  const [workProjectId, setWorkProjectId] = useState<number | null>(null);
  const selectedWorkProjectId = activeProjects.some((project) => project.id === workProjectId) ? workProjectId : activeProjects[0]?.id ?? null;
  const resourcesQuery = useProjectResources(selectedWorkProjectId, tab);
  const sessionsQuery = useProjectSessions(selectedWorkProjectId, tab);

  const projects = tab === "trash" ? trashedProjectsQuery.data ?? [] : archivedProjectsQuery.data ?? [];
  const chats = tab === "trash"
    ? [...(trashedChatsQuery.data ?? []), ...(trashedQuickChatsQuery.data ?? [])]
    : [...(archivedChatsQuery.data ?? []), ...(archivedQuickChatsQuery.data ?? [])];
  const artifacts = tab === "trash" ? trashedArtifactsQuery.data ?? [] : archivedArtifactsQuery.data ?? [];
  const resources = resourcesQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const counts = useMemo(() => ({ projects: projects.length, chats: chats.length, artifacts: artifacts.length, work: resources.length + sessions.length }), [artifacts.length, chats.length, projects.length, resources.length, sessions.length]);

  const run = async (work: () => Promise<void | boolean>) => {
    // A menu can dispatch again before React disables its buttons.
    // Reject duplicates synchronously, including destructive operations.
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setApplying(true);
    onNotice(null);
    try {
      const changed = await work();
      // Canceling a native confirmation did not change any persisted object.
      if (changed !== false) onInvalidate();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `Unable to update ${actionLabel(tab).toLowerCase()}.`);
    } finally {
      actionInFlight.current = false;
      setApplying(false);
    }
  };

  const confirmProjectTrash = async (project: Project) => {
    const dependencies = await getProjectDependencySummary(project.id);
    const detail = dependencies.total
      ? ` This also moves ${dependencies.total} dependent object${dependencies.total === 1 ? "" : "s"} (${dependencies.chats} chats, ${dependencies.resources} resources, ${dependencies.sessions} sessions, ${dependencies.artifacts} artifacts) to Trash.`
      : " It has no active dependent objects.";
    if (!window.confirm(`Move Project “${project.name}” to Trash?${detail}`)) return false;
    await trashProject(project.id);
    return true;
  };

  const confirmProjectPermanentDelete = async (project: Project) => {
    const dependencies = await getProjectDependencySummary(project.id);
    const detail = dependencies.total
      ? ` This permanently removes ${dependencies.total} dependent object${dependencies.total === 1 ? "" : "s"} (${dependencies.chats} chats, ${dependencies.resources} resources, ${dependencies.sessions} sessions, ${dependencies.artifacts} artifacts).`
      : " It has no active dependent objects.";
    if (!window.confirm(`Permanently delete Project “${project.name}”?${detail} This cannot be undone.`)) return false;
    await permanentlyDeleteProject(project.id);
    return true;
  };

  const handleProjectAction = (project: Project, action: LifecycleAction) => {
    if (action === "restore") {
      return run(async () => {
        if (project.trashedAt) await restoreTrashedProject(project.id);
        else await updateProject(project.id, { status: "active" });
      });
    }
    if (action === "delete") return run(() => confirmProjectTrash(project));
    if (action === "delete_permanently") return run(() => confirmProjectPermanentDelete(project));
    return Promise.resolve();
  };

  const handleChatAction = (chat: ProjectChat, action: LifecycleAction) => {
    if (action === "restore") return run(async () => {
      if (chat.trashedAt) await restoreTrashedProjectChat(chat.id);
      else await updateProjectChat(chat.id, { status: "active" });
    });
    if (action === "delete") return run(async () => { await trashProjectChat(chat.id); });
    if (action === "delete_permanently") return run(async () => {
      if (!window.confirm(`Permanently delete chat “${chat.title}”? This cannot be undone.`)) return false;
      await permanentlyDeleteProjectChat(chat.id);
      return true;
    });
    return Promise.resolve();
  };

  const handleArtifactAction = (artifact: ProjectArtifactRecord, action: LifecycleAction) => {
    if (action === "restore") return run(async () => {
      if (artifact.trashedAt) await restoreTrashedArtifact(artifact.id);
      else await setArtifactStatus(artifact.id, "active");
    });
    if (action === "delete") return run(async () => { await trashArtifact(artifact.id); });
    if (action === "delete_permanently") return run(async () => {
      if (!window.confirm(`Permanently delete Artifact “${artifact.title}”? This cannot be undone.`)) return false;
      await permanentlyDeleteArtifact(artifact.id);
      return true;
    });
    return Promise.resolve();
  };

  const handleResourceAction = (resource: ProjectResource, action: LifecycleAction) => {
    if (action === "restore") return run(async () => {
      if (resource.trashedAt) await restoreTrashedProjectResource(resource.projectId, resource.id);
      else await updateProjectResource(resource.projectId, resource.id, { archived: false });
    });
    if (action === "delete") return run(async () => { await trashProjectResource(resource.projectId, resource.id); });
    if (action === "delete_permanently") return run(async () => {
      if (!window.confirm(`Permanently delete resource “${resource.label}”? This cannot be undone.`)) return false;
      await permanentlyDeleteProjectResource(resource.projectId, resource.id);
      return true;
    });
    return Promise.resolve();
  };

  const handleSessionAction = (session: ProjectSession, action: LifecycleAction) => {
    if (action === "restore") return run(async () => {
      if (session.trashedAt) await restoreTrashedProjectSession(session.id);
      else await updateProjectSession(session.id, { status: "active" });
    });
    if (action === "delete") return run(async () => { await trashProjectSession(session.id); });
    if (action === "delete_permanently") return run(async () => {
      if (!window.confirm(`Permanently delete Session “${session.name}”? This cannot be undone.`)) return false;
      await permanentlyDeleteProjectSession(session.id);
      return true;
    });
    return Promise.resolve();
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#050505]">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/70 px-5 py-4">
        <button type="button" disabled={applying} onClick={onClose} className="min-h-10 min-w-10 rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50" aria-label="Close Lifecycle Center" title="Back to Project Home">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-terminal text-[7px] uppercase tracking-[0.24em] text-amber-300/80">Lifecycle Center</div>
          <h1 className="mt-1 font-ui text-xl font-semibold text-foreground">Recover or remove work</h1>
          <p className="mt-1 font-ui text-[9px] leading-5 text-muted-foreground">Archive keeps work organized. Trash is recoverable until permanent deletion.</p>
        </div>
      </header>

      {applying && <p role="status" aria-live="polite" className="px-5 pt-3 font-ui text-sm text-amber-200">Applying saved-work change…</p>}
      <div className="flex shrink-0 gap-2 border-b border-border/60 px-5 py-3">
        {(["trash", "archived"] as const).map((item) => (
          <button key={item} type="button" disabled={applying} onClick={() => setTab(item)} className={`rounded-md border px-3 py-2 font-ui text-[8px] ${tab === item ? "border-amber-300/40 bg-amber-300/[0.08] text-amber-100" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>
            {item === "trash" ? "Trash" : "Archived"}
          </button>
        ))}
        <span className="ml-auto self-center font-terminal text-[6px] uppercase tracking-[0.16em] text-muted-foreground">
          {counts.projects + counts.chats + counts.artifacts + counts.work} loaded objects
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" aria-busy={applying}>
        {tab === "trash" && <div className="mb-5 rounded-lg border border-red-300/20 bg-red-300/[0.035] px-4 py-3 font-ui text-[9px] leading-5 text-red-100/80">Trash is recoverable. Permanent deletion removes the selected object and cannot be undone.</div>}
        <div className="grid gap-4 xl:grid-cols-3">
          <LifecycleGroup title="Projects" queries={[tab === "trash" ? trashedProjectsQuery : archivedProjectsQuery]} icon={<FolderKanban className="h-3.5 w-3.5 text-amber-300" />} empty={tab === "trash" ? "Trash is empty." : "No archived Projects."}>
            {projects.map((project) => (
              <div key={project.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-white/[0.015] px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate font-ui text-[9px] text-foreground">{project.name}</div><div className="mt-1 font-terminal text-[6px] text-muted-foreground">{project.trashedAt ? "TRASHED" : "ARCHIVED"}</div></div>
                <ObjectActionMenu disabled={disabledActions} kind="project" status={lifecycleStatus(project.trashedAt, project.status)} pinned={project.pinned} hidden={["share"]} label={`Actions for ${project.name}`} onAction={(action) => void handleProjectAction(project, action)} />
              </div>
            ))}
          </LifecycleGroup>

          <LifecycleGroup title="Chats" queries={tab === "trash" ? [trashedChatsQuery, trashedQuickChatsQuery] : [archivedChatsQuery, archivedQuickChatsQuery]} icon={<MessageSquare className="h-3.5 w-3.5 text-cyan-300" />} empty={tab === "trash" ? "Trash is empty." : "No archived chats."}>
            {chats.map((chat) => (
              <div key={chat.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-white/[0.015] px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate font-ui text-[9px] text-foreground">{chat.title}</div><div className="mt-1 font-terminal text-[6px] text-muted-foreground">{chat.scope.toUpperCase()} · {chat.trashedAt ? "TRASHED" : "ARCHIVED"}</div></div>
                <ObjectActionMenu disabled={disabledActions} kind="chat" scope={chat.scope} status={lifecycleStatus(chat.trashedAt, chat.status)} pinned={chat.pinned} hidden={["branch"]} label={`Actions for ${chat.title}`} onAction={(action) => void handleChatAction(chat, action)} />
              </div>
            ))}
          </LifecycleGroup>

          <LifecycleGroup title="Artifacts" queries={[tab === "trash" ? trashedArtifactsQuery : archivedArtifactsQuery]} icon={<Package className="h-3.5 w-3.5 text-violet-300" />} empty={tab === "trash" ? "Trash is empty." : "No archived Artifacts."}>
            {artifacts.map((artifact) => (
              <div key={artifact.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-white/[0.015] px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate font-ui text-[9px] text-foreground">{artifact.title}</div><div className="mt-1 font-terminal text-[6px] text-muted-foreground">{artifact.kind.toUpperCase()} · {artifact.trashedAt ? "TRASHED" : "ARCHIVED"}</div></div>
                <ObjectActionMenu disabled={disabledActions} kind="artifact" status={lifecycleStatus(artifact.trashedAt, artifact.status)} hidden={[]} label={`Actions for ${artifact.title}`} onAction={(action) => void handleArtifactAction(artifact, action)} />
              </div>
            ))}
          </LifecycleGroup>

          <LifecycleGroup title="Project resources & Sessions" queries={selectedWorkProjectId === null ? [activeProjectsQuery] : [activeProjectsQuery, resourcesQuery, sessionsQuery]} icon={<Layers className="h-3.5 w-3.5 text-emerald-300" />} empty={selectedWorkProjectId === null ? "No active Project to inspect." : tab === "trash" ? "No trashed resources or Sessions in this Project." : "No archived resources or Sessions in this Project."}
            controls={!activeProjectsQuery.isError && activeProjects.length > 0 && <label className="mt-3 block font-ui text-[9px] text-muted-foreground">Active Project
              <select value={selectedWorkProjectId ?? ""} disabled={applying} onChange={(event) => setWorkProjectId(Number(event.target.value))} className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2 text-sm text-foreground">
                {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>}>
            {resources.map((resource) => (
              <div key={`resource-${resource.id}`} className="flex items-center gap-2 rounded-lg border border-border/60 bg-white/[0.015] px-3 py-2.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
                <div className="min-w-0 flex-1"><div className="truncate font-ui text-[9px] text-foreground">{resource.label}</div><div className="mt-1 font-terminal text-[6px] text-muted-foreground">RESOURCE · {resource.trashedAt ? "TRASHED" : "ARCHIVED"}</div></div>
                <ObjectActionMenu disabled={disabledActions} kind="source" status={lifecycleStatus(resource.trashedAt, resource.status === "archived" ? "archived" : "active")} label={`Actions for ${resource.label}`} onAction={(action) => void handleResourceAction(resource, action)} />
              </div>
            ))}
            {sessions.map((session) => (
              <div key={`session-${session.id}`} className="flex items-center gap-2 rounded-lg border border-border/60 bg-white/[0.015] px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate font-ui text-[9px] text-foreground">{session.name}</div><div className="mt-1 font-terminal text-[6px] text-muted-foreground">SESSION · {session.trashedAt ? "TRASHED" : "ARCHIVED"}</div></div>
                <ObjectActionMenu disabled={disabledActions} kind="session" status={lifecycleStatus(session.trashedAt, session.status)} label={`Actions for ${session.name}`} onAction={(action) => void handleSessionAction(session, action)} />
              </div>
            ))}
            {!resourcesQuery.isLoading && !sessionsQuery.isLoading && !resources.length && !sessions.length && <p key="work-empty" className="px-1 py-5 font-ui text-[8px] text-muted-foreground">{selectedWorkProjectId === null ? "No active Project to inspect." : tab === "trash" ? "No trashed resources or Sessions in this Project." : "No archived resources or Sessions in this Project."}</p>}
          </LifecycleGroup>
        </div>
      </div>
    </section>
  );
}

type RecoveryRead = {
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

function LifecycleGroup({ title, icon, empty, children, queries, controls }: {
  title: string; icon: React.ReactNode; empty: string; children: React.ReactNode; queries: RecoveryRead[]; controls?: React.ReactNode;
}) {
  const loading = queries.some(query => query.isLoading);
  const failed = queries.some(query => query.isError);
  const refreshing = queries.some(query => query.isFetching);
  const hasChildren = Boolean(children && (Array.isArray(children) ? children.length : true));
  return (
    <section className="rounded-xl border border-border/60 bg-white/[0.012] p-3">
      <div className="flex items-center gap-2 border-b border-border/50 pb-3"><span>{icon}</span><h2 className="font-ui text-[10px] font-semibold">{title}</h2></div>
      {controls}
      <div className="mt-3 space-y-2" aria-busy={loading || refreshing}>
        {failed ? <div role="alert" className="space-y-2 font-ui text-sm">
          <p>{title} could not be loaded. The contents are unknown; no saved work was changed.</p>
          <button type="button" disabled={refreshing} onClick={() => { void Promise.all(queries.map(query => query.refetch())); }}
            className="min-h-10 rounded border border-border px-3 py-2 text-sm disabled:opacity-50"
          >{refreshing ? "Retrying…" : `Retry loading ${title}`}</button>
        </div> : loading ? <p role="status" className="font-ui text-sm text-muted-foreground">Loading {title}…</p>
          : hasChildren ? children : <div className="px-1 py-5 font-ui text-[8px] text-muted-foreground">{empty}</div>}
      </div>
    </section>
  );
}
