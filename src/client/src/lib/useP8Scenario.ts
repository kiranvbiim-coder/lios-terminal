import type {
  P8ArtifactBranchRef,
  P8AssumptionMergeRequest,
  P8CompareRequest,
  P8DecisionObjectRequest,
  P8FormulaDraft,
  P8FormulaPublish,
  P8FormulaValidation,
  P8ModelDraftRequest,
  P8ScenarioComparison,
  P8ScenarioKind,
  P8ScenarioSnapshot,
} from "@shared/p8ScenarioContracts";
import { apiRequest } from "./queryClient";
import type { ArtifactDetail, ProjectArtifactProposalRecord } from "./useArtifacts";

export async function branchP8Scenario(artifactId: string, input: { scenarioKind: Exclude<P8ScenarioKind, "base">; version?: number; title?: string }) {
  return (await apiRequest("POST", "/api/p8/artifacts/" + encodeURIComponent(artifactId) + "/branch", input)).json() as Promise<ArtifactDetail>;
}

export async function getP8ScenarioSnapshot(artifactId: string, version?: number, scenarioKind?: P8ScenarioKind): Promise<P8ScenarioSnapshot> {
  const params = new URLSearchParams();
  if (version) params.set("version", String(version));
  if (scenarioKind) params.set("scenarioKind", scenarioKind);
  const res = await fetch("/api/p8/artifacts/" + encodeURIComponent(artifactId) + "/snapshot?" + params.toString());
  if (!res.ok) throw new Error("Failed to load scenario snapshot.");
  return res.json();
}

export async function compareP8Scenarios(projectId: number, input: P8CompareRequest): Promise<P8ScenarioComparison> {
  return (await apiRequest("POST", "/api/p8/projects/" + projectId + "/scenario-compare", input)).json() as Promise<P8ScenarioComparison>;
}

export async function proposeP8AssumptionMerge(input: P8AssumptionMergeRequest) {
  return (await apiRequest("POST", "/api/p8/assumption-merge", input)).json() as Promise<{ proposal: ProjectArtifactProposalRecord; patch: Record<string, unknown> }>;
}

export async function proposeP8ModelDraft(artifactId: string, input: P8ModelDraftRequest) {
  return (await apiRequest("POST", "/api/p8/artifacts/" + encodeURIComponent(artifactId) + "/model-draft", input)).json();
}

export async function validateP8Formula(input: P8FormulaDraft): Promise<P8FormulaValidation> {
  return (await apiRequest("POST", "/api/p8/formulas/validate", input)).json() as Promise<P8FormulaValidation>;
}

export async function publishP8Formula(projectId: number, input: P8FormulaPublish) {
  return (await apiRequest("POST", "/api/p8/projects/" + projectId + "/formulas/publish", input)).json() as Promise<ArtifactDetail & { validation: P8FormulaValidation }>;
}

export async function createP8DecisionObject(projectId: number, input: P8DecisionObjectRequest) {
  return (await apiRequest("POST", "/api/p8/projects/" + projectId + "/decisions", input)).json() as Promise<ArtifactDetail>;
}

export function p8ScenarioKindForArtifact(ref: P8ArtifactBranchRef): P8ScenarioKind {
  return ref.scenarioKind;
}
