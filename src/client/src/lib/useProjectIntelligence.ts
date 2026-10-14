import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import type {
  P7ContextGraph,
  P7HistoricalState,
  P7InsightLens,
  P7ProjectSnapshot,
  P7SearchHit,
  P7TimelineEvent,
} from "@shared/p7ResearchContracts";

export interface ProjectIntelligenceSummary {
  documentCount: number;
  graph: P7ContextGraph;
  researchGraph: P7ContextGraph;
  timeline: P7TimelineEvent[];
}

export function useProjectIntelligence(projectId: number | null) {
  return useQuery<ProjectIntelligenceSummary>({
    queryKey: ["/api/projects", projectId, "intelligence"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/intelligence`);
      if (!res.ok) throw new Error("Failed to load Project Intelligence.");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
}

export function useProjectInsightLens(projectId: number | null) {
  return useQuery<P7InsightLens>({
    queryKey: ["/api/projects", projectId, "intelligence", "insights"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/intelligence/insights`);
      if (!res.ok) throw new Error("Failed to load Insight Lens.");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
}

export function useProjectIntelligenceSnapshots(projectId: number | null) {
  return useQuery<P7ProjectSnapshot[]>({
    queryKey: ["/api/projects", projectId, "intelligence", "snapshots"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/intelligence/snapshots?limit=20`);
      if (!res.ok) throw new Error("Failed to load Project Intelligence snapshots.");
      return res.json();
    },
    enabled: Boolean(projectId),
  });
}

export async function searchProjectIntelligence(projectId: number, query: string): Promise<P7SearchHit[]> {
  return (await apiRequest("POST", `/api/projects/${projectId}/intelligence/search`, { query, limit: 30 })).json();
}

export async function getProjectIntelligenceAsKnownOn(projectId: number, at: string): Promise<P7HistoricalState> {
  const res = await fetch(`/api/projects/${projectId}/intelligence/as-known-on?at=${encodeURIComponent(at)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "No retained Project Intelligence state exists for that time.");
  }
  return res.json();
}

export async function getProjectIntelligenceSnapshotState(projectId: number, snapshotId: string): Promise<P7HistoricalState> {
  const res = await fetch(`/api/projects/${projectId}/intelligence/snapshots/${encodeURIComponent(snapshotId)}/state`);
  if (!res.ok) throw new Error("Failed to load historical Project Intelligence state.");
  return res.json();
}

export async function rebuildProjectIntelligence(projectId: number): Promise<{ documentCount: number; graph: P7ContextGraph; snapshot: P7ProjectSnapshot }> {
  return (await apiRequest("POST", `/api/projects/${projectId}/intelligence/rebuild`, {})).json();
}

export function useInvalidateProjectIntelligence() {
  const qc = useQueryClient();
  return (projectId: number) => {
    qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "intelligence"] });
    qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "continuity"] });
  };
}


export async function refreshThesisArtifact(projectId: number, artifactId: string) {
  return (await apiRequest("POST", `/api/projects/${projectId}/theses/${encodeURIComponent(artifactId)}/refresh`, {})).json() as Promise<{
    version: { version: number };
    changes: string[];
    contradictions: string[];
    evidenceSnapshot: P7ProjectSnapshot;
    currentSnapshot: P7ProjectSnapshot;
  }>;
}

export async function appendThesisPostmortem(projectId: number, artifactId: string, input: {
  outcome: "validated" | "partially_validated" | "invalidated" | "closed";
  summary: string;
  whatWorked?: string[];
  whatFailed?: string[];
  evidenceRefs?: string[];
}) {
  return (await apiRequest("POST", `/api/projects/${projectId}/theses/${encodeURIComponent(artifactId)}/postmortem`, input)).json() as Promise<{ version: number }>;
}
