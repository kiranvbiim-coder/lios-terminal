import { addressForSelection, formatLiosAddress, parseLiosAddress } from "@shared/liosAddress";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import type { ProjectWorkspaceSessionState } from "@shared/projectContracts";
import { workSearchResponseSchema, type WorkSearchResponse } from "@shared/workSearch";

export interface Project {
  id: number;
  ownerUserId: number;
  organizationId: number | null;
  name: string;
  instructions: string | null;
  legacyWorkspaceId: string | null;
  status: "active" | "archived";
  pinned: boolean;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt: string | null;
}

export interface ProjectChat {
  id: number;
  projectId: number | null;
  ownerUserId: number;
  organizationId: number | null;
  scope: "project" | "quick";
  title: string;
  pinned: boolean;
  status: "active" | "archived";
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt: string | null;
  trashedByProjectId: number | null;
  trashedFromStatus: "active" | "archived" | null;
}

export interface ProjectChatMessage {
  id: number;
  chatId: number;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectResource {
  id: string;
  projectId: number;
  ownerUserId: number;
  organizationId: number | null;
  kind: string;
  label: string;
  resourceRef: string | null;
  contextMode: "project" | "on_demand" | "excluded";
  metadata: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  trashedByProjectId: number | null;
  trashedFromStatus: "active" | "archived" | null;
}

export interface ProjectSession {
  id: string;
  projectId: number;
  chatId: number | null;
  parentSessionId: string | null;
  ownerUserId: number;
  organizationId: number | null;
  name: string;
  status: "active" | "archived";
  workspaceState: ProjectWorkspaceSessionState;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt: string | null;
  trashedByProjectId: number | null;
  trashedFromStatus: "active" | "archived" | null;
}

export interface ProjectHomePayload {
  project: Project;
  chats: ProjectChat[];
  resources: ProjectResource[];
  sessions: ProjectSession[];
}

export async function searchWork(query: string, signal?: AbortSignal): Promise<WorkSearchResponse> {
  const normalized = query.trim();
  if (normalized.length < 2) return { query: normalized, results: [] };
  const res = await fetch(`/api/work-search?q=${encodeURIComponent(normalized)}&limit=30`, { signal });
  if (!res.ok) throw new Error("Failed to search LiOS work.");
  return workSearchResponseSchema.parse(await res.json());
}

const ACTIVE_PROJECT_KEY = "lios.activeProjectId";
const ACTIVE_CHAT_KEY = "lios.activeProjectChatId";

function numericStorage(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The selection a LiOS address in the location hash points at, or null when the hash is not an address. */
function selectionFromHash(): { projectId: number | null; chatId: number | null } | null {
  if (typeof window === "undefined") return null;
  const address = parseLiosAddress(window.location.hash);
  if (!address) return null;
  return address.kind === "project"
    ? { projectId: address.projectId, chatId: null }
    : { projectId: address.projectId, chatId: address.chatId };
}

export function getActiveProjectId(): number | null {
  return numericStorage(ACTIVE_PROJECT_KEY);
}

export function getActiveProjectChatId(): number | null {
  return numericStorage(ACTIVE_CHAT_KEY);
}

export function useProjectSelection(): {
  projectId: number | null;
  chatId: number | null;
  setProjectId: (id: number | null) => void;
  setChatId: (id: number | null) => void;
} {
  // A LiOS address in the location hash (a link, a reload, back/forward) wins over the remembered selection.
  const [projectId, setProjectState] = useState<number | null>(() => {
    const fromHash = selectionFromHash();
    return fromHash ? fromHash.projectId : getActiveProjectId();
  });
  const [chatId, setChatState] = useState<number | null>(() => {
    const fromHash = selectionFromHash();
    return fromHash ? fromHash.chatId : getActiveProjectChatId();
  });

  useEffect(() => {
    const onHashChange = () => {
      const fromHash = selectionFromHash();
      if (!fromHash) return;
      setProjectState(fromHash.projectId);
      setChatState(fromHash.chatId);
      try {
        if (fromHash.projectId) window.localStorage.setItem(ACTIVE_PROJECT_KEY, String(fromHash.projectId));
        else window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
        if (fromHash.chatId) window.localStorage.setItem(ACTIVE_CHAT_KEY, String(fromHash.chatId));
        else window.localStorage.removeItem(ACTIVE_CHAT_KEY);
      } catch {}
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Keep the address in step with the selection without adding a history entry per click.
  useEffect(() => {
    const address = addressForSelection({ projectId, chatId });
    const next = address ? formatLiosAddress(address) : null;
    if (next && window.location.hash !== next) window.history.replaceState(null, "", next);
  }, [projectId, chatId]);

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      const parseId = (value: string | null) => {
        const id = Number(value);
        return Number.isInteger(id) && id > 0 ? id : null;
      };
      if (event.key === ACTIVE_PROJECT_KEY) setProjectState(parseId(event.newValue));
      if (event.key === ACTIVE_CHAT_KEY) setChatState(parseId(event.newValue));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setProjectId = useCallback((id: number | null) => {
    setProjectState(id);
    try {
      if (id) window.localStorage.setItem(ACTIVE_PROJECT_KEY, String(id));
      else window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {}
  }, []);

  const setChatId = useCallback((id: number | null) => {
    setChatState(id);
    try {
      if (id) window.localStorage.setItem(ACTIVE_CHAT_KEY, String(id));
      else window.localStorage.removeItem(ACTIVE_CHAT_KEY);
    } catch {}
  }, []);

  return { projectId, chatId, setProjectId, setChatId };
}

export type ProjectLifecycleStatus = "active" | "archived" | "trash";

export function useProjects(status: ProjectLifecycleStatus = "active") {
  return useQuery<Project[]>({
    queryKey: ["/api/projects", status],
    queryFn: async () => {
      const res = await fetch(`/api/projects?status=${status}`);
      if (!res.ok) throw new Error("Failed to load Projects.");
      return res.json();
    },
  });
}

export function useProjectHome(projectId: number | null) {
  return useQuery<ProjectHomePayload>({
    queryKey: ["/api/projects", projectId, "home"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/home`);
      if (!res.ok) throw new Error("Failed to load Project.");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
}

export function useProjectChats(projectId: number | null, status: ProjectLifecycleStatus = "active") {
  return useQuery<ProjectChat[]>({
    queryKey: ["/api/projects", projectId, "chats", status],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/chats?status=${status}`);
      if (!res.ok) throw new Error("Failed to load Project chats.");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
}

export function useQuickChats(status: ProjectLifecycleStatus = "active") {
  return useQuery<ProjectChat[]>({
    queryKey: ["/api/quick-chats", status],
    queryFn: async () => {
      const res = await fetch(`/api/quick-chats?status=${status}`);
      if (!res.ok) throw new Error("Failed to load Quick Chats.");
      return res.json();
    },
  });
}

export function useProjectChatMessages(chatId: number | null) {
  return useQuery<ProjectChatMessage[]>({
    queryKey: ["/api/project-chats", chatId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/project-chats/${chatId}/messages`);
      if (!res.ok) throw new Error("Failed to load chat messages.");
      return res.json();
    },
    enabled: Boolean(chatId),
  });
}

export function useProjectResources(projectId: number | null) {
  return useQuery<ProjectResource[]>({
    queryKey: ["/api/projects", projectId, "resources"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/resources`);
      if (!res.ok) throw new Error("Failed to load Project resources.");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
}

export function useAllProjectChats(status: ProjectLifecycleStatus = "active", enabled = true) {
  return useQuery<ProjectChat[]>({
    enabled,
    queryKey: ["/api/project-chats", status],
    queryFn: async () => {
      const res = await fetch(`/api/project-chats?status=${status}`);
      if (!res.ok) throw new Error("Failed to load Project chats.");
      return res.json();
    },
  });
}

export function useProjectSessions(projectId: number | null) {
  return useQuery<ProjectSession[]>({
    queryKey: ["/api/projects", projectId, "sessions"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/sessions`);
      if (!res.ok) throw new Error("Failed to load Sessions.");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
}

export async function createProject(input: { name: string; instructions?: string | null }): Promise<Project> {
  return (await apiRequest("POST", "/api/projects", input)).json();
}

export async function updateProject(projectId: number, patch: Partial<Pick<Project, "name" | "instructions" | "pinned" | "status">>): Promise<Project> {
  return (await apiRequest("PATCH", `/api/projects/${projectId}`, patch)).json();
}


export interface ProjectDependencySummary {
  projectId: number;
  projectName: string;
  chats: number;
  resources: number;
  sessions: number;
  artifacts: number;
  total: number;
}

export async function getProjectDependencySummary(projectId: number): Promise<ProjectDependencySummary> {
  const res = await fetch(`/api/projects/${projectId}/dependencies`);
  if (!res.ok) throw new Error("Failed to load Project deletion dependencies.");
  return res.json();
}

export async function trashProject(projectId: number): Promise<Project> {
  return (await apiRequest("POST", `/api/projects/${projectId}/trash`, {})).json();
}

export async function restoreTrashedProject(projectId: number): Promise<Project> {
  return (await apiRequest("POST", `/api/projects/${projectId}/restore-trash`, {})).json();
}

export async function permanentlyDeleteProject(projectId: number): Promise<void> {
  await apiRequest("DELETE", `/api/projects/${projectId}/permanent`);
}

export async function trashProjectChat(chatId: number): Promise<ProjectChat> {
  return (await apiRequest("POST", `/api/project-chats/${chatId}/trash`, {})).json();
}

export async function restoreTrashedProjectChat(chatId: number): Promise<ProjectChat> {
  return (await apiRequest("POST", `/api/project-chats/${chatId}/restore-trash`, {})).json();
}

export async function permanentlyDeleteProjectChat(chatId: number): Promise<void> {
  await apiRequest("DELETE", `/api/project-chats/${chatId}/permanent`);
}

export async function trashProjectResource(projectId: number, resourceId: string): Promise<ProjectResource> {
  return (await apiRequest("POST", `/api/projects/${projectId}/resources/${encodeURIComponent(resourceId)}/trash`, {})).json();
}

export async function restoreTrashedProjectResource(projectId: number, resourceId: string): Promise<ProjectResource> {
  return (await apiRequest("POST", `/api/projects/${projectId}/resources/${encodeURIComponent(resourceId)}/restore-trash`, {})).json();
}

export async function permanentlyDeleteProjectResource(projectId: number, resourceId: string): Promise<void> {
  await apiRequest("DELETE", `/api/projects/${projectId}/resources/${encodeURIComponent(resourceId)}/permanent`);
}
export async function createProjectChat(projectId: number, title?: string): Promise<ProjectChat> {
  return (await apiRequest("POST", `/api/projects/${projectId}/chats`, title ? { title } : {})).json();
}

export async function createQuickChat(title?: string): Promise<ProjectChat> {
  return (await apiRequest("POST", "/api/quick-chats", title ? { title } : {})).json();
}

export async function promoteQuickChat(chatId: number, projectId: number): Promise<ProjectChat> {
  return (await apiRequest("POST", `/api/project-chats/${chatId}/promote`, { projectId })).json();
}

export async function updateProjectChat(chatId: number, patch: Partial<Pick<ProjectChat, "title" | "pinned" | "status">>): Promise<ProjectChat> {
  return (await apiRequest("PATCH", `/api/project-chats/${chatId}`, patch)).json();
}

export async function clearProjectChat(chatId: number): Promise<void> {
  await apiRequest("DELETE", `/api/project-chats/${chatId}/messages`);
}

export async function createProjectResource(projectId: number, input: {
  kind: string;
  label: string;
  resourceRef?: string | null;
  contextMode?: ProjectResource["contextMode"];
  metadata?: Record<string, unknown>;
}): Promise<ProjectResource> {
  return (await apiRequest("POST", `/api/projects/${projectId}/resources`, input)).json();
}

export async function updateProjectResource(projectId: number, resourceId: string, patch: {
  label?: string;
  contextMode?: ProjectResource["contextMode"];
  archived?: boolean;
}): Promise<ProjectResource> {
  return (await apiRequest("PATCH", `/api/projects/${projectId}/resources/${encodeURIComponent(resourceId)}`, patch)).json();
}

export async function createProjectSession(projectId: number, input: {
  chatId?: number | null;

  parentSessionId?: string | null;
  name: string;
  workspaceState: ProjectWorkspaceSessionState;
}): Promise<ProjectSession> {
  return (await apiRequest("POST", `/api/projects/${projectId}/sessions`, input)).json();
}

export async function updateProjectSession(sessionId: string, patch: {
  name?: string;
  workspaceState?: ProjectWorkspaceSessionState;
  status?: ProjectSession["status"];
}): Promise<ProjectSession> {
  return (await apiRequest("PATCH", `/api/project-sessions/${encodeURIComponent(sessionId)}`, patch)).json();
}

export async function trashProjectSession(sessionId: string): Promise<ProjectSession> {
  return (await apiRequest("POST", `/api/project-sessions/${encodeURIComponent(sessionId)}/trash`, {})).json();
}

export async function restoreTrashedProjectSession(sessionId: string): Promise<ProjectSession> {
  return (await apiRequest("POST", `/api/project-sessions/${encodeURIComponent(sessionId)}/restore-trash`, {})).json();
}

export async function permanentlyDeleteProjectSession(sessionId: string): Promise<void> {
  await apiRequest("DELETE", `/api/project-sessions/${encodeURIComponent(sessionId)}/permanent`);
}

export async function forkProjectSession(sessionId: string, name?: string): Promise<ProjectSession> {
  return (await apiRequest("POST", `/api/project-sessions/${encodeURIComponent(sessionId)}/fork`, name ? { name } : {})).json();
}

export async function restoreProjectSessionRecord(sessionId: string): Promise<ProjectSession> {
  const res = await fetch(`/api/project-sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error("Failed to load Session.");
  return res.json();
}

export interface ProjectSessionComparison {
  leftId: string;
  rightId: string;
  sameProject: boolean;
  sameChat: boolean;
  sameParent: boolean;
  workspaceEngineChanged: boolean;
  analyticalStateChanged: boolean;
  linkedContextChanged: boolean;
  focusedObjectChanged: boolean;
  savedViewChanged: boolean;
  commonAncestorId: string | null;
  differences: Array<{ category: string; changed: boolean; summary: string; leftHash: string | null; rightHash: string | null }>;
  explanation: string[];
}

export async function compareProjectSessions(leftId: string, rightId: string): Promise<ProjectSessionComparison> {
  const res = await fetch(`/api/project-sessions/${encodeURIComponent(leftId)}/compare/${encodeURIComponent(rightId)}`);
  if (!res.ok) throw new Error("Failed to compare Sessions.");
  return res.json();
}

export async function migrateLegacyWorkspaces(): Promise<{
  scanned: number;
  createdProjects: number;
  migratedSessions: number;
  skippedExisting: number;
}> {
  return (await apiRequest("POST", "/api/projects/migrate-legacy-workspaces", {})).json();
}

export function useInvalidateProjects() {
  const qc = useQueryClient();
  return useCallback((projectId?: number | null, chatId?: number | null) => {
    qc.invalidateQueries({ queryKey: ["/api/projects"] });
    qc.invalidateQueries({ queryKey: ["/api/quick-chats"] });
    qc.invalidateQueries({ queryKey: ["/api/project-chats"] });
    if (projectId) {
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "home"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "chats"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "resources"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "sessions"] });
    }
    if (chatId) qc.invalidateQueries({ queryKey: ["/api/project-chats", chatId, "messages"] });
  }, [qc]);
}

