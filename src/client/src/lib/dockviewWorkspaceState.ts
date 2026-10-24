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
export const DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY = "lios.dockview.layout.tabs.v1";
export const LEGACY_DOCKVIEW_LAYOUT_STORAGE_KEYS = ["lios.dockview.layout.v1"] as const;
const MAX_SAVED_TAB_LAYOUTS = 24;
const MAX_LAYOUT_CHARS = 150_000;
const EVENT_NAME = "lios:dockview-layout-restore";

export type DockviewLayoutState = Record<string, unknown>;
interface ScopedLayout { scope: string; layout: DockviewLayoutState | null }

function isLayout(value: unknown): value is DockviewLayoutState {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validScope(scope: unknown): scope is string {
  return typeof scope === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(scope);
}
function clearLegacyDockviewLayoutState(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_DOCKVIEW_LAYOUT_STORAGE_KEYS) {
    try { window.localStorage.removeItem(key); } catch { /* Private window storage is optional. */ }
  }
}
function loadGlobalGeometry(): DockviewLayoutState | null {
  const raw = window.localStorage.getItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isLayout(parsed)) return parsed;
  } catch { /* Invalid cache; drop it below. */ }
  window.localStorage.removeItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
  return null;
}
function readTabLayouts(): ScopedLayout[] {
  const raw = window.localStorage.getItem(DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    if (raw.length > MAX_LAYOUT_CHARS * MAX_SAVED_TAB_LAYOUTS) throw new Error("oversized geometry cache");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("invalid geometry cache");
    return parsed.filter((entry): entry is ScopedLayout => Boolean(
      entry && typeof entry === "object" && validScope(entry.scope)
      && (entry.layout === null || isLayout(entry.layout)),
    )).slice(-MAX_SAVED_TAB_LAYOUTS);
  } catch {
    window.localStorage.removeItem(DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY);
    return [];
  }
}

/**
 * Dockview persists geometry only: the owning Terminal tab retains its exact
 * semantic panels, Artifact identity, source rights and version independently.
 * The legacy global v2 is an initial geometry fallback for upgraded tabs.
 */
export function loadDockviewLayoutState(scope?: string): DockviewLayoutState | null {
  if (typeof window === "undefined") return null;
  try {
    clearLegacyDockviewLayoutState();
    if (scope !== undefined) {
      if (!validScope(scope)) return null;
      const saved = readTabLayouts().find(entry => entry.scope === scope);
      if (saved) return saved.layout;
    }
    return loadGlobalGeometry();
  } catch { return null; }
}

export function saveDockviewLayoutState(layout: DockviewLayoutState | null, scope?: string): void {
  if (typeof window === "undefined" || (layout !== null && !isLayout(layout))) return;
  try {
    if (scope === undefined) {
      if (layout) window.localStorage.setItem(DOCKVIEW_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
      else window.localStorage.removeItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
      return;
    }
    if (!validScope(scope)) return;
    const serialized = layout === null ? "null" : JSON.stringify(layout);
    if (serialized.length > MAX_LAYOUT_CHARS) return;
    const retained = readTabLayouts().filter(entry => entry.scope !== scope);
    retained.push({ scope, layout });
    window.localStorage.setItem(DOCKVIEW_TAB_LAYOUTS_STORAGE_KEY, JSON.stringify(retained.slice(-MAX_SAVED_TAB_LAYOUTS)));
  } catch {
    // Failed/quota/private storage is never a reason to mutate live Workbench tabs.
  }
}

/** An explicit restore never spills into a different active Terminal tab. */
export function requestDockviewLayoutRestore(layout: DockviewLayoutState | null, scope?: string): void {
  saveDockviewLayoutState(layout, scope);
  if (typeof window === "undefined") return;
  const detail = scope !== undefined ? { type: "lios-tab-geometry", scope, layout } : layout;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
}

export function subscribeDockviewLayoutRestore(
  listener: (layout: DockviewLayoutState | null, scope?: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (isLayout(detail) && detail.type === "lios-tab-geometry") {
      if (validScope(detail.scope) && (detail.layout === null || isLayout(detail.layout))) {
        listener(detail.layout, detail.scope);
      }
    } else if (detail === null || isLayout(detail)) {
      listener(detail);
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
