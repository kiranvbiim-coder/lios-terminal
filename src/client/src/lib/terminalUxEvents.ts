import type { PaneId, ViewMode } from "./terminalTypes";

export type TerminalUxSurface =
  | "workbench"
  | "shortcuts"
  | "macros"
  | "missions"
  | "evidence"
  | "settings"
  | "share"
  | "research-tray"
  | "innovation-studio"
  | "cognitive-core"
  | "decision-center"
  | "scenario-workbench"
  | "object-workbench"
  | "graph-explorer"
  | "workspace-composer"
  | "intelligence-pulse"
  | "impact-map"
  | "trust-ledger"
  | "decision-drift"
  | "wave-c-shell"
  | "wave-e-shell";

export interface TerminalContextMenuRequest {
  x: number;
  y: number;
  paneId: PaneId;
  view: ViewMode;
  symbol?: string;
}

const SURFACE_EVENT = "lios:open-ux-surface";
const CONTEXT_EVENT = "lios:open-context-menu";

export function openTerminalUxSurface(surface: TerminalUxSurface): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SURFACE_EVENT, { detail: surface }));
}

export function requestTerminalContextMenu(request: TerminalContextMenuRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONTEXT_EVENT, { detail: request }));
}

export function subscribeTerminalUxSurface(listener: (surface: TerminalUxSurface) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    listener(event.detail as TerminalUxSurface);
  };
  window.addEventListener(SURFACE_EVENT, handler);
  return () => window.removeEventListener(SURFACE_EVENT, handler);
}

export function subscribeTerminalContextMenu(listener: (request: TerminalContextMenuRequest) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    listener(event.detail as TerminalContextMenuRequest);
  };
  window.addEventListener(CONTEXT_EVENT, handler);
  return () => window.removeEventListener(CONTEXT_EVENT, handler);
}
