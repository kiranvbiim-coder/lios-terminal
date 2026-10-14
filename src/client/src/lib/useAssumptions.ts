import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface SharedAssumption {
  name: string;
  value: number;
  updatedAt: string;
  updatedByUserId: number;
}

/** Workspace-scoped shared assumptions -- see server/uideEngine/assumptionStore.ts for the full design note on why this is an extension of named ranges, not a parallel system. */
export function useAssumptions(workspaceId: string | null) {
  return useQuery<SharedAssumption[]>({
    queryKey: ["/api/workspaces", workspaceId, "assumptions"],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/assumptions`);
      if (!res.ok) throw new Error("Failed to fetch assumptions");
      return res.json();
    },
    enabled: !!workspaceId,
  });
}

export async function setAssumption(workspaceId: string, name: string, value: number): Promise<SharedAssumption[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/assumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, value }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to save assumption");
  return res.json();
}

export async function deleteAssumption(workspaceId: string, name: string): Promise<SharedAssumption[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/assumptions/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to delete assumption");
  return res.json();
}

export function useInvalidateAssumptions() {
  const queryClient = useQueryClient();
  return useCallback((workspaceId: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/workspaces", workspaceId, "assumptions"] });
  }, [queryClient]);
}
