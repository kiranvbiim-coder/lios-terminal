import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface Scenario {
  name: string;
  values: Record<string, number>;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: number;
}

/** Workspace-scoped named scenarios -- see server/uideEngine/scenarioStore.ts for the full design note on why this is a layer over the Assumption Center, not a parallel system. */
export function useScenarios(workspaceId: string | null) {
  return useQuery<Scenario[]>({
    queryKey: ["/api/workspaces", workspaceId, "scenarios"],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/scenarios`);
      if (!res.ok) throw new Error("Failed to fetch scenarios");
      return res.json();
    },
    enabled: !!workspaceId,
  });
}

export async function saveScenario(workspaceId: string, name: string, values: Record<string, number>): Promise<Scenario[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/scenarios`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, values }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to save scenario");
  return res.json();
}

export async function deleteScenario(workspaceId: string, name: string): Promise<Scenario[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/scenarios/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed to delete scenario");
  return res.json();
}

export function useInvalidateScenarios() {
  const queryClient = useQueryClient();
  return useCallback((workspaceId: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/workspaces", workspaceId, "scenarios"] });
  }, [queryClient]);
}
