import type { ArtifactDetail } from "./useArtifacts";

export interface ModelArtifactSaveRequest {
  id: number;
  runId: string;
  projectId: number;
  projectName: string;
}

export interface SavedModelArtifact {
  request: ModelArtifactSaveRequest;
  detail: ArtifactDetail;
}

export interface ModelArtifactSaveState {
  pending: ModelArtifactSaveRequest | null;
  saved: SavedModelArtifact | null;
  failure: { request: ModelArtifactSaveRequest; message: string } | null;
}

export const initialModelArtifactSaveState: ModelArtifactSaveState = {
  pending: null,
  saved: null,
  failure: null,
};

type ModelArtifactSaveAction =
  | { type: "started"; request: ModelArtifactSaveRequest }
  | { type: "saved"; request: ModelArtifactSaveRequest; detail: ArtifactDetail }
  | { type: "failed"; request: ModelArtifactSaveRequest; message: string };

export function modelArtifactSaveReducer(state: ModelArtifactSaveState, action: ModelArtifactSaveAction): ModelArtifactSaveState {
  if (action.type === "started") return { ...state, pending: action.request, failure: null };
  // A delayed completion must not replace a newer request's status or canonical target.
  if (state.pending?.id !== action.request.id) return state;
  if (action.type === "saved") return { pending: null, saved: { request: action.request, detail: action.detail }, failure: null };
  return { ...state, pending: null, failure: { request: action.request, message: action.message } };
}

export function selectedModelArtifactProject<T extends { id: number }>(destination: string, projects: readonly T[]): T | null {
  return projects.find((project) => String(project.id) === destination) ?? null;
}

export function isDisplayedModelSaved(saved: SavedModelArtifact | null, runId: string | null, projectId: number | null): boolean {
  return Boolean(saved && runId && saved.request.runId === runId && saved.request.projectId === projectId && saved.detail.artifact.projectId === projectId);
}

export function modelArtifactSaveNotice(state: ModelArtifactSaveState, runId: string | null): string | null {
  if (state.pending) {
    return `Saving completed run ${state.pending.runId} to ${state.pending.projectName}…${state.pending.runId !== runId ? " This is an earlier run, not the displayed result." : ""}`;
  }
  if (state.failure) {
    return `Could not save run ${state.failure.request.runId} to ${state.failure.request.projectName}: ${state.failure.message} The displayed model result is unchanged.`;
  }
  if (state.saved) {
    const { request, detail } = state.saved;
    return `${request.runId === runId ? "Displayed run" : "Earlier run"} ${request.runId} saved to ${request.projectName}. Artifact ${detail.artifact.id} · v${detail.version.version}.${request.runId !== runId ? " The displayed result has not been saved by this request." : ""}`;
  }
  return null;
}
