import type { PaneId, ViewMode } from "./terminalTypes";

export type SemanticZoomLevel = "detail" | "analysis" | "thesis";
export type AttentionLensMode = "off" | "inputs" | "outputs" | "evidence" | "risk";

export interface PaneAnalyticalState {
  zoom: SemanticZoomLevel;
  attention: AttentionLensMode;
  compareArmed: boolean;
  lastTouchedAt: number;
}

export interface PaneAnalyticalStateRestore {
  paneId: PaneId;
  view: ViewMode;
  symbol?: string;
  state: Pick<PaneAnalyticalState, "zoom" | "attention" | "compareArmed">;
}

const STORAGE_KEY = "limuria-terminal-analytical-state-v1";
const EVENT_NAME = "lios:analytical-state";

export const DEFAULT_PANE_ANALYTICAL_STATE: PaneAnalyticalState = {
  zoom: "detail",
  attention: "off",
  compareArmed: false,
  lastTouchedAt: 0,
};

function keyFor(paneId: PaneId, view: ViewMode, symbol?: string): string {
  return `${paneId}:${view}:${(symbol ?? "").trim().toUpperCase()}`;
}

function safeState(value: unknown): PaneAnalyticalState {
  const raw = value && typeof value === "object" ? value as Partial<PaneAnalyticalState> : {};
  return {
    zoom: raw.zoom === "analysis" || raw.zoom === "thesis" ? raw.zoom : "detail",
    attention: raw.attention === "inputs" || raw.attention === "outputs" || raw.attention === "evidence" || raw.attention === "risk" ? raw.attention : "off",
    compareArmed: raw.compareArmed === true,
    lastTouchedAt: typeof raw.lastTouchedAt === "number" ? raw.lastTouchedAt : 0,
  };
}

function loadAll(): Record<string, PaneAnalyticalState> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, safeState(value)]));
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, PaneAnalyticalState>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: all }));
}

export function loadPaneAnalyticalState(paneId: PaneId, view: ViewMode, symbol?: string): PaneAnalyticalState {
  return loadAll()[keyFor(paneId, view, symbol)] ?? { ...DEFAULT_PANE_ANALYTICAL_STATE };
}

export function patchPaneAnalyticalState(
  paneId: PaneId,
  view: ViewMode,
  symbol: string | undefined,
  patch: Partial<PaneAnalyticalState>,
): PaneAnalyticalState {
  const all = loadAll();
  const key = keyFor(paneId, view, symbol);
  const next = safeState({ ...(all[key] ?? DEFAULT_PANE_ANALYTICAL_STATE), ...patch, lastTouchedAt: Date.now() });
  all[key] = next;
  const ordered = Object.entries(all).sort((a, b) => b[1].lastTouchedAt - a[1].lastTouchedAt).slice(0, 240);
  saveAll(Object.fromEntries(ordered));
  return next;
}

/** Restore multiple pane contexts as one operation so a workspace checkpoint
 * does not emit a cascade of intermediate analytical-state events. */
export function restorePaneAnalyticalStates(entries: PaneAnalyticalStateRestore[]): void {
  if (typeof window === "undefined" || entries.length === 0) return;
  const all = loadAll();
  const touchedAt = Date.now();
  for (const entry of entries) {
    all[keyFor(entry.paneId, entry.view, entry.symbol)] = safeState({ ...entry.state, lastTouchedAt: touchedAt });
  }
  const ordered = Object.entries(all).sort((a, b) => b[1].lastTouchedAt - a[1].lastTouchedAt).slice(0, 240);
  saveAll(Object.fromEntries(ordered));
}

export function cycleSemanticZoom(current: SemanticZoomLevel): SemanticZoomLevel {
  return current === "detail" ? "analysis" : current === "analysis" ? "thesis" : "detail";
}

export function subscribeAnalyticalState(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
