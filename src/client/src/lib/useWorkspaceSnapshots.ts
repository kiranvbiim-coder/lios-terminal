import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { isAnalyticalWorkspaceStateV2, type AnalyticalWorkspaceStateV2 } from "@shared/analyticalWorkspaceState";
import { captureAnalyticalWorkspaceState, restoreAnalyticalWorkspaceState } from "./analyticalWorkspaceSnapshot";
import { getActiveWorkspaceId } from "./useWorkspaces";

export interface WorkspaceSnapshot {
  id: string;
  workspaceId: string;
  label: string;
  name: string;
  clientName: string | null;
  description: string | null;
  tags: string[];
  symbols: string[];
  analyticalState: AnalyticalWorkspaceStateV2 | null;
  savedAt: string;
  savedByUserId: number;
}

/** Manual, named checkpoints of a workspace record plus optional analytical shell state. */
export function useWorkspaceSnapshots(workspaceId: string | null) {
  return useQuery<WorkspaceSnapshot[]>({
    queryKey: ["/api/workspaces", workspaceId, "snapshots"],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/snapshots`);
      if (!res.ok) throw new Error("Failed to fetch workspace snapshots");
      return res.json();
    },
    enabled: !!workspaceId,
  });
}

export async function createWorkspaceSnapshot(
  workspaceId: string,
  label: string,
  analyticalState?: AnalyticalWorkspaceStateV2 | null,
): Promise<WorkspaceSnapshot> {
  // Only attach terminal state when the engagement being checkpointed is the
  // active workspace. This prevents a currently open AAPL analysis, for example,
  // from being accidentally saved onto an unrelated selected engagement.
  const resolvedAnalyticalState = analyticalState !== undefined
    ? analyticalState
    : getActiveWorkspaceId() === workspaceId
      ? captureAnalyticalWorkspaceState("internal")
      : null;

  const res = await fetch(`/api/workspaces/${workspaceId}/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, analyticalState: resolvedAnalyticalState }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to save snapshot");
  return res.json();
}

/**
 * Restore workspace metadata and, when the checkpoint includes V2 shell state,
 * restore the analytical terminal as well. A reload is intentional here: the
 * terminal owns substantial in-memory navigation/undo state, and rehydrating
 * from the already-persisted checkpoint is safer than leaving stale histories
 * attached to newly restored panes. Metadata-only legacy snapshots do not reload.
 */
export async function restoreWorkspaceSnapshot(
  workspaceId: string,
  snapshotId: string,
): Promise<AnalyticalWorkspaceStateV2 | null> {
  const res = await fetch(`/api/workspaces/${workspaceId}/snapshots/${snapshotId}/restore`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to restore snapshot");
  const payload: unknown = await res.json();
  if (!payload || typeof payload !== "object") return null;
  const analyticalState = (payload as { analyticalState?: unknown }).analyticalState;
  if (!isAnalyticalWorkspaceStateV2(analyticalState)) return null;

  if (restoreAnalyticalWorkspaceState(analyticalState, "internal") && typeof window !== "undefined") {
    window.location.reload();
  }
  return analyticalState;
}

export async function deleteWorkspaceSnapshot(workspaceId: string, snapshotId: string): Promise<void> {
  const res = await fetch(`/api/workspaces/${workspaceId}/snapshots/${snapshotId}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to delete snapshot");
}

export function useInvalidateWorkspaceSnapshots() {
  const queryClient = useQueryClient();
  return useCallback((workspaceId: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/workspaces", workspaceId, "snapshots"] });
  }, [queryClient]);
}
