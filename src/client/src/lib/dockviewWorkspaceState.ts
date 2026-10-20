import type { PaneId } from "./terminalTypes";

export interface WorkspaceRendererState { isMobile: boolean; maximizedPane: PaneId | null }

/** Renderer identity is held only while a local Artifact draft would be lost on remount. */
export function resolveWorkspaceRendererState(
  current: WorkspaceRendererState, isMobile: boolean, maximizedPane: PaneId | null, artifactDirty: boolean,
): WorkspaceRendererState {
  return artifactDirty || (current.isMobile === isMobile && current.maximizedPane === maximizedPane)
    ? current : { isMobile, maximizedPane };
}

export const DOCKVIEW_LAYOUT_STORAGE_KEY = "lios.dockview.layout.v2";
export const LEGACY_DOCKVIEW_LAYOUT_STORAGE_KEYS = ["lios.dockview.layout.v1"] as const;

function clearLegacyDockviewLayoutState(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_DOCKVIEW_LAYOUT_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Hardened/private browser context: legacy geometry can remain inert.
    }
  }
}
const EVENT_NAME = "lios:dockview-layout-restore";

export type DockviewLayoutState = Record<string, unknown>;

export function loadDockviewLayoutState(): DockviewLayoutState | null {
  if (typeof window === "undefined") return null;
  try {
    clearLegacyDockviewLayoutState();
    const raw = window.localStorage.getItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as DockviewLayoutState;
      }
    } catch {
      // Invalid persisted geometry is discarded below.
    }
    try { window.localStorage.removeItem(DOCKVIEW_LAYOUT_STORAGE_KEY); } catch {}
    return null;
  } catch {
    return null;
  }
}

export function saveDockviewLayoutState(layout: DockviewLayoutState | null): void {
  if (typeof window === "undefined") return;
  try {
    if (layout) window.localStorage.setItem(DOCKVIEW_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    else window.localStorage.removeItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
  } catch {
    // Hardened/private browser context: layout remains in memory for this run.
  }
}

export function requestDockviewLayoutRestore(layout: DockviewLayoutState | null): void {
  saveDockviewLayoutState(layout);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: layout }));
}

export function subscribeDockviewLayoutRestore(
  listener: (layout: DockviewLayoutState | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail;
    if (detail === null) listener(null);
    else if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      listener(detail as DockviewLayoutState);
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
