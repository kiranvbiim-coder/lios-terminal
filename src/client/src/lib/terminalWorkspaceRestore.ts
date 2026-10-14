import type { WorkspaceState } from "./terminalTypes";

export interface WorkspaceRestoreRequest {
  workspace: WorkspaceState;
  label?: string;
}

const EVENT_NAME = "lios:restore-workspace";

export function requestWorkspaceRestore(workspace: WorkspaceState, label?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { workspace, label } satisfies WorkspaceRestoreRequest }));
}

export function subscribeWorkspaceRestore(listener: (request: WorkspaceRestoreRequest) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent) || !event.detail?.workspace) return;
    listener(event.detail as WorkspaceRestoreRequest);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
