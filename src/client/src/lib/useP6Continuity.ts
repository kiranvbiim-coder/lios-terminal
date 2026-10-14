import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { P6ProjectContinuitySnapshot } from "@shared/p6ContinuityContracts";
import { apiRequest } from "./queryClient";

export function useP6ProjectContinuity(projectId: number | null) {
  return useQuery<P6ProjectContinuitySnapshot>({
    queryKey: ["/api/projects", projectId, "continuity"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/continuity`);
      if (!res.ok) throw new Error("Failed to load Project Continuity.");
      return res.json();
    },
    enabled: Boolean(projectId),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export async function refreshP6ProjectContinuity(projectId: number): Promise<P6ProjectContinuitySnapshot> {
  return (await apiRequest("POST", `/api/projects/${projectId}/continuity/refresh`, {})).json();
}

export function useInvalidateP6ProjectContinuity() {
  const qc = useQueryClient();
  return useCallback((projectId: number | null) => {
    if (!projectId) return;
    qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "continuity"] });
    qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "intelligence"] });
  }, [qc]);
}
