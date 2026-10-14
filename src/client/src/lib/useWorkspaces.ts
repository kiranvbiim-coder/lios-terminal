import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface Workspace {
  id: string;
  name: string;
  clientName: string | null;
  description: string | null;
  symbols: string[];
  tags: string[];
  pinned: boolean;
  archived: boolean;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceImportSummary {
  symbol: string;
  fileName: string;
  importedAt: string;
  importedByUserId: number;
  reportCount: number;
}

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: ["/api/workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces");
      if (!res.ok) throw new Error("Failed to fetch workspaces");
      return res.json();
    },
  });
}

export function useWorkspace(id: string | null) {
  return useQuery<Workspace>({
    queryKey: ["/api/workspaces", id],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${id}`);
      if (!res.ok) throw new Error("Failed to fetch workspace");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useWorkspaceImports(workspaceId: string | null) {
  return useQuery<WorkspaceImportSummary[]>({
    queryKey: ["/api/uide/workspace-imports", workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/uide/workspace-imports/${workspaceId}`);
      if (!res.ok) throw new Error("Failed to fetch workspace imports");
      return res.json();
    },
    enabled: !!workspaceId,
  });
}

export async function createWorkspace(input: { name: string; clientName?: string; description?: string; symbols?: string[]; tags?: string[] }): Promise<Workspace> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to create workspace");
  return res.json();
}

export async function updateWorkspace(id: string, patch: {
  name?: string; clientName?: string | null; description?: string | null; addSymbol?: string; removeSymbol?: string;
  pinned?: boolean; archived?: boolean; addTag?: string; removeTag?: string;
}): Promise<Workspace> {
  const res = await fetch(`/api/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to update workspace");
  return res.json();
}

export async function duplicateWorkspace(id: string): Promise<Workspace> {
  const res = await fetch(`/api/workspaces/${id}/duplicate`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to duplicate workspace");
  return res.json();
}

export async function deleteWorkspace(id: string): Promise<void> {
  const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to delete workspace");
}

/** Invalidates every workspace-related query -- call after any create/update/delete. */
export function useInvalidateWorkspaces() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
    queryClient.invalidateQueries({ queryKey: ["/api/uide/workspace-imports"] });
  }, [queryClient]);
}

// ─── Active workspace (cross-panel context) ────────────────────────────────
//
// Which workspace the user is "in" right now -- persisted so it survives a
// reload. The exported getter lets non-React infrastructure (for example the
// analytical checkpoint service) verify engagement identity before attaching
// terminal state to a workspace snapshot.

const ACTIVE_WORKSPACE_KEY = "limuria.activeWorkspaceId";

export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function useActiveWorkspaceId(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(getActiveWorkspaceId);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVE_WORKSPACE_KEY) setId(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = useCallback((next: string | null) => {
    setId(next);
    try {
      if (next) localStorage.setItem(ACTIVE_WORKSPACE_KEY, next);
      else localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    } catch {
      // localStorage unavailable -- active workspace just won't persist across reloads
    }
  }, []);

  return [id, set];
}
