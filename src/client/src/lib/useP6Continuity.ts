import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { p6ProjectContinuitySnapshotSchema, type P6ProjectContinuitySnapshot } from "@shared/p6ContinuityContracts";
import { apiRequest } from "./queryClient";

export function useP6ProjectContinuity(projectId: number | null) {
  return useQuery<P6ProjectContinuitySnapshot>({
    queryKey: ["/api/projects", projectId, "continuity"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/continuity`);
      if (!res.ok) throw new Error("Failed to load Project Continuity.");
      return assertProjectContinuitySnapshot(await res.json(), projectId!);
    },
    enabled: Boolean(projectId),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** Retained continuity must match every canonical Project identity before display. */
export function assertProjectContinuitySnapshot(payload: unknown, projectId: number): P6ProjectContinuitySnapshot {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("A current Project is required to view Continuity.");
  const parsed = p6ProjectContinuitySnapshotSchema.parse(payload);
  if (parsed.projectId !== projectId || parsed.graph.projectId !== projectId || parsed.dependencies.projectId !== projectId) {
    throw new Error("Project Continuity belongs to another Project; this result was not displayed.");
  }
  return parsed;
}

export async function refreshP6ProjectContinuity(projectId: number): Promise<P6ProjectContinuitySnapshot> {
  const response = await apiRequest("POST", `/api/projects/${projectId}/continuity/refresh`, {});
  return assertProjectContinuitySnapshot(await response.json(), projectId);
}

export function useInvalidateP6ProjectContinuity() {
  const qc = useQueryClient();
  return useCallback((projectId: number | null) => {
    if (!projectId) return;
    qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "continuity"] });
    qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "intelligence"] });
  }, [qc]);
}
